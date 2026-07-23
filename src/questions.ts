import * as p from '@clack/prompts';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  Answers,
  AudioFormat,
  ContainerPref,
  FilenamePreset,
  MediaMode,
  PlaylistMode,
  SubtitleMode,
  VideoMeta,
  VideoQuality,
} from './types.js';
import { showNote } from './ui.js';

function isCancel(value: unknown): boolean {
  return p.isCancel(value);
}

function exitOnCancel(value: unknown): asserts value is NonNullable<typeof value> {
  if (isCancel(value)) {
    p.cancel('Cancelled.');
    process.exit(0);
  }
}

function looksLikeUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatDuration(seconds?: number): string {
  if (seconds == null || Number.isNaN(seconds)) return 'unknown duration';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Unique heights from formats that have video. */
export function availableResolutions(meta: VideoMeta): number[] {
  const heights = new Set<number>();
  for (const f of meta.formats ?? []) {
    if (f.height && f.vcodec && f.vcodec !== 'none') {
      heights.add(f.height);
    }
  }
  return [...heights].sort((a, b) => b - a);
}

/** Available subtitle language codes from metadata. */
export function availableSubtitleLangs(meta: VideoMeta): string[] {
  const langs = new Set<string>();
  for (const key of Object.keys(meta.subtitles ?? {})) {
    if (key && key !== 'live_chat') langs.add(key);
  }
  // Fall back to auto-captions if no manual subs
  if (langs.size === 0) {
    for (const key of Object.keys(meta.automatic_captions ?? {})) {
      if (key && key !== 'live_chat') langs.add(key);
    }
  }
  return [...langs].sort();
}

function isPlaylistUrl(url: string, meta: VideoMeta): boolean {
  if (meta.playlist || meta._type === 'playlist') return true;
  try {
    const u = new URL(url);
    return u.searchParams.has('list');
  } catch {
    return false;
  }
}

export async function promptUrl(initial?: string): Promise<string> {
  if (initial && looksLikeUrl(initial)) return initial;

  const url = await p.text({
    message: 'Paste the video URL',
    placeholder: 'https://www.youtube.com/watch?v=…',
    initialValue: initial ?? '',
    validate: (v) => {
      if (!v?.trim()) return 'URL is required';
      if (!looksLikeUrl(v.trim())) return 'That does not look like a valid http(s) URL';
    },
  });
  exitOnCancel(url);
  return String(url).trim();
}

/**
 * Run the full adaptive question flow and return Answers.
 */
export async function askQuestions(
  url: string,
  meta: VideoMeta,
): Promise<Answers> {
  const title = meta.title ?? 'Unknown title';
  const uploader = meta.uploader ?? 'Unknown uploader';
  const duration = formatDuration(meta.duration);

  showNote(`${title}\nby ${uploader} · ${duration}`, 'Found');

  // 1. What do you want?
  const mode = await p.select({
    message: 'What do you want to download?',
    options: [
      { value: 'video' as MediaMode, label: 'Video (with audio)' },
      { value: 'audio' as MediaMode, label: 'Audio only' },
      { value: 'video-only' as MediaMode, label: 'Video only (no audio)' },
      { value: 'subs-only' as MediaMode, label: 'Subtitles only' },
      { value: 'thumbnail-only' as MediaMode, label: 'Thumbnail only' },
    ],
  });
  exitOnCancel(mode);

  let videoQuality: VideoQuality | undefined;
  let container: ContainerPref | undefined;
  let audioFormat: AudioFormat | undefined;
  let audioQuality: Answers['audioQuality'];

  // 2. Video quality + container
  if (mode === 'video' || mode === 'video-only') {
    const resolutions = availableResolutions(meta);
    const qualityOpts: { value: string; label: string }[] = [
      { value: 'best', label: 'Best available' },
      { value: '1080', label: 'Up to 1080p' },
      { value: '720', label: 'Up to 720p' },
      { value: '480', label: 'Up to 480p' },
    ];
    if (resolutions.length > 0) {
      qualityOpts.push({
        value: 'pick',
        label: 'Choose from available resolutions…',
      });
    }

    const q = await p.select({
      message: 'Video quality?',
      options: qualityOpts,
    });
    exitOnCancel(q);

    if (q === 'pick') {
      const picked = await p.select({
        message: 'Available resolutions',
        options: resolutions.map((h) => ({
          value: String(h),
          label: `${h}p`,
        })),
      });
      exitOnCancel(picked);
      videoQuality = { height: Number(picked) };
    } else if (q === 'best') {
      videoQuality = 'best';
    } else {
      videoQuality = q as '1080' | '720' | '480';
    }

    const c = await p.select({
      message: 'Container preference?',
      options: [
        { value: 'best' as ContainerPref, label: 'Best available' },
        { value: 'mp4' as ContainerPref, label: 'mp4' },
        { value: 'mkv' as ContainerPref, label: 'mkv' },
        { value: 'webm' as ContainerPref, label: 'webm' },
      ],
    });
    exitOnCancel(c);
    container = c as ContainerPref;
  }

  // 3. Audio options
  if (mode === 'audio') {
    const fmt = await p.select({
      message: 'Audio format?',
      options: [
        { value: 'mp3' as AudioFormat, label: 'mp3' },
        { value: 'm4a' as AudioFormat, label: 'm4a' },
        { value: 'opus' as AudioFormat, label: 'opus' },
        { value: 'flac' as AudioFormat, label: 'flac' },
        { value: 'wav' as AudioFormat, label: 'wav' },
        { value: 'best' as AudioFormat, label: 'Best (no convert)' },
      ],
    });
    exitOnCancel(fmt);
    audioFormat = fmt as AudioFormat;

    const aq = await p.select({
      message: 'Audio quality?',
      options: [
        { value: 'best', label: 'Best' },
        { value: 'good', label: 'Good (smaller file)' },
      ],
    });
    exitOnCancel(aq);
    audioQuality = aq as 'best' | 'good';
  }

  // 4. Subtitles
  let subMode: SubtitleMode = 'none';
  let subLangs: string[] = [];

  if (mode === 'subs-only') {
    subMode = 'write';
    const langs = availableSubtitleLangs(meta);
    if (langs.length === 0) {
      p.log.warn('No subtitle languages found in metadata — will request "all".');
      subLangs = ['all'];
    } else {
      const picked = await p.multiselect({
        message: 'Which subtitle languages?',
        options: [
          { value: 'all', label: 'All languages' },
          ...langs.map((l) => ({ value: l, label: l })),
        ],
        required: true,
      });
      exitOnCancel(picked);
      const sel = picked as string[];
      subLangs = sel.includes('all') ? ['all'] : sel;
    }
  } else if (mode !== 'thumbnail-only') {
    const wantSubs = await p.confirm({
      message: 'Download subtitles?',
      initialValue: false,
    });
    exitOnCancel(wantSubs);

    if (wantSubs) {
      const langs = availableSubtitleLangs(meta);
      if (langs.length === 0) {
        p.log.warn('No subtitle languages found — will request "all".');
        subLangs = ['all'];
      } else {
        const picked = await p.multiselect({
          message: 'Which subtitle languages?',
          options: [
            { value: 'all', label: 'All languages' },
            ...langs.map((l) => ({ value: l, label: l })),
          ],
          required: true,
        });
        exitOnCancel(picked);
        const sel = picked as string[];
        subLangs = sel.includes('all') ? ['all'] : sel;
      }

      const how = await p.select({
        message: 'How should subtitles be saved?',
        options: [
          { value: 'embed' as SubtitleMode, label: 'Embed in the video' },
          { value: 'write' as SubtitleMode, label: 'Separate .srt / subtitle file' },
          { value: 'both' as SubtitleMode, label: 'Both embed and separate file' },
        ],
      });
      exitOnCancel(how);
      subMode = how as SubtitleMode;
    }
  }

  // 5. Playlist
  let playlist: PlaylistMode = { kind: 'single' };
  if (isPlaylistUrl(url, meta)) {
    const pl = await p.select({
      message: 'This URL is part of a playlist. What should we download?',
      options: [
        { value: 'single', label: 'Just this video' },
        { value: 'all', label: 'Whole playlist' },
        { value: 'range', label: 'A specific range' },
      ],
    });
    exitOnCancel(pl);

    if (pl === 'single') {
      playlist = { kind: 'single' };
    } else if (pl === 'all') {
      playlist = { kind: 'all' };
    } else {
      const start = await p.text({
        message: 'Playlist start index (1-based)',
        initialValue: '1',
        validate: (v) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1) return 'Enter a positive integer';
        },
      });
      exitOnCancel(start);
      const stop = await p.text({
        message: 'Playlist stop index (inclusive)',
        initialValue: String(meta.playlist_count ?? 10),
        validate: (v) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1) return 'Enter a positive integer';
        },
      });
      exitOnCancel(stop);
      playlist = {
        kind: 'range',
        start: Number(start),
        stop: Number(stop),
      };
    }
  }

  // 6. Output location & filename
  const defaultDir = join(homedir(), 'Downloads');
  const outDir = await p.text({
    message: 'Destination folder',
    initialValue: defaultDir,
    validate: (v) => (!v?.trim() ? 'Folder is required' : undefined),
  });
  exitOnCancel(outDir);

  const filenamePreset = await p.select({
    message: 'Filename style?',
    options: [
      { value: 'title' as FilenamePreset, label: 'Title only' },
      {
        value: 'title-channel' as FilenamePreset,
        label: 'Title + Channel',
      },
      {
        value: 'title-date' as FilenamePreset,
        label: 'Title + Upload Date',
      },
    ],
  });
  exitOnCancel(filenamePreset);

  // 7. Extras (multi-select)
  const extras =
    mode === 'subs-only' || mode === 'thumbnail-only'
      ? []
      : await (async () => {
          const e = await p.multiselect({
            message: 'Extras (optional)',
            options: [
              {
                value: 'thumbnail',
                label: 'Embed thumbnail as cover art',
              },
              { value: 'metadata', label: 'Embed metadata' },
              {
                value: 'sponsorblock',
                label: 'SponsorBlock: remove sponsor segments',
              },
            ],
            required: false,
          });
          exitOnCancel(e);
          return e as string[];
        })();

  // 8. Confirm + show command toggle
  const selectedMode = mode as MediaMode;
  const selectedFilename = filenamePreset as FilenamePreset;

  const summaryLines = [
    `Mode: ${selectedMode}`,
    videoQuality
      ? `Quality: ${typeof videoQuality === 'object' ? `${videoQuality.height}p` : videoQuality}`
      : null,
    container ? `Container: ${container}` : null,
    audioFormat ? `Audio: ${audioFormat} (${audioQuality ?? 'best'})` : null,
    subMode !== 'none'
      ? `Subtitles: ${subMode} [${subLangs.join(', ')}]`
      : 'Subtitles: none',
    `Playlist: ${playlist.kind}${playlist.kind === 'range' ? ` ${playlist.start}:${playlist.stop}` : ''}`,
    `Output: ${String(outDir).trim()}`,
    `Filename: ${selectedFilename}`,
    extras.length ? `Extras: ${extras.join(', ')}` : 'Extras: none',
  ]
    .filter(Boolean)
    .join('\n');

  showNote(summaryLines, 'Summary');

  const showCmd = await p.confirm({
    message: 'Show the yt-dlp command before downloading?',
    initialValue: false,
  });
  exitOnCancel(showCmd);

  // Confirmation happens in cli.ts after flags are built:
  //   showCmd yes → print command → "Run this command?"
  //   showCmd no  → "Start download?"

  return {
    url,
    mode: selectedMode,
    videoQuality,
    container,
    audioFormat,
    audioQuality,
    subtitles: {
      mode: subMode,
      languages: subLangs,
    },
    playlist,
    outputDir: String(outDir).trim(),
    filenamePreset: selectedFilename,
    embedThumbnail: extras.includes('thumbnail'),
    embedMetadata: extras.includes('metadata'),
    sponsorBlock: extras.includes('sponsorblock'),
    showCommand: Boolean(showCmd),
  };
}
