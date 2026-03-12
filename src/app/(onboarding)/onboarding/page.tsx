"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export default function OnboardingWelcome() {
  const router = useRouter();
  const { data: session } = useSession();
  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  return (
    <div className="text-center">
      <h1 className="text-[40px] font-bold tracking-tight text-gray-900">
        Welcome, {firstName}.
      </h1>
      <p className="mt-4 text-[18px] leading-relaxed text-gray-500 max-w-lg mx-auto">
        Let&apos;s set up your CRM by learning about the different communities
        in your life. We&apos;ll create <strong className="text-gray-900">circles</strong> — groups
        that represent the pockets of people you want to stay connected with.
      </p>

      <div className="mt-12 space-y-3 max-w-sm mx-auto text-left">
        <StepPreview number={1} text="Tell us about your circles" />
        <StepPreview number={2} text="Import your existing contacts" />
        <StepPreview number={3} text="Start building relationships" />
      </div>

      <button
        onClick={() => router.push("/onboarding/circles")}
        className="mt-12 inline-flex h-12 items-center justify-center rounded-full bg-gray-900 px-8 text-[15px] font-semibold text-white hover:bg-gray-800 transition-colors"
      >
        Get started
      </button>

      <p className="mt-4 text-[13px] text-gray-400">Takes about 2 minutes</p>
    </div>
  );
}

function StepPreview({ number, text }: { number: number; text: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-gray-50 px-5 py-4">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-[12px] font-bold text-gray-600">
        {number}
      </span>
      <p className="text-[14px] font-medium text-gray-700">{text}</p>
    </div>
  );
}
