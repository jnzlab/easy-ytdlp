import * as p from '@clack/prompts';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  Answers,
  AudioFormat,
  AudioQuality,
  ContainerPref,
  FilenamePreset,
  MediaMode,
  PlaylistMode,
  SubtitleMode,
  VideoMeta,
  VideoQuality,
} from './types.js';
import { loadPreferences, savePreferences } from './preferences.js';
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

/** Split user-provided text into individual URLs (space, comma, or newline separated). */
function splitUrlList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatDuration(seconds?: number): string {
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

export function modeLabel(mode: MediaMode): string {
  const labels: Record<MediaMode, string> = {
    video: 'Video with audio',
    audio: 'Audio only',
    'video-only': 'Video only',
    'subs-only': 'Subtitles only',
    'thumbnail-only': 'Thumbnail only',
  };
  return labels[mode];
}

export function filenameLabel(preset: FilenamePreset): string {
  const labels: Record<FilenamePreset, string> = {
    title: 'Title only',
    'title-channel': 'Title + Channel',
    'title-date': 'Title + Upload Date',
  };
  return labels[preset];
}

export function playlistLabel(playlist: PlaylistMode): string {
  if (playlist.kind === 'single') return 'Just this video';
  if (playlist.kind === 'all') return 'Whole playlist';
  return `Playlist items ${playlist.start}:${playlist.stop}`;
}

export function videoQualityLabel(quality?: VideoQuality): string {
  if (!quality || quality === 'best') return 'Best available';
  if (typeof quality === 'object') return `${quality.height}p`;
  return `Up to ${quality}p`;
}

export function summarizeAnswers(answers: Answers, sourceCount = answers.urls.length): string {
  const lines = [
    'Download',
    `  Mode        ${modeLabel(answers.mode)}`,
    answers.mode === 'video' || answers.mode === 'video-only'
      ? `  Quality     ${videoQualityLabel(answers.videoQuality)}`
      : null,
    answers.container ? `  Container   ${answers.container}` : null,
    answers.mode === 'audio'
      ? `  Audio       ${answers.audioFormat ?? 'best'} (${answers.audioQuality ?? 'best'})`
      : null,
    '',
    'Sources',
    `  URLs        ${sourceCount}`,
    `  Playlist    ${playlistLabel(answers.playlist)}`,
    '',
    'Output',
    `  Folder      ${answers.outputDir}`,
    `  Filename    ${filenameLabel(answers.filenamePreset)}`,
    '',
    'Extras',
    answers.subtitles.mode !== 'none'
      ? `  Subtitles   ${answers.subtitles.mode} [${answers.subtitles.languages.join(', ')}]`
      : '  Subtitles   none',
    answers.embedThumbnail ? '  Thumbnail   embed' : null,
    answers.embedMetadata ? '  Metadata    embed' : null,
    answers.sponsorBlock ? '  SponsorBlock remove segments' : null,
  ];

  return lines.filter((line) => line != null).join('\n');
}

export async function promptUrls(initial?: string[]): Promise<string[]> {
  if (initial && initial.length > 0) {
    for (const u of initial) {
      if (!looksLikeUrl(u)) {
        p.log.error(`Invalid URL: ${u}`);
        process.exit(1);
      }
    }
    return initial;
  }

  const input = await p.text({
    message: 'Paste video URL(s)',
    placeholder: 'One or more URLs, separated by spaces or commas',
    initialValue: '',
    validate: (v) => {
      if (!v?.trim()) return 'At least one URL is required';
      const urls = splitUrlList(v.trim());
      if (urls.length === 0) return 'At least one valid URL is required';
      for (const u of urls) {
        if (!looksLikeUrl(u)) return `Invalid URL: ${u}`;
      }
    },
  });
  exitOnCancel(input);
  return splitUrlList(String(input).trim());
}

/**
 * Run the full adaptive question flow and return Answers.
 */
export async function askQuestions(
  url: string,
  meta: VideoMeta,
): Promise<Answers> {
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
  const selectedMode = mode as MediaMode;

  let videoQuality: VideoQuality | undefined;
  let container: ContainerPref | undefined =
    selectedMode === 'video' || selectedMode === 'video-only' ? 'best' : undefined;
  let audioFormat: AudioFormat | undefined;
  let audioQuality: AudioQuality | undefined;
  let subMode: SubtitleMode = 'none';
  let subLangs: string[] = [];
  let playlist: PlaylistMode = { kind: 'single' };
  let filenamePreset: FilenamePreset = 'title';
  let extras: string[] = [];

  if (selectedMode === 'video' || selectedMode === 'video-only') {
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
  }

  if (selectedMode === 'audio') {
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

  if (selectedMode === 'subs-only') {
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
  }

  const prefs = await loadPreferences();
  const defaultDir = prefs.outputDir ?? join(homedir(), 'Downloads');
  const outDir = await p.text({
    message: 'Destination folder',
    initialValue: defaultDir,
    validate: (v) => (!v?.trim() ? 'Folder is required' : undefined),
  });
  exitOnCancel(outDir);
  const outputDir = String(outDir).trim();
  await savePreferences({ ...prefs, outputDir });

  const customize =
    selectedMode === 'subs-only' || selectedMode === 'thumbnail-only'
      ? false
      : await p.confirm({
          message: 'Customize advanced options?',
          initialValue: false,
        });
  exitOnCancel(customize);

  if (customize && (selectedMode === 'video' || selectedMode === 'video-only')) {
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

  if (customize && selectedMode !== 'thumbnail-only') {
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

    const pickedFilename = await p.select({
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
    exitOnCancel(pickedFilename);
    filenamePreset = pickedFilename as FilenamePreset;

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
    extras = e as string[];
  }

  const answers: Answers = {
    urls: [url],
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
    outputDir,
    filenamePreset,
    embedThumbnail: extras.includes('thumbnail'),
    embedMetadata: extras.includes('metadata'),
    sponsorBlock: extras.includes('sponsorblock'),
    showCommand: false,
  };

  showNote(summarizeAnswers(answers), 'Summary');
  return answers;
}
