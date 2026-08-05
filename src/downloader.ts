import cliProgress from 'cli-progress';
import type { YTDlpWrapInstance } from './yt-dlp-wrap.js';
import { ffmpegInstallHint } from './ffmpeg.js';
import { youtubeCompatFlags } from './youtube-compat.js';

export interface DownloadResult {
  filepaths: string[];
}

export type ProgressPayload = {
  percent: number;
  totalSize?: string;
  currentSpeed?: string;
  eta?: string;
};

/** Live progress: `[download]  12.3% of 10.00MiB at 1.23MiB/s ETA 00:07` */
const LIVE_PROGRESS_RE =
  /\[download\]\s+([\d.]+)%(?:\s+of\s+(\S+))?(?:\s+at\s+(\S+))?\s+ETA\s+(\S+)/i;

/** Post-processor labels we surface while ffmpeg/embeds run after 100%. */
const POSTPROCESS_RE =
  /^\[(?<name>Merger|ExtractAudio|EmbedSubtitle|EmbedThumbnail|Metadata|ModifyChapters|SponsorBlock|VideoRemuxer|VideoConvertor|MoveFiles|ThumbnailsConvertor|SubtitlesConvertor)\]/i;

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

function humanizeError(raw: string): string {
  const lower = raw.toLowerCase();

  if (
    lower.includes('ffmpeg') ||
    lower.includes('ffprobe') ||
    lower.includes('postprocessing')
  ) {
    return [
      'Download or post-processing failed because ffmpeg/ffprobe is missing or broken.',
      '',
      ffmpegInstallHint(),
      '',
      `yt-dlp said: ${raw.trim()}`,
    ].join('\n');
  }

  if (
    lower.includes('http error 403') ||
    lower.includes('403: forbidden') ||
    lower.includes('javascript runtime') ||
    lower.includes('js challenge') ||
    lower.includes('n challenge')
  ) {
    return [
      'YouTube blocked the download (often HTTP 403) — usually because a JavaScript runtime is needed to solve YouTube challenges.',
      '',
      'easy-ytdlp now enables Node automatically. If this still fails:',
      '  1. Update the yt-dlp binary:  easy-ytdlp update-binary',
      '  2. Use Node 22+ (recommended by yt-dlp for the JS solver)',
      '  3. Or install Deno: https://deno.land  (yt-dlp’s preferred runtime)',
      '',
      'More detail: https://github.com/yt-dlp/yt-dlp/wiki/EJS',
      '',
      `yt-dlp said: ${raw.trim()}`,
    ].join('\n');
  }

  if (lower.includes('impersonat')) {
    return [
      'This site asked for browser impersonation, but the required library is not available in the standalone yt-dlp binary.',
      'Try: easy-ytdlp update-binary',
      'Or see: https://github.com/yt-dlp/yt-dlp#impersonation',
      '',
      `yt-dlp said: ${raw.trim()}`,
    ].join('\n');
  }

  if (
    lower.includes('private video') ||
    lower.includes('this video is private')
  ) {
    return 'This video is private. Login/cookies are out of scope for easy-ytdlp — see yt-dlp authentication docs if you need them.';
  }

  if (
    lower.includes('geo') ||
    lower.includes('not available in your country') ||
    lower.includes('blocked in your country')
  ) {
    return `This video appears geo-restricted or blocked in your region.\n\nyt-dlp said: ${raw.trim()}`;
  }

  if (
    lower.includes('unsupported url') ||
    lower.includes('no suitable extractor') ||
    lower.includes('unable to extract')
  ) {
    return `That URL is not supported or could not be parsed.\n\nyt-dlp said: ${raw.trim()}`;
  }

  if (lower.includes('video unavailable') || lower.includes('has been removed')) {
    return `This video is unavailable.\n\nyt-dlp said: ${raw.trim()}`;
  }

  return raw.trim() || 'Download failed for an unknown reason.';
}

