"use client";

import { useState, useEffect, useCallback } from "react";
import { CircleIcon } from "@/components/ui/circle-icon";

const CIRCLE_COLORS = [
  "#2D2D2D",
  "#8B2020",
  "#7A6B2E",
  "#5B4E8A",
  "#8A5A30",
  "#6B7280",
  "#2E6B5A",
  "#4A6B8A",
] as const;

const CADENCE_OPTIONS = [7, 14, 21, 30, 60, 90] as const;

interface CircleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; color: string; followUpDays: number }) => void;
  onDelete?: () => void;
  initialValues?: {
    name: string;
    color: string;
    followUpDays: number;
  };
  isSubmitting?: boolean;
}

export function CircleDialog({
  open,
  onOpenChange,
  onSubmit,
  onDelete,
  initialValues,
  isSubmitting,
}: CircleDialogProps) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [color, setColor] = useState(initialValues?.color ?? CIRCLE_COLORS[0]);
  const [cadence, setCadence] = useState(initialValues?.followUpDays ?? 30);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialValues?.name ?? "");
      setColor(initialValues?.color ?? CIRCLE_COLORS[0]);
      setCadence(initialValues?.followUpDays ?? 30);
      setShowDeleteConfirm(false);
    }
  }, [open, initialValues]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) return;
      onSubmit({ name: name.trim(), color, followUpDays: cadence });
    },
    [name, color, cadence, onSubmit],
  );

  if (!open) return null;

  const letter = name.trim().charAt(0) || "?";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.06)" }}
    >
      <div
        className="crm-animate-enter w-full max-w-[380px] rounded-[14px] bg-white p-6"
        style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
      >
        <form onSubmit={handleSubmit}>
          {/* Name + preview */}
          <div className="flex items-center gap-3">
            <CircleIcon letter={letter} color={color} size={40} />
            <input
              autoFocus
              type="text"
              placeholder="Circle name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded-[10px] border border-[#E8EAED] px-3.5 py-2.5 text-[15px] font-medium text-[#1A1A1A] outline-none placeholder:text-[#C1C5CA] focus:border-[#1A1A1A]"
              style={{ letterSpacing: "-0.01em" }}
            />
          </div>

          {/* Color picker */}
          <div className="mt-5">
            <label className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[#B5BAC0]">
              Color
            </label>
            <div className="flex gap-2">
              {CIRCLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="transition-transform hover:scale-110"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    backgroundColor: c,
                    outline: color === c ? `2px solid ${c}` : "none",
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Cadence */}
          <div className="mt-5">
            <label className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[#B5BAC0]">
              Follow-up cadence
            </label>
            <div
              className="inline-flex rounded-lg bg-[#F5F6F8] p-0.5"
            >
              {CADENCE_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCadence(d)}
                  className="rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors"
                  style={{
                    backgroundColor: cadence === d ? "#1A1A1A" : "transparent",
                    color: cadence === d ? "#FFFFFF" : "#9BA3AE",
                  }}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center justify-between">
            <div>
              {onDelete && !showDeleteConfirm && (
                <button
                  type="button"
                  className="text-[13px] text-[#BF5040] transition-colors hover:text-[#A3392B]"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete circle
                </button>
              )}
              {showDeleteConfirm && (
                <span className="text-[12px] text-[#2A2D32]">
                  Delete?{" "}
                  <button
                    type="button"
                    className="font-medium text-[#BF5040]"
                    onClick={onDelete}
                  >
                    Yes
                  </button>
                  {" / "}
                  <button
                    type="button"
                    className="text-[#9BA3AE]"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    Cancel
                  </button>
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="text-[14px] text-[#9BA3AE] transition-colors hover:text-[#1A1A1A]"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || isSubmitting}
                className="rounded-[10px] bg-[#1A1A1A] px-5 py-2 text-[14px] font-medium text-white transition-colors hover:bg-[#2D2D2D] disabled:opacity-40"
              >
                {initialValues ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
