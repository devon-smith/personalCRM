"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Merge, X, Users } from "lucide-react";
import { toast } from "sonner";

interface MatchContact {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  avatarUrl: string | null;
  tier: string | null;
}

interface NicknameMatch {
  contactA: MatchContact;
  contactB: MatchContact;
  matchedFirstNames: [string, string];
  sharedLastName: string;
  confidence: number;
}

function Avatar({ contact }: { contact: MatchContact }) {
  const initials = contact.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  if (contact.avatarUrl) {
    return (
      <img
        src={contact.avatarUrl}
        alt={contact.name}
        className="shrink-0 rounded-full object-cover"
        style={{ width: 32, height: 32 }}
      />
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={{
        width: 32,
        height: 32,
        backgroundColor: "#F3F4F6",
        color: "#7B8189",
      }}
    >
      {initials}
    </div>
  );
}

function ContactCard({ contact }: { contact: MatchContact }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar contact={contact} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-[#1A1A1A]">
          {contact.name}
        </div>
        <div className="truncate text-[11px] text-[#9BA1A8]">
          {contact.company ?? contact.email ?? "No details"}
        </div>
      </div>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? "#4A8C5E" : pct >= 65 ? "#C4962E" : "#9BA1A8";
  const bg = pct >= 80 ? "#EBF5EE" : pct >= 65 ? "#FBF5E8" : "#F3F4F6";

  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
      style={{ color, backgroundColor: bg }}
    >
      {pct}% match
    </span>
  );
}

function MatchRow({
  match,
  onMerge,
  onDismiss,
  isMerging,
  isDismissing,
}: {
  match: NicknameMatch;
  onMerge: () => void;
  onDismiss: () => void;
  isMerging: boolean;
  isDismissing: boolean;
}) {
  const busy = isMerging || isDismissing;

  return (
    <div className="rounded-[12px] border border-[#E8EAED] bg-white px-4 py-3.5">
      <div className="flex items-center gap-2">
        <ConfidenceBadge confidence={match.confidence} />
        <span className="text-[11px] text-[#B5BAC0]">
          &ldquo;{match.matchedFirstNames[0]}&rdquo; &harr; &ldquo;{match.matchedFirstNames[1]}&rdquo; {match.sharedLastName}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1">
          <ContactCard contact={match.contactA} />
        </div>

        <div className="text-[#C8CDD3]">
          <Merge className="h-4 w-4 rotate-90" />
        </div>

        <div className="flex-1">
          <ContactCard contact={match.contactB} />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={onDismiss}
          disabled={busy}
          className="flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium text-[#7B8189] transition-colors hover:bg-[#F3F4F6] disabled:opacity-50"
        >
          {isDismissing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
          Not a match
        </button>
        <button
          onClick={onMerge}
          disabled={busy}
          className="flex items-center gap-1 rounded-[8px] bg-[#1A1A1A] px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-[#2D2D2D] disabled:opacity-50"
        >
          {isMerging ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Merge className="h-3 w-3" />
          )}
          Merge contacts
        </button>
      </div>
    </div>
  );
}

export function NicknameMatches() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ suggestions: NicknameMatch[] }>({
    queryKey: ["nickname-matches"],
    queryFn: async () => {
      const res = await fetch("/api/contacts/nickname-matches");
      if (!res.ok) throw new Error("Failed to fetch nickname matches");
      return res.json();
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async ({
      contactAId,
      contactBId,
    }: {
      contactAId: string;
      contactBId: string;
    }) => {
      const res = await fetch("/api/contacts/nickname-matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "merge",
          contactAId,
          contactBId,
        }),
      });
      if (!res.ok) throw new Error("Merge failed");
      return res.json();
    },
    onSuccess: () => {
      toast("Contacts merged");
      queryClient.invalidateQueries({ queryKey: ["nickname-matches"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const dismissMutation = useMutation({
    mutationFn: async ({
      contactAId,
      contactBId,
    }: {
      contactAId: string;
      contactBId: string;
    }) => {
      const res = await fetch("/api/contacts/nickname-matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dismiss",
          contactAId,
          contactBId,
        }),
      });
      if (!res.ok) throw new Error("Dismiss failed");
      return res.json();
    },
    onSuccess: () => {
      toast("Match dismissed");
      queryClient.invalidateQueries({ queryKey: ["nickname-matches"] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <section>
        <h2
          className="text-[18px] font-semibold text-[#1A1A1A]"
          style={{ letterSpacing: "-0.03em" }}
        >
          Possible duplicates
        </h2>
        <div className="mt-4 flex items-center gap-2 text-[13px] text-[#C1C5CA]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Scanning...
        </div>
      </section>
    );
  }

  const suggestions = data?.suggestions ?? [];

  if (suggestions.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2">
        <h2
          className="text-[18px] font-semibold text-[#1A1A1A]"
          style={{ letterSpacing: "-0.03em" }}
        >
          Possible duplicates
        </h2>
        <span className="rounded-md bg-[#FBF5E8] px-1.5 py-0.5 text-[11px] font-medium text-[#C4962E]">
          {suggestions.length}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-[#B5BAC0]">
        Contacts that may be the same person under different names.
      </p>

      <div className="mt-4 space-y-2.5">
        {suggestions.map((match) => {
          const key = `${match.contactA.id}:${match.contactB.id}`;
          return (
            <MatchRow
              key={key}
              match={match}
              onMerge={() =>
                mergeMutation.mutate({
                  contactAId: match.contactA.id,
                  contactBId: match.contactB.id,
                })
              }
              onDismiss={() =>
                dismissMutation.mutate({
                  contactAId: match.contactA.id,
                  contactBId: match.contactB.id,
                })
              }
              isMerging={
                mergeMutation.isPending &&
                mergeMutation.variables?.contactAId === match.contactA.id &&
                mergeMutation.variables?.contactBId === match.contactB.id
              }
              isDismissing={
                dismissMutation.isPending &&
                dismissMutation.variables?.contactAId === match.contactA.id &&
                dismissMutation.variables?.contactBId === match.contactB.id
              }
            />
          );
        })}
      </div>
    </section>
  );
}
