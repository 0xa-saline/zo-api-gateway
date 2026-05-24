const LEGACY_KV_KEY = 'zo_tokens';
const TOKEN_PREFIX = 'zo_token_v2:';
const TOKEN_MIGRATION_KEY = 'zo_tokens_v2_ready';
const TOKEN_CACHE_TTL_MS = 2000;

let tokensMigrationReady = false;
let tokenCache: { tokens: StoredToken[]; expiresAt: number } | null = null;

export function tokenToId(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'tid_' + (h >>> 0).toString(36);
}

export function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return token.slice(0, 6) + '...' + token.slice(-4);
}

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

function normalizeToken(token: StoredToken): StoredToken {
  const normalized = { ...token };
  if (!normalized.email && normalized.label && normalized.label.includes('@')) {
    normalized.email = normalized.label;
    normalized.label = '';
  }
  if (normalized.status === undefined) {
    normalized.status = 'unchecked';
  }
  return normalized;
}

function sortTokens(tokens: StoredToken[]): StoredToken[] {
  return tokens.slice().sort((a, b) => a.addedAt - b.addedAt);
}

function cloneTokens(tokens: StoredToken[]): StoredToken[] {
  return tokens.map((token) => ({ ...token }));
}

function getCachedTokens(): StoredToken[] | null {
  if (!tokenCache || tokenCache.expiresAt <= Date.now()) return null;
  return cloneTokens(tokenCache.tokens);
}

function setTokenCache(tokens: StoredToken[]): StoredToken[] {
  const sorted = sortTokens(tokens);
  tokenCache = {
    tokens: cloneTokens(sorted),
    expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
  };
  return sorted;
}

function updateCachedToken(tokenValue: string, updater: (token: StoredToken) => StoredToken | null): void {
  const cached = getCachedTokens();
  if (!cached) return;
  const updated = cached
    .map((token) => (token.token === tokenValue ? updater(token) : token))
    .filter((token): token is StoredToken => token !== null);
  setTokenCache(updated);
}

function parseTokenRecord(raw: string | null): StoredToken | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredToken;
    if (typeof parsed.token !== 'string') return null;
    return normalizeToken(parsed);
  } catch {
    return null;
  }
}

async function listAllTokenKeys(kv: KVNamespace): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  while (true) {
    const page = await kv.list({ prefix: TOKEN_PREFIX, cursor });
    keys.push(...page.keys.map((key) => key.name));
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return keys;
}

async function tokenStorageKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return `${TOKEN_PREFIX}${hex}`;
}

async function putTokenRecord(kv: KVNamespace, token: StoredToken): Promise<void> {
  await kv.put(await tokenStorageKey(token.token), JSON.stringify(token));
}

async function getTokenRecord(kv: KVNamespace, token: string): Promise<StoredToken | null> {
  return parseTokenRecord(await kv.get(await tokenStorageKey(token)));
}

async function getTokensFromV2(kv: KVNamespace): Promise<StoredToken[]> {
  const keys = await listAllTokenKeys(kv);
  if (keys.length === 0) return [];

  const tokens = (await Promise.all(keys.map((key) => kv.get(key))))
    .map((raw) => parseTokenRecord(raw))
    .filter((token): token is StoredToken => token !== null);
  return sortTokens(tokens);
}

async function loadLegacyTokens(kv: KVNamespace): Promise<StoredToken[]> {
  const raw = await kv.get(LEGACY_KV_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredToken[];
    if (!Array.isArray(parsed)) return [];
    const tokens = parsed
      .map((token) => normalizeToken(token))
      .filter((token) => typeof token.token === 'string');
    return sortTokens(tokens);
  } catch {
    return [];
  }
}

async function ensureTokensMigrated(kv: KVNamespace): Promise<StoredToken[] | null> {
  if (tokensMigrationReady) return null;
  if (await kv.get(TOKEN_MIGRATION_KEY)) {
    tokensMigrationReady = true;
    return null;
  }

  const currentTokens = await getTokensFromV2(kv);
  const currentByToken = new Set(currentTokens.map((token) => token.token));
  const legacyTokens = await loadLegacyTokens(kv);
  const mergedTokens = [...currentTokens];

  for (const legacyToken of legacyTokens) {
    if (currentByToken.has(legacyToken.token)) continue;
    await putTokenRecord(kv, legacyToken);
    currentByToken.add(legacyToken.token);
    mergedTokens.push(legacyToken);
  }

  await kv.put(TOKEN_MIGRATION_KEY, '1');
  tokensMigrationReady = true;
  return setTokenCache(mergedTokens);
}

