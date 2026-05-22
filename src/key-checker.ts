const ZO_API_BASE = 'https://api.zo.computer';

export interface TokenCheckResult {
  valid: boolean;
  httpStatus: number;
  error?: string;
  checkedAt: number;
}

export interface TokenQuotaResult {
  available: boolean;
  checkedAt: number;
  used?: number;
  limit?: number;
  remaining?: number;
  plan?: string;
  resetAt?: string;
  raw?: Record<string, unknown>;
}

export async function checkTokenValidity(token: string): Promise<TokenCheckResult> {
  const checkedAt = Date.now();
  try {
    const resp = await fetch(`${ZO_API_BASE}/zo/spaces`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (resp.ok) {
      return { valid: true, httpStatus: resp.status, checkedAt };
    }

    if (resp.status === 401 || resp.status === 403) {
      const body = await resp.text().catch(() => '');
      return { valid: false, httpStatus: resp.status, error: body || `HTTP ${resp.status}`, checkedAt };
    }

    // 5xx or other errors — server issue, not necessarily invalid
    return { valid: true, httpStatus: resp.status, checkedAt };
  } catch (err) {
    // Network error — can't determine validity, assume valid
    return { valid: true, httpStatus: 0, error: (err as Error).message, checkedAt };
  }
}

// Try to extract quota/usage info from a JSON response, scanning common field patterns
function extractQuotaFields(data: Record<string, unknown>, result: TokenQuotaResult): void {
  // Direct top-level fields
  for (const key of ['used', 'usage', 'tokens_used', 'credits_used', 'total_usage']) {
    if (typeof data[key] === 'number') { result.used = data[key] as number; break; }
  }
  for (const key of ['limit', 'quota', 'credits_limit', 'total_limit', 'credits_total', 'total_credits']) {
    if (typeof data[key] === 'number') { result.limit = data[key] as number; break; }
  }
  for (const key of ['remaining', 'credits_remaining', 'balance', 'credits_balance', 'credits_left']) {
    if (typeof data[key] === 'number') { result.remaining = data[key] as number; break; }
  }
  for (const key of ['plan', 'plan_name', 'subscription', 'tier']) {
    if (typeof data[key] === 'string') { result.plan = data[key] as string; break; }
  }
  for (const key of ['reset_at', 'resetAt', 'reset_date', 'renewal_date']) {
    if (typeof data[key] === 'string') { result.resetAt = data[key] as string; break; }
  }

  // Nested usage/quota/billing objects
  for (const container of ['usage', 'quota', 'billing', 'credits', 'account', 'subscription']) {
    const nested = data[container];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const obj = nested as Record<string, unknown>;
      if (result.used === undefined) {
        for (const key of ['used', 'total_used', 'count', 'tokens_used', 'credits_used']) {
          if (typeof obj[key] === 'number') { result.used = obj[key] as number; break; }
        }
      }
      if (result.limit === undefined) {
        for (const key of ['limit', 'total', 'max', 'quota', 'credits_total']) {
          if (typeof obj[key] === 'number') { result.limit = obj[key] as number; break; }
        }
      }
      if (result.remaining === undefined) {
        for (const key of ['remaining', 'balance', 'left', 'credits_remaining']) {
          if (typeof obj[key] === 'number') { result.remaining = obj[key] as number; break; }
        }
      }
      if (result.plan === undefined) {
        for (const key of ['plan', 'name', 'tier']) {
          if (typeof obj[key] === 'string') { result.plan = obj[key] as string; break; }
        }
      }
    }
  }

  // Derive remaining if not provided
  if (result.remaining === undefined && result.limit !== undefined && result.used !== undefined) {
    result.remaining = result.limit - result.used;
  }
}

// Try a single endpoint for quota info
async function tryQuotaEndpoint(url: string, token: string): Promise<TokenQuotaResult | null> {
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) return null;

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('json')) return null;

    const data = (await resp.json()) as Record<string, unknown>;
    const result: TokenQuotaResult = { available: false, checkedAt: Date.now(), raw: data };

    extractQuotaFields(data, result);

    // Consider it available if we found any meaningful data
    if (result.used !== undefined || result.limit !== undefined || result.remaining !== undefined || result.plan !== undefined) {
      result.available = true;
    }

    return result.available ? result : null;
  } catch {
    return null;
  }
}

const QUOTA_ENDPOINTS = [
  '/zo/usage',
  '/zo/me',
  '/zo/account',
  '/zo/billing',
  '/zo/credits',
  '/user/me',
  '/user/usage',
  '/v1/usage',
  '/api/usage',
];

export async function checkTokenQuota(token: string): Promise<TokenQuotaResult> {
  const checkedAt = Date.now();

  for (const endpoint of QUOTA_ENDPOINTS) {
    const result = await tryQuotaEndpoint(`${ZO_API_BASE}${endpoint}`, token);
    if (result) {
      result.checkedAt = checkedAt;
      return result;
    }
  }

  return { available: false, checkedAt };
}

export interface BatchCheckResult {
  token: string;
  validity: TokenCheckResult;
  quota: TokenQuotaResult;
}

export async function batchCheckTokens(tokens: string[]): Promise<BatchCheckResult[]> {
  const results: BatchCheckResult[] = [];
  for (const token of tokens) {
    const [validity, quota] = await Promise.all([
      checkTokenValidity(token),
      checkTokenQuota(token),
    ]);
    results.push({ token, validity, quota });
  }
  return results;
}
