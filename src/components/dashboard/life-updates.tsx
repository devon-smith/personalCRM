"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { ArrowRightLeft, Briefcase, Check, X, Mail } from "lucide-react";
import Link from "next/link";

interface ChangelogEntry {
  readonly id: string;
  readonly contactId: string;
  readonly contactName: string;
  readonly company: string | null;
  readonly type: string;
  readonly field: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly status: string;
  readonly detectedAt: string;
}

export function LifeUpdates() {
  const queryClient = useQueryClient();

  const { data } = useQuery<{ entries: ChangelogEntry[] }>({
    queryKey: ["changelog"],
    queryFn: async () => {
      const res = await fetch("/api/changelog");
      if (!res.ok) return { entries: [] };
      return res.json();
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/changelog/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["changelog"] });
    },
  });

  if (!data?.entries.length) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <ArrowRightLeft className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
        <h3 className="crm-section-label">Life Updates</h3>
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ backgroundColor: "var(--status-info-bg)", color: "var(--status-info)" }}
        >
          {data.entries.length}
        </span>
      </div>
      <div className="space-y-1">
        {data.entries.map((entry) => {
          const color = getAvatarColor(entry.contactName);
          const isJobChange = entry.type === "JOB_CHANGE" || entry.type === "COMPANY_CHANGE";

          return (
            <div
              key={entry.id}
              className="group rounded-[10px] px-3 py-2.5 transition-colors"
              style={{ transitionDuration: "var(--duration-fast)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
            >
              <div className="flex items-start gap-3">
                <Link href={`/people?contact=${entry.contactId}`}>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback
                      className="text-[10px] font-semibold"
                      style={{ backgroundColor: color.bg, color: color.text }}
                    >
                      {getInitials(entry.contactName)}
                    </AvatarFallback>
                  </Avatar>
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="ds-body-sm" style={{ color: "var(--text-primary)" }}>
                    <span className="font-medium">{entry.contactName}</span>
                    {isJobChange ? (
                      <span style={{ color: "var(--text-secondary)" }}>
                        {" moved from "}
                        <span style={{ color: "var(--text-primary)" }}>{entry.oldValue}</span>
                        {" to "}
                        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{entry.newValue}</span>
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-secondary)" }}>
                        {" changed "}
                        {entry.field}
                        {entry.newValue && (
                          <>
                            {" to "}
                            <span className="font-medium" style={{ color: "var(--text-primary)" }}>{entry.newValue}</span>
                          </>
                        )}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <button
                      onClick={() => updateStatus.mutate({ id: entry.id, status: "ACTED" })}
                      className="inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition-colors"
                      style={{
                        border: "1px solid var(--border)",
                        color: "var(--text-secondary)",
                        transitionDuration: "var(--duration-fast)",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
                    >
                      <Mail className="h-3 w-3" />
                      Congratulate
                    </button>
                    <button
                      onClick={() => updateStatus.mutate({ id: entry.id, status: "DISMISSED" })}
                      className="inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[11px] transition-colors"
                      style={{ color: "var(--text-tertiary)", transitionDuration: "var(--duration-fast)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
                    >
                      <X className="h-3 w-3" />
                      Dismiss
                    </button>
                  </div>
                </div>
                <Briefcase className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--border-strong)" }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
