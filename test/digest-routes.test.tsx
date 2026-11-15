import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { NightDigest } from '../src/digest/types.js';

function parseTableRows(html: string) {
  const tbodyMatch = html.match(/<tbody>(.*?)<\/tbody>/s);
  if (!tbodyMatch) return [];
  const rowMatches = [...tbodyMatch[1].matchAll(/<tr([^>]*)>(.*?)<\/tr>/gs)];
  return rowMatches.map((m) => {
    const trAttrs = m[1];
    const cells = [...m[2].matchAll(/<td([^>]*)>(.*?)<\/td>/gs)].map((c) => ({
      attrs: c[1],
      isWarn: c[1].includes('class="warn"'),
      text: c[2],
    }));
    return {
      isWarn: trAttrs.includes('class="warn"'),
      job: cells[0]?.text,
      owner: cells[1]?.text,
      runs: cells[2]?.text,
      retries: cells[3]?.text,
      retriesWarn: cells[3]?.isWarn,
      lastStatus: cells[4]?.text,
      lastStatusWarn: cells[4]?.isWarn,
      lastError: cells[5]?.text,
      first: cells[6]?.text,
      last: cells[7]?.text,
    };
  });
}

describe('digest routes', () => {
  let tempDir: string;
  let config: RigConfig;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    config = {
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir: tempDir,
    };
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns 200 for a valid night file with sorted rows, warning classes, and dashes for nulls', async () => {
    copyFileSync('runs/2026-10-28.jsonl', join(tempDir, '2026-10-28.jsonl'));
    const app = createApp(config);

    // HTML route: GET /digest/:night
    const resHtml = await app.request('/digest/2026-10-28');
    expect(resHtml.status).toBe(200);
    const html = await resHtml.text();
    expect(html).toContain('<h1>digest · 2026-10-28</h1>');

    const rows = parseTableRows(html);
    expect(rows).toHaveLength(5);

    // Rows are sorted alphabetically by job
    const jobs = rows.map((r) => r.job);
    expect(jobs).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);

    // digest/render: null owner rendered as —, null error rendered as —, not warned
    const digestRender = rows.find((r) => r.job === 'digest/render');
    expect(digestRender?.isWarn).toBe(false);
    expect(digestRender?.owner).toBe('—');
    expect(digestRender?.lastError).toBe('—');
    expect(digestRender?.retriesWarn).toBe(false);
    expect(digestRender?.lastStatusWarn).toBe(false);

    // fixtures/refresh: retries >= 3 gets warning classes on tr and retries td
    const fixturesRefresh = rows.find((r) => r.job === 'fixtures/refresh');
    expect(fixturesRefresh?.isWarn).toBe(true);
    expect(fixturesRefresh?.retries).toBe('3');
    expect(fixturesRefresh?.retriesWarn).toBe(true);
    expect(fixturesRefresh?.lastStatusWarn).toBe(false);
    expect(fixturesRefresh?.lastError).toBe('upstream 503');

    // notes/backup: fail gets warning classes on tr and lastStatus td
    const notesBackup = rows.find((r) => r.job === 'notes/backup');
    expect(notesBackup?.isWarn).toBe(true);
    expect(notesBackup?.lastStatus).toBe('fail');
    expect(notesBackup?.lastStatusWarn).toBe(true);
    expect(notesBackup?.retriesWarn).toBe(false);
    expect(notesBackup?.lastError).toBe('quota exceeded');

    // rig/rotate-logs: null error rendered as —, not warned
    const rotateLogs = rows.find((r) => r.job === 'rig/rotate-logs');
    expect(rotateLogs?.isWarn).toBe(false);
    expect(rotateLogs?.lastError).toBe('—');

    // JSON route: GET /api/digest/:night
    const resJson = await app.request('/api/digest/2026-10-28');
    expect(resJson.status).toBe(200);
    const json = (await resJson.json()) as NightDigest;
    expect(json.night).toBe('2026-10-28');
    expect(json.rows).toHaveLength(5);
    expect(json.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(json.badLines).toBe(1);

    // JSON and HTML agree on the same jobs in the same order
    const jsonJobs = json.rows.map((r) => r.job);
    expect(jsonJobs).toEqual(jobs);

    // Verify null owner and null error representation in JSON
    const jsonDigestRender = json.rows.find((r) => r.job === 'digest/render');
    expect(jsonDigestRender?.owner).toBe('—');
    expect(jsonDigestRender?.lastError).toBeNull();
  });

  it('checks that /digest/2026-10-28 and /api/digest/2026-10-28 agree on the same jobs in the same order', async () => {
    copyFileSync('runs/2026-10-28.jsonl', join(tempDir, '2026-10-28.jsonl'));
    const app = createApp(config);

    const resHtml = await app.request('/digest/2026-10-28');
    const resJson = await app.request('/api/digest/2026-10-28');
    expect(resHtml.status).toBe(200);
    expect(resJson.status).toBe(200);

    const html = await resHtml.text();
    const json = (await resJson.json()) as NightDigest;

    const htmlJobs = parseTableRows(html).map((r) => r.job);
    const jsonJobs = json.rows.map((r) => r.job);

    expect(htmlJobs.length).toBeGreaterThan(0);
    expect(htmlJobs).toEqual(jsonJobs);
  });

  it('returns 404 for a night with no file on both HTML and JSON routes', async () => {
    const app = createApp(config);

    const resHtml = await app.request('/digest/2026-10-99');
    expect(resHtml.status).toBe(404);
    expect(await resHtml.text()).toBe('not found');

    const resJson = await app.request('/api/digest/2026-10-99');
    expect(resJson.status).toBe(404);
    expect(await resJson.json()).toEqual({ error: 'not found' });
  });

  it('renders "nothing ran" on HTML and rows: [] on JSON for an empty night file', async () => {
    writeFileSync(join(tempDir, '2026-10-20.jsonl'), '');
    const app = createApp(config);

    // HTML route: GET /digest/:night
    const resHtml = await app.request('/digest/2026-10-20');
    expect(resHtml.status).toBe(200);
    const html = await resHtml.text();
    expect(html).toContain('<h1>digest · 2026-10-20</h1>');
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table>');

    // JSON route: GET /api/digest/:night
    const resJson = await app.request('/api/digest/2026-10-20');
    expect(resJson.status).toBe(200);
    const json = (await resJson.json()) as NightDigest;
    expect(json).toEqual({
      night: '2026-10-20',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('renders valid rows and bad line count without throwing on both HTML and JSON routes', async () => {
    const lines = [
      'corrupt unparseable line',
      '{"at":"2026-10-21T01:00:00+01:00","job":"job/beta","status":"ok","owner":"alice"}',
      '{"status":"ok"}', // missing at and job
      '{"at":"2026-10-21T02:00:00+01:00","job":"job/alpha","status":"fail","owner":"bob","error":"timeout"}',
      '{not json at all}',
    ];
    writeFileSync(join(tempDir, '2026-10-21.jsonl'), lines.join('\n'));
    const app = createApp(config);

    // HTML route: GET /digest/:night
    const resHtml = await app.request('/digest/2026-10-21');
    expect(resHtml.status).toBe(200);
    const html = await resHtml.text();
    expect(html).toContain('<p class="warn">3 bad lines</p>');

    const rows = parseTableRows(html);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.job)).toEqual(['job/alpha', 'job/beta']);

    // JSON route: GET /api/digest/:night
    const resJson = await app.request('/api/digest/2026-10-21');
    expect(resJson.status).toBe(200);
    const json = (await resJson.json()) as NightDigest;
    expect(json.badLines).toBe(3);
    expect(json.counts).toEqual({ ok: 1, retry: 0, fail: 1 });
    expect(json.rows).toHaveLength(2);
    expect(json.rows.map((r) => r.job)).toEqual(['job/alpha', 'job/beta']);
  });
});
