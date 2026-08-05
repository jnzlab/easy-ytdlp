import { describe, expect, it } from 'vitest';
import { buildFlags, formatCommand, FILENAME_TEMPLATES } from '../src/builder.js';
import type { Answers } from '../src/types.js';

function base(overrides: Partial<Answers> = {}): Answers {
  return {
    urls: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    mode: 'video',
    videoQuality: 'best',
    container: 'best',
    subtitles: { mode: 'none', languages: [] },
    playlist: { kind: 'single' },
    outputDir: '/home/user/Downloads',
    filenamePreset: 'title',
    embedThumbnail: false,
    embedMetadata: false,
    sponsorBlock: false,
    showCommand: false,
    ...overrides,
  };
}

describe('buildFlags', () => {
  it('maps best video + audio to bv*+ba/b', () => {
    const flags = buildFlags(base());
    expect(flags).toContain('-f');
    expect(flags[flags.indexOf('-f') + 1]).toBe('bv*+ba/b');
    expect(flags).toContain('--no-playlist');
    expect(flags).toContain('-P');
    expect(flags).toContain('/home/user/Downloads');
    expect(flags).toContain('-o');
    expect(flags).toContain(FILENAME_TEMPLATES.title);
    expect(flags).toContain('--print');
    expect(flags).toContain('after_move:filepath');
    expect(flags).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('maps capped resolution via -S res:XXXX', () => {
    const flags = buildFlags(base({ videoQuality: '720' }));
    expect(flags).toContain('-S');
    expect(flags[flags.indexOf('-S') + 1]).toBe('res:720');
    expect(flags).toContain('bv*+ba/b');
  });

  it('maps specific height from metadata', () => {
    const flags = buildFlags(base({ videoQuality: { height: 1440 } }));
    expect(flags).toContain('bv*[height=1440]+ba/b');
  });

  it('maps container preference', () => {
    const flags = buildFlags(base({ container: 'mp4' }));
    expect(flags).toContain('--merge-output-format');
    expect(flags).toContain('mp4');
  });

  it('maps video-only mode', () => {
    const flags = buildFlags(base({ mode: 'video-only', videoQuality: 'best' }));
    expect(flags).toContain('-f');
    expect(flags[flags.indexOf('-f') + 1]).toBe('bv');
  });

  it('maps video-only with height cap', () => {
    const flags = buildFlags(
      base({ mode: 'video-only', videoQuality: '480' }),
    );
    expect(flags).toContain('-S');
    expect(flags).toContain('res:480');
    expect(flags).toContain('bv');
  });

  it('maps audio extraction', () => {
    const flags = buildFlags(
      base({
        mode: 'audio',
        audioFormat: 'mp3',
        audioQuality: 'good',
        videoQuality: undefined,
        container: undefined,
      }),
    );
    expect(flags).toContain('-x');
    expect(flags).toContain('--audio-format');
    expect(flags).toContain('mp3');
    expect(flags).toContain('--audio-quality');
    expect(flags).toContain('5');
  });

  it('maps audio best quality to 0', () => {
    const flags = buildFlags(
      base({
        mode: 'audio',
        audioFormat: 'flac',
        audioQuality: 'best',
      }),
    );
    expect(flags).toContain('0');
  });

  it('maps subtitles-only', () => {
    const flags = buildFlags(
      base({
        mode: 'subs-only',
        subtitles: { mode: 'write', languages: ['en', 'es'] },
      }),
    );
    expect(flags).toContain('--skip-download');
    expect(flags).toContain('--write-subs');
    expect(flags).toContain('--sub-langs');
    expect(flags).toContain('en,es');
  });

  it('maps thumbnail-only', () => {
    const flags = buildFlags(base({ mode: 'thumbnail-only' }));
    expect(flags).toContain('--skip-download');
    expect(flags).toContain('--write-thumbnail');
  });

  it('maps embed and write subtitles', () => {
    const flags = buildFlags(
      base({
        subtitles: { mode: 'both', languages: ['all'] },
      }),
    );
    expect(flags).toContain('--write-subs');
    expect(flags).toContain('--embed-subs');
    expect(flags).toContain('--sub-langs');
    expect(flags).toContain('all');
  });

  it('maps embed-only subtitles', () => {
    const flags = buildFlags(
      base({
        subtitles: { mode: 'embed', languages: ['en'] },
      }),
    );
    expect(flags).toContain('--embed-subs');
    expect(flags).not.toContain('--write-subs');
  });

  it('maps playlist all', () => {
    const flags = buildFlags(base({ playlist: { kind: 'all' } }));
    expect(flags).toContain('--yes-playlist');
    expect(flags).not.toContain('--no-playlist');
  });

  it('maps playlist range', () => {
    const flags = buildFlags(
      base({ playlist: { kind: 'range', start: 2, stop: 5 } }),
    );
    expect(flags).toContain('--yes-playlist');
    expect(flags).toContain('-I');
    expect(flags).toContain('2:5');
  });

  it('pins to the first item for a bare playlist URL in single mode', () => {
    const flags = buildFlags(
      base({
        urls: [
          'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
        ],
        playlist: { kind: 'single' },
      }),
    );
    expect(flags).toContain('--playlist-items');
    expect(flags).toContain('1');
    expect(flags).not.toContain('--no-playlist');
  });

  it('maps filename presets', () => {
    const channel = buildFlags(base({ filenamePreset: 'title-channel' }));
    expect(channel).toContain(FILENAME_TEMPLATES['title-channel']);

    const dated = buildFlags(base({ filenamePreset: 'title-date' }));
    expect(dated).toContain(FILENAME_TEMPLATES['title-date']);
  });

  it('maps extras', () => {
    const flags = buildFlags(
      base({
        embedThumbnail: true,
        embedMetadata: true,
        sponsorBlock: true,
      }),
    );
    expect(flags).toContain('--embed-thumbnail');
    expect(flags).toContain('--embed-metadata');
    expect(flags).toContain('--sponsorblock-remove');
    expect(flags).toContain('default');
  });

  it('keeps going across multiple URLs', () => {
    const flags = buildFlags(
      base({
        urls: [
          'https://example.com/one',
          'https://example.com/two',
        ],
      }),
    );
    expect(flags[0]).toBe('--ignore-errors');
    expect(flags).toContain('https://example.com/one');
    expect(flags).toContain('https://example.com/two');
  });

  it('skips embed-thumbnail for thumbnail-only mode', () => {
    const flags = buildFlags(
      base({ mode: 'thumbnail-only', embedThumbnail: true }),
    );
    expect(flags).not.toContain('--embed-thumbnail');
  });

  it('is deterministic for the same answers', () => {
    const a = buildFlags(base({ videoQuality: '1080', container: 'mkv' }));
    const b = buildFlags(base({ videoQuality: '1080', container: 'mkv' }));
    expect(a).toEqual(b);
  });
});

describe('formatCommand', () => {
  it('quotes flags with spaces', () => {
    const cmd = formatCommand(['-o', 'my file.%(ext)s', 'https://example.com']);
    expect(cmd).toContain('yt-dlp');
    expect(cmd).toContain('"my file.%(ext)s"');
  });

  it('breaks flags onto multiple lines', () => {
    const cmd = formatCommand([
      '-f',
      'bv*+ba/b',
      '--embed-subs',
      'https://example.com/v',
    ]);
    expect(cmd).toContain('\n');
    expect(cmd).toContain('-f bv*+ba/b');
    expect(cmd).toContain('--embed-subs');
  });
});
