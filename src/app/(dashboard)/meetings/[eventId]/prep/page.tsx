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
  MapPin,
  MessageSquareText,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { AttendeePrep } from "@/lib/meeting-prep";
import { Surface, SectionLabel } from "@/components/ds";

interface PrepResponse {
  eventTitle: string;
  eventDescription: string | null;
  eventLocation: string | null;
  eventStartTime: string;
  eventEndTime: string | null;
  eventHtmlLink: string | null;
  eventPrep?: {
    knownAttendees: number;
    unknownAttendees: number;
    openThreads: number;
    facts: number;
    recentInteractions: number;
    lastMetAt: string | null;
    summary: string;
  };
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
    <div className="mx-auto max-w-[980px] pt-8 pb-16">
      {/* Header */}
      <Link
        href="/calendar"
        className="inline-flex items-center gap-1 ds-body-sm mb-4"
        style={{ color: "var(--text-tertiary)" }}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to calendar
      </Link>

      <section className="crm-animate-enter rounded-[14px] border border-[#EAE2D6] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(40,30,20,0.03)] sm:px-6">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#B5613F]">
          Meeting dossier
        </div>
        <div className="mt-1 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-serif text-[34px] font-medium leading-tight text-[#1B1A17] sm:text-[42px]">
              {data.eventTitle}
            </h1>
            {data.eventPrep?.summary && (
              <p className="mt-2 max-w-[720px] text-[13px] leading-5 text-[#6A645A]">
                {data.eventPrep.summary}
              </p>
            )}
          </div>
          {data.eventHtmlLink && (
            <a
              href={data.eventHtmlLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 w-fit items-center gap-1.5 rounded-[8px] border border-[#E2D9CB] bg-[#FAF8F5] px-3 text-[12px] font-semibold text-[#6F685D]"
            >
              Open in Calendar
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <MetaPill>{formatEventTime(data.eventStartTime)}</MetaPill>
          {data.eventEndTime && (
            <MetaPill>
              {formatDurationMinutes(
                Math.round(
                  (new Date(data.eventEndTime).getTime() - new Date(data.eventStartTime).getTime()) / 60000,
                ),
              )}
            </MetaPill>
          )}
          {data.eventLocation && (
            <MetaPill>
              <MapPin className="mr-1 h-3 w-3" />
              {data.eventLocation}
            </MetaPill>
          )}
          {data.attendees.length > 0 && (
            <MetaPill>
              {data.attendees.length} attendee{data.attendees.length === 1 ? "" : "s"} on file
            </MetaPill>
          )}
        </div>
      </section>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DossierMetric label="Known people" value={(data.eventPrep?.knownAttendees ?? data.attendees.length).toString()} />
        <DossierMetric label="Open threads" value={(data.eventPrep?.openThreads ?? 0).toString()} />
        <DossierMetric label="Saved facts" value={(data.eventPrep?.facts ?? 0).toString()} />
        <DossierMetric label="Touchpoints" value={(data.eventPrep?.recentInteractions ?? 0).toString()} />
      </div>

      {data.eventDescription && (
        <Surface tone="sand" padded className="mt-5 p-5">
          <div className="mb-2 flex items-center gap-2">
            <MessageSquareText className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />
            <SectionLabel>Calendar agenda</SectionLabel>
          </div>
          <p className="ds-body-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
            {data.eventDescription}
          </p>
        </Surface>
      )}

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
    <Surface tone="mist" padded className="crm-animate-enter p-6 sm:p-8">
      {/* Attendee header */}
      <div className="flex items-start gap-4 mb-5">
        <Avatar className="h-14 w-14 shrink-0">
          {a.avatarUrl && <AvatarImage src={a.avatarUrl} alt={a.contactName} />}
          <AvatarFallback
            className="text-[15px] font-semibold"
            style={{ backgroundColor: "var(--surface-mist-raised)", color: "var(--text-primary)" }}
          >
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
            href={`/people?contact=${a.contactId}`}
            className="ds-display-lg hover:underline truncate inline-block"
            style={{ fontSize: "1.5rem" }}
          >
            {a.contactName}
          </Link>
          <p className="ds-body-md mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {[a.role, a.company].filter(Boolean).join(" · ") || a.email}
          </p>
          {a.lastMeetingDelta && (
            <div className="mt-2">
              <MetaPill>Last met {a.lastMeetingDelta.daysSince}d ago</MetaPill>
            </div>
          )}
        </div>
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
    </Surface>
  );
}

function DossierMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-[#E2D9CB] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(40,30,20,0.03)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#A89F90]">
        {label}
      </div>
      <div className="mt-1 font-serif text-[25px] leading-none text-[#1B1A17]">{value}</div>
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
    <Surface tone="stone" padded className="mb-4 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.7} style={{ color: "var(--text-secondary)" }} />
        <SectionLabel>{title}</SectionLabel>
      </div>
      <div className="ds-body-sm">{children}</div>
    </Surface>
  );
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-medium"
      style={{
        backgroundColor: "var(--accent-soft)",
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </span>
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

function formatDurationMinutes(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
