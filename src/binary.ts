import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import envPaths from 'env-paths';
import { YTDlpWrap, type YTDlpWrapInstance } from './yt-dlp-wrap.js';

const paths = envPaths('easy-ytdlp');
const RELEASE_BASE =
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

function binaryName(): string {
  return platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

/**
 * Pick the right GitHub release asset.
 * Prefer standalone binaries (no system Python) — matches the prompt goal.
 */
export function releaseAssetName(
  osPlatform: NodeJS.Platform = platform(),
  cpuArch: string = arch(),
): string {
  if (osPlatform === 'win32') return 'yt-dlp.exe';
  if (osPlatform === 'darwin') return 'yt-dlp_macos';
  if (osPlatform === 'linux') {
    if (cpuArch === 'arm64' || cpuArch === 'aarch64') {
      return 'yt-dlp_linux_aarch64';
    }
    return 'yt-dlp_linux';
  }
  // Fallback: platform-independent zipimport (needs Python)
  return 'yt-dlp';
}

/** Absolute path where the managed yt-dlp binary is cached. */
export function getBinaryPath(): string {
  return join(paths.cache, binaryName());
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Turn whatever yt-dlp-wrap / https throws into a readable string. */
export function formatUnknownError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const r = err as IncomingMessage & {
      statusCode?: number;
      statusMessage?: string;
      message?: string;
      code?: string;
    };
    if (typeof r.statusCode === 'number') {
      return `HTTP ${r.statusCode}${r.statusMessage ? ` ${r.statusMessage}` : ''}`;
    }
    if (typeof r.message === 'string') return r.message;
    if (typeof r.code === 'string') return r.code;
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

function friendlyBinaryError(err: unknown): Error {
  const msg = formatUnknownError(err);
  return new Error(
    [
      'Failed to download or set up the yt-dlp binary.',
      '',
      `Details: ${msg}`,
      '',
      'Common fixes:',
      '  • Check your network / proxy settings',
      '  • Ensure the cache directory is writable:',
      `      ${paths.cache}`,
      '  • Retry with: easy-ytdlp update-binary',
    ].join('\n'),
  );
}

function getOnce(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? httpRequest : httpsRequest;
    const req = lib(
      url,
      {
        headers: {
          'User-Agent': 'easy-ytdlp',
          Accept: '*/*',
        },
      },
      (res) => resolve(res),
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Download a file following redirects. Uses /releases/latest/download/…
 * so we never hit api.github.com (avoids rate-limit → opaque [object Object]).
 */
export async function downloadReleaseAsset(
  asset: string,
  destPath: string,
): Promise<void> {
  const startUrl = `${RELEASE_BASE}/${asset}`;
  let url: string | undefined = startUrl;
  let redirects = 0;

  while (url) {
    const res = await getOnce(url);
    const status = res.statusCode ?? 0;

    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume(); // drain
      const next = res.headers.location;
      url = next.startsWith('http') ? next : new URL(next, url).href;
      redirects += 1;
      if (redirects > 10) {
        throw new Error(`Too many redirects downloading ${asset}`);
      }
      continue;
    }

    if (status !== 200) {
      res.resume();
      throw new Error(
        `Download failed: HTTP ${status} ${res.statusMessage ?? ''} (${startUrl})`.trim(),
      );
    }

    await pipeline(res, createWriteStream(destPath));
    return;
  }

  throw new Error(`Download failed: no URL for ${asset}`);
}

/**
 * Ensure a yt-dlp binary is present in the OS cache dir.
 * Downloads from GitHub releases on first run (or when force=true).
 */
export async function ensureBinary(
  options: { force?: boolean; onStatus?: (msg: string) => void } = {},
): Promise<string> {
  const { force = false, onStatus } = options;
  const binPath = getBinaryPath();

  await mkdir(paths.cache, { recursive: true });

  if (!force && (await exists(binPath))) {
    return binPath;
  }

  if (force && (await exists(binPath))) {
    try {
      await unlink(binPath);
    } catch {
      // ignore
    }
  }

  const asset = releaseAssetName();
  onStatus?.(`Downloading ${asset} (one-time setup)…`);

  const tmpPath = `${binPath}.tmp`;
  try {
    if (await exists(tmpPath)) {
      await unlink(tmpPath);
    }
    await downloadReleaseAsset(asset, tmpPath);
    await chmod(tmpPath, 0o755);
    // Atomic-ish replace
    const { rename } = await import('node:fs/promises');
    await rename(tmpPath, binPath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // ignore cleanup errors
    }
    throw friendlyBinaryError(err);
  }

  onStatus?.(`yt-dlp binary ready at ${binPath}`);
  return binPath;
}

/** Force-refresh the cached yt-dlp binary. */
export async function updateBinary(
  onStatus?: (msg: string) => void,
): Promise<string> {
  return ensureBinary({ force: true, onStatus });
}

/** Create a YTDlpWrap instance pointed at the managed binary. */
export async function createYtDlp(
  options: { force?: boolean; onStatus?: (msg: string) => void } = {},
): Promise<YTDlpWrapInstance> {
  const binPath = await ensureBinary(options);
  return new YTDlpWrap(binPath);
}
