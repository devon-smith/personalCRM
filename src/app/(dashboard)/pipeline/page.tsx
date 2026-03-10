"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KanbanBoard } from "@/components/pipeline/kanban-board";
import { JobFormDialog } from "@/components/pipeline/job-form-dialog";
import { JobDetailModal } from "@/components/pipeline/job-detail-modal";
import { useJobs, type JobWithContacts } from "@/lib/hooks/use-jobs";

export default function PipelinePage() {
  const { data: jobs, isLoading } = useJobs();
  const [formOpen, setFormOpen] = useState(false);
  const [editJob, setEditJob] = useState<JobWithContacts | null>(null);
  const [detailJob, setDetailJob] = useState<JobWithContacts | null>(null);

  function handleCardClick(job: JobWithContacts) {
    setDetailJob(job);
  }

  function handleEditFromDetail() {
    if (detailJob) {
      setEditJob(detailJob);
      setDetailJob(null);
      setFormOpen(true);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
        <Button onClick={() => { setEditJob(null); setFormOpen(true); }}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add Application
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-muted-foreground">Loading pipeline...</p>
        </div>
      ) : (
        <KanbanBoard
          jobs={jobs ?? []}
          onCardClick={handleCardClick}
        />
      )}

      <JobFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editJob={editJob}
      />

      {detailJob && (
        <JobDetailModal
          open={!!detailJob}
          onOpenChange={(open) => !open && setDetailJob(null)}
          job={detailJob}
          onEdit={handleEditFromDetail}
        />
      )}
    </div>
  );
}
