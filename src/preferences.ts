import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import envPaths from 'env-paths';

const paths = envPaths('easy-ytdlp');
const PREFS_PATH = join(paths.config, 'preferences.json');

export interface Preferences {
  outputDir?: string;
}

export async function loadPreferences(): Promise<Preferences> {
  try {
    const raw = await readFile(PREFS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Preferences;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await mkdir(dirname(PREFS_PATH), { recursive: true });
  await writeFile(PREFS_PATH, `${JSON.stringify(prefs, null, 2)}\n`, 'utf-8');
}
