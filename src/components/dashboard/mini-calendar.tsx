"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Mini month calendar — pill-rounded, no event dots (yet), today
 * highlighted with an accent pill. Used in the dashboard right rail
 * as the visual anchor above the day timeline.
 *
 * Stateful only for the displayed month; clicking a day doesn't
 * select / filter anything yet — the calendar is "context, not
 * action" for this first cut.
 */

interface MiniCalendarProps {
  /** Optional set of YYYY-MM-DD date strings that have something on
   *  them — used to dot the day cell when we have that signal. */
  highlightedDates?: ReadonlySet<string>;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function MiniCalendar({ highlightedDates }: MiniCalendarProps) {
  const today = React.useMemo(() => new Date(), []);
  const [viewMonth, setViewMonth] = React.useState(() => startOfMonth(today));
  const todayIso = isoDate(today);

  const grid = React.useMemo(() => buildGrid(viewMonth), [viewMonth]);
  const monthLabel = viewMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  function shift(delta: number) {
    setViewMonth((m) => {
      const next = new Date(m);
      next.setMonth(m.getMonth() + delta);
      return next;
    });
  }

  return (
    <div className="select-none">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => shift(-1)}
          className="h-6 w-6 rounded-full inline-flex items-center justify-center transition-colors"
          style={{ color: "#5A574F" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#EFEAE0";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.6} />
        </button>
        <div
          className="text-[13px] font-semibold tracking-tight"
          style={{ color: "#1B1A17" }}
        >
          {monthLabel}
        </div>
        <button
          onClick={() => shift(1)}
          className="h-6 w-6 rounded-full inline-flex items-center justify-center transition-colors"
          style={{ color: "#5A574F" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#EFEAE0";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
          aria-label="Next month"
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.6} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            className="text-[10px] font-medium text-center"
            style={{ color: "#8C8A82" }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {grid.map((cell, i) => {
          if (!cell) {
            return <div key={`empty-${i}`} className="aspect-square" />;
          }
          const cellIso = isoDate(cell);
          const isToday = cellIso === todayIso;
          const isMarked = highlightedDates?.has(cellIso) ?? false;
          return (
            <div
              key={cellIso}
              className="aspect-square flex items-center justify-center"
            >
              <div
                className="h-6 w-6 rounded-full inline-flex items-center justify-center text-[11px] font-medium tabular-nums relative"
                style={{
                  backgroundColor: isToday ? "#1B1A17" : "transparent",
                  color: isToday ? "#FAF8F5" : "#1B1A17",
                }}
              >
                {cell.getDate()}
                {isMarked && !isToday ? (
                  <span
                    aria-hidden
                    className="absolute bottom-0.5 h-1 w-1 rounded-full"
                    style={{ backgroundColor: "#7A4F3C" }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Build a 42-cell grid (6 weeks × 7 days) with leading/trailing
 *  empty slots for partial weeks. Returns null for padding cells. */
function buildGrid(monthStart: Date): (Date | null)[] {
  const firstWeekday = monthStart.getDay(); // 0=Sun
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const lastDay = monthEnd.getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= lastDay; day++) {
    cells.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), day));
  }
  while (cells.length < 42) cells.push(null);
  return cells.slice(0, 42);
}
