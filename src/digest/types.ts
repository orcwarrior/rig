// Plan morning-digest § 1. One row per job for a night's run log, plus the reader's contract.
// Declared first so the digest page, its JSON and the board link (§ 2) all build against it.

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

// Reads runsDir/<night>.jsonl. Null means there is no file for that night (the route answers
// 404); an empty file is a digest with no rows ("nothing ran"). Not implemented yet: § 1's
// reader issue fills this in, everything in § 2 can already import it.
export function readNight(runsDir: string, night: string): NightDigest | null {
  throw new Error(`readNight: not implemented (${runsDir}/${night}.jsonl)`);
}
