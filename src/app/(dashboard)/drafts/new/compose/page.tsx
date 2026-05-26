"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * /drafts/new/compose
 *
 * Bootstrap route for the iterative workspace. Reads entry-point
 * params from the query string, calls POST /api/drafts/workspace/new
 * to spin up a Draft row + generate v1, then redirects to
 * /drafts/[id]/compose. Same page is reached from "Draft reply"
 * (with ?inboxItemId=…), "Draft outreach" (with ?contactId=…), and
 * the priority queue.
 */
export default function NewWorkspaceRoute() {
  const router = useRouter();
  const params = useSearchParams();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function go() {
      try {
        const body: Record<string, string> = {};
        const inboxItemId = params.get("inboxItemId");
        const contactId = params.get("contactId");
        const threadKey = params.get("threadKey");
        const tone = params.get("tone");
        const context = params.get("context");
        if (inboxItemId) body.inboxItemId = inboxItemId;
        if (contactId) body.contactId = contactId;
        if (threadKey) body.threadKey = threadKey;
        if (tone) body.tone = tone;
        if (context) body.context = context;

        const res = await fetch("/api/drafts/workspace/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? "Failed to create workspace");
        }
        const { id } = (await res.json()) as { id: string };
        if (cancelled) return;
        router.replace(`/drafts/${id}/compose`);
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setCreating(false);
      }
    }
    go();
    return () => {
      cancelled = true;
    };
  }, [params, router]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      {creating ? (
        <>
          <Loader2
            className="h-5 w-5 animate-spin"
            style={{ color: "var(--text-tertiary)" }}
          />
          <p
            className="text-[13px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Setting up your draft workspace&hellip;
          </p>
          <p
            className="text-[12px] max-w-xs"
            style={{ color: "var(--text-tertiary)" }}
          >
            Pulling in the inbound message, voice references, and memory
            for this contact.
          </p>
        </>
      ) : (
        <>
          <p
            className="text-[14px] font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            Couldn&rsquo;t open the workspace
          </p>
          <p
            className="text-[12px] max-w-md"
            style={{ color: "var(--text-tertiary)" }}
          >
            {errorMsg ?? "Unknown error"}
          </p>
        </>
      )}
    </div>
  );
}
