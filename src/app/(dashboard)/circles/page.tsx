"use client";

import { useState, useMemo, useCallback } from "react";
import { CircleRow } from "@/components/circles/circle-row";
import { CircleDialog } from "@/components/circles/circle-dialog";
import { MiniBar } from "@/components/ui/mini-bar";
import {
  useCircles,
  useCreateCircle,
  useUpdateCircle,
  useDeleteCircle,
} from "@/lib/hooks/use-circles";
import type { CircleWithContacts } from "@/lib/hooks/use-circles";
import { useContacts } from "@/lib/hooks/use-contacts";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AutoCategorizeResult } from "@/app/api/circles/auto-categorize/route";
import { CircleSuggestions } from "@/components/circles/circle-suggestions";

export default function CirclesPage() {
  const { data: circles, isLoading } = useCircles();
  const { data: contactsData } = useContacts();
  const createCircle = useCreateCircle();
  const updateCircle = useUpdateCircle();
  const deleteCircle = useDeleteCircle();

  const queryClient = useQueryClient();
  const [openCircleId, setOpenCircleId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCircle, setEditingCircle] = useState<CircleWithContacts | null>(null);
  const [categorizeResult, setCategorizeResult] = useState<AutoCategorizeResult | null>(null);

  const autoCategorize = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/circles/auto-categorize", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Auto-categorize failed");
      }
      return res.json() as Promise<AutoCategorizeResult>;
    },
    onSuccess: (data) => {
      setCategorizeResult(data);
      queryClient.invalidateQueries({ queryKey: ["circles"] });
      toast.success(
        `Assigned ${data.contactsAssigned} contacts across ${data.tiers.filter((t) => t.contactCount > 0).length} circles`,
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const allContacts = useMemo(
    () => (contactsData ?? []).map((c) => ({ id: c.id, name: c.name })),
    [contactsData],
  );

  const totals = useMemo(() => {
    if (!circles) return { people: 0, good: 0, mid: 0, cold: 0 };
    return circles.reduce(
      (acc, c) => ({
        people: acc.people + c.contacts.length,
        good: acc.good + c.health.good,
        mid: acc.mid + c.health.mid,
        cold: acc.cold + c.health.cold,
      }),
      { people: 0, good: 0, mid: 0, cold: 0 },
    );
  }, [circles]);

  const handleToggle = useCallback((id: string) => {
    setOpenCircleId((prev) => (prev === id ? null : id));
  }, []);

  const handleCreate = useCallback(
    (data: { name: string; color: string; followUpDays: number }) => {
      createCircle.mutate(data, {
        onSuccess: () => {
          setDialogOpen(false);
          toast("Created " + data.name);
        },
        onError: (err) => toast.error(err.message),
      });
    },
    [createCircle],
  );

  const handleEdit = useCallback(
    (data: { name: string; color: string; followUpDays: number }) => {
      if (!editingCircle) return;
      updateCircle.mutate(
        { id: editingCircle.id, ...data },
        {
          onSuccess: () => {
            setEditingCircle(null);
            toast("Updated " + data.name);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    },
    [editingCircle, updateCircle],
  );

  const handleDelete = useCallback(() => {
    if (!editingCircle) return;
    deleteCircle.mutate(editingCircle.id, {
      onSuccess: () => {
        setEditingCircle(null);
        setOpenCircleId(null);
        toast("Deleted circle");
      },
      onError: (err) => toast.error(err.message),
    });
  }, [editingCircle, deleteCircle]);

  if (isLoading) {
    return (
      <div className="pt-14">
        <div className="h-6 w-20 animate-pulse rounded-[6px]" style={{ backgroundColor: "var(--surface-sunken)" }} />
      </div>
    );
  }

  return (
    <div className="pt-14">
      {/* Header */}
      <div className="crm-animate-enter flex items-center justify-between">
        <h1 className="ds-display-lg">Circles</h1>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[12px] rounded-lg"
            onClick={() => autoCategorize.mutate()}
            disabled={autoCategorize.isPending}
          >
            {autoCategorize.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Auto-categorize
          </Button>
          <span className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
            {totals.people} people
          </span>
        </div>
      </div>

      {/* Auto-categorize result */}
      {categorizeResult && categorizeResult.contactsAssigned > 0 && (
        <div
          className="crm-animate-enter mt-3 rounded-[14px] p-3 space-y-1.5"
          style={{ backgroundColor: "var(--status-success-bg)" }}
        >
          <p className="ds-caption font-medium" style={{ color: "var(--status-success)" }}>
            Auto-categorized {categorizeResult.contactsAssigned} contacts
          </p>
          <div className="flex flex-wrap gap-2">
            {categorizeResult.tiers
              .filter((t) => t.contactCount > 0)
              .map((t) => (
                <span
                  key={t.name}
                  className="text-[11px] rounded-full px-2 py-0.5"
                  style={{ color: "var(--status-success)", backgroundColor: "var(--status-success-bg)" }}
                >
                  {t.name}: {t.contactCount}
                </span>
              ))}
          </div>
          {categorizeResult.uncategorized > 0 && (
            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              {categorizeResult.uncategorized} contacts had no recent interactions
            </p>
          )}
          <button
            onClick={() => setCategorizeResult(null)}
            className="text-[11px] hover:underline"
            style={{ color: "var(--status-success)" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Health summary */}
      {(totals.good > 0 || totals.mid > 0 || totals.cold > 0) && (
        <div
          className="crm-animate-enter mt-4 flex items-center gap-3.5"
          style={{ animationDelay: "40ms" }}
        >
          <div className="max-w-[280px] flex-1">
            <MiniBar good={totals.good} mid={totals.mid} cold={totals.cold} />
          </div>
          <div className="flex gap-2 text-[12px] font-medium">
            {totals.good > 0 && (
              <span style={{ color: "var(--warmth-good)" }}>{totals.good}</span>
            )}
            {totals.mid > 0 && (
              <span style={{ color: "var(--warmth-mid)" }}>{totals.mid}</span>
            )}
            {totals.cold > 0 && (
              <span style={{ color: "var(--warmth-cold)" }}>{totals.cold}</span>
            )}
          </div>
        </div>
      )}

      {/* Circle list */}
      <div className="crm-stagger mt-6 flex flex-col gap-1">
        {circles?.map((circle) => (
          <div
            key={circle.id}
            onDoubleClick={() => setEditingCircle(circle)}
          >
            <CircleRow
              circleId={circle.id}
              name={circle.name}
              color={circle.color}
              followUpDays={circle.followUpDays}
              contacts={circle.contacts}
              health={circle.health}
              isOpen={openCircleId === circle.id}
              onToggle={() => handleToggle(circle.id)}
              allContacts={allContacts}
            />
          </div>
        ))}

        {/* New circle row */}
        <button
          className="flex items-center gap-3 rounded-[14px] px-4 py-[13px] transition-colors"
          style={{ transitionDuration: "var(--duration-fast)" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
          onClick={() => setDialogOpen(true)}
        >
          <div
            className="flex items-center justify-center"
            style={{
              width: 36,
              height: 36,
              borderRadius: 36 * 0.3,
              border: "1.5px dashed var(--border-strong)",
              fontSize: 16,
              color: "var(--text-tertiary)",
            }}
          >
            +
          </div>
          <span className="ds-body-md font-medium" style={{ color: "var(--text-tertiary)" }}>
            New circle
          </span>
        </button>
      </div>

      {/* Suggested circles (below existing) */}
      <CircleSuggestions />

      {/* Create dialog */}
      <CircleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleCreate}
        isSubmitting={createCircle.isPending}
      />

      {/* Edit dialog */}
      <CircleDialog
        open={editingCircle !== null}
        onOpenChange={(open) => {
          if (!open) setEditingCircle(null);
        }}
        onSubmit={handleEdit}
        onDelete={handleDelete}
        initialValues={
          editingCircle
            ? {
                name: editingCircle.name,
                color: editingCircle.color,
                followUpDays: editingCircle.followUpDays,
              }
            : undefined
        }
        isSubmitting={updateCircle.isPending}
      />
    </div>
  );
}
