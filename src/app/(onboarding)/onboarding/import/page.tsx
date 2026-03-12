"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Mail, ArrowRight, Smartphone, Loader2, Check } from "lucide-react";

export default function OnboardingImport() {
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [appleImporting, setAppleImporting] = useState(false);
  const [appleResult, setAppleResult] = useState<{
    created: number;
    enriched: number;
    skipped: number;
    total: number;
  } | null>(null);

  function handleSkip() {
    router.push("/onboarding/complete");
  }

  async function handleGmailImport() {
    setImporting(true);
    try {
      sessionStorage.setItem("onboarding-import-source", "gmail");
      router.push("/onboarding/complete");
    } finally {
      setImporting(false);
    }
  }

  function handleCsvImport() {
    sessionStorage.setItem("onboarding-import-source", "csv");
    router.push("/onboarding/complete");
  }

  async function handleAppleImport() {
    setAppleImporting(true);
    try {
      const res = await fetch("/api/contacts/apple", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Import failed");
      }
      const result = await res.json();
      setAppleResult(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to import Apple Contacts");
    } finally {
      setAppleImporting(false);
    }
  }

  return (
    <div>
      <h1 className="text-[32px] font-bold tracking-tight text-gray-900">
        Bring in your contacts.
      </h1>
      <p className="mt-2 text-[16px] text-gray-500">
        Import existing contacts so your CRM is useful from day one.
        You can always add more later.
      </p>

      <div className="mt-10 space-y-3">
        {/* Apple Contacts — one-click, no export needed */}
        <button
          onClick={handleAppleImport}
          disabled={appleImporting || !!appleResult}
          className="group flex w-full items-center gap-4 rounded-2xl border border-gray-200 p-5 text-left transition-all hover:border-gray-300 hover:bg-gray-50 disabled:opacity-75"
        >
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${appleResult ? "" : "bg-gray-100 group-hover:bg-gray-200"}`}
            style={appleResult ? { backgroundColor: "#EBF5EE" } : undefined}
          >
            {appleImporting ? (
              <Loader2 className="h-6 w-6 text-gray-500 animate-spin" />
            ) : appleResult ? (
              <Check className="h-6 w-6 text-[#4A8C5E]" />
            ) : (
              <Smartphone className="h-6 w-6 text-gray-500" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold text-gray-900">
              {appleResult ? "Apple Contacts imported" : "Import from Apple Contacts"}
            </p>
            <p className="mt-0.5 text-[13px] text-gray-400">
              {appleImporting
                ? "Reading your Contacts app..."
                : appleResult
                  ? `${appleResult.created} created, ${appleResult.enriched} enriched, ${appleResult.skipped} unchanged`
                  : "One click — reads directly from your Mac's Contacts app"}
            </p>
          </div>
          {!appleImporting && !appleResult && (
            <ArrowRight className="h-5 w-5 text-gray-300 group-hover:text-gray-500 transition-colors" />
          )}
        </button>

        {/* Gmail import */}
        <button
          onClick={handleGmailImport}
          disabled={importing}
          className="group flex w-full items-center gap-4 rounded-2xl border border-gray-200 p-5 text-left transition-all hover:border-gray-300 hover:bg-gray-50"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 group-hover:bg-gray-200 transition-colors">
            <Mail className="h-6 w-6 text-gray-500" />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold text-gray-900">
              Import from Google Contacts
            </p>
            <p className="mt-0.5 text-[13px] text-gray-400">
              We&apos;ll pull in names, emails, and companies from your Google account
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-gray-300 group-hover:text-gray-500 transition-colors" />
        </button>

        {/* CSV import */}
        <button
          onClick={handleCsvImport}
          className="group flex w-full items-center gap-4 rounded-2xl border border-gray-200 p-5 text-left transition-all hover:border-gray-300 hover:bg-gray-50"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 group-hover:bg-gray-200 transition-colors">
            <Upload className="h-6 w-6 text-gray-500" />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold text-gray-900">
              Upload a CSV or vCard file
            </p>
            <p className="mt-0.5 text-[13px] text-gray-400">
              Export from LinkedIn, Outlook, or any spreadsheet
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-gray-300 group-hover:text-gray-500 transition-colors" />
        </button>
      </div>

      {/* Actions */}
      <div className="mt-10 flex items-center justify-between">
        <button
          onClick={() => router.push("/onboarding/circles")}
          className="text-[14px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleSkip}
          className="text-[14px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
        >
          {appleResult ? "Continue" : "Skip for now"}
        </button>
      </div>
    </div>
  );
}
