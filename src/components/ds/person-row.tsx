"use client";

import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * The universal "person in a list" primitive — used in inbox,
 * people list, recent interactions, meeting attendees. Avatar
 * + name + meta on the left, free `trailing` slot on the right.
 *
 * Hover lifts the row a touch and applies a sand-tinted background
 * so a list of rows reads as a sequence of small cards.
 */
export interface PersonRowProps {
  name: string;
  meta?: React.ReactNode;
  /** Optional second line. Use for snippets / subjects / preview text. */
  detail?: React.ReactNode;
  trailing?: React.ReactNode;
  avatarUrl?: string | null;
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<PersonRowProps["size"]>, { row: string; avatar: string; initials: string; name: string }> = {
  sm: { row: "py-2 gap-2.5", avatar: "h-8 w-8",   initials: "text-[10px]", name: "text-[13px]" },
  md: { row: "py-2.5 gap-3", avatar: "h-9 w-9",   initials: "text-[11px]", name: "text-[14px]" },
  lg: { row: "py-3 gap-3",   avatar: "h-10 w-10", initials: "text-[12px]", name: "text-[15px]" },
};

export function PersonRow({
  name,
  meta,
  detail,
  trailing,
  avatarUrl,
  href,
  onClick,
  size = "md",
  className,
}: PersonRowProps) {
  const sz = SIZE_CLASS[size];
  const color = getAvatarColor(name);
  const initials = getInitials(name);

  const Tag: React.ElementType = href ? "a" : onClick ? "button" : "div";

  return (
    <Tag
      href={href}
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center rounded-2xl px-3 transition-colors text-left",
        sz.row,
        (href || onClick) && "cursor-pointer hover:bg-[var(--surface-sand-raised)]",
        className,
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      <Avatar className={cn("shrink-0", sz.avatar)}>
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
        <AvatarFallback
          className={cn("font-semibold", sz.initials)}
          style={{ backgroundColor: color.bg, color: color.text }}
        >
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate font-medium", sz.name)} style={{ color: "var(--text-primary)" }}>
          {name}
        </div>
        {meta ? (
          <div className="ds-body-sm truncate" style={{ color: "var(--text-secondary)" }}>
            {meta}
          </div>
        ) : null}
        {detail ? (
          <div className="ds-body-sm truncate mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            {detail}
          </div>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0 ml-2 flex items-center gap-2">{trailing}</div> : null}
    </Tag>
  );
}
