"use client";

import { cn } from "@/lib/utils";
import { useRelationshipHealth } from "@/lib/hooks/use-insights";

const labelStyles: Record<string, string> = {
  thriving: "bg-green-100 text-green-700",
  stable: "bg-blue-100 text-blue-700",
  fading: "bg-yellow-100 text-yellow-700",
  dormant: "bg-red-100 text-red-700",
};

const labelIcons: Record<string, string> = {
  thriving: "●",
  stable: "●",
  fading: "●",
  dormant: "●",
};

interface HealthBadgeProps {
  contactId: string;
  compact?: boolean;
}

export function HealthBadge({ contactId, compact = false }: HealthBadgeProps) {
  const { data, isLoading } = useRelationshipHealth(contactId);

  if (isLoading) {
    return (
      <span className="inline-flex h-5 w-12 animate-pulse rounded-full bg-gray-100" />
    );
  }

  if (!data) return null;

  if (compact) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
          labelStyles[data.healthLabel]
        )}
        title={`${data.healthScore}/100 — ${data.summary}`}
      >
        {labelIcons[data.healthLabel]} {data.healthScore}
      </span>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        labelStyles[data.healthLabel]
      )}
    >
      <span>{labelIcons[data.healthLabel]}</span>
      <span className="capitalize">{data.healthLabel}</span>
      <span className="opacity-60">({data.healthScore})</span>
    </div>
  );
}

interface HealthScoreBarProps {
  score: number;
  label: string;
}

export function HealthScoreBar({ score, label }: HealthScoreBarProps) {
  const color =
    label === "thriving"
      ? "bg-green-500"
      : label === "stable"
        ? "bg-blue-500"
        : label === "fading"
          ? "bg-yellow-500"
          : "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-gray-100">
        <div
          className={cn("h-2 rounded-full transition-all", color)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-medium text-gray-500">
        {score}
      </span>
    </div>
  );
}