const YOUTUBE_HOST_RE = /(\.|^)youtube\.com$/i;
const YOUTUBE_SHORT_HOST_RE = /(\.|^)youtu\.be$/i;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * True when the URL is a bare playlist (a `list` param with no concrete
 * video id). For these, yt-dlp's `--no-playlist` is a no-op: it still
 * extracts *every* video's metadata, which is slow and makes the
 * `--dump-json` output explode (one full JSON per entry).
 */
export function isPlaylistOnlyUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  const isYoutube =
    YOUTUBE_HOST_RE.test(host) || YOUTUBE_SHORT_HOST_RE.test(host);
  if (!isYoutube || !u.searchParams.has('list')) return false;

  // Concrete video forms: watch?v=<id>, youtu.be/<id>, /shorts|embed|live/<id>
  const v = u.searchParams.get('v') ?? '';
  if (VIDEO_ID_RE.test(v)) return false;
  if (host.endsWith('youtu.be') && u.pathname.length > 1) return false;
  if (/^\/(?:shorts|embed|live)\/[A-Za-z0-9_-]{11}/.test(u.pathname)) {
    return false;
  }
  return true;
}

/**
 * yt-dlp flags for fetching metadata of a single URL. Bare playlist URLs
 * use `--flat-playlist` so only a tiny per-entry listing is dumped;
 * video URLs keep `--no-playlist` to skip the rest of the playlist.
 *
 * `-f best` is passed explicitly so yt-dlp-wrap's getVideoInfo doesn't
 * append its own copy after the URL.
 */
function metadataArgs(url: string): string[] {
  const scopeFlags = isPlaylistOnlyUrl(url)
    ? ['--flat-playlist', '-f', 'best']
    : ['--no-playlist'];
  return [...youtubeCompatFlags(), ...scopeFlags, url];
}

type FlatPlaylistEntry = {
  id?: string;
  title?: string;
  _type?: string;
  playlist?: string | null;
  playlist_id?: string | null;
  playlist_title?: string | null;
  playlist_uploader?: string | null;
  playlist_count?: number | null;
  n_entries?: number | null;
};

/**
 * `--flat-playlist --dump-json` prints one line per entry, which
 * yt-dlp-wrap's getVideoInfo turns into an array (or a single object for
 * one-video playlists). Fold that back into one playlist-shaped metadata
 * object the wizard can display and ask questions about.
 */
function normalizePlaylistMeta(raw: unknown, url: string): unknown {
  const entries: FlatPlaylistEntry[] = Array.isArray(raw)
    ? (raw as FlatPlaylistEntry[])
    : raw && typeof raw === 'object'
      ? [raw as FlatPlaylistEntry]
      : [];
  const first = entries[0];
  if (!first) {
    // Empty/private playlist — no entries to read a title from, but keep
    // the playlist shape so the wizard still recognizes and displays it.
    return { _type: 'playlist', webpage_url: url, playlist_count: 0, entries: [] };
  }

  const count = first.playlist_count ?? first.n_entries ?? entries.length;
  return {
    _type: 'playlist',
    id: first.playlist_id ?? first.id,
    title: first.playlist_title ?? first.playlist ?? first.title,
    uploader: first.playlist_uploader,
    playlist: first.playlist_title ?? first.playlist,
    playlist_id: first.playlist_id,
    playlist_count: count,
    n_entries: count,
    webpage_url: url,
    entries,
  };
}

/**
 * Fetch video metadata via yt-dlp --dump-json (no download).
 */
export async function fetchMetadata(
  ytDlp: YTDlpWrapInstance,
  url: string,
): Promise<unknown> {
  const playlistOnly = isPlaylistOnlyUrl(url);
  try {
    const raw = await ytDlp.getVideoInfo(metadataArgs(url));
    return playlistOnly ? normalizePlaylistMeta(raw, url) : raw;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(humanizeError(msg));
  }
}

