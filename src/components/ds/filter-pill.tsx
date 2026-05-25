"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Filter pill — a `<select>` underneath, styled as a rounded chip. Keeps
 * native keyboard / mobile picker behavior; the pill chrome is purely
 * visual. Closed state shows label + current selection; opening uses
 * the OS-native menu.
 */
export interface FilterPillOption {
  value: string;
  label: string;
}

export interface FilterPillProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label: string;
  options: FilterPillOption[];
  size?: "sm" | "md";
  /** Visually flag this pill as "active" (something selected beyond default). */
  active?: boolean;
}

export function FilterPill({
  label,
  options,
  value,
  onChange,
  size = "md",
  active = false,
  className,
  ...rest
}: FilterPillProps) {
  const current = options.find((o) => o.value === value);
  const display = current && current.value !== "" ? current.label : label;
  const sizeClass = size === "sm" ? "px-3 py-1 text-[12px]" : "px-4 py-1.5 text-[13px]";

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <span
        className={cn(
          "pointer-events-none inline-flex items-center gap-1.5 rounded-full transition-colors font-medium",
          sizeClass,
        )}
        style={{
          backgroundColor: active ? "var(--accent-color)" : "var(--accent-soft)",
          color: active ? "var(--text-inverse)" : "var(--text-primary)",
          border: "1px solid transparent",
        }}
      >
        <span className="truncate">{display}</span>
        <ChevronDown
          className="h-3 w-3 opacity-70"
          strokeWidth={2}
        />
      </span>
      <select
        value={value}
        onChange={onChange}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={label}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
