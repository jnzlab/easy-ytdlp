import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir, platform } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import * as p from '@clack/prompts';
import { showNote } from './ui.js';

/** One-liners from https://deno.land — the official install scripts. */
const INSTALL_SH = 'curl -fsSL https://deno.land/install.sh | sh';
const INSTALL_PS = 'irm https://deno.land/install.ps1 | iex';

/**
 * Failures that mean "yt-dlp could not solve YouTube's JS challenge".
 * Shared with downloader.humanizeError so the message we print and the
 * offer to install Deno always agree on what counts as a runtime issue.
 */
export function isJsRuntimeError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('http error 403') ||
    lower.includes('403: forbidden') ||
    lower.includes('javascript runtime') ||
    lower.includes('js challenge') ||
    lower.includes('n challenge')
  );
}

/** The command a user can copy/paste to install Deno themselves. */
export function denoInstallCommand(): string {
  return platform() === 'win32' ? INSTALL_PS : INSTALL_SH;
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function denoFilename(): string {
  return platform() === 'win32' ? 'deno.exe' : 'deno';
}

/** Install locations deno's own installer uses, in the order it picks them. */
function knownDenoDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.DENO_INSTALL) dirs.push(join(process.env.DENO_INSTALL, 'bin'));
  if (process.env.DENO_INSTALL_ROOT) dirs.push(process.env.DENO_INSTALL_ROOT);
  const home = homedir();
  if (home) dirs.push(join(home, '.deno', 'bin'));
  return dirs;
}

/**
 * Locate a deno binary on PATH or in deno's default install dir. The
 * second case matters right after an install: the new `~/.deno/bin` entry
 * only exists in shells started later, not in this process.
 */
export function findDeno(): string | null {
  const name = denoFilename();
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    ...knownDenoDirs(),
  ];
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

/** Make a freshly installed deno visible to the yt-dlp child process. */
export function ensureDenoOnPath(denoPath: string): void {
  const dir = dirname(denoPath);
  const entries = (process.env.PATH ?? '').split(delimiter);
  if (entries.includes(dir)) return;
  process.env.PATH = [dir, ...entries].filter(Boolean).join(delimiter);
}

/** Print the install command so the user can run it and come back. */
function showManualInstructions(): void {
  showNote(
    [
      'Install Deno yourself with:',
      '',
      `  ${denoInstallCommand()}`,
      '',
      'Then re-run easy-ytdlp — it will pick Deno up automatically.',
    ].join('\n'),
    'Install Deno',
  );
}

function runInstallCommand(): Promise<boolean> {
  const isWindows = platform() === 'win32';
  const command = isWindows ? 'powershell.exe' : 'sh';
  const args = isWindows
    ? ['-NoProfile', '-Command', INSTALL_PS]
    : ['-c', INSTALL_SH];

  return new Promise((resolve) => {
    // stdio: 'inherit' — the installer prints progress and may ask about
    // editing shell configs; the user should see and answer it directly.
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', (err) => {
      p.log.error(`Could not run the installer: ${err.message}`);
      resolve(false);
    });
    child.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Ask whether to install Deno and do it when the user says yes.
 * Returns true when Deno is now available (so the caller can retry).
 *
 * `canPrompt: false` (non-interactive runs) skips the question and just
 * hands over the command.
 */
export async function offerDenoInstall(
  options: { canPrompt?: boolean } = {},
): Promise<boolean> {
  const existing = findDeno();
  if (existing) {
    ensureDenoOnPath(existing);
    p.log.info(`Found Deno at ${existing} — using it for this run.`);
    return true;
  }

  if (options.canPrompt === false || !process.stdin.isTTY) {
    showManualInstructions();
    return false;
  }

  p.log.info(`Install command: ${denoInstallCommand()}`);
  const answer = await p.confirm({
    message: 'Install Deno now?',
    initialValue: true,
  });

  if (p.isCancel(answer) || !answer) {
    showManualInstructions();
    return false;
  }

  p.log.step('Installing Deno…');
  const ok = await runInstallCommand();
  if (!ok) {
    p.log.error('Deno installation failed.');
    showManualInstructions();
    return false;
  }

  const installed = findDeno();
  if (!installed) {
    p.log.warn(
      'The installer finished but no deno binary was found. Open a new terminal and re-run easy-ytdlp.',
    );
    return false;
  }

  ensureDenoOnPath(installed);
  p.log.success(`Deno installed: ${installed}`);
  return true;
}
