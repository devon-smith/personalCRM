"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ExternalLink, Trash2 } from "lucide-react";
import { useDeleteJob, type JobWithContacts } from "@/lib/hooks/use-jobs";
import { formatDate } from "@/lib/date-utils";
import { toast } from "sonner";

const statusColors: Record<string, string> = {
  INTERESTED: "bg-blue-100 text-blue-700",
  APPLIED: "bg-yellow-100 text-yellow-700",
  SCREEN: "bg-orange-100 text-orange-700",
  ONSITE: "bg-purple-100 text-purple-700",
  OFFER: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  CLOSED: "bg-gray-100 text-gray-700",
};

const statusLabels: Record<string, string> = {
  INTERESTED: "Interested",
  APPLIED: "Applied",
  SCREEN: "Phone Screen",
  ONSITE: "On-Site",
  OFFER: "Offer",
  REJECTED: "Rejected",
  CLOSED: "Closed",
};

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

interface JobDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobWithContacts;
  onEdit: () => void;
}

export function JobDetailModal({
  open,
  onOpenChange,
  job,
  onEdit,
}: JobDetailModalProps) {
  const deleteJob = useDeleteJob();

  function handleDelete() {
    if (!confirm("Delete this application?")) return;
    deleteJob.mutate(job.id, {
      onSuccess: () => {
        toast.success("Application deleted");
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{job.company}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <p className="text-sm text-gray-600">{job.roleTitle}</p>
            <Badge variant="secondary" className={statusColors[job.status]}>
              {statusLabels[job.status]}
            </Badge>
          </div>

          {job.salaryRange && (
            <div>
              <p className="text-xs font-medium text-gray-500">Salary Range</p>
              <p className="text-sm text-gray-900">{job.salaryRange}</p>
            </div>
          )}

          {job.deadline && (
            <div>
              <p className="text-xs font-medium text-gray-500">Deadline</p>
              <p className="text-sm text-gray-900">{formatDate(new Date(job.deadline))}</p>
            </div>
          )}

          {job.notes && (
            <div>
              <p className="text-xs font-medium text-gray-500">Notes</p>
              <p className="whitespace-pre-wrap text-sm text-gray-700">{job.notes}</p>
            </div>
          )}

          {job.contacts.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Linked Contacts</p>
              <div className="space-y-2">
                {job.contacts.map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="bg-blue-100 text-[9px] text-blue-700">
                        {getInitials(c.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-gray-700">{c.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
            {job.url && (
              <a href={job.url} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <ExternalLink className="mr-1.5 h-3 w-3" />
                  Open Posting
                </Button>
              </a>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700"
              onClick={handleDelete}
            >
              <Trash2 className="mr-1.5 h-3 w-3" />
              Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
