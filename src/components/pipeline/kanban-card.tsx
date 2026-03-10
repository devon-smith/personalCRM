"use client";

import { useDraggable } from "@dnd-kit/core";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { JobWithContacts } from "@/lib/hooks/use-jobs";

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function daysUntil(date: string | Date): number {
  const d = new Date(date);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

interface KanbanCardProps {
  job: JobWithContacts;
  onClick: () => void;
  isDragging?: boolean;
  isOverlay?: boolean;
}

export function KanbanCard({
  job,
  onClick,
  isDragging = false,
  isOverlay = false,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: job.id,
  });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const deadlineDays = job.deadline ? daysUntil(job.deadline) : null;
  const isUrgent = deadlineDays !== null && deadlineDays <= 3 && deadlineDays >= 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "cursor-grab rounded-lg border border-gray-200 bg-white p-3 transition-shadow active:cursor-grabbing",
        isDragging && "opacity-30",
        isOverlay && "rotate-2 shadow-xl",
        !isDragging && !isOverlay && "hover:shadow-md"
      )}
    >
      <p className="text-sm font-semibold text-gray-900">{job.company}</p>
      <p className="text-xs text-gray-500">{job.roleTitle}</p>

      <div className="mt-2 flex items-center justify-between">
        {/* Deadline */}
        {deadlineDays !== null && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              isUrgent
                ? "bg-red-100 text-red-700"
                : deadlineDays < 0
                  ? "bg-gray-100 text-gray-500 line-through"
                  : "bg-gray-100 text-gray-600"
            )}
          >
            {deadlineDays < 0
              ? "Past due"
              : deadlineDays === 0
                ? "Today"
                : `${deadlineDays}d left`}
          </span>
        )}

        {/* Contact avatars */}
        {job.contacts.length > 0 && (
          <div className="flex -space-x-1.5">
            {job.contacts.slice(0, 3).map((c) => (
              <Avatar key={c.id} className="h-5 w-5 border border-white">
                <AvatarFallback className="bg-blue-100 text-[8px] text-blue-700">
                  {getInitials(c.name)}
                </AvatarFallback>
              </Avatar>
            ))}
            {job.contacts.length > 3 && (
              <span className="flex h-5 items-center rounded-full bg-gray-100 px-1 text-[8px] text-gray-600">
                +{job.contacts.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
