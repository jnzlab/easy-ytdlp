import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { platform } from 'node:os';
import { delimiter, join } from 'node:path';

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Check whether a command is available on PATH. */
export async function commandExists(name: string): Promise<boolean> {
  const pathEnv = process.env.PATH ?? '';
  const exts =
    platform() === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
      : [''];

  for (const dir of pathEnv.split(delimiter)) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext.toLowerCase());
      if (await isExecutable(candidate)) return true;
      // Also try original case on Windows
      const candidate2 = join(dir, name + ext);
      if (candidate2 !== candidate && (await isExecutable(candidate2))) {
        return true;
      }
    }
  }
  return false;
}

export interface FfmpegStatus {
  ffmpeg: boolean;
  ffprobe: boolean;
  ok: boolean;
}

export async function checkFfmpeg(): Promise<FfmpegStatus> {
  const ffmpeg = await commandExists('ffmpeg');
  const ffprobe = await commandExists('ffprobe');
  return { ffmpeg, ffprobe, ok: ffmpeg && ffprobe };
}

/** Platform-specific install guidance when ffmpeg is missing. */
export function ffmpegInstallHint(): string {
  const os = platform();
  const lines = [
    'ffmpeg (and ffprobe) are required for merging video+audio, extracting audio, and embedding subtitles/thumbnails.',
    '',
    'Install ffmpeg:',
  ];

  if (os === 'darwin') {
    lines.push('  brew install ffmpeg');
  } else if (os === 'win32') {
    lines.push(
      '  winget install ffmpeg',
      '  # or: choco install ffmpeg',
      '  # or download from https://ffmpeg.org/download.html',
    );
  } else {
    lines.push(
      '  # Fedora / RHEL:',
      '  sudo dnf install ffmpeg',
      '  # Debian / Ubuntu:',
      '  sudo apt install ffmpeg',
      '  # Arch:',
      '  sudo pacman -S ffmpeg',
    );
  }

  lines.push('', 'Then re-run easy-ytdlp.');
  return lines.join('\n');
}

/** Whether the chosen answers need ffmpeg for post-processing. */
export function needsFfmpeg(mode: string, extras: {
  embedSubs?: boolean;
  embedThumbnail?: boolean;
  extractAudio?: boolean;
}): boolean {
  if (mode === 'video' || mode === 'video-only') return true;
  if (mode === 'audio' || extras.extractAudio) return true;
  if (extras.embedSubs || extras.embedThumbnail) return true;
  return false;
}
