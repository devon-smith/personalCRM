"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * RouteTransition (M0.x.17)
 *
 * Wraps the dashboard content and replays a short fade+lift each time
 * the pathname changes, so moving between tabs in the mobile shell
 * reads as a transition rather than an instant swap. The wrapper
 * `<div key={pathname}>` remounts on navigation, which re-triggers the
 * CSS animation exactly once per route change.
 *
 * Desktop gets the same gentle fade; it's subtle enough not to feel
 * heavy with a mouse, and keeps the two surfaces consistent.
 *
 * Also keeps per-path scroll memory: navigating back to a list (e.g.
 * /people → a contact → back) restores where you were instead of
 * snapping to the top. A fresh tab still opens at the top (native tab
 * behavior).
 *
 * Honors prefers-reduced-motion via CSS (the keyframe is disabled in
 * the reduced-motion block, so this just renders children).
 */
export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const scrollPositions = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    // Restore the incoming path's saved scroll (back-nav) or start at
    // the top (fresh tab). The continuous listener below keeps the
    // stored value fresh while we're on a page.
    const saved = scrollPositions.current.get(pathname);
    requestAnimationFrame(() => {
      window.scrollTo({ top: saved ?? 0, behavior: "auto" });
    });
  }, [pathname]);

  // Continuously record the current path's scroll position so that when
  // we navigate away, the last-known value is already stored.
  useEffect(() => {
    function onScroll() {
      scrollPositions.current.set(pathname, window.scrollY);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname]);

  return (
    <div key={pathname} className="ds-route-fade">
      {children}
    </div>
  );
}
