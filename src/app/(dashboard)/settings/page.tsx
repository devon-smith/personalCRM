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
import { DataHealth } from "@/components/settings/data-health";
import { LinkedInImport } from "@/components/settings/linkedin-import";

export default function SettingsPage() {
  return (
    <div className="space-y-12 pt-14">
      <div className="crm-animate-enter">
        <h1
          className="text-[24px] font-semibold text-[#1A1A1A]"
          style={{ letterSpacing: "-0.04em" }}
        >
          Settings
        </h1>
        <p className="mt-1 text-[13px] text-[#B5BAC0]">
          Manage your circles, integrations, and data.
        </p>
      </div>

      {/* LinkedIn Import */}
      <section className="crm-animate-enter" style={{ animationDelay: "40ms" }}>
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <LinkedInImport />
        </div>
      </section>

      <DataHealth />
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
      <h2
        className="text-[18px] font-semibold text-[#1A1A1A]"
        style={{ letterSpacing: "-0.03em" }}
      >
        Circles
      </h2>
      <p className="mt-1 text-[13px] text-[#B5BAC0]">
        Organize contacts into communities with follow-up cadences.
      </p>

      <div className="mt-5 space-y-1">
        {isLoading ? (
          <div className="py-8 text-center text-[13px] text-[#C1C5CA]">
            Loading...
          </div>
        ) : circles?.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-[#C1C5CA]">
            No circles yet. Create one below.
          </div>
        ) : (
          circles?.map((circle) => (
            <div
              key={circle.id}
              className="flex items-center gap-3 rounded-[12px] px-4 py-3 transition-colors hover:bg-[#F7F7F8]"
            >
              <CircleIcon
                letter={circle.name.charAt(0)}
                color={circle.color}
                size={28}
              />
              <span className="flex-1 text-[14px] font-medium text-[#1A1A1A]">
                {circle.name}
              </span>
              <span className="text-[12px] text-[#C1C5CA]">
                {circle.contacts.length} contact
                {circle.contacts.length !== 1 ? "s" : ""}
              </span>
              <span className="text-[12px] text-[#C1C5CA]">
                {circle.followUpDays}d
              </span>
              <button
                onClick={() => handleDelete(circle.id, circle.name)}
                className="text-[#C8CDD3] transition-colors hover:text-[#BF5040]"
                title="Delete circle"
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
          className="h-7 w-7 cursor-pointer rounded-lg border-0 bg-transparent p-0"
        />
        <input
          placeholder="New circle name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          className="flex-1 rounded-[10px] border border-[#E8EAED] px-3 py-2 text-[14px] text-[#1A1A1A] outline-none placeholder:text-[#C1C5CA] focus:border-[#1A1A1A]"
        />
        <button
          onClick={handleCreate}
          disabled={!newName.trim() || createCircle.isPending}
          className="flex items-center gap-1 rounded-[10px] bg-[#1A1A1A] px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#2D2D2D] disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
    </section>
  );
}
