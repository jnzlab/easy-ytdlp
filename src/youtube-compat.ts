import { accessSync, constants, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findDeno } from './deno.js';

/** yt-dlp's EJS wiki recommends Node 22+ for the challenge solver. */
const MIN_RECOMMENDED_MAJOR = 22;

function nodeMajor(version: string): number {
  const m = version.replace(/^v/, '').split('.')[0];
  return Number(m) || 0;
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer a Node 22+ binary for yt-dlp's JS challenge solver.
 * If the current process is older (e.g. nvm defaulted to 20) but a newer
 * nvm install exists, point yt-dlp at that instead.
 */
export function resolveNodeForYtDlp(): { path: string; major: number } {
  const currentMajor = nodeMajor(process.versions.node);
  if (currentMajor >= MIN_RECOMMENDED_MAJOR) {
    return { path: process.execPath, major: currentMajor };
  }

  const nvmDir = process.env.NVM_DIR;
  if (nvmDir) {
    const versionsRoot = join(nvmDir, 'versions', 'node');
    try {
      const dirs = readdirSync(versionsRoot)
        .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
        .sort((a, b) => {
          // Descending semver-ish by major.minor.patch
          const pa = a.slice(1).split('.').map(Number);
          const pb = b.slice(1).split('.').map(Number);
          for (let i = 0; i < 3; i++) {
            const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
            if (diff !== 0) return diff;
          }
          return 0;
        });

      for (const dir of dirs) {
        const major = nodeMajor(dir);
        if (major < MIN_RECOMMENDED_MAJOR) continue;
        const candidate = join(versionsRoot, dir, 'bin', 'node');
        if (isExecutable(candidate)) {
          return { path: candidate, major };
        }
      }
    } catch {
      // nvm dir missing or unreadable — fall through
    }
  }

  return { path: process.execPath, major: currentMajor };
}

/**
 * YouTube now requires an external JS runtime to solve challenge scripts (EJS).
 * Deno is the only runtime enabled by default; Node must be opted in explicitly.
 *
 * yt-dlp finds Deno on PATH by itself, but a Deno we just installed lives in
 * `~/.deno/bin`, which only lands on PATH in shells started later — so pass
 * its location explicitly when we can see it.
 *
 * @see https://github.com/yt-dlp/yt-dlp/wiki/EJS
 */
export function youtubeCompatFlags(): string[] {
  const { path } = resolveNodeForYtDlp();
  const deno = findDeno();
  return [
    ...(deno ? ['--js-runtimes', `deno:${deno}`] : []),
    '--js-runtimes',
    `node:${path}`,
    // Fallback if the cached binary's bundled EJS scripts are missing/outdated
    '--remote-components',
    'ejs:github',
  ];
}
