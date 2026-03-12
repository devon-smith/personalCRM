"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { CircleIcon } from "@/components/ui/circle-icon";
import { WarmthAvatar } from "@/components/ui/warmth-avatar";
import { MiniBar } from "@/components/ui/mini-bar";
import { getInitials } from "@/lib/avatar";
import type { CircleContact } from "@/lib/hooks/use-circles";

interface CircleRowProps {
  name: string;
  color: string;
  followUpDays: number;
  contacts: CircleContact[];
  health: { good: number; mid: number; cold: number };
  isOpen: boolean;
  onToggle: () => void;
  onLogInteraction?: (contactId: string) => void;
}

function formatDaysSince(days: number | null): string {
  if (days === null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

export function CircleRow({
  name,
  color,
  followUpDays,
  contacts,
  health,
  isOpen,
  onToggle,
  onLogInteraction,
}: CircleRowProps) {
  const [hoveredContactId, setHoveredContactId] = useState<string | null>(null);
  const letter = name.charAt(0);

  return (
    <div
      className="overflow-hidden rounded-[14px] bg-white transition-all"
      style={{
        border: isOpen ? `1px solid ${color}22` : "1px solid transparent",
      }}
    >
      {/* Collapsed row */}
      <button
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-[13px] text-left transition-colors hover:bg-[#F7F7F8]"
        onClick={onToggle}
      >
        <CircleIcon letter={letter} color={color} size={36} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className="text-[14px] font-semibold text-[#1A1A1A]"
              style={{ letterSpacing: "-0.02em" }}
            >
              {name}
            </span>
            <span className="text-[12px] font-normal text-[#C1C5CA]">
              {contacts.length}
            </span>
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
                className="flex items-center justify-center text-[10px] font-semibold text-[#9BA3AE]"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 26 * 0.38,
                  backgroundColor: "#F0F1F3",
                  marginLeft: -6,
                }}
              >
                +{contacts.length - 4}
              </div>
            )}
          </div>
        )}

        <span className="text-[11px] font-medium text-[#B5BAC0]">
          {followUpDays}d
        </span>

        <ChevronRight
          className="h-3.5 w-3.5 text-[#CBCFD4] transition-transform duration-200"
          style={{
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="overflow-hidden">
          <div className="mx-4 border-t border-[#F2F3F5]" />

          <div className="px-4 pb-3 pt-2">
            {contacts.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-[#C1C5CA]">
                No contacts in this circle yet
              </p>
            ) : (
              <div className="crm-stagger">
                {contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-[#F9F9FA]"
                    onMouseEnter={() => setHoveredContactId(contact.id)}
                    onMouseLeave={() => setHoveredContactId(null)}
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
                        color: contact.warmth === "cold" ? "#8A8F96" : "#2A2D32",
                      }}
                    >
                      {contact.name}
                    </span>

                    <span className="text-[12px] text-[#C1C5CA]">
                      {formatDaysSince(contact.daysSince)}
                    </span>

                    {hoveredContactId === contact.id && (
                      <div className="flex gap-1">
                        <button
                          className="rounded-md bg-[#F3F4F6] px-2 py-0.5 text-[11px] font-medium text-[#7B8189] transition-colors hover:bg-[#EDEEF0] hover:text-[#4A4E54]"
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

            <button className="mt-1 px-2 py-[7px] text-[13px] font-medium text-[#C1C5CA] transition-colors hover:text-[#6366F1]">
              + Add person
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
