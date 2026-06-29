/**
 * Cache wrapper for external research APIs (OpenAlex, Crossref, etc.).
 *
 * Each entry has its own TTL — author search results expire quickly
 * because new affiliations and papers appear constantly, while DOI
 * metadata can cache for weeks since it never changes.
 */
import { prisma } from "@/lib/prisma";

export interface CacheKey {
  source: string;
  kind: string;
  externalKey: string;
}

const inflightMisses = new Map<string, Promise<unknown>>();

function cacheKeyString(key: CacheKey): string {
  return `${key.source}\u0000${key.kind}\u0000${key.externalKey}`;
}

export async function getCached<T>(key: CacheKey): Promise<T | null> {
  const row = await prisma.externalResearchCache.findUnique({
    where: {
      source_kind_externalKey: {
        source: key.source,
        kind: key.kind,
        externalKey: key.externalKey,
      },
    },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row.data as T;
}

export async function setCached<T>(
  key: CacheKey,
  data: T,
  ttlMs: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await prisma.externalResearchCache.upsert({
    where: {
      source_kind_externalKey: {
        source: key.source,
        kind: key.kind,
        externalKey: key.externalKey,
      },
    },
    create: {
      source: key.source,
      kind: key.kind,
      externalKey: key.externalKey,
      data: data as object,
      expiresAt,
    },
    update: {
      data: data as object,
      fetchedAt: new Date(),
      expiresAt,
    },
  });
}

/**
 * Convenience: fetch through the cache. If the entry is missing or
 * stale, call the fetcher, write the result, and return it.
 */
export async function withCache<T>(
  key: CacheKey,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = await getCached<T>(key);
  if (hit !== null) return hit;

  const inflightKey = cacheKeyString(key);
  const existing = inflightMisses.get(inflightKey);
  if (existing) return existing as Promise<T>;

  const pending = (async () => {
    const fresh = await fetcher();
    await setCached(key, fresh, ttlMs);
    return fresh;
  })();
  inflightMisses.set(inflightKey, pending);

  try {
    return await pending;
  } finally {
    if (inflightMisses.get(inflightKey) === pending) {
      inflightMisses.delete(inflightKey);
    }
  }
}
