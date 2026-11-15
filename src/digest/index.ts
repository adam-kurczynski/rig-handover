import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, RunStatus } from './types.js';

const NIGHT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

type ParsedEntry = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function parseEntry(raw: string): ParsedEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;

  if (typeof record.at !== 'string' || record.at.length === 0) {
    return null;
  }

  if (typeof record.job !== 'string' || record.job.length === 0) {
    return null;
  }

  if (record.status !== 'ok' && record.status !== 'retry' && record.status !== 'fail') {
    return null;
  }

  if (record.owner !== undefined && record.owner !== null && typeof record.owner !== 'string') {
    return null;
  }

  if (record.error !== undefined && record.error !== null && typeof record.error !== 'string') {
    return null;
  }

  return {
    at: record.at,
    job: record.job,
    status: record.status,
    owner: typeof record.owner === 'string' ? record.owner : null,
    ...(typeof record.error === 'string' && record.error.length > 0 ? { error: record.error } : {}),
  };
}

export function readNight(runsDir: string, night: string): NightDigest | null {
  if (!NIGHT_REGEX.test(night)) {
    return null;
  }

  let content: string;
  try {
    content = readFileSync(join(runsDir, `${night}.jsonl`), 'utf-8');
  } catch {
    return null;
  }

  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return {
      night,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    };
  }

  let badLines = 0;
  const counts = { ok: 0, retry: 0, fail: 0 };
  const jobMap = new Map<string, DigestRow>();

  for (const line of lines) {
    const entry = parseEntry(line);
    if (!entry) {
      badLines++;
      continue;
    }

    counts[entry.status]++;

    const existing = jobMap.get(entry.job);
    if (!existing) {
      const owner = entry.owner && entry.owner.trim().length > 0 ? entry.owner : '—';
      jobMap.set(entry.job, {
        job: entry.job,
        owner,
        runs: 1,
        retries: entry.status === 'retry' ? 1 : 0,
        lastStatus: entry.status,
        lastError: entry.error ?? null,
        first: entry.at,
        last: entry.at,
      });
    } else {
      existing.runs += 1;
      if (entry.status === 'retry') {
        existing.retries += 1;
      }
      existing.lastStatus = entry.status;
      if (entry.owner && entry.owner.trim().length > 0) {
        existing.owner = entry.owner;
      }
      if (entry.error !== undefined && entry.error.length > 0) {
        existing.lastError = entry.error;
      }
      existing.last = entry.at;
    }
  }

  const rows = Array.from(jobMap.values()).sort((a, b) => a.job.localeCompare(b.job));

  return {
    night,
    rows,
    badLines,
    counts,
  };
}

export type { RunStatus, DigestRow, NightDigest, ReadNight } from './types.js';
