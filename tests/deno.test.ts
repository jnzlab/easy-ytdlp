import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  denoInstallCommand,
  ensureDenoOnPath,
  findDeno,
  isJsRuntimeError,
} from '../src/deno.js';

const originalPath = process.env.PATH;
const tempDirs: string[] = [];

afterEach(() => {
  process.env.PATH = originalPath;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fakeDenoDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'easy-ytdlp-deno-'));
  tempDirs.push(dir);
  const bin = join(dir, 'deno');
  writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  chmodSync(bin, 0o755);
  return dir;
}

describe('isJsRuntimeError', () => {
  it('matches the failures a JS runtime fixes', () => {
    expect(isJsRuntimeError('ERROR: unable to solve n challenge')).toBe(true);
    expect(isJsRuntimeError('HTTP Error 403: Forbidden')).toBe(true);
    expect(
      isJsRuntimeError('No JavaScript runtime available for this extractor'),
    ).toBe(true);
    // The humanized message we print must also be recognized
    expect(
      isJsRuntimeError(
        'YouTube blocked the download (often HTTP 403) — usually because a JavaScript runtime is needed to solve YouTube challenges.',
      ),
    ).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(isJsRuntimeError('ffmpeg not found')).toBe(false);
    expect(isJsRuntimeError('This video is private')).toBe(false);
  });
});

describe('denoInstallCommand', () => {
  it('returns a runnable one-liner', () => {
    expect(denoInstallCommand()).toContain('deno.land/install');
  });
});

describe('findDeno / ensureDenoOnPath', () => {
  it('finds a deno binary on PATH', () => {
    const dir = fakeDenoDir();
    process.env.PATH = dir;
    expect(findDeno()).toBe(join(dir, 'deno'));
  });

  it('returns null when no deno exists anywhere it looks', () => {
    const empty = mkdtempSync(join(tmpdir(), 'easy-ytdlp-empty-'));
    tempDirs.push(empty);
    process.env.PATH = empty;
    const home = process.env.HOME;
    process.env.HOME = empty;
    try {
      expect(findDeno()).toBeNull();
    } finally {
      process.env.HOME = home;
    }
  });

  it('prepends the deno directory to PATH exactly once', () => {
    const dir = fakeDenoDir();
    process.env.PATH = '/usr/bin';
    ensureDenoOnPath(join(dir, 'deno'));
    ensureDenoOnPath(join(dir, 'deno'));
    expect(process.env.PATH).toBe(`${dir}${delimiter}/usr/bin`);
  });
});
