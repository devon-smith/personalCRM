"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const ROUTE_ORDER = [
  "/dashboard",
  "/reply-queue",
  "/ask",
  "/people",
  "/calendar",
  "/circles",
  "/voice",
  "/merge",
  "/settings",
];

function routeIndex(pathname: string): number {
  const index = ROUTE_ORDER.findIndex((path) =>
    path === "/dashboard"
      ? pathname === path
      : pathname === path || pathname.startsWith(`${path}/`),
  );
  return index >= 0 ? index : ROUTE_ORDER.length;
}

/**
 * RouteTransition (M0.x.17)
 *
 * Wraps dashboard content and replays a short directional fade/slide on
 * pathname changes. The direction follows the mobile tab order so the
 * shell reads closer to native iOS tab movement instead of a hard web
 * page swap.
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
  const previousPathname = useRef(pathname);
  const scrollPositions = useRef<Map<string, number>>(new Map());
  // eslint-disable-next-line react-hooks/refs -- previous route is read to derive transition direction
  const previousIndex = routeIndex(previousPathname.current);
  const currentIndex = routeIndex(pathname);
  // eslint-disable-next-line react-hooks/refs -- previous route is read to derive transition direction
  const isSamePathname = previousPathname.current === pathname;
  const direction =
    isSamePathname
      ? "neutral"
      : currentIndex > previousIndex
        ? "forward"
        : "back";

  useEffect(() => {
    previousPathname.current = pathname;
  }, [pathname]);

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
    <div
      key={pathname}
      className="ds-route-transition"
      data-route-direction={direction}
    >
      {children}
    </div>
  );
}
