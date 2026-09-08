import { Command } from 'commander';
import * as p from '@clack/prompts';
import { readFileSync } from 'node:fs';
import { createYtDlp, updateBinary } from './binary.js';
import { buildFlags, formatCommand } from './builder.js';
import { fetchMetadata, runDownload } from './downloader.js';
import {
  checkFfmpeg,
  ffmpegInstallHint,
  needsFfmpeg,
} from './ffmpeg.js';
import {
  askQuestions,
  promptUrls,
  formatDuration,
  summarizeAnswers,
} from './questions.js';
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
import { showCommand, showSaved, showNote } from './ui.js';
import { youtubeCompatFlags } from './youtube-compat.js';
import { progressFlags } from './downloader.js';

/** Read the version from package.json so it can never drift from npm. */
function readCliVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const CLI_VERSION = readCliVersion();

type CliOptions = {
  showCommand?: boolean;
  batchFile?: string;
  yes?: boolean;
  mode?: string;
  quality?: string;
  container?: string;
  audioFormat?: string;
  audioQuality?: string;
  output?: string;
  filename?: string;
  subs?: string;
  subLangs?: string;
  playlist?: string;
  playlistRange?: string;
  embedThumbnail?: boolean;
  embedMetadata?: boolean;
  sponsorblock?: boolean;
};

function fail(message: string): never {
  p.log.error(message);
  process.exit(1);
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], name: string, fallback: T): T {
  if (value == null) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  fail(`Invalid ${name}: ${value}. Expected one of: ${allowed.join(', ')}`);
}

function parseQuality(value: string | undefined): VideoQuality {
  if (!value || value === 'best') return 'best';
  if (value === '1080' || value === '720' || value === '480') return value;
  const height = Number(value.replace(/p$/i, ''));
  if (Number.isInteger(height) && height > 0) return { height };
  fail(`Invalid quality: ${value}. Use best, 1080, 720, 480, or a height like 1440.`);
}

function parsePlaylist(options: CliOptions): PlaylistMode {
  const kind = pick(
    options.playlist,
    ['single', 'all', 'range'] as const,
    'playlist',
    'single',
  );
  if (kind !== 'range') return { kind };

  if (!options.playlistRange) {
    fail('--playlist range requires --playlist-range <start:stop>');
  }
  const [startRaw, stopRaw] = options.playlistRange.split(':');
  const start = Number(startRaw);
  const stop = Number(stopRaw);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(stop) ||
    start < 1 ||
    stop < start
  ) {
    fail('Invalid --playlist-range. Use a 1-based inclusive range like 2:5.');
  }
  return { kind: 'range', start, stop };
}

function parseLanguages(value: string | undefined): string[] {
  return value
    ? value
        .split(',')
        .map((lang) => lang.trim())
        .filter(Boolean)
    : [];
}

