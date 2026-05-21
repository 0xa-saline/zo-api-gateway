import type { CallLog } from './types';

const LOG_KEY = 'zo_call_logs';
const MAX_LOGS = 50;

function generateLogId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'log_';
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export async function getLogs(kv: KVNamespace): Promise<CallLog[]> {
  const raw = await kv.get(LOG_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CallLog[];
  } catch {
    return [];
  }
}

export async function addLog(
  kv: KVNamespace,
  model: string,
  format: 'anthropic' | 'openai',
  status: 'ok' | 'error',
  duration: number,
  error?: string,
): Promise<void> {
  const logs = await getLogs(kv);
  const entry: CallLog = {
    id: generateLogId(),
    time: Date.now(),
    model,
    format,
    status,
    duration,
  };
  if (error) entry.error = error;
  logs.push(entry);
  while (logs.length > MAX_LOGS) logs.shift();
  await kv.put(LOG_KEY, JSON.stringify(logs));
}
