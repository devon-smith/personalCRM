"use client";

import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { CalendarPlus, Clock } from "lucide-react";

interface SchedulingSuggestion {
  readonly contactId: string;
  readonly contactName: string;
  readonly company: string | null;
  readonly daysOverdue: number;
  readonly suggestedSlot: {
    readonly start: string;
    readonly end: string;
    readonly durationMinutes: number;
  };
  readonly googleCalendarLink: string;
}

export function SmartScheduling() {
  const { data } = useQuery<{ suggestions: SchedulingSuggestion[] }>({
    queryKey: ["scheduling-suggestions"],
    queryFn: async () => {
      const res = await fetch("/api/scheduling");
      if (!res.ok) return { suggestions: [] };
      return res.json();
    },
    staleTime: 10 * 60 * 1000, // 10 min cache
  });

  if (!data?.suggestions.length) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <CalendarPlus className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
        <h3 className="crm-section-label">Smart Scheduling</h3>
      </div>
      <div className="space-y-1">
        {data.suggestions.map((s) => {
          const color = getAvatarColor(s.contactName);
          const slotDate = new Date(s.suggestedSlot.start);
          const dayName = slotDate.toLocaleDateString("en-US", { weekday: "short" });
          const time = slotDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
          const endTime = new Date(s.suggestedSlot.end).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });

          return (
            <div
              key={s.contactId}
              className="group flex items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors"
              style={{ transitionDuration: "var(--duration-fast)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback
                  className="text-[10px] font-semibold"
                  style={{ backgroundColor: color.bg, color: color.text }}
                >
                  {getInitials(s.contactName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="ds-body-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                  {s.contactName}
                </p>
                <div className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  <Clock className="h-3 w-3" />
                  <span>
                    {dayName} {time}–{endTime}
                  </span>
                  <span style={{ color: "var(--border-strong)" }}>·</span>
                  <span style={{ color: "var(--status-warning)" }}>{s.daysOverdue}d overdue</span>
                </div>
              </div>
              <a
                href={s.googleCalendarLink}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-[8px] px-2.5 py-1 text-[11px] font-medium transition-all opacity-0 group-hover:opacity-100"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                  transitionDuration: "var(--duration-fast)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
                  e.currentTarget.style.borderColor = "var(--border-strong)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <CalendarPlus className="inline-block h-3 w-3 mr-1" />
                Book
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
