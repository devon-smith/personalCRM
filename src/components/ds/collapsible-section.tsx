"use client";

import {
  ReactNode,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * Companion hook for sections that can't use <CollapsibleSection>
 * because their data shape is non-flat (e.g. Inbox renders items
 * grouped by time, with section dividers between groups). Shares
 * the same session-scoped Map so toggle state survives SPA route
 * changes within a tab, but full reload starts collapsed.
 *
 * Returns [expanded, toggle]; the caller renders its own disclosure.
 */
export function useSessionExpanded(
  storageKey: string,
): [boolean, () => void] {
  const [expanded, setExpanded] = useState<boolean>(() =>
    readSessionExpanded(storageKey),
  );
  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      sessionExpandState.set(storageKey, next);
      persistExpanded(storageKey, next);
      return next;
    });
  }, [storageKey]);
  return [expanded, toggle];
}

/**
 * CollapsibleSection — reusable disclosure primitive for dashboard
 * sections. Renders the first N items by default; a "Show N more"
 * disclosure expands to the full list. Animation is a CSS height
 * transition (220ms ease-out) since framer-motion isn't a dep yet.
 *
 * Design constraints (from M0.7):
 *   - Fresh page load always starts collapsed ("dashboard starts
 *     calm"). Reads from localStorage are deferred — see
 *     persistExpanded below; we write the user's preference but
 *     don't honor it across full reloads.
 *   - Within a single SPA tab session, route changes DO remember
 *     the expanded state (a module-level Map survives mount/unmount
 *     while the JS module lives).
 *   - Hide the disclosure entirely when items.length <= previewCount.
 *     Never render "Show 0 more".
 *
 * For testability, the slicing + disclosure-visibility logic is
 * extracted into pure helpers below. The component itself is a thin
 * shell over those — the hook + DOM is verified manually.
 */

export interface CollapsibleSectionProps<T> {
  /** localStorage key for the (optional) cross-session preference. */
  storageKey: string;
  /** How many items render when collapsed. */
  previewCount: number;
  items: readonly T[];
  renderItem: (item: T, idx: number) => ReactNode;
  /** Rendered when items.length === 0. Defaults to nothing. */
  emptyState?: ReactNode;
  /** Build the disclosure label from the hidden count. */
  showMoreLabel?: (hidden: number) => string;
  showLessLabel?: string;
  /** Container className for the list wrapper. */
  className?: string;
}

/**
 * Module-level singleton tracking expanded state by storageKey,
 * scoped to the JS module lifetime. SPA route changes preserve it
 * (the module stays alive); full browser reloads clear it (a fresh
 * module instance starts empty). Matches the "start calm on every
 * fresh load, remember within session" spec.
 */
const sessionExpandState = new Map<string, boolean>();

export function CollapsibleSection<T>(
  props: CollapsibleSectionProps<T>,
): ReactNode {
  const {
    storageKey,
    previewCount,
    items,
    renderItem,
    emptyState,
    showMoreLabel = defaultShowMoreLabel,
    showLessLabel = "Show less",
    className,
  } = props;

  // Read once from the session-scoped Map via the shared hook. SSR-safe:
  // the Map is empty on first render, so the initial state is always
  // false unless the user has already toggled this section in-session.
  const [expanded, handleToggle] = useSessionExpanded(storageKey);

  const visibleItems = useMemo(
    () => getVisibleItems(items, previewCount, expanded),
    [items, previewCount, expanded],
  );

  const showDisclosure = shouldShowDisclosure(items.length, previewCount);
  const hidden = Math.max(0, items.length - previewCount);

  const labelId = useId();

  if (items.length === 0) {
    return emptyState ?? null;
  }

  return (
    <div className={className}>
      <div
        id={labelId}
        // Smooth height handoff. CSS can't animate to/from `auto`
        // directly, so we animate `max-height` against a generous
        // upper bound and let overflow handle the cutoff. The bound
        // is sized off the visible items count so collapse doesn't
        // animate past the actual content height.
        style={{
          overflow: "hidden",
          transition: "max-height 220ms ease-out",
          maxHeight: expanded ? "2000px" : `${previewCount * 88}px`,
        }}
      >
        {visibleItems.map((item, idx) => renderItem(item, idx))}
      </div>

      {showDisclosure && (
        <button
          type="button"
          aria-controls={labelId}
          aria-expanded={expanded}
          onClick={handleToggle}
          // ≥44px tap target — important on mobile per spec.
          className="group mt-2 flex h-11 w-full items-center justify-center gap-1 text-[12px] transition-colors"
          style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-tertiary)";
          }}
        >
          <span>
            {expanded ? showLessLabel : showMoreLabel(hidden)}
          </span>
          {expanded ? (
            <ChevronUp className="h-3 w-3" strokeWidth={2} />
          ) : (
            <ChevronDown className="h-3 w-3" strokeWidth={2} />
          )}
        </button>
      )}
    </div>
  );
}

// ─── Pure helpers (exported for testing) ────────────────────────

/**
 * Decide whether the disclosure button should render at all.
 * False when the list already fits in the preview slot — no point
 * showing "Show 0 more".
 */
export function shouldShowDisclosure(
  totalItems: number,
  previewCount: number,
): boolean {
  return totalItems > previewCount;
}

/**
 * Slice the items array based on the expanded state. When collapsed,
 * returns the first `previewCount` items. When expanded, returns
 * the full list.
 */
export function getVisibleItems<T>(
  items: readonly T[],
  previewCount: number,
  expanded: boolean,
): T[] {
  if (expanded) return items.slice();
  return items.slice(0, previewCount);
}

/**
 * Default disclosure label. Sections override this for natural
 * phrasing ("Show 12 more meetings", "Show full day").
 */
export function defaultShowMoreLabel(hidden: number): string {
  return `Show ${hidden} more`;
}

/**
 * Read the session-scoped expanded state. Exposed for testing
 * (so a test can prime + assert) and for the component's
 * `useState` initializer.
 */
export function readSessionExpanded(storageKey: string): boolean {
  return sessionExpandState.get(storageKey) ?? false;
}

/**
 * Reset the session-scoped state. Test-only — production code
 * has no reason to clear another section's state.
 */
export function _resetSessionExpandStateForTesting(): void {
  sessionExpandState.clear();
}

/**
 * Persist to localStorage. Safe in SSR / no-storage environments —
 * silently no-ops if the global isn't available. We don't read this
 * value back on mount (by spec), but it's available for a future
 * settings UI or cross-tab sync.
 */
function persistExpanded(storageKey: string, expanded: boolean): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, expanded ? "1" : "0");
  } catch {
    // Storage can throw in private browsing / quota-exceeded /
    // disabled-cookies contexts. Disclosure state isn't load-bearing,
    // so swallow.
  }
}
