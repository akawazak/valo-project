export const RESOURCE_CACHE_VERSION = 3;

const CACHE_PREFIX = `vv-resource-cache:v${RESOURCE_CACHE_VERSION}:`;
const LEGACY_PREFIX = "vv-public-cache:";
const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const inFlight = new Map<string, Promise<unknown>>();
const health = new Map<string, ResourceHealth>();

export type ResourceHealthState = "fresh" | "stale" | "refreshing" | "error" | "empty";

export type ResourceHealth = {
  key: string;
  url: string;
  state: ResourceHealthState;
  source: "network" | "cache" | "none";
  savedAt: number;
  lastAttemptAt: number;
  lastSuccessAt: number;
  error?: string;
};

type CacheEnvelope<T> = {
  version: number;
  savedAt: number;
  data: T;
};

export type CacheFirstOptions = {
  timeoutMs?: number;
  maxAgeMs?: number;
  force?: boolean;
  fetcher?: typeof fetch;
};

function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function cacheKey(url: string) {
  return `${CACHE_PREFIX}${url}`;
}

function emit(name: string, detail: unknown) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
}

function updateHealth(url: string, patch: Partial<ResourceHealth>) {
  const previous = health.get(url) || {
    key: url,
    url,
    state: "empty" as const,
    source: "none" as const,
    savedAt: 0,
    lastAttemptAt: 0,
    lastSuccessAt: 0,
  };
  const next = { ...previous, ...patch };
  health.set(url, next);
  emit("vantavault:data-health", next);
}

function parseEnvelope<T>(raw: string | null): CacheEnvelope<T> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CacheEnvelope<T>>;
    if (!parsed || typeof parsed.savedAt !== "number" || !("data" in parsed)) return null;
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      savedAt: parsed.savedAt,
      data: parsed.data as T,
    };
  } catch {
    return null;
  }
}

function readEnvelope<T>(url: string): CacheEnvelope<T> | null {
  const target = storage();
  if (!target) return null;
  const current = parseEnvelope<T>(target.getItem(cacheKey(url)));
  if (current?.version === RESOURCE_CACHE_VERSION) return current;

  const legacy = parseEnvelope<T>(target.getItem(`${LEGACY_PREFIX}${url}`));
  if (!legacy) return null;
  const migrated = { ...legacy, version: RESOURCE_CACHE_VERSION };
  try {
    target.setItem(cacheKey(url), JSON.stringify(migrated));
    target.removeItem(`${LEGACY_PREFIX}${url}`);
  } catch {
    // Storage is best effort; the migrated value is still usable this session.
  }
  return migrated;
}

function writeEnvelope<T>(url: string, envelope: CacheEnvelope<T>) {
  try {
    storage()?.setItem(cacheKey(url), JSON.stringify(envelope));
  } catch {
    // Quota/private-mode failures should not make a successful request fail.
  }
}

function stableJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

async function fetchAndCache<T>(url: string, options: CacheFirstOptions, previous: CacheEnvelope<T> | null): Promise<T> {
  const existing = inFlight.get(url) as Promise<T> | undefined;
  if (existing) return existing;

  const request = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
    updateHealth(url, { state: "refreshing", source: previous ? "cache" : "none", lastAttemptAt: Date.now(), error: undefined });
    try {
      const response = await (options.fetcher || fetch)(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as T;
      const savedAt = Date.now();
      const changed = !previous || stableJson(previous.data) !== stableJson(data);
      writeEnvelope(url, { version: RESOURCE_CACHE_VERSION, savedAt, data });
      updateHealth(url, { state: "fresh", source: "network", savedAt, lastSuccessAt: savedAt, error: undefined });
      if (changed) emit("vantavault:resource-updated", { url, savedAt });
      return data;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      updateHealth(url, {
        state: previous ? "stale" : "error",
        source: previous ? "cache" : "none",
        savedAt: previous?.savedAt || 0,
        error: message,
      });
      if (previous) return previous.data;
      throw reason;
    } finally {
      clearTimeout(timeoutId);
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, request);
  return request;
}

/**
 * Returns cached data synchronously-fast and refreshes it in the background.
 * A cold cache still waits for the network. Concurrent callers share one request.
 */
export async function fetchCacheFirstJson<T>(url: string, options: CacheFirstOptions = {}): Promise<T> {
  const cached = readEnvelope<T>(url);
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const isFresh = Boolean(cached && Date.now() - cached.savedAt <= maxAgeMs);

  if (cached && !options.force) {
    updateHealth(url, {
      state: isFresh ? "fresh" : "stale",
      source: "cache",
      savedAt: cached.savedAt,
      lastSuccessAt: cached.savedAt,
    });
    void fetchAndCache(url, options, cached).catch(() => undefined);
    return cached.data;
  }

  return fetchAndCache(url, options, cached);
}

export function getResourceHealthSnapshot(): ResourceHealth[] {
  return [...health.values()].sort((left, right) => left.url.localeCompare(right.url));
}

export function clearResourceCache() {
  const target = storage();
  if (target) {
    const keys: string[] = [];
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (key?.startsWith(CACHE_PREFIX) || key?.startsWith(LEGACY_PREFIX)) keys.push(key);
    }
    for (const key of keys) target.removeItem(key);
  }
  health.clear();
  emit("vantavault:data-health", null);
}
