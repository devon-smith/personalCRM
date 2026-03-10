"use client";

import { useState, useEffect, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCreateJob, useUpdateJob, type JobWithContacts } from "@/lib/hooks/use-jobs";
import type { JobStatus } from "@/generated/prisma/enums";
import { toast } from "sonner";

const statuses = [
  { value: "INTERESTED", label: "Interested" },
  { value: "APPLIED", label: "Applied" },
  { value: "SCREEN", label: "Phone Screen" },
  { value: "ONSITE", label: "On-Site" },
  { value: "OFFER", label: "Offer" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CLOSED", label: "Closed" },
];

interface JobFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editJob?: JobWithContacts | null;
}

export function JobFormDialog({ open, onOpenChange, editJob }: JobFormDialogProps) {
  const isEditing = !!editJob;
  const createJob = useCreateJob();
  const updateJob = useUpdateJob();

  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<JobStatus>("INTERESTED");
  const [salaryRange, setSalaryRange] = useState("");
  const [deadline, setDeadline] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (editJob && isEditing) {
      setCompany(editJob.company);
      setRoleTitle(editJob.roleTitle);
      setUrl(editJob.url ?? "");
      setStatus(editJob.status);
      setSalaryRange(editJob.salaryRange ?? "");
      setDeadline(editJob.deadline ? new Date(editJob.deadline).toISOString().split("T")[0] : "");
      setNotes(editJob.notes ?? "");
    }
  }, [editJob, isEditing]);

  useEffect(() => {
    if (!open) {
      setCompany("");
      setRoleTitle("");
      setUrl("");
      setStatus("INTERESTED");
      setSalaryRange("");
      setDeadline("");
      setNotes("");
    }
  }, [open]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!company.trim() || !roleTitle.trim()) {
      toast.error("Company and role are required");
      return;
    }

    const data = {
      company,
      roleTitle,
      url: url || null,
      status,
      salaryRange: salaryRange || null,
      deadline: deadline || null,
      notes: notes || null,
    };

    if (isEditing && editJob) {
      updateJob.mutate(
        { id: editJob.id, ...data },
        {
          onSuccess: () => { toast.success("Application updated"); onOpenChange(false); },
          onError: (err) => toast.error(err.message),
        }
      );
    } else {
      createJob.mutate(data, {
        onSuccess: () => { toast.success("Application added"); onOpenChange(false); },
        onError: (err) => toast.error(err.message),
      });
    }
  }

  const isPending = createJob.isPending || updateJob.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Application" : "Add Application"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Company *</label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Inc" required />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Role Title *</label>
              <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Senior Engineer" required />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Job URL</label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as JobStatus)}
                className="h-8 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
              >
                {statuses.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Salary Range</label>
              <Input value={salaryRange} onChange={(e) => setSalaryRange(e.target.value)} placeholder="$150k - $200k" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Deadline</label>
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Application notes..."
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : isEditing ? "Save Changes" : "Add Application"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