/**
 * Parse a single yt-dlp stderr/stdout line for *live* download progress.
 * Ignores completion summaries like `100% of 12MiB in 00:01` (no ETA) —
 * those were freezing the bar at 100% after the first stream finished.
 */
export function parseProgressLine(line: string): ProgressPayload | null {
  const cleaned = stripAnsi(line).trim();
  // Completion summary: "100% of 12.3MiB in 00:01 at 5MiB/s" — not live
  if (/\bin\b/i.test(cleaned) && !/\bETA\b/i.test(cleaned)) {
    return null;
  }
  const m = cleaned.match(LIVE_PROGRESS_RE);
  if (!m) return null;
  const percent = parseFloat(m[1]!);
  if (!Number.isFinite(percent)) return null;
  return {
    percent,
    totalSize: m[2],
    currentSpeed: m[3],
    eta: m[4],
  };
}

export function parsePostprocessLine(line: string): string | null {
  const cleaned = stripAnsi(line).trim();
  const m = cleaned.match(POSTPROCESS_RE);
  if (!m?.groups?.name) return null;
  const labels: Record<string, string> = {
    Merger: 'Merging video + audio…',
    ExtractAudio: 'Extracting audio…',
    EmbedSubtitle: 'Embedding subtitles…',
    EmbedThumbnail: 'Embedding thumbnail…',
    Metadata: 'Embedding metadata…',
    ModifyChapters: 'Removing sponsor segments…',
    SponsorBlock: 'SponsorBlock…',
    VideoRemuxer: 'Remuxing…',
    VideoConvertor: 'Converting…',
    MoveFiles: 'Moving file…',
    ThumbnailsConvertor: 'Processing thumbnail…',
    SubtitlesConvertor: 'Processing subtitles…',
  };
  return labels[m.groups.name] ?? `${m.groups.name}…`;
}

/**
 * Flags we inject so progress is emitted as discrete lines (needed when
 * stdout/stderr are pipes, not a TTY).
 */
export function progressFlags(): string[] {
  return ['--newline', '--progress'];
}

/**
 * Run yt-dlp with the given flags, show a progress bar, and collect
 * after_move:filepath lines printed by yt-dlp.
 *
 * Note: yt-dlp-wrap's exec() only parses progress from stdout, but yt-dlp
 * writes progress to stderr — so we parse stderr ourselves.
 */
