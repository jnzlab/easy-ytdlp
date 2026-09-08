import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  fetchMetadata,
  isPlaylistOnlyUrl,
  runDownload,
} from '../src/downloader.js';
import type { YTDlpWrapInstance } from '../src/yt-dlp-wrap.js';

type Scenario = {
  exit: 'close' | 'error';
  code?: number;
  stderr?: string;
  stdout?: string;
  /** What getVideoInfo should resolve with on success. */
  meta?: unknown;
  /** Error message for exit: 'error' scenarios. */
  errorMessage?: string;
};

/**
 * Fake YTDlpWrapInstance that replays a script of scenarios, one per
 * exec()/getVideoInfo() call, and records every args array.
 */
function makeFakeYtDlp(scenarios: Scenario[]): {
  ytDlp: YTDlpWrapInstance;
  calls: string[][];
} {
  const calls: string[][] = [];
  let i = 0;

  const next = (): Scenario => scenarios[Math.min(i, scenarios.length - 1)]!;

  const ytDlp = {
    exec(args: string[]) {
      calls.push(args);
      const scenario = next();
      i += 1;

      const emitter = new EventEmitter() as EventEmitter & {
        ytDlpProcess?: { stdout: PassThrough; stderr: PassThrough };
      };
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      emitter.ytDlpProcess = { stdout, stderr };

      queueMicrotask(() => {
        // Real yt-dlp always newline-terminates its output lines.
        if (scenario.stdout) stdout.write(`${scenario.stdout}\n`);
        if (scenario.stderr) stderr.write(scenario.stderr);

        if (scenario.exit === 'error') {
          stderr.end();
          stdout.end();
          emitter.emit('error', new Error(scenario.errorMessage ?? 'boom'));
        } else {
          stderr.end();
          // Emit 'close' only after stdout has fully flushed, like the
          // real child-process 'close' event fires after streams end.
          stdout.once('end', () => emitter.emit('close', scenario.code ?? 0));
          stdout.end();
        }
      });

      return emitter;
    },

    getVideoInfo(args: string[]) {
      calls.push(args);
      const scenario = next();
      i += 1;

      if (scenario.exit === 'error') {
        return Promise.reject(new Error(scenario.errorMessage ?? 'boom'));
      }
      return Promise.resolve(scenario.meta ?? { id: 'x', title: 'T' });
    },
  };

  return { ytDlp: ytDlp as unknown as YTDlpWrapInstance, calls };
}

