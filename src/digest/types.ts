// Plan morning-digest § 1. One row per job for a night's run log, plus the reader's contract.
// Declared first so the digest page, its JSON and the board link (§ 2) all build against it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl. Parsed at the edge, in readNight.
export type RunLogLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

export type DigestRow = {
  job: string;
  owner: string | null; // null renders as —, the row is kept
  runs: number; // lines for this job
  retries: number; // lines with status 'retry'
  status: RunStatus; // the job's last line
  error: string | null; // most recent error for the job, null if none
  firstAt: string; // first line's "at", offset kept
  lastAt: string; // last line's "at", offset kept
};

export type NightDigest = {
  night: string;
  rows: DigestRow[]; // sorted by job, so the page and the JSON can't disagree (ADR 0001)
  badLines: number; // lines that didn't parse; counted, never thrown
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is RunStatus {
  return value === 'ok' || value === 'retry' || value === 'fail';
}

function isMissing(err: unknown): boolean {
  return isRecord(err) && err.code === 'ENOENT';
}

// One line, parsed at the edge. Null means it isn't a run event: broken JSON and JSON of the
// wrong shape are both counted as bad lines by the caller.
function parseLine(raw: string): RunLogLine | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  const { at, job, status, owner, error } = value;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  if (typeof job !== 'string' || job === '') return null;
  if (!isStatus(status)) return null;
  if (owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && typeof error !== 'string') return null;

  const line: RunLogLine = { at, job, status, owner };
  if (error !== undefined) line.error = error;
  return line;
}

type JobAcc = DigestRow & { firstMs: number; lastMs: number };

// Reads runsDir/<night>.jsonl. Null means there is no file for that night (the route answers
// 404); an empty file is a digest with no rows ("nothing ran").
export function readNight(runsDir: string, night: string): NightDigest | null {
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }

  const byJob = new Map<string, JobAcc>();
  let badLines = 0;

  // A byte-order mark would sit in front of the first object; blank lines (a trailing newline)
  // are layout, not events.
  for (const raw of text.replace(/^\uFEFF/, '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') continue;

    const event = parseLine(line);
    if (event === null) {
      badLines += 1;
      continue;
    }

    const ms = Date.parse(event.at);
    const acc = byJob.get(event.job);
    if (acc === undefined) {
      byJob.set(event.job, {
        job: event.job,
        owner: event.owner,
        runs: 1,
        retries: event.status === 'retry' ? 1 : 0,
        status: event.status,
        error: event.error ?? null,
        firstAt: event.at,
        lastAt: event.at,
        firstMs: ms,
        lastMs: ms,
      });
      continue;
    }

    acc.runs += 1;
    if (event.status === 'retry') acc.retries += 1;

    // The last event in the file wins a tie, so a job ends on the line that ended it.
    if (ms >= acc.lastMs) {
      acc.lastMs = ms;
      acc.lastAt = event.at;
      acc.status = event.status;
      acc.error = event.error ?? null;
      acc.owner = event.owner;
    }
    if (ms < acc.firstMs) {
      acc.firstMs = ms;
      acc.firstAt = event.at;
    }
  }

  const rows: DigestRow[] = [...byJob.values()]
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0))
    .map(({ firstMs: _firstMs, lastMs: _lastMs, ...row }) => row);

  return { night, rows, badLines };
}
