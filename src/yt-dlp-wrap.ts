/**
 * yt-dlp-wrap is CommonJS. Under Node ESM, the default import may be
 * `{ default: YTDlpWrap }` instead of the constructor itself.
 */
import YTDlpWrapImport from 'yt-dlp-wrap';

type YTDlpWrapClass = {
  new (binaryPath?: string): YTDlpWrapInstance;
  downloadFromGithub(
    filePath?: string,
    version?: string,
    platform?: string,
  ): Promise<void>;
  getGithubReleases(page?: number, perPage?: number): Promise<unknown>;
};

export type YTDlpWrapInstance = {
  exec(args: string[]): {
    on(event: string, listener: (...args: never[]) => void): unknown;
    ytDlpProcess?: {
      stdout?: NodeJS.ReadableStream;
      stderr?: NodeJS.ReadableStream;
    };
  };
  getVideoInfo(urlOrArgs: string | string[]): Promise<unknown>;
  setBinaryPath(path: string): void;
  getBinaryPath(): string;
};

function resolveConstructor(): YTDlpWrapClass {
  const mod = YTDlpWrapImport as unknown as
    | YTDlpWrapClass
    | { default: YTDlpWrapClass };
  if (typeof mod === 'function') {
    return mod;
  }
  if (mod && typeof mod.default === 'function') {
    return mod.default;
  }
  throw new Error(
    'Failed to load yt-dlp-wrap: unexpected module shape. Try reinstalling dependencies.',
  );
}

export const YTDlpWrap = resolveConstructor();
