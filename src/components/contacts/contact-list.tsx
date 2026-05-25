"use client";

import * as React from "react";
import { useMemo } from "react";
import { PersonRow, Sparkline } from "@/components/ds";
import type { ContactWithCount } from "@/lib/hooks/use-contacts";
import { useMomentum } from "@/lib/hooks/use-momentum";
import { formatDistanceToNow } from "@/lib/date-utils";

interface ContactListProps {
  contacts: ContactWithCount[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}

/**
 * Apple Contacts-style list view. Each row is a PersonRow primitive,
 * grouped by leading letter with a sticky letter heading. The right
 * edge gets a sticky A–Z jump rail.
 *
 * Replaces the wide-table ContactTable on the People page. The table
 * surfaced columns (source, tags, momentum) that mostly belong in the
 * detail panel; the list keeps the visual rhythm tight.
 */
export function ContactList({ contacts, onSelect, selectedId }: ContactListProps) {
  const contactIds = useMemo(() => contacts.map((c) => c.id), [contacts]);
  const { data: momentumData } = useMomentum(contactIds);

  const momentumMap = useMemo(() => {
    const map = new Map<string, { sparkline: readonly number[] }>();
    for (const m of momentumData?.momentum ?? []) {
      map.set(m.contactId, { sparkline: m.sparkline });
    }
    return map;
  }, [momentumData]);

  // Group by leading letter (uppercased). Anything that doesn't start
  // with a letter clusters under "#" so the rail still has a useful
  // anchor for phone-only contacts.
  const groups = useMemo(() => groupContactsByLetter(contacts), [contacts]);
  const availableLetters = useMemo(() => groups.map((g) => g.letter), [groups]);

  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="ds-body-md font-medium" style={{ color: "var(--text-primary)" }}>
          No contacts match.
        </p>
        <p className="ds-body-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
          Try a different search or filter.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-8" id="contact-list-scroll">
        {groups.map((group) => (
          <section key={group.letter} id={`group-${group.letter}`} className="pt-3">
            <div
              className="sticky top-0 z-10 -mx-2 px-2 py-2 mb-1 text-[12px] font-semibold uppercase tracking-[0.08em]"
              style={{
                color: "var(--text-tertiary)",
                backgroundColor: "var(--background)",
              }}
            >
              {group.letter}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((contact) => {
                const m = momentumMap.get(contact.id);
                const lastContact = contact.lastInteraction
                  ? `${formatDistanceToNow(new Date(contact.lastInteraction))} ago`
                  : "No contact yet";
                return (
                  <li key={contact.id}>
                    <PersonRow
                      name={contact.name}
                      meta={[contact.role, contact.company].filter(Boolean).join(" · ") || undefined}
                      onClick={() => onSelect(contact.id)}
                      className={
                        selectedId === contact.id
                          ? "bg-[var(--surface-sand-raised)]"
                          : undefined
                      }
                      trailing={
                        <>
                          {m && m.sparkline.length > 1 ? (
                            <Sparkline
                              data={[...m.sparkline]}
                              variant="line"
                              width={44}
                              height={18}
                              color="var(--text-tertiary)"
                            />
                          ) : null}
                          <span
                            className="text-[11.5px] tabular-nums whitespace-nowrap"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            {lastContact}
                          </span>
                        </>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <AlphaJumpRail
        letters={availableLetters}
        scrollContainerId="contact-list-scroll"
      />
    </div>
  );
}

// ─── Alpha rail ─────────────────────────────────────────────

function AlphaJumpRail({
  letters,
  scrollContainerId,
}: {
  letters: string[];
  scrollContainerId: string;
}) {
  const all = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const present = new Set(letters);

  function jumpTo(letter: string) {
    const el = document.getElementById(`group-${letter}`);
    const scroller = document.getElementById(scrollContainerId);
    if (!el || !scroller) return;
    const top = el.offsetTop;
    scroller.scrollTo({ top: top - 4, behavior: "smooth" });
  }

  return (
    <nav
      className="hidden sm:flex shrink-0 flex-col items-center justify-center px-2 select-none"
      aria-label="Jump to letter"
    >
      {all.map((letter) => {
        const has = present.has(letter);
        return (
          <button
            key={letter}
            disabled={!has}
            onClick={() => jumpTo(letter)}
            className="text-[10px] font-semibold leading-none px-1.5 py-0.5 rounded transition-colors"
            style={{
              color: has ? "var(--text-secondary)" : "var(--text-tertiary)",
              opacity: has ? 1 : 0.4,
              cursor: has ? "pointer" : "default",
            }}
            onMouseEnter={(e) => {
              if (has) e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              if (has) e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            {letter}
          </button>
        );
      })}
    </nav>
  );
}

// ─── Grouping helper ────────────────────────────────────────

function groupContactsByLetter(contacts: ContactWithCount[]) {
  const buckets = new Map<string, ContactWithCount[]>();
  for (const c of contacts) {
    const letter = leadingLetter(c.name);
    if (!buckets.has(letter)) buckets.set(letter, []);
    buckets.get(letter)!.push(c);
  }
  const ordered = Array.from(buckets.entries()).sort(([a], [b]) => {
    // "#" group always last so phone-only / symbol-only contacts don't
    // crowd the alphabetic visual rhythm at the top.
    if (a === "#") return 1;
    if (b === "#") return -1;
    return a.localeCompare(b);
  });
  return ordered.map(([letter, items]) => ({ letter, items }));
}

function leadingLetter(name: string): string {
  for (const ch of name) {
    if (/\p{L}/u.test(ch)) return ch.toUpperCase();
  }
  return "#";
}
