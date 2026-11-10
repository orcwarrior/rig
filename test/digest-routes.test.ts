import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import { readNight, type DigestRow, type NightDigest } from '../src/digest/types.js';

const tempDirs: string[] = [];

// runs/ is read-only; anything the test has to write goes in a throwaway dir.
function tempRunsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  tempDirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function appFor(runsDir: string) {
  const config: RigConfig = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
  return createApp(config);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDigestRow(value: unknown): value is DigestRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.job === 'string' &&
    (value.owner === null || typeof value.owner === 'string') &&
    typeof value.runs === 'number' &&
    typeof value.retries === 'number' &&
    (value.status === 'ok' || value.status === 'retry' || value.status === 'fail') &&
    (value.error === null || typeof value.error === 'string') &&
    typeof value.firstAt === 'string' &&
    typeof value.lastAt === 'string'
  );
}

// The JSON route's body, checked at the edge like any other input: a body that isn't a
// digest fails the test instead of slipping through as whatever the route returned.
function parseDigest(value: unknown): NightDigest {
  if (!isRecord(value)) throw new Error('body is not an object');
  const { night, rows, badLines } = value;
  if (typeof night !== 'string' || typeof badLines !== 'number' || !Array.isArray(rows)) {
    throw new Error('body is not a night digest');
  }
  const parsed: DigestRow[] = [];
  for (const row of rows as unknown[]) {
    if (!isDigestRow(row)) throw new Error('body has a row that is not a digest row');
    parsed.push(row);
  }
  return { night, rows: parsed, badLines };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

// The job cells of the page's table, in the order the page lists them.
function pageJobs(html: string): string[] {
  const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
  const jobs: string[] = [];
  for (const row of tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cell = /<td>([\s\S]*?)<\/td>/.exec(row[1] ?? '')?.[1] ?? '';
    jobs.push(stripTags(cell));
  }
  return jobs;
}

describe('GET /digest/:night', () => {
  it('renders the night on disk with one row per job', async () => {
    const res = await appFor('runs').request('/digest/2026-10-28');
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('digest · 2026-10-28');
    expect(pageJobs(html)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('shows the same jobs in the same order as the JSON route (ADR 0001)', async () => {
    const app = appFor('runs');
    const page = await (await app.request('/digest/2026-10-28')).text();
    const json = parseDigest(await (await app.request('/api/digest/2026-10-28')).json());

    expect(pageJobs(page)).toEqual(json.rows.map((row) => row.job));
    expect(json.rows.map((row) => row.job)).toEqual(readNight('runs', '2026-10-28')?.rows.map((row) => row.job));
  });

  it('404s for a night with no file', async () => {
    const dir = tempRunsDir({});
    const res = await appFor(dir).request('/digest/2026-01-01');
    const html = await res.text();

    expect(res.status).toBe(404);
    expect(html).toContain('no run log for that night');
    expect(pageJobs(html)).toEqual([]);
  });

  it('renders "nothing ran" for an empty night', async () => {
    const dir = tempRunsDir({ '2026-01-01.jsonl': '' });
    const res = await appFor(dir).request('/digest/2026-01-01');
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(pageJobs(html)).toEqual([]);
  });

  it('renders a night with a bad line, counts it, and does not throw', async () => {
    const dir = tempRunsDir({
      '2026-01-01.jsonl': [
        '{"at":"2026-01-01T23:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
        '{"at":"2026-01-01T23:01:00+01:00","job":"lane/sy',
        'not json at all',
      ].join('\n'),
    });
    const res = await appFor(dir).request('/digest/2026-01-01');
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(pageJobs(html)).toEqual(['lane/sync']);
    expect(html).toContain('2 unreadable lines not shown');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the night on disk as JSON', async () => {
    const res = await appFor('runs').request('/api/digest/2026-10-28');
    const digest = parseDigest(await res.json());

    expect(res.status).toBe(200);
    expect(digest.night).toBe('2026-10-28');
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((row) => row.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('404s with an error body for a night with no file', async () => {
    const dir = tempRunsDir({});
    const res = await appFor(dir).request('/api/digest/2026-01-01');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'night not found', night: '2026-01-01' });
  });

  it('returns empty rows for an empty night', async () => {
    const dir = tempRunsDir({ '2026-01-01.jsonl': '' });
    const res = await appFor(dir).request('/api/digest/2026-01-01');
    const digest = parseDigest(await res.json());

    expect(res.status).toBe(200);
    expect(digest).toEqual({ night: '2026-01-01', rows: [], badLines: 0 });
  });

  it('counts the bad lines of a broken night the same way the page does', async () => {
    const dir = tempRunsDir({
      '2026-01-01.jsonl': [
        '{"at":"2026-01-01T23:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
        '{"at":"2026-01-01T23:01:00+01:00","job":"lane/sy',
        'not json at all',
      ].join('\n'),
    });
    const app = appFor(dir);
    const page = await (await app.request('/digest/2026-01-01')).text();
    const res = await app.request('/api/digest/2026-01-01');
    const digest = parseDigest(await res.json());

    expect(res.status).toBe(200);
    expect(digest.badLines).toBe(2);
    expect(digest.rows.map((row) => row.job)).toEqual(pageJobs(page));
  });
});

describe('the page and the JSON cannot disagree', () => {
  it('lists the same jobs in the same order, sorted by job', async () => {
    const dir = tempRunsDir({
      '2026-01-01.jsonl': [
        '{"at":"2026-01-01T23:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
        '{"at":"2026-01-01T23:01:00+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
        '{"at":"2026-01-01T23:02:00+01:00","job":"digest/render","status":"ok","owner":null}',
      ].join('\n'),
    });
    const app = appFor(dir);
    const page = await (await app.request('/digest/2026-01-01')).text();
    const digest = parseDigest(await (await app.request('/api/digest/2026-01-01')).json());

    expect(pageJobs(page)).toEqual(['digest/render', 'lane/sync', 'notes/backup']);
    expect(digest.rows.map((row) => row.job)).toEqual(pageJobs(page));
  });
});
