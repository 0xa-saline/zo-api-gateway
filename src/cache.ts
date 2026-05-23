const CACHE_PREFIX = 'cache:';
const CACHE_TTL_SECONDS = 3600; // 1 hour default

interface CacheEntry {
  response: string;
  model: string;
  timestamp: number;
}

interface CacheStats {
  total_keys: number;
  oldest?: number;
  newest?: number;
}

async function hashKey(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildCacheKey(model: string, messages: unknown[]): string {
  const normalized = JSON.stringify({ model, messages });
  return normalized;
}

export async function getCache(kv: KVNamespace, cacheKeyRaw: string): Promise<string | null> {
  const hash = await hashKey(cacheKeyRaw);
  const key = `${CACHE_PREFIX}${hash}`;
  const entry = await kv.get<CacheEntry>(key, 'json');
  if (!entry) return null;
  return entry.response;
}

export async function setCache(
  kv: KVNamespace,
  cacheKeyRaw: string,
  response: string,
  model: string,
  ttl?: number,
): Promise<void> {
  const hash = await hashKey(cacheKeyRaw);
  const key = `${CACHE_PREFIX}${hash}`;
  const entry: CacheEntry = {
    response,
    model,
    timestamp: Date.now(),
  };
  await kv.put(key, JSON.stringify(entry), {
    expirationTtl: ttl ?? CACHE_TTL_SECONDS,
  });
}

export async function clearCache(kv: KVNamespace): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const list = await kv.list({ prefix: CACHE_PREFIX, cursor, limit: 100 });
    for (const key of list.keys) {
      await kv.delete(key.name);
      deleted++;
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return deleted;
}

export async function getCacheStats(kv: KVNamespace): Promise<CacheStats> {
  let total = 0;
  let oldest: number | undefined;
  let newest: number | undefined;
  let cursor: string | undefined;
  do {
    const list = await kv.list({ prefix: CACHE_PREFIX, cursor, limit: 100 });
    total += list.keys.length;
    for (const key of list.keys) {
      if (key.expiration) {
        const created = (key.expiration - CACHE_TTL_SECONDS) * 1000;
        if (!oldest || created < oldest) oldest = created;
        if (!newest || created > newest) newest = created;
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return { total_keys: total, oldest, newest };
}
