import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight, type NightDigest, type RunStatus } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

// ok / retry / fail counts of one night's digest rows (plan § 2c).
export type NightCounts = Record<RunStatus, number>;

export type NightOnDisk = {
  night: string;
  counts: NightCounts | null; // null when the file can't be read: renders as —
};

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightOnDisk[];
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// The board's counts come from the same readNight rows as the digest page and JSON
// (plan § 2c), so the three can't disagree.
function nightCounts(runsDir: string, night: string): NightCounts | null {
  let digest: NightDigest | null;
  try {
    digest = readNight(runsDir, night);
  } catch {
    return null;
  }
  if (digest === null) return null;

  const counts: NightCounts = { ok: 0, retry: 0, fail: 0 };
  for (const row of digest.rows) counts[row.status] += 1;
  return counts;
}

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: nightsOnDisk(config.runsDir).map((night) => ({
      night,
      counts: nightCounts(config.runsDir, night),
    })),
  };
}
