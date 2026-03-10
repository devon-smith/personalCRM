"use client";

import { useState, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "./kanban-column";
import { KanbanCard } from "./kanban-card";
import { useUpdateJob, type JobWithContacts } from "@/lib/hooks/use-jobs";
import type { JobStatus } from "@/generated/prisma/enums";
import { toast } from "sonner";

const STATUSES = [
  { key: "INTERESTED", label: "Interested", color: "bg-blue-500" },
  { key: "APPLIED", label: "Applied", color: "bg-yellow-500" },
  { key: "SCREEN", label: "Phone Screen", color: "bg-orange-500" },
  { key: "ONSITE", label: "On-Site", color: "bg-purple-500" },
  { key: "OFFER", label: "Offer", color: "bg-green-500" },
  { key: "REJECTED", label: "Rejected", color: "bg-red-500" },
  { key: "CLOSED", label: "Closed", color: "bg-gray-400" },
] as const;

interface KanbanBoardProps {
  jobs: JobWithContacts[];
  onCardClick: (job: JobWithContacts) => void;
}

export function KanbanBoard({ jobs, onCardClick }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const updateJob = useUpdateJob();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const jobsByStatus = useMemo(() => {
    const grouped: Record<string, JobWithContacts[]> = {};
    for (const s of STATUSES) {
      grouped[s.key] = [];
    }
    for (const job of jobs) {
      if (grouped[job.status]) {
        grouped[job.status].push(job);
      }
    }
    return grouped;
  }, [jobs]);

  const activeJob = activeId
    ? jobs.find((j) => j.id === activeId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const jobId = active.id as string;
    const newStatus = over.id as string;

    // Check if dropping on a valid column
    if (!STATUSES.some((s) => s.key === newStatus)) return;

    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.status === newStatus) return;

    updateJob.mutate(
      { id: jobId, status: newStatus as JobStatus },
      {
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STATUSES.map(({ key, label, color }) => (
          <KanbanColumn
            key={key}
            id={key}
            title={label}
            color={color}
            count={jobsByStatus[key]?.length ?? 0}
          >
            {(jobsByStatus[key] ?? []).map((job) => (
              <KanbanCard
                key={job.id}
                job={job}
                onClick={() => onCardClick(job)}
                isDragging={activeId === job.id}
              />
            ))}
          </KanbanColumn>
        ))}
      </div>

      <DragOverlay>
        {activeJob && (
          <KanbanCard job={activeJob} onClick={() => {}} isOverlay />
        )}
      </DragOverlay>
    </DndContext>
  );
}
