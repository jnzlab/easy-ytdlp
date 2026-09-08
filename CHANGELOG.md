# Changelog

## 1.1.4 - 2026-09-08

### Fixed

- Interactive mode no longer fails with "Failed to fetch metadata for any of
  the provided URLs" on videos that have no pre-merged format. `yt-dlp-wrap`
  silently added `-f best` to the metadata call, which YouTube now rejects for
  many videos; the metadata fetch passes `--ignore-no-formats-error` and its
  own format flag instead. When every URL fails, the underlying yt-dlp error is
  now shown instead of a generic message.
- `--version` now reads the version from `package.json` instead of a
  hardcoded constant that had drifted from the published version.
- Removed an accidental dependency of the package on itself.
- Pasting a bare YouTube playlist link no longer fails/hangs at startup. The
  metadata fetch now uses `--flat-playlist` for playlist URLs (fast, one small
  line per video) and shows the playlist title + video count instead of dumping
  full metadata for every video. "Just this video" on a bare playlist URL now
  downloads only the first entry (`--playlist-items 1`) instead of the whole
  playlist.

## 1.1.0 - 2026-07-27

### Added

- Added a shorter default wizard that keeps common downloads focused on mode, quality, and output folder.
- Added an advanced-options step for subtitles, playlist handling, filename presets, container preferences, embedded thumbnail/metadata, and SponsorBlock.
- Added a grouped final summary with readable labels for download, source, output, and extras.
- Added a final action menu with start, show command, change settings, and cancel actions.
- Added persisted output-folder preferences so the last destination is reused on future runs.
- Added support for multiple URLs in one command and `--batch-file` input with blank-line and comment handling.
- Added compact numbered metadata previews for multi-URL jobs.
- Added per-URL download progress labels for multi-URL runs.
- Added non-interactive `--yes` mode with flags for mode, quality, output folder, audio format, subtitles, playlist range, filename preset, embedded metadata/thumbnail, and SponsorBlock.

### Changed

- Downloads for multiple URLs now run one URL at a time, which makes progress and failures easier to understand.
- CLI version output now matches the package version.
- Plain video-only downloads no longer warn about missing ffmpeg unless remuxing or post-processing is requested.
- Saved-file output now uses consistent Clack log formatting.
- README usage examples now cover multi-URL, batch-file, advanced wizard, and non-interactive workflows.

### Fixed

- Batch-file read failures now show a friendly CLI error instead of a raw Node exception.
- Multi-URL command preview now explains that the displayed command is for the first URL and will be repeated for each URL.
