import * as p from '@clack/prompts';

/** Terminal width minus space for clack's left gutter / box borders. */
export function contentWidth(pad = 8): number {
  const cols = process.stdout.columns ?? 80;
  return Math.max(40, cols - pad);
}

/** Word-wrap (or hard-break) text so clack note boxes don't overflow and merge. */
export function wrapText(text: string, width = contentWidth()): string {
  return text
    .split(/\r?\n/)
    .flatMap((line) => wrapLine(line, width))
    .join('\n');
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line || ' '];

  const out: string[] = [];
  let rest = line;
  while (rest.length > width) {
    // Prefer breaking on spaces; otherwise hard-break
    let breakAt = rest.lastIndexOf(' ', width);
    if (breakAt < Math.floor(width * 0.5)) breakAt = width;
    out.push(rest.slice(0, breakAt).trimEnd());
    rest = rest.slice(breakAt).trimStart();
  }
  if (rest.length) out.push(rest);
  return out;
}

/**
 * Show a titled panel via clack note, with content wrapped tightly so the
 * box chrome (`│  … │`) never exceeds the terminal width (which wraps the
 * right border onto the next line and looks "distorted").
 */
export function showNote(body: string, title: string): void {
  // clack note adds: vertical bar + 2 spaces + content + pad + vertical bar
  p.note(wrapText(body, contentWidth(14)), title);
}

/**
 * Show saved file paths. Uses clack's `log.success()` for each path
 * instead of raw console.log, so the output stays visually consistent
 * and avoids terminal artifacts from mixing clack-managed output with
 * direct writes.
 */
export function showSaved(paths: string[]): void {
  if (paths.length === 0) return;
  if (paths.length === 1) {
    p.log.success(paths[0]!);
    return;
  }
  p.log.success(`Saved ${paths.length} files`);
  for (const filePath of paths) {
    p.log.info(filePath);
  }
}

/**
 * Show a long shell command without a clack box — boxes break on very long lines.
 * Prints a step label plus indented, wrapped flag lines.
 */
export function showCommand(command: string): void {
  p.log.step('yt-dlp command');
  // wrapText (not wrapLine) so multi-line flag lists keep each flag paired
  for (const line of wrapText(command, contentWidth(4)).split('\n')) {
    console.log(`  ${line}`);
  }
}