describe('runDownload', () => {
  it('collects filepaths from stdout and resolves on close', async () => {
    const { ytDlp, calls } = makeFakeYtDlp([
      { exit: 'close', code: 0, stdout: '/tmp/downloads/video.mp4' },
    ]);

    const result = await runDownload(ytDlp, [
      '--no-playlist',
      'https://example.com/v',
    ]);

    expect(result.filepaths).toEqual(['/tmp/downloads/video.mp4']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('https://example.com/v');
  });

  it('rejects with a humanized error when yt-dlp fails', async () => {
    const { ytDlp } = makeFakeYtDlp([
      {
        exit: 'error',
        errorMessage:
          'Error code: 1\n\nStderr:\nERROR: HTTP Error 403: Forbidden',
      },
    ]);

    await expect(
      runDownload(ytDlp, ['https://example.com/v']),
    ).rejects.toThrow(/blocked|403/);
  });

  it('rejects when yt-dlp exits with a non-zero code', async () => {
    const { ytDlp } = makeFakeYtDlp([
      { exit: 'close', code: 1, stderr: 'ERROR: Unsupported URL' },
    ]);

    await expect(
      runDownload(ytDlp, ['https://example.com/v']),
    ).rejects.toThrow(/not supported/);
  });
});

describe('isPlaylistOnlyUrl', () => {
  it('detects bare playlist URLs', () => {
    expect(
      isPlaylistOnlyUrl('https://www.youtube.com/playlist?list=PL123'),
    ).toBe(true);
    expect(
      isPlaylistOnlyUrl('https://music.youtube.com/playlist?list=PL123'),
    ).toBe(true);
    // A `list` param with no video id on a watch page is still playlist-only
    expect(isPlaylistOnlyUrl('https://www.youtube.com/watch?list=PL123')).toBe(
      true,
    );
  });

  it('does not flag URLs that name a concrete video', () => {
    expect(
      isPlaylistOnlyUrl(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123',
      ),
    ).toBe(false);
    expect(
      isPlaylistOnlyUrl('https://youtu.be/dQw4w9WgXcQ?list=PL123'),
    ).toBe(false);
    expect(
      isPlaylistOnlyUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ?list=PL123'),
    ).toBe(false);
  });

  it('ignores non-YouTube and malformed URLs', () => {
    expect(isPlaylistOnlyUrl('https://example.com/playlist?list=PL123')).toBe(
      false,
    );
    expect(isPlaylistOnlyUrl('not a url')).toBe(false);
  });
});

describe('fetchMetadata', () => {
  it('passes --no-playlist for video URLs and returns the metadata as-is', async () => {
    const { ytDlp, calls } = makeFakeYtDlp([
      {
        exit: 'close',
        code: 0,
        meta: { id: 'x', title: 'T', playlist: 'Some PL', playlist_count: 20 },
      },
    ]);

    const meta = (await fetchMetadata(
      ytDlp,
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123',
    )) as { id: string };

    expect(calls[0]).toContain('--no-playlist');
    expect(calls[0]).not.toContain('--flat-playlist');
    expect(meta.id).toBe('x');
  });

  it('never lets a missing pre-merged format abort the metadata fetch', async () => {
    const { ytDlp, calls } = makeFakeYtDlp([
      { exit: 'close', code: 0, meta: { id: 'x', title: 'T' } },
      { exit: 'close', code: 0, meta: [{ id: 'a', title: 'A' }] },
    ]);

    await fetchMetadata(ytDlp, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await fetchMetadata(ytDlp, 'https://www.youtube.com/playlist?list=PL123');

    for (const args of calls) {
      // yt-dlp-wrap injects `-f best` (which YouTube often can't satisfy)
      // unless a format flag is already present.
      expect(args).toContain('-f');
      expect(args).not.toContain('best');
      expect(args).toContain('--ignore-no-formats-error');
      // The URL must stay last so flags aren't parsed as extra URLs.
      expect(args[args.length - 1]).toMatch(/^https:/);
    }
  });

  it('uses --flat-playlist for bare playlist URLs and normalizes entries', async () => {
    const { ytDlp, calls } = makeFakeYtDlp([
      {
        exit: 'close',
        code: 0,
        meta: [
          {
            id: 'a',
            title: 'Video A',
            _type: 'url',
            playlist: 'My Mix',
            playlist_title: 'My Mix',
            playlist_uploader: 'Some Channel',
            playlist_count: 2,
            n_entries: 2,
          },
          { id: 'b', title: 'Video B', _type: 'url', playlist: 'My Mix' },
        ],
      },
    ]);

    const meta = (await fetchMetadata(
      ytDlp,
      'https://www.youtube.com/playlist?list=PL123',
    )) as {
      _type: string;
      title: string;
      uploader: string;
      playlist_count: number;
      entries: unknown[];
    };

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('--flat-playlist');
    expect(calls[0]).not.toContain('--no-playlist');
    expect(meta._type).toBe('playlist');
    expect(meta.title).toBe('My Mix');
    expect(meta.uploader).toBe('Some Channel');
    expect(meta.playlist_count).toBe(2);
    expect(meta.entries).toHaveLength(2);
  });

  it('normalizes a single-entry playlist object', async () => {
    const { ytDlp } = makeFakeYtDlp([
      {
        exit: 'close',
        code: 0,
        meta: {
          id: 'a',
          title: 'Only',
          _type: 'url',
          playlist: 'Solo',
          playlist_title: 'Solo',
          playlist_uploader: 'Chan',
          n_entries: 1,
        },
      },
    ]);

    const meta = (await fetchMetadata(
      ytDlp,
      'https://www.youtube.com/playlist?list=PL1',
    )) as { _type: string; title: string; playlist_count: number };

    expect(meta._type).toBe('playlist');
    expect(meta.title).toBe('Solo');
    expect(meta.playlist_count).toBe(1);
  });

  it('keeps a playlist shape for empty playlists', async () => {
    const { ytDlp, calls } = makeFakeYtDlp([
      { exit: 'close', code: 0, meta: [] },
    ]);

    const meta = (await fetchMetadata(
      ytDlp,
      'https://www.youtube.com/playlist?list=PLempty',
    )) as { _type: string; playlist_count: number; entries: unknown[] };

    expect(calls[0]).toContain('--flat-playlist');
    expect(meta._type).toBe('playlist');
    expect(meta.playlist_count).toBe(0);
    expect(meta.entries).toEqual([]);
  });

  it('rejects with a humanized error on failure', async () => {
    const { ytDlp } = makeFakeYtDlp([
      { exit: 'error', errorMessage: 'Error code: 1\n\nStderr:\nERROR: Unsupported URL' },
    ]);

    await expect(
      fetchMetadata(ytDlp, 'https://example.com/v'),
    ).rejects.toThrow(/not supported/);
  });
});
