"use client";

import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { Cake } from "lucide-react";
import Link from "next/link";

interface UpcomingBirthday {
  readonly id: string;
  readonly name: string;
  readonly company: string | null;
  readonly daysUntil: number;
  readonly isToday: boolean;
}

export function UpcomingBirthdays() {
  const { data } = useQuery<{ birthdays: UpcomingBirthday[] }>({
    queryKey: ["birthdays"],
    queryFn: async () => {
      const res = await fetch("/api/birthdays?days=14");
      if (!res.ok) return { birthdays: [] };
      return res.json();
    },
  });

  if (!data?.birthdays.length) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Cake className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
        <h3 className="crm-section-label">Birthdays</h3>
      </div>
      <div className="space-y-1">
        {data.birthdays.map((bday) => {
          const color = getAvatarColor(bday.name);
          return (
            <Link
              key={bday.id}
              href={`/people?contact=${bday.id}`}
              className="group flex items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors"
              style={{
                backgroundColor: bday.isToday ? "var(--status-warning-bg)" : undefined,
                transitionDuration: "var(--duration-fast)",
              }}
              onMouseEnter={(e) => { if (!bday.isToday) e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
              onMouseLeave={(e) => { if (!bday.isToday) e.currentTarget.style.backgroundColor = ""; }}
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback
                  className="text-[10px] font-semibold"
                  style={{ backgroundColor: color.bg, color: color.text }}
                >
                  {getInitials(bday.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="ds-body-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{bday.name}</p>
                {bday.company && (
                  <p className="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>{bday.company}</p>
                )}
              </div>
              <span
                className="text-[12px] font-medium"
                style={{ color: bday.isToday ? "var(--status-warning)" : "var(--text-tertiary)" }}
              >
                {bday.isToday ? "Today!" : `in ${bday.daysUntil}d`}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