export async function runDownload(
  ytDlp: YTDlpWrapInstance,
  flags: string[],
  options: { label?: string } = {},
): Promise<DownloadResult> {
  const filepaths: string[] = [];
  let lastError = '';
  let part = 1;

  // Leave a blank line so the bar isn't glued to clack's last log line
  console.log();

  const bar = new cliProgress.SingleBar(
    {
      // Use custom tokens — built-in `{eta}` is seconds-remaining and hits 0 at 100%
      format:
        '  {phase} |{bar}| {percentage}% | {dl_speed} | ETA {dl_eta}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false,
      // CRITICAL: must be false — YouTube DASH hits 100% per stream; stopping
      // here froze the bar while audio/merge still ran for minutes.
      stopOnComplete: false,
      forceRedraw: true,
      stream: process.stderr,
    },
    cliProgress.Presets.shades_classic,
  );

  let barStarted = false;
  let lastPercent = 0;
  let phase = options.label ? `Downloading ${options.label}` : 'Downloading';

  const ensureBar = () => {
    if (!barStarted) {
      bar.start(100, 0, {
        phase,
        dl_speed: 'starting…',
        dl_eta: '—',
      });
      barStarted = true;
    }
  };

  const updateBar = (progress: ProgressPayload) => {
    let percent = Math.min(100, Math.max(0, progress.percent));
    if (!Number.isFinite(percent)) return;

    // New stream/fragment after a finished one (e.g. video 100% → audio 0%)
    if (percent + 5 < lastPercent) {
      part += 1;
      phase = options.label
        ? `Downloading ${options.label} (${part})`
        : `Downloading (${part})`;
    }
    lastPercent = percent;

    ensureBar();
    bar.update(percent, {
      phase,
      dl_speed: progress.currentSpeed ?? 'N/A',
      dl_eta: progress.eta && progress.eta !== 'Unknown' ? progress.eta : '—',
    });
  };

  const setPhase = (label: string) => {
    phase = label;
    ensureBar();
    // Keep current percent; just refresh the label during post-processing
    bar.update(Math.min(99, Math.max(lastPercent, 1)), {
      phase,
      dl_speed: '…',
      dl_eta: '—',
    });
  };

  const handleLine = (raw: string) => {
    const trimmed = stripAnsi(raw).trim();
    if (!trimmed) return;

    const progress = parseProgressLine(trimmed);
    if (progress) {
      updateBar(progress);
      return;
    }

    const post = parsePostprocessLine(trimmed);
    if (post) {
      setPhase(post);
      return;
    }

    if (/^\[download\]\s+Destination:/i.test(trimmed)) {
      // Next file starting — don't bump to 100%, wait for live % lines
      if (lastPercent >= 99) {
        part += 1;
        lastPercent = 0;
        phase = options.label
          ? `Downloading ${options.label} (${part})`
          : `Downloading (${part})`;
        ensureBar();
        bar.update(0, {
          phase,
          dl_speed: 'starting…',
          dl_eta: '—',
        });
      }
    }
  };

  const execFlags = [...youtubeCompatFlags(), ...progressFlags(), ...flags];

  return new Promise((resolve, reject) => {
    const emitter = ytDlp.exec(execFlags) as ReturnType<
      YTDlpWrapInstance['exec']
    > & {
      on(
        event: 'progress',
        listener: (progress: {
          percent?: number;
          currentSpeed?: string;
          eta?: string;
        }) => void,
      ): unknown;
      on(event: 'error', listener: (err: Error) => void): unknown;
      on(event: 'close', listener: (code: number | null) => void): unknown;
    };

    // yt-dlp-wrap may emit from stdout; only accept finite percents
    emitter.on('progress', (progress) => {
      if (
        typeof progress.percent === 'number' &&
        Number.isFinite(progress.percent) &&
        // Ignore wrap's parse of completion lines (often lack a real ETA string)
        progress.eta
      ) {
        updateBar({
          percent: progress.percent,
          currentSpeed: progress.currentSpeed,
          eta: progress.eta,
        });
      }
    });

    ensureBar();

    const proc = emitter.ytDlpProcess;

    if (proc?.stderr) {
      let errBuf = '';
      proc.stderr.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        if (/error|errno|traceback|ffmpeg/i.test(text)) {
          lastError += text;
        }
        errBuf += text;
        const lines = errBuf.split(/\r|\n/);
        errBuf = lines.pop() ?? '';
        for (const line of lines) handleLine(line);
      });
    }

    if (proc?.stdout) {
      let buffer = '';
      proc.stdout.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = stripAnsi(line).trim();
          if (!trimmed) continue;

          handleLine(trimmed);

          if (
            !trimmed.startsWith('[') &&
            (trimmed.includes('/') || trimmed.includes('\\')) &&
            !trimmed.toLowerCase().includes('error')
          ) {
            filepaths.push(trimmed);
          }
        }
      });
    }

    emitter.on('error', (err) => {
      if (barStarted) {
        bar.stop();
        console.error();
      }
      const combined = [err.message, lastError].filter(Boolean).join('\n');
      reject(new Error(humanizeError(combined)));
    });

    emitter.on('close', (code) => {
      if (barStarted) {
        if (code === 0 || code === null) {
          bar.update(100, {
            phase: 'Done',
            dl_speed: 'done',
            dl_eta: '0s',
          });
        }
        bar.stop();
        console.error();
      }
      if (code !== 0 && code !== null) {
        reject(
          new Error(humanizeError(lastError || `yt-dlp exited with code ${code}`)),
        );
        return;
      }
      resolve({ filepaths });
    });
  });
}
