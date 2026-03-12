"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CIRCLE_TEMPLATES } from "@/lib/circles/templates";
import {
  Heart,
  GraduationCap,
  Briefcase,
  Network,
  Palette,
  MapPin,
  Users,
  Globe,
  Check,
  Plus,
} from "lucide-react";

const ICON_MAP: Record<string, React.ElementType> = {
  heart: Heart,
  "graduation-cap": GraduationCap,
  briefcase: Briefcase,
  network: Network,
  palette: Palette,
  "map-pin": MapPin,
  users: Users,
  globe: Globe,
};

interface SelectedCircle {
  name: string;
  color: string;
  icon: string;
  followUpDays: number;
}

export default function OnboardingCircles() {
  const router = useRouter();
  const [selected, setSelected] = useState<SelectedCircle[]>([]);
  const [customName, setCustomName] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  function toggleCircle(template: (typeof CIRCLE_TEMPLATES)[number]) {
    setSelected((prev) => {
      const exists = prev.some((s) => s.name === template.name);
      if (exists) {
        return prev.filter((s) => s.name !== template.name);
      }
      return [
        ...prev,
        {
          name: template.name,
          color: template.color,
          icon: template.icon,
          followUpDays: template.followUpDays,
        },
      ];
    });
  }

  function addCustomCircle() {
    const trimmed = customName.trim();
    if (!trimmed || selected.some((s) => s.name === trimmed)) return;
    setSelected((prev) => [
      ...prev,
      { name: trimmed, color: "#6B7280", icon: "users", followUpDays: 30 },
    ]);
    setCustomName("");
    setShowCustom(false);
  }

  function handleContinue() {
    // Store in sessionStorage for the complete step
    sessionStorage.setItem("onboarding-circles", JSON.stringify(selected));
    router.push("/onboarding/import");
  }

  return (
    <div>
      <h1 className="text-[32px] font-bold tracking-tight text-gray-900">
        What communities matter to you?
      </h1>
      <p className="mt-2 text-[16px] text-gray-500">
        Select the groups that represent the different pockets of people in your
        life. You can always add more later.
      </p>

      {/* Circle template grid */}
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CIRCLE_TEMPLATES.map((template) => {
          const isSelected = selected.some((s) => s.name === template.name);
          const IconComponent = ICON_MAP[template.icon] ?? Users;

          return (
            <button
              key={template.name}
              onClick={() => toggleCircle(template)}
              className={`group relative flex items-start gap-3 rounded-2xl border p-4 text-left transition-all duration-150 ${
                isSelected
                  ? "border-gray-900 bg-gray-50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              {/* Selected check */}
              {isSelected && (
                <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900">
                  <Check className="h-3 w-3 text-white" />
                </div>
              )}

              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${template.color}15`, color: template.color }}
              >
                <IconComponent className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-gray-900">
                  {template.name}
                </p>
                <p className="mt-0.5 text-[12px] text-gray-400">
                  {template.description}
                </p>
              </div>
            </button>
          );
        })}

        {/* Custom circle */}
        {showCustom ? (
          <div className="flex items-center gap-2 rounded-2xl border border-dashed border-gray-300 p-4">
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Circle name..."
              className="flex-1 bg-transparent text-[14px] text-gray-900 placeholder:text-gray-400 outline-none"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && addCustomCircle()}
            />
            <button
              onClick={addCustomCircle}
              className="rounded-full bg-gray-900 px-3 py-1 text-[12px] font-semibold text-white hover:bg-gray-800 transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => setShowCustom(false)}
              className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowCustom(true)}
            className="flex items-center gap-3 rounded-2xl border border-dashed border-gray-300 p-4 text-left text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[14px] font-semibold">Add your own</p>
              <p className="text-[12px]">Create a custom circle</p>
            </div>
          </button>
        )}
      </div>

      {/* Custom circles added */}
      {selected.filter((s) => !CIRCLE_TEMPLATES.some((t) => t.name === s.name)).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {selected
            .filter((s) => !CIRCLE_TEMPLATES.some((t) => t.name === s.name))
            .map((c) => (
              <span
                key={c.name}
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-[12px] font-medium text-gray-700"
              >
                {c.name}
                <button
                  onClick={() =>
                    setSelected((prev) => prev.filter((s) => s.name !== c.name))
                  }
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </span>
            ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-10 flex items-center justify-between">
        <button
          onClick={() => router.push("/onboarding")}
          className="text-[14px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-gray-400">
            {selected.length} selected
          </span>
          <button
            onClick={handleContinue}
            disabled={selected.length === 0}
            className="inline-flex h-11 items-center justify-center rounded-full bg-gray-900 px-7 text-[14px] font-semibold text-white hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
