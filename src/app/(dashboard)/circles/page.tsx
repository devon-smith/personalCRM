"use client";

import { useState, useMemo, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { CircleDialog } from "@/components/circles/circle-dialog";
import { MiniBar } from "@/components/ui/mini-bar";
import { CircleIcon } from "@/components/ui/circle-icon";
import { WarmthAvatar } from "@/components/ui/warmth-avatar";
import {
  useCircles,
  useCreateCircle,
  useUpdateCircle,
  useDeleteCircle,
  useAddContactsToCircle,
  useRemoveContactsFromCircle,
} from "@/lib/hooks/use-circles";
import type { CircleWithContacts, CircleContact } from "@/lib/hooks/use-circles";
import { useContacts } from "@/lib/hooks/use-contacts";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Sparkles,
  ChevronRight,
  GripVertical,
  MessageCircle,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/avatar";
import type { AutoCategorizeResult } from "@/app/api/circles/auto-categorize/route";
import { CircleSuggestions } from "@/components/circles/circle-suggestions";
import type { CircleIntelligence } from "@/app/api/circles/[id]/intelligence/route";
import { NetworkMap } from "@/components/circles/network-map";

// ─── Draggable contact pill ──────────────────────────────────────────
function DraggableContact({
  contact,
  circleId,
}: {
  readonly contact: CircleContact;
  readonly circleId: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${circleId}::${contact.id}`,
    data: { contact, sourceCircleId: circleId },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="flex items-center gap-2 rounded-[10px] px-2 py-2 transition-colors group"
      style={{
        opacity: isDragging ? 0.3 : 1,
        cursor: "grab",
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "";
      }}
    >
      <GripVertical
        className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-50 transition-opacity"
        style={{ color: "var(--text-tertiary)" }}
      />
      <WarmthAvatar
        initials={getInitials(contact.name)}
        warmth={contact.warmth}
        size={28}
        avatarUrl={contact.avatarUrl}
      />
      <span
        className="flex-1 text-[13px] font-medium truncate"
        style={{
          color:
            contact.warmth === "cold"
              ? "var(--text-tertiary)"
              : "var(--text-primary)",
        }}
      >
        {contact.name}
      </span>
      {contact.company && (
        <span className="ds-caption truncate max-w-[100px]" style={{ color: "var(--text-tertiary)" }}>
          {contact.company}
        </span>
      )}
      <span className="ds-caption shrink-0">
        {contact.daysSince === null
          ? "never"
          : contact.daysSince === 0
            ? "today"
            : `${contact.daysSince}d`}
      </span>
    </div>
  );
}

// ─── Drag overlay ghost ──────────────────────────────────────────────
function DragGhost({ contact }: { readonly contact: CircleContact }) {
  return (
    <div
      className="flex items-center gap-2 rounded-[10px] px-3 py-2 shadow-lg"
      style={{
        backgroundColor: "var(--surface)",
        border: "1px solid var(--accent-color)",
        minWidth: 180,
      }}
    >
      <WarmthAvatar
        initials={getInitials(contact.name)}
        warmth={contact.warmth}
        size={24}
        avatarUrl={contact.avatarUrl}
      />
      <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
        {contact.name}
      </span>
    </div>
  );
}

// ─── Intelligence panel ──────────────────────────────────────────────
function IntelligencePanel({ circleId }: { readonly circleId: string }) {
  const { data, isLoading } = useQuery<CircleIntelligence>({
    queryKey: ["circle-intelligence", circleId],
    queryFn: async () => {
      const res = await fetch(`/api/circles/${circleId}/intelligence`);
      if (!res.ok) throw new Error("Failed to load intelligence");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3" style={{ color: "var(--text-tertiary)" }}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="ds-caption">Generating insights...</span>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-3">
      {/* Narrative */}
      <p className="ds-body-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {data.narrative}
      </p>

      {/* Per-person insights */}
      {data.contactInsights.length > 0 && (
        <div className="space-y-1.5">
          {data.contactInsights.map((ci) => (
            <div
              key={ci.contactId}
              className="rounded-[8px] px-3 py-2"
              style={{ backgroundColor: "var(--background)" }}
            >
              <p className="ds-caption font-medium" style={{ color: "var(--text-secondary)" }}>
                {ci.insight}
              </p>
              <div className="flex items-start gap-1.5 mt-1">
                <MessageCircle
                  className="h-3 w-3 mt-0.5 shrink-0"
                  style={{ color: "var(--accent-color)" }}
                />
                <p className="ds-caption" style={{ color: "var(--accent-color)" }}>
                  {ci.conversationStarter}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Droppable circle card ───────────────────────────────────────────
function CircleCard({
  circle,
  isExpanded,
  onToggle,
  onEdit,
}: {
  readonly circle: CircleWithContacts;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly onEdit: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: circle.id });
  const [showIntel, setShowIntel] = useState(false);

  return (
    <div
      ref={setNodeRef}
      className="overflow-hidden rounded-[14px] transition-all"
      style={{
        backgroundColor: "var(--surface)",
        border: isOver
          ? `2px solid ${circle.color}`
          : isExpanded
            ? `1px solid ${circle.color}22`
            : "1px solid transparent",
        boxShadow: isOver ? `0 0 20px ${circle.color}15` : undefined,
      }}
    >
      {/* Header row */}
      <button
        className="flex w-full items-center gap-3 px-4 py-[13px] text-left transition-colors"
        style={{ transitionDuration: "var(--duration-fast)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "";
        }}
        onClick={onToggle}
      >
        <CircleIcon letter={circle.name.charAt(0)} color={circle.color} size={36} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="ds-heading-sm">{circle.name}</span>
            <span className="ds-caption">{circle.contacts.length}</span>
          </div>
          <div className="mt-[5px] max-w-[160px]">
            <MiniBar good={circle.health.good} mid={circle.health.mid} cold={circle.health.cold} />
          </div>
        </div>

        {/* Avatar stack when collapsed */}
        {!isExpanded && circle.contacts.length > 0 && (
          <div className="hidden items-center sm:flex">
            {circle.contacts.slice(0, 4).map((c, i) => (
              <div key={c.id} style={{ marginLeft: i > 0 ? -6 : 0, zIndex: 4 - i }}>
                <WarmthAvatar
                  initials={getInitials(c.name)}
                  warmth={c.warmth}
                  size={26}
                  avatarUrl={c.avatarUrl}
                />
              </div>
            ))}
            {circle.contacts.length > 4 && (
              <div
                className="flex items-center justify-center text-[10px] font-semibold"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 26 * 0.38,
                  backgroundColor: "var(--surface-sunken)",
                  color: "var(--text-tertiary)",
                  marginLeft: -6,
                }}
              >
                +{circle.contacts.length - 4}
              </div>
            )}
          </div>
        )}

        <span className="ds-caption">{circle.followUpDays}d</span>

        <ChevronRight
          className="h-3.5 w-3.5 transition-transform"
          style={{
            color: "var(--text-tertiary)",
            transitionDuration: "var(--duration-fast)",
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="overflow-hidden">
          <div className="mx-4" style={{ borderTop: "1px solid var(--border-subtle)" }} />

          {/* Toolbar */}
          <div className="flex items-center justify-end gap-1 px-4 pt-2">
            <button
              className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium transition-colors"
              style={{
                color: showIntel ? "var(--accent-color)" : "var(--text-tertiary)",
                backgroundColor: showIntel ? "var(--accent-soft)" : "transparent",
                transitionDuration: "var(--duration-fast)",
              }}
              onMouseEnter={(e) => {
                if (!showIntel) e.currentTarget.style.color = "var(--accent-color)";
              }}
              onMouseLeave={(e) => {
                if (!showIntel) e.currentTarget.style.color = "var(--text-tertiary)";
              }}
              onClick={() => setShowIntel((prev) => !prev)}
            >
              <Sparkles className="h-3 w-3" />
              Insights
            </button>
            <button
              className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium transition-colors"
              style={{ color: "var(--text-tertiary)", transitionDuration: "var(--duration-fast)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-tertiary)";
              }}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <Settings2 className="h-3 w-3" />
              Edit
            </button>
          </div>

          {/* Intelligence panel */}
          {showIntel && (
            <div
              className="mx-4 mt-2 rounded-[10px] p-3"
              style={{ backgroundColor: "var(--accent-soft)" }}
            >
              <IntelligencePanel circleId={circle.id} />
            </div>
          )}

          {/* Contact list */}
          <div className="px-4 pb-3 pt-2">
            {circle.contacts.length === 0 ? (
              <p
                className="py-4 text-center ds-body-sm"
                style={{ color: "var(--text-tertiary)" }}
              >
                Drag contacts here or use the search below
              </p>
            ) : (
              <div className="crm-stagger">
                {circle.contacts.map((contact) => (
                  <DraggableContact
                    key={contact.id}
                    contact={contact}
                    circleId={circle.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────
export default function CirclesPage() {
  const { data: circles, isLoading } = useCircles();
  const { data: contactsData } = useContacts();
  const createCircle = useCreateCircle();
  const updateCircle = useUpdateCircle();
  const deleteCircle = useDeleteCircle();
  const addContacts = useAddContactsToCircle();
  const removeContacts = useRemoveContactsFromCircle();

  const queryClient = useQueryClient();
  const [openCircleId, setOpenCircleId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCircle, setEditingCircle] = useState<CircleWithContacts | null>(null);
  const [categorizeResult, setCategorizeResult] = useState<AutoCategorizeResult | null>(null);
  const [activeContact, setActiveContact] = useState<CircleContact | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

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

  function handleDragStart(event: DragStartEvent) {
    const contact = event.active.data.current?.contact as CircleContact | undefined;
    setActiveContact(contact ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveContact(null);

    const { active, over } = event;
    if (!over) return;

    const sourceCircleId = active.data.current?.sourceCircleId as string;
    const targetCircleId = over.id as string;
    const contactId = (active.data.current?.contact as CircleContact)?.id;

    if (!contactId || sourceCircleId === targetCircleId) return;

    // Move: remove from source, add to target
    removeContacts.mutate(
      { circleId: sourceCircleId, contactIds: [contactId] },
      {
        onSuccess: () => {
          addContacts.mutate(
            { circleId: targetCircleId, contactIds: [contactId] },
            {
              onSuccess: () => {
                toast("Moved to " + (circles?.find((c) => c.id === targetCircleId)?.name ?? "circle"));
              },
              onError: (err) => toast.error(err.message),
            },
          );
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="pt-14">
        <div
          className="h-6 w-20 animate-pulse rounded-[6px]"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        />
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

      {/* Geographic network map */}
      <NetworkMap />

      {/* Drag hint */}
      <p
        className="mt-4 ds-caption"
        style={{ color: "var(--text-tertiary)" }}
      >
        Drag contacts between circles to reorganize
      </p>

      {/* Circle cards with DnD */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="crm-stagger mt-3 flex flex-col gap-1">
          {circles?.map((circle) => (
            <CircleCard
              key={circle.id}
              circle={circle}
              isExpanded={openCircleId === circle.id}
              onToggle={() => handleToggle(circle.id)}
              onEdit={() => setEditingCircle(circle)}
            />
          ))}

          {/* New circle button */}
          <button
            className="flex items-center gap-3 rounded-[14px] px-4 py-[13px] transition-colors"
            style={{ transitionDuration: "var(--duration-fast)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "";
            }}
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

        {/* Drag overlay */}
        <DragOverlay>
          {activeContact ? <DragGhost contact={activeContact} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Suggested circles */}
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
