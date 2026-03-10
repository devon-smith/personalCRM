"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

interface KanbanColumnProps {
  id: string;
  title: string;
  color: string;
  count: number;
  children: React.ReactNode;
}

export function KanbanColumn({
  id,
  title,
  color,
  count,
  children,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[280px] shrink-0 flex-col rounded-lg border border-gray-200 bg-gray-50 transition-colors",
        isOver && "border-blue-400 bg-blue-50/50"
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-3">
        <div className={cn("h-2.5 w-2.5 rounded-full", color)} />
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-200 px-1.5 text-[11px] font-medium text-gray-600">
          {count}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2 px-2 pb-2" style={{ minHeight: 80 }}>
        {children}
      </div>
    </div>
  );
}
