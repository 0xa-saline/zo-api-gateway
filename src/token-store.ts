const KV_KEY = 'zo_tokens';

export interface StoredToken {
  token: string;
  label: string;
  email?: string;
  spaceName?: string;
  addedAt: number;
  enabled: boolean;
}

export async function getTokens(kv: KVNamespace): Promise<StoredToken[]> {
  const raw = await kv.get(KV_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as StoredToken[];
  } catch {
    return [];
  }
}

export async function addToken(
  kv: KVNamespace,
  token: string,
  label: string,
  email?: string,
  spaceName?: string,
): Promise<StoredToken[]> {
  const tokens = await getTokens(kv);
  const exists = tokens.some((t) => t.token === token);
  if (exists) throw new Error('Token already exists');
  const entry: StoredToken = { token, label, addedAt: Date.now(), enabled: true };
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
  if (t) t.enabled = enabled;
  await kv.put(KV_KEY, JSON.stringify(tokens));
  return tokens;
}

export async function getEnabledTokenStrings(kv: KVNamespace): Promise<string[]> {
  const tokens = await getTokens(kv);
  return tokens.filter((t) => t.enabled).map((t) => t.token);
}
