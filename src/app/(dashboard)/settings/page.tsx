"use client";

import { useState } from "react";
import {
  useCircles,
  useCreateCircle,
  useDeleteCircle,
} from "@/lib/hooks/use-circles";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { CircleIcon } from "@/components/ui/circle-icon";
import Link from "next/link";
import { Plug } from "lucide-react";
import { NotionSync } from "@/components/settings/notion-sync";
import { NicknameMatches } from "@/components/settings/nickname-matches";

export default function SettingsPage() {
  return (
    <div className="space-y-12 pt-14">
      <div className="crm-animate-enter">
        <h1 className="ds-display-lg">Settings</h1>
        <p className="ds-body-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
          Manage your circles and data.
        </p>
      </div>

      {/* Link to Integrations */}
      <Link
        href="/integrations"
        className="crm-animate-enter crm-card flex items-center gap-3 p-5 transition-colors"
        style={{ animationDelay: "20ms" }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--surface)"; }}
      >
        <div
          className="flex h-10 w-10 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        >
          <Plug className="h-5 w-5" style={{ color: "var(--text-secondary)" }} />
        </div>
        <div className="flex-1">
          <p className="ds-heading-sm">Integrations</p>
          <p className="ds-caption mt-0.5">Manage connected sources, sync data, and view data health</p>
        </div>
        <span className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>→</span>
      </Link>

      {/* Notion Message Sync */}
      <section className="crm-animate-enter" style={{ animationDelay: "60ms" }}>
        <NotionSync />
      </section>

      {/* Nickname / Duplicate Detection */}
      <section className="crm-animate-enter" style={{ animationDelay: "80ms" }}>
        <NicknameMatches />
      </section>

      <CirclesSection />
    </div>
  );
}

function CirclesSection() {
  const { data: circles, isLoading } = useCircles();
  const createCircle = useCreateCircle();
  const deleteCircle = useDeleteCircle();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6B7280");

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    createCircle.mutate(
      { name, color: newColor },
      {
        onSuccess: () => {
          setNewName("");
          toast("Created " + name);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    deleteCircle.mutate(id, {
      onSuccess: () => toast("Deleted " + name),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <section className="crm-animate-enter" style={{ animationDelay: "80ms" }}>
      <h2 className="ds-heading-lg">Circles</h2>
      <p className="ds-body-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
        Organize contacts into communities with follow-up cadences.
      </p>

      <div className="mt-5 space-y-1">
        {isLoading ? (
          <div className="py-8 text-center ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
            Loading...
          </div>
        ) : circles?.length === 0 ? (
          <div className="py-8 text-center ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
            No circles yet. Create one below.
          </div>
        ) : (
          circles?.map((circle) => (
            <div
              key={circle.id}
              className="flex items-center gap-3 rounded-[10px] px-4 py-3 transition-colors"
              style={{ transitionDuration: "var(--duration-fast)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
            >
              <CircleIcon
                letter={circle.name.charAt(0)}
                color={circle.color}
                size={28}
              />
              <span className="flex-1 ds-body-md font-medium" style={{ color: "var(--text-primary)" }}>
                {circle.name}
              </span>
              <span className="ds-caption">
                {circle.contacts.length} contact
                {circle.contacts.length !== 1 ? "s" : ""}
              </span>
              <span className="ds-caption">
                {circle.followUpDays}d
              </span>
              <button
                onClick={() => handleDelete(circle.id, circle.name)}
                className="transition-colors"
                style={{ color: "var(--text-tertiary)", transitionDuration: "var(--duration-fast)" }}
                title="Delete circle"
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--status-urgent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add new circle */}
      <div className="mt-4 flex items-center gap-2">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="h-7 w-7 cursor-pointer rounded-[6px] border-0 bg-transparent p-0"
        />
        <input
          placeholder="New circle name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          className="flex-1 rounded-[10px] px-3 py-2 ds-body-md outline-none transition-colors"
          style={{
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
        <button
          onClick={handleCreate}
          disabled={!newName.trim() || createCircle.isPending}
          className="flex items-center gap-1 rounded-[10px] px-3.5 py-2 ds-body-sm font-medium transition-colors disabled:opacity-40"
          style={{
            backgroundColor: "var(--accent-color)",
            color: "var(--text-inverse)",
            transitionDuration: "var(--duration-fast)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--accent-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--accent-color)"; }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
    </section>
  );
}
