export function privateCacheHeaders(
  maxAgeSeconds: number,
  staleWhileRevalidateSeconds = maxAgeSeconds * 5,
): HeadersInit {
  return {
    "Cache-Control": `private, max-age=${maxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`,
    Vary: "Cookie",
  };
}

export const noStoreHeaders: HeadersInit = {
  "Cache-Control": "no-store",
};
