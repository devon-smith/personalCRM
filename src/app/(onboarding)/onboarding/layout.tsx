"use client";

import { usePathname } from "next/navigation";

const STEPS = [
  { path: "/onboarding", label: "Welcome" },
  { path: "/onboarding/circles", label: "Your circles" },
  { path: "/onboarding/import", label: "Import contacts" },
  { path: "/onboarding/complete", label: "All set" },
];

function getCurrentStep(pathname: string): number {
  const index = STEPS.findIndex((s) => pathname === s.path);
  return index >= 0 ? index : 0;
}

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const currentStep = getCurrentStep(pathname);

  return (
    <div className="min-h-screen bg-white">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50">
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-gray-900 transition-all duration-500 ease-out"
            style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex justify-center pt-8 pb-4">
        <div className="flex items-center gap-2">
          {STEPS.map((step, i) => (
            <div key={step.path} className="flex items-center gap-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors ${
                  i <= currentStep
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                {i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`h-px w-8 transition-colors ${
                    i < currentStep ? "bg-gray-900" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-2xl px-6 py-8">{children}</main>
    </div>
  );
}
