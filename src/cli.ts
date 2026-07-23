import { Command } from 'commander';
import * as p from '@clack/prompts';
import { createYtDlp, updateBinary } from './binary.js';
import { buildFlags, formatCommand } from './builder.js';
import { fetchMetadata, runDownload } from './downloader.js';
import {
  checkFfmpeg,
  ffmpegInstallHint,
  needsFfmpeg,
} from './ffmpeg.js';
import { askQuestions, promptUrl } from './questions.js';
import type { VideoMeta } from './types.js';
import { showCommand, showSaved } from './ui.js';
import { youtubeCompatFlags } from './youtube-compat.js';
import { progressFlags } from './downloader.js';

async function runWizard(urlArg?: string, opts: { showCommand?: boolean } = {}) {
  p.intro('easy-ytdlp');

  const spinner = p.spinner();
  spinner.start('Preparing yt-dlp binary…');
  let ytDlp;
  try {
    ytDlp = await createYtDlp({
      onStatus: (msg) => {
        spinner.message(msg);
      },
    });
    spinner.stop('yt-dlp ready');
  } catch (err) {
    spinner.stop('Binary setup failed');
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const url = await promptUrl(urlArg);

  spinner.start('Fetching video info…');
  let meta: VideoMeta;
  try {
    meta = (await fetchMetadata(ytDlp, url)) as VideoMeta;
    spinner.stop('Metadata loaded');
  } catch (err) {
    spinner.stop('Could not fetch metadata');
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const answers = await askQuestions(url, meta);
  if (opts.showCommand) {
    answers.showCommand = true;
  }

  const flags = buildFlags(answers);
  // What we actually exec (compat + progress injected at run time too)
  const displayFlags = [
    ...youtubeCompatFlags(),
    ...progressFlags(),
    ...flags,
  ];

  if (answers.showCommand) {
    showCommand(formatCommand(displayFlags));
    const proceed = await p.confirm({
      message: 'Run this command?',
      initialValue: true,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel('Cancelled.');
      process.exit(0);
    }
  } else {
    const proceed = await p.confirm({
      message: 'Start download?',
      initialValue: true,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel('Cancelled.');
      process.exit(0);
    }
  }

  // ffmpeg check when needed
  if (
    needsFfmpeg(answers.mode, {
      embedSubs:
        answers.subtitles.mode === 'embed' ||
        answers.subtitles.mode === 'both',
      embedThumbnail: answers.embedThumbnail,
      extractAudio: answers.mode === 'audio',
    })
  ) {
    const status = await checkFfmpeg();
    if (!status.ok) {
      p.log.warn(
        [
          'ffmpeg/ffprobe not found on PATH.',
          ffmpegInstallHint(),
        ].join('\n\n'),
      );
      const cont = await p.confirm({
        message: 'Continue anyway? (download may fail at merge/extract)',
        initialValue: false,
      });
      if (p.isCancel(cont) || !cont) {
        p.cancel('Cancelled.');
        process.exit(0);
      }
    }
  }

  p.log.info('Starting download…');
  try {
    const result = await runDownload(ytDlp, flags);
    if (result.filepaths.length > 0) {
      showSaved(result.filepaths);
    } else {
      p.log.success('Done. (No filepath printed — check your output folder.)');
      p.log.info(`Output folder: ${answers.outputDir}`);
    }
    p.outro('Finished');
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
    p.outro('Failed');
    process.exit(1);
  }
}

async function runUpdateBinary() {
  p.intro('easy-ytdlp update-binary');
  const spinner = p.spinner();
  spinner.start('Refreshing yt-dlp binary…');
  try {
    const path = await updateBinary((msg) => spinner.message(msg));
    spinner.stop(`Updated: ${path}`);
    p.outro('Binary update complete');
  } catch (err) {
    spinner.stop('Update failed');
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const program = new Command();

program
  .name('easy-ytdlp')
  .description(
    'Interactive, user-friendly wrapper around yt-dlp — no flag memorization required',
  )
  .version('1.0.0')
  .argument('[url]', 'Video URL (prompted if omitted)')
  .option(
    '--show-command',
    'Always show the generated yt-dlp command before running',
  )
  .action(async (url: string | undefined, options: { showCommand?: boolean }) => {
    await runWizard(url, { showCommand: options.showCommand });
  });

program
  .command('update-binary')
  .description('Force-refresh the cached yt-dlp binary')
  .action(async () => {
    await runUpdateBinary();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
