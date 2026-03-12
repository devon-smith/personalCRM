"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronRight, Search } from "lucide-react";
import { CircleIcon } from "@/components/ui/circle-icon";
import { WarmthAvatar } from "@/components/ui/warmth-avatar";
import { MiniBar } from "@/components/ui/mini-bar";
import { getInitials } from "@/lib/avatar";
import { useAddContactsToCircle } from "@/lib/hooks/use-circles";
import type { CircleContact } from "@/lib/hooks/use-circles";

interface CircleRowProps {
  circleId: string;
  name: string;
  color: string;
  followUpDays: number;
  contacts: CircleContact[];
  health: { good: number; mid: number; cold: number };
  isOpen: boolean;
  onToggle: () => void;
  onLogInteraction?: (contactId: string) => void;
  allContacts?: Array<{ id: string; name: string }>;
}

function formatDaysSince(days: number | null): string {
  if (days === null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

export function CircleRow({
  circleId,
  name,
  color,
  followUpDays,
  contacts,
  health,
  isOpen,
  onToggle,
  onLogInteraction,
  allContacts,
}: CircleRowProps) {
  const [hoveredContactId, setHoveredContactId] = useState<string | null>(null);
  const [showAddSearch, setShowAddSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const addContacts = useAddContactsToCircle();
  const letter = name.charAt(0);

  const contactIdsInCircle = new Set(contacts.map((c) => c.id));
  const filteredAddCandidates = (allContacts ?? []).filter(
    (c) =>
      !contactIdsInCircle.has(c.id) &&
      c.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  useEffect(() => {
    if (showAddSearch) {
      searchInputRef.current?.focus();
    }
  }, [showAddSearch]);

  return (
    <div
      className="overflow-hidden rounded-[14px] transition-all"
      style={{
        backgroundColor: "var(--surface)",
        border: isOpen ? `1px solid ${color}22` : "1px solid transparent",
      }}
    >
      {/* Collapsed row */}
      <button
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-[13px] text-left transition-colors"
        style={{ transitionDuration: "var(--duration-fast)" }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
        onClick={onToggle}
      >
        <CircleIcon letter={letter} color={color} size={36} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="ds-heading-sm">{name}</span>
            <span className="ds-caption">{contacts.length}</span>
          </div>
          <div className="mt-[5px] max-w-[160px]">
            <MiniBar good={health.good} mid={health.mid} cold={health.cold} />
          </div>
        </div>

        {/* Avatar stack — hidden when expanded */}
        {!isOpen && contacts.length > 0 && (
          <div className="hidden items-center sm:flex">
            {contacts.slice(0, 4).map((contact, i) => (
              <div
                key={contact.id}
                style={{ marginLeft: i > 0 ? -6 : 0, zIndex: 4 - i }}
              >
                <WarmthAvatar
                  initials={getInitials(contact.name)}
                  warmth={contact.warmth}
                  size={26}
                  avatarUrl={contact.avatarUrl}
                />
              </div>
            ))}
            {contacts.length > 4 && (
              <div
                className="flex items-center justify-center text-[10px] font-semibold"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 26 * 0.38,
                  backgroundColor: "var(--surface-sunken)",
                  color: "var(--text-tertiary)",
                  marginLeft: -6,
                }}
              >
                +{contacts.length - 4}
              </div>
            )}
          </div>
        )}

        <span className="ds-caption">{followUpDays}d</span>

        <ChevronRight
          className="h-3.5 w-3.5 transition-transform"
          style={{
            color: "var(--text-tertiary)",
            transitionDuration: "var(--duration-fast)",
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="overflow-hidden">
          <div className="mx-4" style={{ borderTop: "1px solid var(--border-subtle)" }} />

          <div className="px-4 pb-3 pt-2">
            {contacts.length === 0 ? (
              <p className="py-4 text-center ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
                No contacts in this circle yet
              </p>
            ) : (
              <div className="crm-stagger">
                {contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center gap-3 rounded-[10px] px-2 py-2 transition-colors"
                    style={{ transitionDuration: "var(--duration-fast)" }}
                    onMouseEnter={(e) => {
                      setHoveredContactId(contact.id);
                      e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
                    }}
                    onMouseLeave={(e) => {
                      setHoveredContactId(null);
                      e.currentTarget.style.backgroundColor = "";
                    }}
                  >
                    <WarmthAvatar
                      initials={getInitials(contact.name)}
                      warmth={contact.warmth}
                      size={30}
                      avatarUrl={contact.avatarUrl}
                    />

                    <span
                      className="flex-1 text-[13.5px] font-medium"
                      style={{
                        color: contact.warmth === "cold" ? "var(--text-tertiary)" : "var(--text-primary)",
                      }}
                    >
                      {contact.name}
                    </span>

                    <span className="ds-caption">
                      {formatDaysSince(contact.daysSince)}
                    </span>

                    {hoveredContactId === contact.id && (
                      <div className="flex gap-1">
                        <button
                          className="rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition-colors"
                          style={{
                            backgroundColor: "var(--surface-sunken)",
                            color: "var(--text-tertiary)",
                            transitionDuration: "var(--duration-fast)",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = "var(--border)";
                            e.currentTarget.style.color = "var(--text-secondary)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
                            e.currentTarget.style.color = "var(--text-tertiary)";
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onLogInteraction?.(contact.id);
                          }}
                        >
                          log
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!showAddSearch ? (
              <button
                className="mt-1 px-2 py-[7px] text-[13px] font-medium transition-colors"
                style={{ color: "var(--text-tertiary)", transitionDuration: "var(--duration-fast)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent-color)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
                onClick={() => setShowAddSearch(true)}
              >
                + Add person
              </button>
            ) : (
              <div className="mt-1">
                <div
                  className="flex items-center gap-2 rounded-[10px] px-2 py-1.5"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <Search className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search contacts..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setShowAddSearch(false);
                        setSearchQuery("");
                      }
                    }}
                    className="flex-1 bg-transparent text-[13px] placeholder-current outline-none"
                    style={{ color: "var(--text-primary)", "--tw-placeholder-opacity": 1 } as React.CSSProperties}
                  />
                  <button
                    className="text-[11px] transition-colors"
                    style={{ color: "var(--text-tertiary)", transitionDuration: "var(--duration-fast)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
                    onClick={() => {
                      setShowAddSearch(false);
                      setSearchQuery("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
                {searchQuery.length > 0 && (
                  <div
                    className="mt-1 max-h-[160px] overflow-y-auto rounded-[10px]"
                    style={{
                      backgroundColor: "var(--surface)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    {filteredAddCandidates.length === 0 ? (
                      <p className="px-3 py-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                        No matching contacts
                      </p>
                    ) : (
                      filteredAddCandidates.slice(0, 8).map((candidate) => (
                        <button
                          key={candidate.id}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors"
                          style={{ color: "var(--text-primary)", transitionDuration: "var(--duration-fast)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
                          onClick={() => {
                            addContacts.mutate(
                              { circleId, contactIds: [candidate.id] },
                              {
                                onSuccess: () => {
                                  setShowAddSearch(false);
                                  setSearchQuery("");
                                },
                              },
                            );
                          }}
                        >
                          <WarmthAvatar
                            initials={getInitials(candidate.name)}
                            warmth="none"
                            size={22}
                          />
                          {candidate.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
