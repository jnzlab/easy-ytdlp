import { describe, expect, it } from 'vitest';
import {
  parsePostprocessLine,
  parseProgressLine,
  progressFlags,
} from '../src/downloader.js';
import { wrapText } from '../src/ui.js';
import { youtubeCompatFlags } from '../src/youtube-compat.js';

describe('wrapText', () => {
  it('keeps short lines intact', () => {
    expect(wrapText('hello', 40)).toBe('hello');
  });

  it('wraps long lines within width', () => {
    const long = 'a'.repeat(100);
    const wrapped = wrapText(long, 40);
    const lines = wrapped.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length <= 40)).toBe(true);
  });

  it('prefers breaking on spaces', () => {
    const text = 'alpha bravo charlie delta echo foxtrot';
    const wrapped = wrapText(text, 20);
    expect(wrapped.split('\n').every((l) => l.length <= 20)).toBe(true);
    expect(wrapped).toContain('alpha');
  });

  it('wraps each line of a multi-line command independently', () => {
    const cmd =
      'yt-dlp\n  --sponsorblock-remove default\n  --print after_move:filepath';
    const wrapped = wrapText(cmd, 80);
    expect(wrapped).toContain('--sponsorblock-remove default');
  });
});

describe('progressFlags', () => {
  it('includes newline so piped progress is parseable', () => {
    expect(progressFlags()).toEqual(['--newline', '--progress']);
  });
});

describe('youtubeCompatFlags', () => {
  it('enables a Node binary as a JS runtime', () => {
    const flags = youtubeCompatFlags();
    expect(flags).toContain('--js-runtimes');
    const runtime = flags[flags.indexOf('--js-runtimes') + 1];
    expect(runtime).toMatch(/^node:/);
    expect(flags).toContain('--remote-components');
    expect(flags).toContain('ejs:github');
  });

  it('prefers nvm Node 22+ when the active process is older', async () => {
    const { resolveNodeForYtDlp } = await import('../src/youtube-compat.js');
    const resolved = resolveNodeForYtDlp();
    const currentMajor = Number(process.versions.node.split('.')[0]);
    if (currentMajor < 22 && process.env.NVM_DIR) {
      expect(resolved.major).toBeGreaterThanOrEqual(22);
      expect(resolved.path).toContain('/versions/node/v');
    } else {
      expect(resolved.path).toBeTruthy();
    }
  });
});

describe('parseProgressLine', () => {
  it('parses live progress with ETA', () => {
    const p = parseProgressLine(
      '[download]  45.2% of  123.45MiB at    2.50MiB/s ETA 00:30',
    );
    expect(p).toEqual({
      percent: 45.2,
      totalSize: '123.45MiB',
      currentSpeed: '2.50MiB/s',
      eta: '00:30',
    });
  });

  it('ignores completion summaries without ETA (would freeze bar at 100%)', () => {
    expect(
      parseProgressLine(
        '[download] 100% of 50.00MiB in 00:05 at 10.00MiB/s',
      ),
    ).toBeNull();
  });

  it('ignores destination lines', () => {
    expect(
      parseProgressLine(
        '[download] Destination: /home/jameel/Downloads/video.f313.mp4',
      ),
    ).toBeNull();
  });

  it('strips ansi before parsing', () => {
    const p = parseProgressLine(
      '[download] \u001b[0;94m 12.0%\u001b[0m of 10.00MiB at 1.00MiB/s ETA 00:08',
    );
    expect(p?.percent).toBe(12);
    expect(p?.eta).toBe('00:08');
  });
});

describe('parsePostprocessLine', () => {
  it('maps merger / embed events to status labels', () => {
    expect(parsePostprocessLine('[Merger] Merging formats into "x.mkv"')).toBe(
      'Merging video + audio…',
    );
    expect(parsePostprocessLine('[EmbedThumbnail] Embedding…')).toBe(
      'Embedding thumbnail…',
    );
  });

  it('returns null for unrelated lines', () => {
    expect(parsePostprocessLine('[youtube] Downloading webpage')).toBeNull();
  });
});
