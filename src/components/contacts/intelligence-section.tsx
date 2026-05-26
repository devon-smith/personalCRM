"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/**
 * Renders the M7.1 "About them" + M7.2 "People who know them" panels
 * for a contact. Both load lazily — null/empty state on first render
 * if the worker hasn't extracted yet.
 *
 * Conscious design call: keep this collapsed by default in the
 * contact panel. The data is reference info, not the chronological
 * story Jennifer actually wants to read.
 */
export function IntelligenceSection({ contactId }: { contactId: string }) {
  const { data: profileData } = useQuery({
    queryKey: ["contact", contactId, "profile"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/profile`);
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json() as Promise<{ profile: ProfileShape | null }>;
    },
  });

  const { data: networkData } = useQuery({
    queryKey: ["contact", contactId, "network"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/network`);
      if (!res.ok) throw new Error("Failed to load network");
      return res.json() as Promise<{ neighbors: NeighborShape[] }>;
    },
  });

  const profile = profileData?.profile;
  const neighbors = networkData?.neighbors ?? [];

  if (!profile && neighbors.length === 0) {
    // Don't render an empty pane — the daily worker hasn't populated
    // these yet, and a "no data" panel is just noise.
    return null;
  }

  return (
    <div className="space-y-5">
      {profile && <AboutPanel profile={profile} />}
      {neighbors.length > 0 && <NetworkPanel neighbors={neighbors} />}
    </div>
  );
}

// ─── About panel ───────────────────────────────────────────

interface ProfileShape {
  expertiseAreas: string[];
  communicationStyle: {
    formality: string;
    responseSpeed: string;
    length: string;
  } | null;
  geographicContext: {
    primaryLocation: string | null;
    travelFrequency: string;
  } | null;
  personalitySignals: {
    humor: string;
    warmth: string;
    interests: string[];
  } | null;
  relationshipStage: string | null;
  generatedAt: string;
}

function AboutPanel({ profile }: { profile: ProfileShape }) {
  return (
    <section
      className="rounded-2xl p-4"
      style={{
        backgroundColor: "#F4EFE3",
        border: "1px solid #ECE7D9",
      }}
    >
      <header className="flex items-center gap-1.5 mb-3">
        <Sparkles className="h-3.5 w-3.5" style={{ color: "#7A4F3C" }} />
        <h3
          className="text-[11px] font-medium uppercase tracking-wider"
          style={{ color: "#5A574F" }}
        >
          About them
        </h3>
      </header>

      <dl className="space-y-2 text-[13px]">
        {profile.relationshipStage && (
          <Row label="Relationship">{profile.relationshipStage}</Row>
        )}
        {profile.expertiseAreas.length > 0 && (
          <Row label="Expertise">
            <div className="flex flex-wrap gap-1">
              {profile.expertiseAreas.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded-full text-[11px]"
                  style={{ backgroundColor: "#E4E9E9", color: "#5A574F" }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </Row>
        )}
        {profile.communicationStyle && (
          <Row label="Style">
            {profile.communicationStyle.formality}, {profile.communicationStyle.length}
          </Row>
        )}
        {profile.geographicContext?.primaryLocation && (
          <Row label="Location">{profile.geographicContext.primaryLocation}</Row>
        )}
        {profile.personalitySignals?.interests &&
          profile.personalitySignals.interests.length > 0 && (
            <Row label="Interests">
              {profile.personalitySignals.interests.join(", ")}
            </Row>
          )}
      </dl>
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <dt
        className="text-[11px] uppercase tracking-wide w-20 shrink-0"
        style={{ color: "#8C8A82" }}
      >
        {label}
      </dt>
      <dd style={{ color: "#1B1A17" }}>{children}</dd>
    </div>
  );
}

// ─── Network panel ─────────────────────────────────────────

interface NeighborShape {
  contactId: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  avatarUrl: string | null;
  edgeType: string;
  strength: number;
  observationCount: number;
  evidence: unknown;
}

const EDGE_LABEL: Record<string, string> = {
  mutual_thread: "in a shared thread",
  same_org: "same organization",
  mentioned: "mentioned in email",
  introduced_by_user: "introduced",
};

function NetworkPanel({ neighbors }: { neighbors: NeighborShape[] }) {
  return (
    <section
      className="rounded-2xl p-4"
      style={{
        backgroundColor: "#E9E9E3",
        border: "1px solid #DDD9CF",
      }}
    >
      <header className="flex items-center gap-1.5 mb-3">
        <Users className="h-3.5 w-3.5" style={{ color: "#5A574F" }} />
        <h3
          className="text-[11px] font-medium uppercase tracking-wider"
          style={{ color: "#5A574F" }}
        >
          People who know them
        </h3>
      </header>

      <ul className="space-y-2">
        {neighbors.slice(0, 8).map((n) => (
          <li key={`${n.contactId}-${n.edgeType}`}>
            <Link
              href={`/contacts/${n.contactId}`}
              className="flex items-center gap-2.5 py-1 transition-colors rounded-md px-1 -mx-1 hover:bg-[#EFEAE0]"
            >
              <Avatar className="h-7 w-7">
                <AvatarImage src={n.avatarUrl ?? undefined} />
                <AvatarFallback
                  className="text-[10px] font-medium"
                  style={{ backgroundColor: "#D8D2C4", color: "#5A574F" }}
                >
                  {n.name
                    .split(" ")
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div
                  className="text-[13px] font-medium truncate"
                  style={{ color: "#1B1A17" }}
                >
                  {n.name}
                </div>
                <div
                  className="text-[11px] truncate"
                  style={{ color: "#8C8A82" }}
                >
                  {EDGE_LABEL[n.edgeType] ?? n.edgeType}
                  {n.observationCount > 1 ? ` · ${n.observationCount}×` : ""}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {neighbors.length > 8 && (
        <p
          className="text-[11px] mt-2 pl-1"
          style={{ color: "#8C8A82" }}
        >
          + {neighbors.length - 8} more
        </p>
      )}
    </section>
  );
}
