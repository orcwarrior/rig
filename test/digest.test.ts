import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/types.js';

const tempDirs: string[] = [];

// runs/ is read-only; anything the test has to write goes in a throwaway dir.
function tempRunsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  tempDirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight on runs/2026-10-28.jsonl', () => {
  const digest = readNight('runs', '2026-10-28');
  const rows = new Map((digest?.rows ?? []).map((row) => [row.job, row]));

  it('returns one row per job, sorted by job, and counts the one bad line', () => {
    expect(digest).not.toBeNull();
    expect(digest?.night).toBe('2026-10-28');
    expect(digest?.rows).toHaveLength(5);
    expect(digest?.badLines).toBe(1);
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('summarises runs, retries, last status and error per job', () => {
    expect(rows.get('lane/sync')).toEqual({
      job: 'lane/sync',
      owner: 'rook',
      runs: 8,
      retries: 1,
      status: 'ok',
      error: null,
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(rows.get('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      status: 'ok',
      error: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(rows.get('notes/backup')).toEqual({
      job: 'notes/backup',
      owner: 'lane-07',
      runs: 1,
      retries: 0,
      status: 'fail',
      error: 'quota exceeded',
      firstAt: '2026-10-29T04:00:01+01:00',
      lastAt: '2026-10-29T04:00:01+01:00',
    });
    expect(rows.get('rig/rotate-logs')).toEqual({
      job: 'rig/rotate-logs',
      owner: 'lane-07',
      runs: 1,
      retries: 0,
      status: 'ok',
      error: null,
      firstAt: '2026-10-28T23:00:02+01:00',
      lastAt: '2026-10-28T23:00:02+01:00',
    });
  });

  it('keeps the row for a job whose owner is null', () => {
    expect(rows.get('digest/render')).toEqual({
      job: 'digest/render',
      owner: null,
      runs: 1,
      retries: 0,
      status: 'ok',
      error: null,
      firstAt: '2026-10-29T05:41:09+01:00',
      lastAt: '2026-10-29T05:41:09+01:00',
    });
  });

  it('keeps the times as written, offset and all', () => {
    for (const row of digest?.rows ?? []) {
      expect(row.firstAt).toMatch(/\+01:00$/);
      expect(row.lastAt).toMatch(/\+01:00$/);
    }
  });
});

describe('readNight', () => {
  it('returns null for a night with no file', () => {
    const dir = tempRunsDir({});
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns no rows for an empty file', () => {
    const dir = tempRunsDir({ '2026-01-01.jsonl': '' });
    expect(readNight(dir, '2026-01-01')).toEqual({ night: '2026-01-01', rows: [], badLines: 0 });
  });

  it('counts broken JSON and wrongly shaped JSON as bad lines, and still renders the rest', () => {
    const dir = tempRunsDir({
      '2026-01-01.jsonl': [
        '{"at":"2026-01-01T23:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
        '{"at":"2026-01-01T23:01:00+01:00","job":"lane/sy',
        'not json at all',
        '[]',
        '{"job":"lane/sync","status":"ok","owner":"rook"}',
        '{"at":"2026-01-01T23:02:00+01:00","job":"lane/sync","status":"weird","owner":"rook"}',
        '{"at":"2026-01-01T23:03:00+01:00","job":"lane/sync","status":"ok","owner":7}',
        '{"at":"2026-01-01T23:04:00+01:00","job":"lane/sync","status":"ok","owner":"rook","error":42}',
        '{"at":"2026-01-01T23:05:00+01:00","job":"lane/sync","status":"ok","owner":null}',
      ].join('\n'),
    });

    const digest = readNight(dir, '2026-01-01');
    expect(digest?.badLines).toBe(7);
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.rows[0]?.runs).toBe(2);
    expect(digest?.rows[0]?.owner).toBeNull();
  });

  it('ignores blank lines instead of counting them as bad', () => {
    const dir = tempRunsDir({
      '2026-01-01.jsonl':
        '\n{"at":"2026-01-01T23:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}\r\n\n',
    });
    expect(readNight(dir, '2026-01-01')).toEqual({
      night: '2026-01-01',
      rows: [
        {
          job: 'lane/sync',
          owner: 'rook',
          runs: 1,
          retries: 0,
          status: 'ok',
          error: null,
          firstAt: '2026-01-01T23:00:00+01:00',
          lastAt: '2026-01-01T23:00:00+01:00',
        },
      ],
      badLines: 0,
    });
  });

  it('takes the last status and error from the latest event, and counts the retries', () => {
    const dir = tempRunsDir({
      '2026-01-01.jsonl': [
        '{"at":"2026-01-01T23:00:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-01-01T23:01:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-01-01T23:02:00+01:00","job":"fixtures/refresh","status":"fail","owner":"rook","error":"gave up"}',
      ].join('\n'),
    });

    const row = readNight(dir, '2026-01-01')?.rows[0];
    expect(row?.runs).toBe(3);
    expect(row?.retries).toBe(2);
    expect(row?.status).toBe('fail');
    expect(row?.error).toBe('gave up');
  });

  it('clears the error when the job ends ok', () => {
    const dir = tempRunsDir({
      '2026-01-01.jsonl': [
        '{"at":"2026-01-01T23:00:00+01:00","job":"lane/sync","status":"retry","owner":"rook","error":"lock held"}',
        '{"at":"2026-01-01T23:01:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
      ].join('\n'),
    });

    const row = readNight(dir, '2026-01-01')?.rows[0];
    expect(row?.status).toBe('ok');
    expect(row?.error).toBeNull();
    expect(row?.retries).toBe(1);
  });

  it('finds the earliest and latest time even when the file is out of order', () => {
    const dir = tempRunsDir({
      '2026-01-01.jsonl': [
        '{"at":"2026-01-01T03:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
        '{"at":"2026-01-01T01:00:00+01:00","job":"lane/sync","status":"retry","owner":"rook","error":"lock held"}',
      ].join('\n'),
    });

    const row = readNight(dir, '2026-01-01')?.rows[0];
    expect(row?.firstAt).toBe('2026-01-01T01:00:00+01:00');
    expect(row?.lastAt).toBe('2026-01-01T03:00:00+01:00');
    expect(row?.status).toBe('ok');
    expect(row?.error).toBeNull();
  });
});