export async function getTokens(kv: KVNamespace): Promise<StoredToken[]> {
  const cached = tokensMigrationReady ? getCachedTokens() : null;
  if (cached) return cached;

  const migratedTokens = await ensureTokensMigrated(kv);
  if (migratedTokens) return migratedTokens;

  return setTokenCache(await getTokensFromV2(kv));
}

export async function addToken(
  kv: KVNamespace,
  token: string,
  email?: string,
  spaceName?: string,
): Promise<StoredToken[]> {
  const tokens = await getTokens(kv);
  const exists = tokens.some((entry) => entry.token === token);
  if (exists) throw new Error('Token already exists');
  const entry: StoredToken = { token, label: '', addedAt: Date.now(), enabled: true, status: 'unchecked' };
  if (email) entry.email = email;
  if (spaceName) entry.spaceName = spaceName;
  await putTokenRecord(kv, entry);
  return setTokenCache([...tokens, entry]);
}

export async function removeToken(kv: KVNamespace, token: string): Promise<StoredToken[]> {
  const tokens = await getTokens(kv);
  await kv.delete(await tokenStorageKey(token));
  return setTokenCache(tokens.filter((entry) => entry.token !== token));
}

export async function toggleToken(kv: KVNamespace, token: string, enabled: boolean): Promise<StoredToken[]> {
  const tokens = await getTokens(kv);
  const updatedTokens = tokens.map((entry) => {
    if (entry.token !== token) return entry;
    const updated: StoredToken = { ...entry, enabled };
    if (enabled) updated.disableReason = undefined;
    return updated;
  });
  const updated = updatedTokens.find((entry) => entry.token === token);
  if (updated) {
    await putTokenRecord(kv, updated);
  }
  return setTokenCache(updatedTokens);
}

export async function updateToken(
  kv: KVNamespace,
  token: string,
  updates: { email?: string; spaceName?: string },
): Promise<StoredToken[]> {
  const tokens = await getTokens(kv);
  const updatedTokens = tokens.map((entry) => {
    if (entry.token !== token) return entry;
    const updated = { ...entry };
    if (updates.email !== undefined) updated.email = updates.email;
    if (updates.spaceName !== undefined) updated.spaceName = updates.spaceName;
    return updated;
  });
  const updated = updatedTokens.find((entry) => entry.token === token);
  if (!updated) throw new Error('Token not found');
  await putTokenRecord(kv, updated);
  return setTokenCache(updatedTokens);
}

export async function updateTokenStatus(
  kv: KVNamespace,
  token: string,
  status: 'valid' | 'invalid' | 'unchecked',
  disableReason?: string,
): Promise<void> {
  await ensureTokensMigrated(kv);
  const record = await getTokenRecord(kv, token);
  if (!record) throw new Error('Token not found');

  record.status = status;
  record.lastChecked = Date.now();
  if (status === 'invalid') {
    record.enabled = false;
    record.disableReason = disableReason || 'auto-check: token invalid';
  }
  if (disableReason !== undefined) record.disableReason = disableReason;

  await putTokenRecord(kv, record);
  updateCachedToken(token, () => record);
}

export async function autoDisableToken(
  kv: KVNamespace,
  token: string,
  reason: string,
): Promise<void> {
  await ensureTokensMigrated(kv);
  const record = await getTokenRecord(kv, token);
  if (record && record.enabled) {
    record.enabled = false;
    record.status = 'invalid';
    record.disableReason = reason;
    record.lastChecked = Date.now();
    await putTokenRecord(kv, record);
    updateCachedToken(token, () => record);
  }
}

export async function getEnabledTokenStrings(kv: KVNamespace): Promise<string[]> {
  const tokens = await getTokens(kv);
  return tokens.filter((token) => token.enabled).map((token) => token.token);
}

export async function findTokenById(kv: KVNamespace, tokenId: string): Promise<string | null> {
  const tokens = await getTokens(kv);
  const token = tokens.find((entry) => tokenToId(entry.token) === tokenId);
  return token ? token.token : null;
}
