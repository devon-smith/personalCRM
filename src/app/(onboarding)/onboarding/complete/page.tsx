"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

interface SelectedCircle {
  name: string;
  color: string;
  icon: string;
  followUpDays: number;
}

export default function OnboardingComplete() {
  const router = useRouter();
  const [circles, setCircles] = useState<SelectedCircle[]>([]);
  const [importSource, setImportSource] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("onboarding-circles");
    if (stored) {
      setCircles(JSON.parse(stored) as SelectedCircle[]);
    }
    setImportSource(sessionStorage.getItem("onboarding-import-source"));
  }, []);

  async function handleComplete() {
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ circles }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? "Failed to complete onboarding");
      }

      // Clean up sessionStorage
      sessionStorage.removeItem("onboarding-circles");
      sessionStorage.removeItem("onboarding-import-source");

      setSaved(true);

      // Brief pause to show success, then redirect
      setTimeout(() => {
        if (importSource === "gmail") {
          router.push("/settings?tab=gmail");
        } else if (importSource === "csv") {
          router.push("/contacts?import=true");
        } else {
          router.push("/dashboard");
        }
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <div className="text-center">
      {saved ? (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-900">
            <Check className="h-8 w-8 text-white" />
          </div>
          <h1 className="mt-6 text-[32px] font-bold tracking-tight text-gray-900">
            You&apos;re all set.
          </h1>
          <p className="mt-2 text-[16px] text-gray-400">
            Taking you to your dashboard...
          </p>
        </>
      ) : (
        <>
          <h1 className="text-[32px] font-bold tracking-tight text-gray-900">
            Looking good.
          </h1>
          <p className="mt-2 text-[16px] text-gray-500">
            Here&apos;s what we&apos;ll set up for you.
          </p>

          {/* Summary */}
          <div className="mt-10 mx-auto max-w-md space-y-4 text-left">
            {/* Circles summary */}
            <div className="rounded-2xl bg-gray-50 p-5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-3">
                Your circles
              </p>
              {circles.length === 0 ? (
                <p className="text-[13px] text-gray-400 italic">
                  No circles selected — we&apos;ll create defaults for you
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {circles.map((c) => (
                    <span
                      key={c.name}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white"
                      style={{ backgroundColor: c.color }}
                    >
                      {c.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Import summary */}
            {importSource && (
              <div className="rounded-2xl bg-gray-50 p-5">
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-2">
                  Contact import
                </p>
                <p className="text-[14px] text-gray-700">
                  {importSource === "gmail"
                    ? "We'll guide you through Google Contacts import after setup"
                    : "We'll open the CSV importer after setup"}
                </p>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mt-6 mx-auto max-w-md rounded-xl bg-red-50 p-4 text-left">
              <p className="text-[13px] text-red-600">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="mt-10 flex items-center justify-center gap-4">
            <button
              onClick={() => router.push("/onboarding/import")}
              className="text-[14px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleComplete}
              disabled={saving}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-gray-900 px-8 text-[15px] font-semibold text-white hover:bg-gray-800 transition-colors disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Complete setup"
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
