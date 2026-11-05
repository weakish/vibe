import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export function specPathForState(stateFile) {
  return path.join(path.dirname(stateFile), 'spec.md');
}

// A missing file means "use the built-in spec". An empty file is a saved empty spec.
export async function readSavedSpec(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeSavedSpec(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = uniqueTemp(file);
  try {
    await fs.writeFile(temp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

function uniqueTemp(file) {
  return `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
}
