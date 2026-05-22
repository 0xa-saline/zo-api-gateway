const KV_KEY = 'zo_tokens';

export interface StoredToken {
  token: string;
  label: string;
  email?: string;
  spaceName?: string;
  addedAt: number;
  enabled: boolean;
  lastChecked?: number;
  status?: 'valid' | 'invalid' | 'unchecked';
  disableReason?: string;
}

export async function getTokens(kv: KVNamespace): Promise<StoredToken[]> {
  const raw = await kv.get(KV_KEY);
  if (!raw) return [];
  try {
    const tokens = JSON.parse(raw) as StoredToken[];
    let migrated = false;
    for (const t of tokens) {
      if (!t.email && t.label && t.label.includes('@')) {
        t.email = t.label;
        t.label = '';
        migrated = true;
      }
      if (t.status === undefined) {
        t.status = 'unchecked';
        migrated = true;
      }
    }
    if (migrated) {
      await kv.put(KV_KEY, JSON.stringify(tokens));
    }
    return tokens;
  } catch {
    return [];
  }
}

export async function addToken(
  kv: KVNamespace,
  token: string,
  email?: string,
  spaceName?: string,
): Promise<StoredToken[]> {
  const tokens = await getTokens(kv);
  const exists = tokens.some((t) => t.token === token);
  if (exists) throw new Error('Token already exists');
  const entry: StoredToken = { token, label: '', addedAt: Date.now(), enabled: true, status: 'unchecked' };
  if (email) entry.email = email;
  if (spaceName) entry.spaceName = spaceName;
  tokens.push(entry);
  await kv.put(KV_KEY, JSON.stringify(tokens));
  return tokens;
}

export async function removeToken(kv: KVNamespace, token: string): Promise<StoredToken[]> {
  let tokens = await getTokens(kv);
  tokens = tokens.filter((t) => t.token !== token);
  await kv.put(KV_KEY, JSON.stringify(tokens));
  return tokens;
}

export async function toggleToken(kv: KVNamespace, token: string, enabled: boolean): Promise<StoredToken[]> {
  const tokens = await getTokens(kv);
  const t = tokens.find((t) => t.token === token);
  if (t) {
    t.enabled = enabled;
    if (enabled) t.disableReason = undefined;
  }
  await kv.put(KV_KEY, JSON.stringify(tokens));
  return tokens;
}

export async function updateToken(
  kv: KVNamespace,
  token: string,
  updates: { email?: string; spaceName?: string },
): Promise<StoredToken[]> {
  const tokens = await getTokens(kv);
  const t = tokens.find((t) => t.token === token);
  if (!t) throw new Error('Token not found');
  if (updates.email !== undefined) t.email = updates.email;
  if (updates.spaceName !== undefined) t.spaceName = updates.spaceName;
  await kv.put(KV_KEY, JSON.stringify(tokens));
  return tokens;
}

export async function updateTokenStatus(
  kv: KVNamespace,
  token: string,
  status: 'valid' | 'invalid' | 'unchecked',
  disableReason?: string,
): Promise<StoredToken[]> {
  const tokens = await getTokens(kv);
  const t = tokens.find((t) => t.token === token);
  if (!t) throw new Error('Token not found');
  t.status = status;
  t.lastChecked = Date.now();
  if (status === 'invalid') {
    t.enabled = false;
    t.disableReason = disableReason || 'auto-check: token invalid';
  }
  if (disableReason !== undefined) t.disableReason = disableReason;
  await kv.put(KV_KEY, JSON.stringify(tokens));
  return tokens;
}

export async function autoDisableToken(
  kv: KVNamespace,
  token: string,
  reason: string,
): Promise<void> {
  const tokens = await getTokens(kv);
  const t = tokens.find((t) => t.token === token);
  if (t && t.enabled) {
    t.enabled = false;
    t.status = 'invalid';
    t.disableReason = reason;
    t.lastChecked = Date.now();
    await kv.put(KV_KEY, JSON.stringify(tokens));
  }
}

export async function getEnabledTokenStrings(kv: KVNamespace): Promise<string[]> {
  const tokens = await getTokens(kv);
  return tokens.filter((t) => t.enabled).map((t) => t.token);
}