function compactTitle(title: string, max = 72): string {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

function answersFromOptions(urls: string[], options: CliOptions): Answers {
  const mode = pick(
    options.mode,
    ['video', 'audio', 'video-only', 'subs-only', 'thumbnail-only'] as const,
    'mode',
    'video',
  ) as MediaMode;
  const subtitlesMode = pick(
    options.subs,
    ['none', 'embed', 'write', 'both'] as const,
    'subs',
    mode === 'subs-only' ? 'write' : 'none',
  ) as SubtitleMode;

  return {
    urls,
    mode,
    videoQuality:
      mode === 'video' || mode === 'video-only'
        ? parseQuality(options.quality)
        : undefined,
    container:
      mode === 'video' || mode === 'video-only'
        ? (pick(
            options.container,
            ['best', 'mp4', 'mkv', 'webm'] as const,
            'container',
            'best',
          ) as ContainerPref)
        : undefined,
    audioFormat:
      mode === 'audio'
        ? (pick(
            options.audioFormat,
            ['best', 'mp3', 'm4a', 'opus', 'flac', 'wav'] as const,
            'audio-format',
            'best',
          ) as AudioFormat)
        : undefined,
    audioQuality:
      mode === 'audio'
        ? (pick(
            options.audioQuality,
            ['best', 'good'] as const,
            'audio-quality',
            'best',
          ) as AudioQuality)
        : undefined,
    subtitles: {
      mode: subtitlesMode,
      languages: parseLanguages(options.subLangs),
    },
    playlist: parsePlaylist(options),
    outputDir: options.output ?? process.cwd(),
    filenamePreset: pick(
      options.filename,
      ['title', 'title-channel', 'title-date'] as const,
      'filename',
      'title',
    ) as FilenamePreset,
    embedThumbnail: Boolean(options.embedThumbnail),
    embedMetadata: Boolean(options.embedMetadata),
    sponsorBlock: Boolean(options.sponsorblock),
    showCommand: Boolean(options.showCommand),
  };
}

function displayFlagsForAnswers(answers: Answers): string[] {
  const urls =
    answers.urls.length > 1 ? [answers.urls[0]!] : answers.urls;
  return [
    ...youtubeCompatFlags(),
    ...progressFlags(),
    ...buildFlags({ ...answers, urls }),
  ];
}

function showCommandForAnswers(answers: Answers): void {
  if (answers.urls.length > 1) {
    p.log.info('Showing the command for the first URL. It will be repeated for each URL.');
  }
  showCommand(formatCommand(displayFlagsForAnswers(answers)));
}

async function confirmStart(answers: Answers): Promise<'start' | 'change'> {
  while (true) {
    const action = await p.select({
      message: 'Ready?',
      options: [
        { value: 'start', label: 'Start download' },
        { value: 'show-command', label: 'Show yt-dlp command' },
        { value: 'change', label: 'Change settings' },
        { value: 'cancel', label: 'Cancel' },
      ],
    });

    if (p.isCancel(action) || action === 'cancel') {
      p.cancel('Cancelled.');
      process.exit(0);
    }
    if (action === 'show-command') {
      showCommandForAnswers(answers);
      continue;
    }
    return action as 'start' | 'change';
  }
}

async function ensureFfmpegIfNeeded(answers: Answers): Promise<void> {
  if (
    !needsFfmpeg(answers.mode, {
      embedSubs:
        answers.subtitles.mode === 'embed' ||
        answers.subtitles.mode === 'both',
      embedThumbnail: answers.embedThumbnail,
      extractAudio: answers.mode === 'audio',
      remuxVideo: answers.container != null && answers.container !== 'best',
    })
  ) {
    return;
  }

  const status = await checkFfmpeg();
  if (status.ok) return;

  p.log.warn(
    [
      'ffmpeg/ffprobe not found on PATH.',
      ffmpegInstallHint(),
    ].join('\n\n'),
  );
  const cont = await p.confirm({
    message: 'Continue anyway? (download may fail at merge/extract)',
    initialValue: false,
  });
  if (p.isCancel(cont) || !cont) {
    p.cancel('Cancelled.');
    process.exit(0);
  }
}

async function runDownloads(
  ytDlp: Awaited<ReturnType<typeof createYtDlp>>,
  answers: Answers,
): Promise<string[]> {
  const allPaths: string[] = [];

  for (let i = 0; i < answers.urls.length; i++) {
    const url = answers.urls[i]!;
    const label =
      answers.urls.length > 1 ? `${i + 1} of ${answers.urls.length}` : undefined;
    const flags = buildFlags({ ...answers, urls: [url] });

    if (label) p.log.info(`Download ${label}`);

    try {
      const result = await runDownload(ytDlp, flags, { label });
      allPaths.push(...result.filepaths);
    } catch (err) {
      if (answers.urls.length === 1) throw err;
      p.log.warn(err instanceof Error ? err.message : String(err));
    }
  }

  return allPaths;
}

async function runWizard(urlsArg?: string[], opts: CliOptions = {}) {
  p.intro('easy-ytdlp');

  const spinner = p.spinner();
  spinner.start('Preparing yt-dlp binary…');
  let ytDlp;
  try {
    ytDlp = await createYtDlp({
      onStatus: (msg) => {
        spinner.message(msg);
      },
    });
    spinner.stop('yt-dlp ready');
  } catch (err) {
    spinner.stop('Binary setup failed');
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const urls = await promptUrls(urlsArg);

  if (opts.yes) {
    const answers = answersFromOptions(urls, opts);
    showNote(summarizeAnswers(answers), 'Summary');
    if (answers.showCommand) {
      showCommandForAnswers(answers);
    }
    await ensureFfmpegIfNeeded(answers);
    p.log.info('Starting download…');
    try {
      const filepaths = await runDownloads(ytDlp, answers);
      if (filepaths.length > 0) {
        showSaved(filepaths);
      } else {
        p.log.success('Done. (No filepath printed — check your output folder.)');
        p.log.info(`Output folder: ${answers.outputDir}`);
      }
      p.outro('Finished');
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
      p.outro('Failed');
      process.exit(1);
    }
    return;
  }

  // Fetch metadata for all URLs in parallel to display info for each
  spinner.start('Fetching video info…');
  const metaResults = await Promise.allSettled(
    urls.map((u) => fetchMetadata(ytDlp, u)),
  );

  type VideoInfo = {
    url: string;
    meta: VideoMeta;
    title: string;
    uploader: string;
    duration: string;
  };
  const videoInfos: VideoInfo[] = [];
  const failedUrls: string[] = [];

  for (let i = 0; i < metaResults.length; i++) {
    const r = metaResults[i]!;
    const u = urls[i]!;
    if (r.status === 'fulfilled') {
      const m = r.value as VideoMeta;
      const isPlaylist = m._type === 'playlist';
      videoInfos.push({
        url: u,
        meta: m,
        title: m.title ?? 'Unknown title',
        uploader: m.uploader ?? 'Unknown uploader',
        duration: isPlaylist
          ? `${m.playlist_count ?? '?'} videos`
          : formatDuration(m.duration),
      });
    } else {
      failedUrls.push(u);
    }
  }

  if (videoInfos.length === 0) {
    spinner.stop('Could not fetch metadata');
    const reasons = metaResults
      .filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      )
      .map((r) =>
        r.reason instanceof Error ? r.reason.message : String(r.reason),
      );
    p.log.error(
      [
        'Failed to fetch metadata for any of the provided URLs.',
        ...new Set(reasons),
      ].join('\n\n'),
    );
    process.exit(1);
  }

  spinner.stop('Metadata loaded');

  // Show 'Found' note with all successfully fetched video info
  if (videoInfos.length === 1) {
    const v = videoInfos[0]!;
    showNote(`${v.title}\nby ${v.uploader} · ${v.duration}`, 'Found');
  } else {
    const lines = videoInfos.map(
      (v, index) =>
        `${index + 1}. ${compactTitle(v.title)}\n   by ${v.uploader} · ${v.duration}`,
    );
    showNote(lines.join('\n\n'), `Found (${videoInfos.length} videos)`);
  }

  // Warn about any failed URLs
  if (failedUrls.length > 0) {
    p.log.warn(
      `Could not fetch metadata for ${failedUrls.length} URL(s). They will still be downloaded with shared settings.`,
    );
  }

  // Use the first successful URL's metadata for question context
  const primary = videoInfos[0]!;
  if (urls.length > 1) {
    p.log.info(`Using shared settings based on: ${primary.title}`);
  }

  let answers: Answers;
  while (true) {
    answers = await askQuestions(primary.url, primary.meta);
    // Use all user-provided URLs, not just the first one
    answers.urls = urls;
    if (opts.showCommand) {
      answers.showCommand = true;
    }
    if (answers.showCommand) {
      showCommandForAnswers(answers);
    }

    const action = await confirmStart(answers);
    if (action === 'start') break;
  }

  await ensureFfmpegIfNeeded(answers);

  p.log.info('Starting download…');
  try {
    const filepaths = await runDownloads(ytDlp, answers);
    if (filepaths.length > 0) {
      showSaved(filepaths);
    } else {
      p.log.success('Done. (No filepath printed — check your output folder.)');
      p.log.info(`Output folder: ${answers.outputDir}`);
    }
    p.outro('Finished');
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
    p.outro('Failed');
    process.exit(1);
  }
}

async function runUpdateBinary() {
  p.intro('easy-ytdlp update-binary');
  const spinner = p.spinner();
  spinner.start('Refreshing yt-dlp binary…');
  try {
    const path = await updateBinary((msg) => spinner.message(msg));
    spinner.stop(`Updated: ${path}`);
    p.outro('Binary update complete');
  } catch (err) {
    spinner.stop('Update failed');
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const program = new Command();

program
  .name('easy-ytdlp')
  .description(
    'Interactive, user-friendly wrapper around yt-dlp — no flag memorization required',
  )
  .version(CLI_VERSION)
  .argument('[urls...]', 'One or more video URLs (prompted if omitted)')
  .option(
    '--show-command',
    'Always show the generated yt-dlp command before running',
  )
  .option(
    '-a, --batch-file <path>',
    'File containing URLs to download, one per line',
  )
  .option('-y, --yes', 'Run without interactive prompts using defaults/options')
  .option(
    '--mode <mode>',
    'Download mode: video, audio, video-only, subs-only, thumbnail-only',
  )
  .option('--quality <quality>', 'Video quality: best, 1080, 720, 480, or height')
  .option('--container <container>', 'Container: best, mp4, mkv, webm')
  .option('--audio-format <format>', 'Audio format: best, mp3, m4a, opus, flac, wav')
  .option('--audio-quality <quality>', 'Audio quality: best, good')
  .option('-o, --output <dir>', 'Destination folder')
  .option('--filename <preset>', 'Filename preset: title, title-channel, title-date')
  .option('--subs <mode>', 'Subtitle mode: none, embed, write, both')
  .option('--sub-langs <langs>', 'Comma-separated subtitle languages, for example en,es')
  .option('--playlist <mode>', 'Playlist mode: single, all, range')
  .option('--playlist-range <range>', 'Playlist range for --playlist range, for example 2:5')
  .option('--embed-thumbnail', 'Embed thumbnail as cover art')
  .option('--embed-metadata', 'Embed metadata')
  .option('--sponsorblock', 'Remove SponsorBlock default segments')
  .action(async (urls: string[] | undefined, options: CliOptions) => {
    let allUrls = urls ?? [];
    if (options.batchFile) {
      let content: string;
      try {
        content = readFileSync(options.batchFile, 'utf-8');
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        p.log.error(`Could not read batch file "${options.batchFile}": ${detail}`);
        process.exit(1);
      }
      const fileUrls = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      allUrls = [...allUrls, ...fileUrls];
    }
    if (options.yes && allUrls.length === 0) {
      fail('--yes requires at least one URL or --batch-file.');
    }
    await runWizard(allUrls.length > 0 ? allUrls : undefined, {
      ...options,
    });
  });

program
  .command('update-binary')
  .description('Force-refresh the cached yt-dlp binary')
  .action(async () => {
    await runUpdateBinary();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
