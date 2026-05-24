"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ExternalLink,
  GraduationCap,
  Clock,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { AttendeePrep } from "@/lib/meeting-prep";

interface PrepResponse {
  eventTitle: string;
  eventStartTime: string;
  eventEndTime: string | null;
  eventHtmlLink: string | null;
  unknownAttendeeEmails: string[];
  attendees: AttendeePrep[];
  error?: string;
}

export default function MeetingPrepPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);

  const { data, isLoading, error } = useQuery<PrepResponse>({
    queryKey: ["meeting-prep", eventId],
    queryFn: async () => {
      const res = await fetch(`/api/meetings/${eventId}/prep`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Prep failed (${res.status})`);
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[760px] pt-14">
        <div className="flex items-center gap-2" style={{ color: "var(--text-tertiary)" }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="ds-body-sm">Building prep dossier…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-[760px] pt-14">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 ds-body-sm"
          style={{ color: "var(--text-tertiary)" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>
        <p className="mt-6 ds-body-sm" style={{ color: "var(--status-error)" }}>
          {error instanceof Error ? error.message : "Couldn't load prep for this meeting."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[760px] pt-14 pb-16">
      {/* Header */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 ds-body-sm mb-4"
        style={{ color: "var(--text-tertiary)" }}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to dashboard
      </Link>

      <div className="crm-animate-enter">
        <h1 className="ds-display-lg">{data.eventTitle}</h1>
        <p className="mt-1 ds-caption">
          {formatEventTime(data.eventStartTime)}
          {data.eventEndTime && ` – ${formatEventTime(data.eventEndTime)}`}
          {data.eventHtmlLink && (
            <>
              {" · "}
              <a
                href={data.eventHtmlLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1"
                style={{ color: "var(--accent-color)" }}
              >
                Open in Calendar
                <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
        </p>
      </div>

      {/* Unknown attendees notice */}
      {data.unknownAttendeeEmails.length > 0 && (
        <div
          className="mt-4 rounded-[10px] px-3 py-2 text-[12px]"
          style={{
            backgroundColor: "var(--surface-sunken)",
            color: "var(--text-tertiary)",
          }}
        >
          {data.unknownAttendeeEmails.length} attendee
          {data.unknownAttendeeEmails.length === 1 ? "" : "s"} not in your CRM yet:{" "}
          {data.unknownAttendeeEmails.slice(0, 3).join(", ")}
          {data.unknownAttendeeEmails.length > 3
            ? `, +${data.unknownAttendeeEmails.length - 3} more`
            : ""}
        </div>
      )}

      {/* Attendee cards */}
      <div className="mt-8 space-y-8">
        {data.attendees.length === 0 ? (
          <p className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
            No CRM-matched attendees on this meeting yet.
          </p>
        ) : (
          data.attendees.map((a) => <AttendeeCard key={a.contactId} attendee={a} />)
        )}
      </div>
    </div>
  );
}

function AttendeeCard({ attendee: a }: { attendee: AttendeePrep }) {
  return (
    <div className="crm-animate-enter">
      {/* Attendee header */}
      <div className="flex items-center gap-3 mb-4">
        <Avatar className="h-12 w-12">
          {a.avatarUrl && <AvatarImage src={a.avatarUrl} alt={a.contactName} />}
          <AvatarFallback>
            {a.contactName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <Link
            href={`/people/${a.contactId}`}
            className="ds-heading-md font-medium hover:underline"
            style={{ color: "var(--text-primary)" }}
          >
            {a.contactName}
          </Link>
          <p className="ds-caption">
            {[a.role, a.company].filter(Boolean).join(" at ") || a.email}
          </p>
        </div>
        {a.lastMeetingDelta && (
          <span
            className="text-[11px] px-2 py-1 rounded-full"
            style={{
              backgroundColor: "var(--surface-sunken)",
              color: "var(--text-tertiary)",
            }}
          >
            Last met {a.lastMeetingDelta.daysSince}d ago
          </span>
        )}
      </div>

      {/* Section 1 — Your history */}
      <Section icon={Clock} title="Your history">
        {a.history.totalInteractions === 0 ? (
          <p style={{ color: "var(--text-tertiary)" }}>
            No prior interactions on record.
          </p>
        ) : (
          <>
            <p className="ds-caption mb-2">
              {a.history.totalInteractions} total interaction
              {a.history.totalInteractions === 1 ? "" : "s"}
            </p>
            {a.history.recentInteractions.length > 0 && (
              <ul className="space-y-1.5 ds-body-sm">
                {a.history.recentInteractions.map((i) => (
                  <li key={i.id} className="truncate">
                    <span style={{ color: "var(--text-tertiary)" }}>
                      {formatDate(i.occurredAt)} · {i.type.toLowerCase()} · {i.direction.toLowerCase()}
                    </span>
                    {(i.subject || i.summary) && (
                      <span style={{ color: "var(--text-primary)" }}>
                        {" — "}
                        {i.subject ?? i.summary}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {a.history.recentLifeUpdates.length > 0 && (
              <div className="mt-3">
                <p
                  className="text-[11px] font-medium uppercase tracking-wide mb-1"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Recent changes
                </p>
                <ul className="space-y-1 ds-body-sm">
                  {a.history.recentLifeUpdates.map((u) => (
                    <li key={u.id}>
                      {u.type.replace("_", " ").toLowerCase()}: {u.oldValue ?? "—"} → {u.newValue ?? "—"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {a.history.recentJournal.length > 0 && (
              <div className="mt-3">
                <p
                  className="text-[11px] font-medium uppercase tracking-wide mb-1"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Notes
                </p>
                <ul className="space-y-1 ds-body-sm">
                  {a.history.recentJournal.map((j) => (
                    <li key={j.id} style={{ color: "var(--text-secondary)" }}>
                      &quot;{j.content.slice(0, 200)}{j.content.length > 200 ? "…" : ""}&quot;
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Section>

      {/* Section 2 — Their public scholarly activity */}
      <Section icon={GraduationCap} title="Their public activity">
        {!a.scholarly ? (
          <p style={{ color: "var(--text-tertiary)" }}>
            No OpenAlex match. (Common for non-academic contacts.)
          </p>
        ) : a.scholarly.candidatesFound > 1 && !a.scholarly.authorId ? (
          <p style={{ color: "var(--text-tertiary)" }}>
            {a.scholarly.candidatesFound} candidates matched on OpenAlex — disambiguation
            UI coming soon. Open the contact to manually pick.
          </p>
        ) : (
          <div className="ds-body-sm">
            <p>
              <span style={{ color: "var(--text-primary)" }}>{a.scholarly.authorName}</span>
              {a.scholarly.currentInstitution && (
                <span style={{ color: "var(--text-tertiary)" }}>
                  {" "}· {a.scholarly.currentInstitution}
                </span>
              )}
            </p>
            <p className="ds-caption">
              {a.scholarly.worksCount} works · {a.scholarly.citedByCount.toLocaleString()} citations
              {a.scholarly.hIndex !== null && ` · h-index ${a.scholarly.hIndex}`}
            </p>
            {a.scholarly.recentWorks.length > 0 && (
              <div className="mt-3">
                <p
                  className="text-[11px] font-medium uppercase tracking-wide mb-1"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Recent works
                </p>
                <ul className="space-y-1.5">
                  {a.scholarly.recentWorks.map((w) => (
                    <li key={w.id}>
                      {w.url ? (
                        <a
                          href={w.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--accent-color)" }}
                          className="hover:underline"
                        >
                          {w.title}
                        </a>
                      ) : (
                        <span style={{ color: "var(--text-primary)" }}>{w.title}</span>
                      )}
                      <span style={{ color: "var(--text-tertiary)" }}>
                        {w.publicationYear && ` · ${w.publicationYear}`}
                        {w.venue && ` · ${w.venue}`}
                        {w.citedByCount > 0 && ` · ${w.citedByCount} cites`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Section 3 — Open web */}
      <Section icon={Sparkles} title="Open web">
        {!a.openWeb ? (
          <p style={{ color: "var(--text-tertiary)" }}>
            Web search unavailable. (Set ANTHROPIC_API_KEY to enable.)
          </p>
        ) : a.openWeb.emptyResult ? (
          <p style={{ color: "var(--text-tertiary)" }}>
            No recent web mentions in the last 90 days.
          </p>
        ) : (
          <div>
            <p style={{ color: "var(--text-primary)" }}>{a.openWeb.summary}</p>
            {a.openWeb.citations.length > 0 && (
              <div className="mt-3">
                <p
                  className="text-[11px] font-medium uppercase tracking-wide mb-1"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Sources
                </p>
                <ul className="space-y-1">
                  {a.openWeb.citations.map((c) => (
                    <li key={c.url} className="truncate">
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                        style={{ color: "var(--accent-color)" }}
                      >
                        {c.title ?? c.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Clock;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mb-5 rounded-[14px] p-5"
      style={{
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-3.5 w-3.5" style={{ color: "var(--accent-color)" }} />
        <span
          className="text-[11px] font-medium uppercase tracking-wide"
          style={{ color: "var(--text-tertiary)" }}
        >
          {title}
        </span>
      </div>
      <div className="ds-body-sm">{children}</div>
    </div>
  );
}

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
