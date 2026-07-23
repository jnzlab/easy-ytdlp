/** Media download mode chosen by the user. */
export type MediaMode =
  | 'video'
  | 'audio'
  | 'video-only'
  | 'subs-only'
  | 'thumbnail-only';

/** Video quality preference. */
export type VideoQuality =
  | 'best'
  | '1080'
  | '720'
  | '480'
  | { height: number };

/** Container preference for merged video. */
export type ContainerPref = 'mp4' | 'mkv' | 'webm' | 'best';

/** Audio target format. */
export type AudioFormat = 'mp3' | 'm4a' | 'opus' | 'flac' | 'wav' | 'best';

/** Audio quality preset. */
export type AudioQuality = 'best' | 'good';

/** How to handle subtitles. */
export type SubtitleMode = 'none' | 'embed' | 'write' | 'both';

/** Playlist download scope. */
export type PlaylistMode =
  | { kind: 'single' }
  | { kind: 'all' }
  | { kind: 'range'; start: number; stop: number };

/** Filename template preset (plain-English choices). */
export type FilenamePreset = 'title' | 'title-channel' | 'title-date';

/** Collected answers from the interactive question flow. */
export interface Answers {
  url: string;
  mode: MediaMode;
  videoQuality?: VideoQuality;
  container?: ContainerPref;
  audioFormat?: AudioFormat;
  audioQuality?: AudioQuality;
  subtitles: {
    mode: SubtitleMode;
    languages: string[];
  };
  playlist: PlaylistMode;
  outputDir: string;
  filenamePreset: FilenamePreset;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  sponsorBlock: boolean;
  showCommand: boolean;
}

/** Minimal shape of yt-dlp --dump-json metadata we care about. */
export interface VideoFormat {
  format_id?: string;
  height?: number | null;
  width?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  ext?: string;
  resolution?: string;
}

export interface VideoMeta {
  id?: string;
  title?: string;
  duration?: number;
  uploader?: string;
  webpage_url?: string;
  _type?: string;
  playlist?: string | null;
  playlist_index?: number | null;
  playlist_count?: number | null;
  formats?: VideoFormat[];
  subtitles?: Record<string, unknown[]>;
  automatic_captions?: Record<string, unknown[]>;
  thumbnail?: string;
  thumbnails?: unknown[];
}
