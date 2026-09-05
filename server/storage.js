import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export function createStatsStore(directory) {
  const file = path.join(directory, 'stats.json');
  let pending = Promise.resolve();
  return {
    async read() {
      try {
        const value = JSON.parse(await readFile(file, 'utf8'));
        return Object.fromEntries(['wins', 'voyages', 'bestPearls'].map(k => [k, Number.isSafeInteger(value[k]) && value[k] >= 0 ? value[k] : 0]));
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn(`Statistics could not be read; starting fresh: ${error.message}`);
        return { wins: 0, voyages: 0, bestPearls: 0 };
      }
    },
    write(stats) {
      const payload = JSON.stringify({ wins: stats.wins, voyages: stats.voyages, bestPearls: stats.bestPearls }, null, 2) + '\n';
      pending = pending.catch(() => {}).then(async () => {
        await mkdir(directory, { recursive: true });
        await writeFile(`${file}.tmp`, payload, 'utf8');
        await rename(`${file}.tmp`, file);
      });
      return pending;
    },
    flush() { return pending; },
  };
}
