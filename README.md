# easy-ytdlp

Interactive, user-friendly CLI wrapper around [yt-dlp](https://github.com/yt-dlp/yt-dlp). Answer a few plain-English questions — quality, format, destination — and the tool builds and runs the correct `yt-dlp` command for you.

No Python install. No flag memorization. The `yt-dlp` binary is downloaded and cached automatically on first run.

## Install

```bash
# one-shot (no install)
npx @jnzlab/easy-ytdlp <url>

# or install globally
npm install -g @jnzlab/easy-ytdlp
easy-ytdlp <url>
```

**Requirements:** Node.js 18+. For video merging, audio extraction, and embedding, install [ffmpeg](https://ffmpeg.org/) on your system.

## Usage

```bash
easy-ytdlp                                 # prompts for URL
easy-ytdlp https://youtu.be/dQw4w9WgXcQ    # start with a URL
easy-ytdlp <url> --show-command            # preview the yt-dlp flags first
easy-ytdlp update-binary                   # force-refresh the cached yt-dlp binary
```

### Example session

![easy-ytdlp demo](https://pub-453eda74623641f7967529680d3689bb.r2.dev/demo.gif)

### Audio-only example

```bash
npx @jnzlab/easy-ytdlp "https://www.youtube.com/watch?v=…"
# → choose "Audio only" → mp3 → Best → confirm
```

## What it covers

Guided choices for:

- Video (+ audio), audio-only, video-only, subtitles-only, thumbnail-only
- Quality caps (`-S res:…`) and available resolutions from metadata
- Containers, audio formats, subtitle languages / embed vs file
- Playlist: this video, whole playlist, or index range
- Output folder + plain-English filename templates
- Embed thumbnail / metadata, SponsorBlock remove

## Out of scope (v1)

These need the raw `yt-dlp` CLI directly:

- Login / cookies-based extraction
- DRM content
- Live streams from the start

See the [yt-dlp authentication](https://github.com/yt-dlp/yt-dlp#authentication-options) and related docs, or the local reference copy in [`docs/yt-dlp-README.md`](docs/yt-dlp-README.md).

## License

MIT
