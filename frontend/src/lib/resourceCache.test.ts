import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearResourceCache, fetchCacheFirstJson, getResourceHealthSnapshot } from "./resourceCache";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

beforeEach(() => {
  const target = new EventTarget() as EventTarget & { localStorage: Storage };
  target.localStorage = new MemoryStorage();
  vi.stubGlobal("window", target);
  clearResourceCache();
});

describe("fetchCacheFirstJson", () => {
  it("deduplicates concurrent cold requests", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ value: 7 }), { status: 200 }));
    const [first, second] = await Promise.all([
      fetchCacheFirstJson<{ value: number }>("https://example.test/catalog", { fetcher }),
      fetchCacheFirstJson<{ value: number }>("https://example.test/catalog", { fetcher }),
    ]);

    expect(first.value).toBe(7);
    expect(second.value).toBe(7);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getResourceHealthSnapshot()[0]?.state).toBe("fresh");
  });

  it("returns cached data immediately and refreshes it in the background", async () => {
    const url = "https://example.test/playercards";
    await fetchCacheFirstJson(url, {
      fetcher: async () => new Response(JSON.stringify({ revision: 1 }), { status: 200 }),
    });
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async () => {
      await waiting;
      return new Response(JSON.stringify({ revision: 2 }), { status: 200 });
    });

    const cached = await fetchCacheFirstJson<{ revision: number }>(url, { fetcher });
    expect(cached.revision).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(getResourceHealthSnapshot()[0]?.state).toBe("fresh"));
    const refreshed = await fetchCacheFirstJson<{ revision: number }>(url, { fetcher: vi.fn(async () => { throw new Error("offline"); }) });
    expect(refreshed.revision).toBe(2);
  });

  it("uses stale data when refresh fails", async () => {
    const url = "https://example.test/weapons";
    await fetchCacheFirstJson(url, {
      fetcher: async () => new Response(JSON.stringify({ items: ["cached"] }), { status: 200 }),
    });
    const value = await fetchCacheFirstJson<{ items: string[] }>(url, {
      fetcher: vi.fn(async () => { throw new Error("offline"); }),
      maxAgeMs: 0,
    });
    expect(value.items).toEqual(["cached"]);
  });
});
