import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/index.js';
import { readNight as readNightFromTypes } from '../src/digest/types.js';

describe('digest reader', () => {
  it('reads runs/2026-10-28.jsonl correctly', () => {
    const digest = readNight('runs', '2026-10-28');
    expect(digest).not.toBeNull();
    if (!digest) return;

    expect(digest.night).toBe('2026-10-28');
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest.rows).toHaveLength(5);

    // Jobs are sorted alphabetically
    const jobNames = digest.rows.map((r) => r.job);
    expect(jobNames).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);

    // digest/render has owner '—' (null in file), lastError null
    const digestRender = digest.rows.find((r) => r.job === 'digest/render');
    expect(digestRender).toBeDefined();
    expect(digestRender?.owner).toBe('—');
    expect(digestRender?.runs).toBe(1);
    expect(digestRender?.retries).toBe(0);
    expect(digestRender?.lastStatus).toBe('ok');
    expect(digestRender?.lastError).toBeNull();
    expect(digestRender?.first).toBe('2026-10-29T05:41:09+01:00');
    expect(digestRender?.last).toBe('2026-10-29T05:41:09+01:00');

    // fixtures/refresh has retries 3, lastStatus 'ok', lastError 'upstream 503'
    const fixturesRefresh = digest.rows.find((r) => r.job === 'fixtures/refresh');
    expect(fixturesRefresh).toBeDefined();
    expect(fixturesRefresh?.owner).toBe('rook');
    expect(fixturesRefresh?.runs).toBe(4);
    expect(fixturesRefresh?.retries).toBe(3);
    expect(fixturesRefresh?.lastStatus).toBe('ok');
    expect(fixturesRefresh?.lastError).toBe('upstream 503');
    expect(fixturesRefresh?.first).toBe('2026-10-29T01:30:00+01:00');
    expect(fixturesRefresh?.last).toBe('2026-10-29T01:37:00+01:00');

    // notes/backup has lastStatus 'fail', lastError 'quota exceeded'
    const notesBackup = digest.rows.find((r) => r.job === 'notes/backup');
    expect(notesBackup).toBeDefined();
    expect(notesBackup?.owner).toBe('lane-07');
    expect(notesBackup?.runs).toBe(1);
    expect(notesBackup?.retries).toBe(0);
    expect(notesBackup?.lastStatus).toBe('fail');
    expect(notesBackup?.lastError).toBe('quota exceeded');
    expect(notesBackup?.first).toBe('2026-10-29T04:00:01+01:00');
    expect(notesBackup?.last).toBe('2026-10-29T04:00:01+01:00');

    // lane/sync
    const laneSync = digest.rows.find((r) => r.job === 'lane/sync');
    expect(laneSync).toBeDefined();
    expect(laneSync?.owner).toBe('rook');
    expect(laneSync?.runs).toBe(8);
    expect(laneSync?.retries).toBe(1);
    expect(laneSync?.lastStatus).toBe('ok');
    expect(laneSync?.lastError).toBe('lock held');
    expect(laneSync?.first).toBe('2026-10-28T23:00:06+01:00');
    expect(laneSync?.last).toBe('2026-10-29T05:00:04+01:00');

    // rig/rotate-logs
    const rotateLogs = digest.rows.find((r) => r.job === 'rig/rotate-logs');
    expect(rotateLogs).toBeDefined();
    expect(rotateLogs?.owner).toBe('lane-07');
    expect(rotateLogs?.runs).toBe(1);
    expect(rotateLogs?.retries).toBe(0);
    expect(rotateLogs?.lastStatus).toBe('ok');
    expect(rotateLogs?.lastError).toBeNull();
    expect(rotateLogs?.first).toBe('2026-10-28T23:00:02+01:00');
    expect(rotateLogs?.last).toBe('2026-10-28T23:00:02+01:00');

    // Original time offsets preserved (+01:00, not UTC Z)
    for (const row of digest.rows) {
      expect(row.first).toContain('+01:00');
      expect(row.last).toContain('+01:00');
      expect(row.first.endsWith('Z')).toBe(false);
      expect(row.last.endsWith('Z')).toBe(false);
    }
  });

  it('re-exports readNight from types.ts', () => {
    expect(readNightFromTypes).toBe(readNight);
  });

  it('returns null for missing night', () => {
    expect(readNight('runs', '1999-01-01')).toBeNull();
  });

  it('returns null for invalid night format', () => {
    expect(readNight('runs', 'not-a-date')).toBeNull();
    expect(readNight('runs', '2026-10-28.jsonl')).toBeNull();
    expect(readNight('runs', '2026-10')).toBeNull();
  });

  it('returns empty digest for an empty file', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'rig-test-'));
    try {
      const night = '2026-10-29';
      writeFileSync(join(tempDir, `${night}.jsonl`), '');
      const digest = readNight(tempDir, night);
      expect(digest).toEqual({
        night,
        rows: [],
        badLines: 0,
        counts: { ok: 0, retry: 0, fail: 0 },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('handles bad lines gracefully without throwing', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'rig-test-'));
    try {
      const night = '2026-10-30';
      const lines = [
        'not valid json',
        '{"status":"ok"}', // missing at, job
        '{"at":"","job":"foo","status":"ok"}', // empty at
        '{"at":"2026-10-30T00:00:00Z","job":"","status":"ok"}', // empty job
        '{"at":"2026-10-30T00:00:00Z","job":"foo","status":"invalid"}', // bad status
        '{"at":"2026-10-30T00:00:00Z","job":"valid/job","status":"ok","owner":"alice"}',
      ];
      writeFileSync(join(tempDir, `${night}.jsonl`), lines.join('\n'));
      const digest = readNight(tempDir, night);
      expect(digest).not.toBeNull();
      expect(digest?.badLines).toBe(5);
      expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
      expect(digest?.rows).toHaveLength(1);
      expect(digest?.rows[0].job).toBe('valid/job');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
