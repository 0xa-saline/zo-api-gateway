import type { CallLog } from './types';

const LEGACY_LOG_KEY = 'zo_call_logs';
const LOG_PREFIX = 'zo_call_log_v2:';
const LOG_MIGRATION_KEY = 'zo_call_logs_v2_ready';
const MAX_LOGS = 50;

let logsMigrationReady = false;

function generateLogId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'log_';
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function logStorageKey(log: CallLog): string {
  return `${LOG_PREFIX}${String(log.time).padStart(13, '0')}:${log.id}`;
}

function parseLogRecord(raw: string | null): CallLog | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CallLog;
    if (typeof parsed.id !== 'string' || typeof parsed.time !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function sortLogs(logs: CallLog[]): CallLog[] {
  return logs.slice().sort((a, b) => a.time - b.time);
}

async function listAllLogKeys(kv: KVNamespace): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  while (true) {
    const page = await kv.list({ prefix: LOG_PREFIX, cursor });
    keys.push(...page.keys.map((key) => key.name));
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return keys;
}

async function getLogsFromV2(kv: KVNamespace): Promise<CallLog[]> {
  const keys = await listAllLogKeys(kv);
  if (keys.length === 0) return [];

  const logs = (await Promise.all(keys.map((key) => kv.get(key))))
    .map((raw) => parseLogRecord(raw))
    .filter((log): log is CallLog => log !== null);
  return sortLogs(logs);
}

async function loadLegacyLogs(kv: KVNamespace): Promise<CallLog[]> {
  const raw = await kv.get(LEGACY_LOG_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CallLog[];
    if (!Array.isArray(parsed)) return [];
    return sortLogs(parsed);
  } catch {
    return [];
  }
}

async function ensureLogsMigrated(kv: KVNamespace): Promise<CallLog[] | null> {
  if (logsMigrationReady) return null;
  if (await kv.get(LOG_MIGRATION_KEY)) {
    logsMigrationReady = true;
    return null;
  }

  const currentLogs = await getLogsFromV2(kv);
  const currentKeys = new Set(currentLogs.map((log) => logStorageKey(log)));
  const legacyLogs = await loadLegacyLogs(kv);
  const mergedLogs = [...currentLogs];

  for (const legacyLog of legacyLogs) {
    const key = logStorageKey(legacyLog);
    if (currentKeys.has(key)) continue;
    await kv.put(key, JSON.stringify(legacyLog));
    currentKeys.add(key);
    mergedLogs.push(legacyLog);
  }

  await kv.put(LOG_MIGRATION_KEY, '1');
  logsMigrationReady = true;
  return sortLogs(mergedLogs);
}

async function pruneLogs(kv: KVNamespace): Promise<void> {
  const keys = await listAllLogKeys(kv);
  if (keys.length <= MAX_LOGS) return;
  const staleKeys = keys.sort().slice(0, keys.length - MAX_LOGS);
  await Promise.all(staleKeys.map((key) => kv.delete(key)));
}

export async function getLogs(kv: KVNamespace): Promise<CallLog[]> {
  const migratedLogs = await ensureLogsMigrated(kv);
  if (migratedLogs) return migratedLogs.slice(-MAX_LOGS);
  return (await getLogsFromV2(kv)).slice(-MAX_LOGS);
}

export async function addLog(
  kv: KVNamespace,
  model: string,
  format: 'anthropic' | 'openai',
  status: 'ok' | 'error',
  duration: number,
  error?: string,
): Promise<void> {
  await ensureLogsMigrated(kv);
  const entry: CallLog = {
    id: generateLogId(),
    time: Date.now(),
    model,
    format,
    status,
    duration,
  };
  if (error) entry.error = error;
  await kv.put(logStorageKey(entry), JSON.stringify(entry));
  await pruneLogs(kv);
}
