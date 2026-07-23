import type {
  Answers,
  AudioQuality,
  ContainerPref,
  FilenamePreset,
  VideoQuality,
} from './types.js';

const FILENAME_TEMPLATES: Record<FilenamePreset, string> = {
  title: '%(title)s.%(ext)s',
  'title-channel': '%(title)s [%(uploader)s].%(ext)s',
  'title-date': '%(upload_date)s - %(title)s.%(ext)s',
};

function audioQualityValue(q: AudioQuality | undefined): string {
  return q === 'good' ? '5' : '0';
}

function videoQualityFlags(quality: VideoQuality | undefined): string[] {
  if (!quality || quality === 'best') {
    return ['-f', 'bv*+ba/b'];
  }
  if (typeof quality === 'object' && 'height' in quality) {
    const h = quality.height;
    return ['-f', `bv*[height=${h}]+ba/b`];
  }
  // Cap at resolution via -S res:XXXX (README Sorting Formats)
  return ['-S', `res:${quality}`, '-f', 'bv*+ba/b'];
}

function containerFlags(container: ContainerPref | undefined): string[] {
  if (!container || container === 'best') return [];
  return ['--merge-output-format', container];
}

/**
 * Maps collected interactive answers to a plain yt-dlp CLI flag array.
 * Pure function — same answers always produce the same flags.
 */
export function buildFlags(answers: Answers): string[] {
  const flags: string[] = [];

  switch (answers.mode) {
    case 'video':
      flags.push(...videoQualityFlags(answers.videoQuality));
      flags.push(...containerFlags(answers.container));
      break;

    case 'video-only':
      if (
        answers.videoQuality &&
        answers.videoQuality !== 'best' &&
        typeof answers.videoQuality !== 'object'
      ) {
        flags.push('-S', `res:${answers.videoQuality}`, '-f', 'bv');
      } else if (
        typeof answers.videoQuality === 'object' &&
        answers.videoQuality?.height
      ) {
        flags.push('-f', `bv[height=${answers.videoQuality.height}]`);
      } else {
        flags.push('-f', 'bv');
      }
      flags.push(...containerFlags(answers.container));
      break;

    case 'audio':
      flags.push(
        '-x',
        '--audio-format',
        answers.audioFormat ?? 'best',
        '--audio-quality',
        audioQualityValue(answers.audioQuality),
      );
      break;

    case 'subs-only':
      flags.push('--skip-download', '--write-subs');
      break;

    case 'thumbnail-only':
      flags.push('--skip-download', '--write-thumbnail');
      break;
  }

  // Subtitles (unless already handled as subs-only)
  if (answers.mode === 'subs-only') {
    const langs =
      answers.subtitles.languages.length > 0
        ? answers.subtitles.languages.join(',')
        : 'all';
    flags.push('--sub-langs', langs);
  } else if (
    answers.subtitles.mode !== 'none' &&
    answers.mode !== 'thumbnail-only'
  ) {
    const langs =
      answers.subtitles.languages.length > 0
        ? answers.subtitles.languages.join(',')
        : 'all';
    flags.push('--sub-langs', langs);

    if (
      answers.subtitles.mode === 'write' ||
      answers.subtitles.mode === 'both'
    ) {
      flags.push('--write-subs');
    }
    if (
      answers.subtitles.mode === 'embed' ||
      answers.subtitles.mode === 'both'
    ) {
      flags.push('--embed-subs');
    }
  }

  // Playlist handling
  switch (answers.playlist.kind) {
    case 'single':
      flags.push('--no-playlist');
      break;
    case 'all':
      flags.push('--yes-playlist');
      break;
    case 'range':
      flags.push(
        '--yes-playlist',
        '-I',
        `${answers.playlist.start}:${answers.playlist.stop}`,
      );
      break;
  }

  // Output path + filename template
  flags.push('-P', answers.outputDir);
  flags.push('-o', FILENAME_TEMPLATES[answers.filenamePreset]);

  // Extras
  if (answers.embedThumbnail && answers.mode !== 'thumbnail-only') {
    flags.push('--embed-thumbnail');
  }
  if (answers.embedMetadata) {
    flags.push('--embed-metadata');
  }
  if (answers.sponsorBlock) {
    flags.push('--sponsorblock-remove', 'default');
  }

  // Always print final path after post-processing
  flags.push('--print', 'after_move:filepath');

  // URL last (yt-dlp accepts URL anywhere, but trailing is conventional)
  flags.push(answers.url);

  return flags;
}

/** Format a flag array as a shell-displayable command string (display only). */
export function formatCommand(flags: string[]): string {
  const quoted = flags.map((f) =>
    /[\s"'\\]/.test(f) ? JSON.stringify(f) : f,
  );
  // One flag (or flag+value) per line so terminals don't wrap mid-token
  // and smash clack/box UI.
  const parts: string[] = ['yt-dlp'];
  for (let i = 0; i < quoted.length; i++) {
    const cur = quoted[i]!;
    const next = quoted[i + 1];
    if (cur.startsWith('-') && next && !next.startsWith('-') && !looksLikeUrl(next)) {
      parts.push(`${cur} ${next}`);
      i++;
    } else {
      parts.push(cur);
    }
  }
  return parts.join('\n  ');
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || s.startsWith('"http');
}

export { FILENAME_TEMPLATES };
