import { describe, expect, it } from 'vitest';
import { formatUnknownError, releaseAssetName } from '../src/binary.js';

describe('releaseAssetName', () => {
  it('picks standalone linux x64 binary', () => {
    expect(releaseAssetName('linux', 'x64')).toBe('yt-dlp_linux');
  });

  it('picks linux aarch64 binary', () => {
    expect(releaseAssetName('linux', 'arm64')).toBe('yt-dlp_linux_aarch64');
  });

  it('picks macos and windows assets', () => {
    expect(releaseAssetName('darwin', 'arm64')).toBe('yt-dlp_macos');
    expect(releaseAssetName('win32', 'x64')).toBe('yt-dlp.exe');
  });
});

describe('formatUnknownError', () => {
  it('reads Error messages', () => {
    expect(formatUnknownError(new Error('boom'))).toBe('boom');
  });

  it('reads HTTP response-like objects instead of [object Object]', () => {
    expect(
      formatUnknownError({ statusCode: 403, statusMessage: 'Forbidden' }),
    ).toBe('HTTP 403 Forbidden');
  });

  it('stringifies plain objects', () => {
    expect(formatUnknownError({ code: 'EAI_AGAIN' })).toBe('EAI_AGAIN');
  });
});
