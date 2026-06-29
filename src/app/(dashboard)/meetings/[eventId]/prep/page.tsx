"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  GraduationCap,
  Link2,
  Loader2,
  MapPin,
  MessageSquareText,
  Newspaper,
  Sparkles,
  UserRoundPlus,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { AttendeePrep } from "@/lib/meeting-prep";

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
  researchLimits?: {
    knownAttendees: number;
    scholarlyLimit: number;
    openWebLimit: number;
    scholarlyRequested: number;
    openWebRequested: number;
    scholarlySkipped: number;
    openWebSkipped: number;
  };
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
        <div className="flex items-center gap-2 text-[#8C857B]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-[14px]">Building prep dossier...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-[760px] pt-14">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-[13px] text-[#8C857B]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>
        <p className="mt-6 text-[14px] text-[#B04F35]">
          {error instanceof Error ? error.message : "Couldn't load prep for this meeting."}
        </p>
      </div>
    );
  }

  const agenda = parseAgenda(data.eventDescription);
  const duration = data.eventEndTime
    ? formatDurationMinutes(
        Math.max(
          0,
          Math.round(
            (new Date(data.eventEndTime).getTime() -
              new Date(data.eventStartTime).getTime()) /
              60000,
          ),
        ),
      )
    : null;
  const prepItems = buildPrepItems(data);

  return (
    <div className="mx-auto max-w-[1120px] px-4 pt-8 pb-16 sm:px-6">
      <Link
        href="/calendar"
        className="mb-5 inline-flex items-center gap-1 text-[13px] font-medium text-[#8A8175] transition hover:text-[#1F1D1A]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to calendar
      </Link>

      <section className="overflow-hidden rounded-[28px] border border-white/80 bg-white/80 shadow-[0_24px_80px_rgba(53,43,34,0.10)] backdrop-blur">
        <div className="grid gap-0 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="px-5 py-6 sm:px-8 sm:py-8">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#F2ECE3] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A95D3D]">
              <Sparkles className="h-3.5 w-3.5" />
              Meeting brief
            </div>
            <h1 className="mt-4 max-w-[760px] font-serif text-[38px] font-medium leading-[0.98] text-[#1F1D1A] sm:text-[56px]">
              {data.eventTitle}
            </h1>
            <p className="mt-5 max-w-[720px] text-[15px] leading-7 text-[#625B51]">
              {data.eventPrep?.summary || fallbackSummary(data)}
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              <MetaPill icon={CalendarDays}>{formatEventTime(data.eventStartTime)}</MetaPill>
              {duration && <MetaPill icon={Clock}>{duration}</MetaPill>}
              {data.eventLocation && (
                <MetaPill icon={MapPin}>{compactLocation(data.eventLocation)}</MetaPill>
              )}
              <MetaPill>
                {data.attendees.length} known attendee
                {data.attendees.length === 1 ? "" : "s"}
              </MetaPill>
            </div>
          </div>

          <aside className="border-t border-[#EEE6DB] bg-[#F8F4ED] p-5 sm:p-8 lg:border-l lg:border-t-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#A59B8E]">
              Before you walk in
            </div>
            <div className="mt-4 space-y-3">
              {prepItems.map((item) => (
                <PrepItem key={item.title} {...item} />
              ))}
            </div>
            {data.eventHtmlLink && (
              <a
                href={data.eventHtmlLink}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#1F1D1A] px-4 text-[13px] font-semibold text-white shadow-[0_8px_24px_rgba(31,29,26,0.18)] transition hover:bg-[#39342D]"
              >
                Open in Calendar
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </aside>
        </div>
      </section>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DossierMetric
          label="Known people"
          value={(data.eventPrep?.knownAttendees ?? data.attendees.length).toString()}
          caption="Matched to your CRM"
        />
        <DossierMetric
          label="Open threads"
          value={(data.eventPrep?.openThreads ?? 0).toString()}
          caption="Promises or pending replies"
        />
        <DossierMetric
          label="Saved facts"
          value={(data.eventPrep?.facts ?? 0).toString()}
          caption="Reusable context"
        />
        <DossierMetric
          label="Touchpoints"
          value={(data.eventPrep?.recentInteractions ?? 0).toString()}
          caption="Recent interactions"
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
        <section className="rounded-[24px] border border-[#ECE2D5] bg-white p-5 shadow-[0_10px_40px_rgba(53,43,34,0.06)] sm:p-6">
          <SectionHeader
            icon={MessageSquareText}
            eyebrow="Calendar notes"
            title="Agenda cleaned up"
          />
          {agenda.cleanText ? (
            <p className="mt-4 whitespace-pre-wrap text-[14px] leading-7 text-[#514A42]">
              {agenda.cleanText}
            </p>
          ) : (
            <p className="mt-4 text-[14px] leading-7 text-[#8A8175]">
              No useful agenda notes were attached to this event.
            </p>
          )}
          {agenda.links.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {agenda.links.slice(0, 4).map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#E3D8CA] bg-[#FAF7F2] px-3 py-1.5 text-[12px] font-semibold text-[#655D52] transition hover:border-[#C9B8A3] hover:text-[#1F1D1A]"
                >
                  <Link2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{link.label}</span>
                </a>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[24px] border border-[#ECE2D5] bg-[#F7F5F0] p-5 shadow-[0_10px_40px_rgba(53,43,34,0.06)] sm:p-6">
          <SectionHeader
            icon={CheckCircle2}
            eyebrow="Suggested posture"
            title="Highest-signal prep"
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {buildSignalCards(data).map((signal) => (
              <SignalCard key={signal.title} {...signal} />
            ))}
          </div>
        </section>
      </div>

      {data.unknownAttendeeEmails.length > 0 && (
        <div className="mt-5 rounded-[18px] border border-[#E8DED0] bg-[#FBF8F2] px-4 py-3 text-[13px] leading-6 text-[#6A6258]">
          <span className="font-semibold text-[#1F1D1A]">
            {data.unknownAttendeeEmails.length} attendee
            {data.unknownAttendeeEmails.length === 1 ? "" : "s"} not in your CRM:
          </span>{" "}
          {data.unknownAttendeeEmails.slice(0, 4).join(", ")}
          {data.unknownAttendeeEmails.length > 4
            ? `, +${data.unknownAttendeeEmails.length - 4} more`
            : ""}
        </div>
      )}

      {data.researchLimits &&
        (data.researchLimits.scholarlySkipped > 0 ||
          data.researchLimits.openWebSkipped > 0) && (
          <div className="mt-5 rounded-[18px] border border-[#E8DED0] bg-[#FBF8F2] px-4 py-3 text-[13px] leading-6 text-[#6A6258]">
            <span className="font-semibold text-[#1F1D1A]">Public research focused:</span>{" "}
            researched the top {data.researchLimits.openWebRequested} attendee
            {data.researchLimits.openWebRequested === 1 ? "" : "s"} for open-web context
            and the top {data.researchLimits.scholarlyRequested} for scholarly context to keep
            large-meeting prep fast and API-efficient.
          </div>
        )}

      <section className="mt-9">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#A59B8E]">
              People intelligence
            </div>
            <h2 className="mt-1 font-serif text-[32px] font-medium text-[#1F1D1A]">
              Who you are meeting
            </h2>
          </div>
        </div>

        {data.attendees.length === 0 ? (
          <p className="rounded-[22px] border border-[#ECE2D5] bg-white p-6 text-[14px] text-[#8A8175]">
            No CRM-matched attendees on this meeting yet.
          </p>
        ) : (
          <div className="space-y-5">
            {data.attendees.map((a) => (
              <AttendeeCard key={a.contactId} attendee={a} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AttendeeCard({ attendee: a }: { attendee: AttendeePrep }) {
  const highlights = buildAttendeeHighlights(a);

  return (
    <article className="overflow-hidden rounded-[28px] border border-[#ECE2D5] bg-white shadow-[0_18px_60px_rgba(53,43,34,0.08)]">
      <div className="grid gap-0 lg:grid-cols-[300px_1fr]">
        <aside className="bg-[#F6F1E9] p-6 sm:p-7">
          <Avatar className="h-16 w-16 border border-white/80 shadow-sm">
            {a.avatarUrl && <AvatarImage src={a.avatarUrl} alt={a.contactName} />}
            <AvatarFallback className="bg-[#E7DED1] text-[16px] font-semibold text-[#1F1D1A]">
              {initials(a.contactName)}
            </AvatarFallback>
          </Avatar>
          <Link
            href={`/people?contact=${a.contactId}`}
            className="mt-4 inline-flex items-center gap-1 font-serif text-[28px] font-medium leading-tight text-[#1F1D1A] hover:underline"
          >
            {a.contactName}
            <ArrowUpRight className="h-4 w-4" />
          </Link>
          <p className="mt-2 text-[14px] leading-6 text-[#655D52]">
            {[a.role, a.company].filter(Boolean).join(" · ") || a.email}
          </p>
          {a.email && <p className="mt-2 break-all text-[12px] text-[#91887B]">{a.email}</p>}

          <div className="mt-5 space-y-2">
            <MiniStat
              label="Interactions"
              value={a.history.totalInteractions.toString()}
            />
            <MiniStat
              label="Last met"
              value={
                a.lastMeetingDelta
                  ? `${a.lastMeetingDelta.daysSince}d ago`
                  : "No meeting"
              }
            />
            <MiniStat
              label="Recent changes"
              value={a.lastMeetingDelta?.changesSinceCount.toString() ?? "0"}
            />
          </div>
        </aside>

        <div className="p-5 sm:p-7">
          <div className="grid gap-3 md:grid-cols-3">
            {highlights.map((highlight) => (
              <HighlightCard key={highlight.title} {...highlight} />
            ))}
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-3">
            <IntelPanel icon={Clock} title="Your history">
              {a.history.totalInteractions === 0 ? (
                <EmptyLine>No prior interactions on record.</EmptyLine>
              ) : (
                <div className="space-y-3">
                  {a.history.recentInteractions.slice(0, 4).map((i) => (
                    <TimelineItem
                      key={i.id}
                      date={formatDate(i.occurredAt)}
                      label={`${sentenceCase(i.type)} · ${sentenceCase(i.direction)}`}
                      body={i.subject ?? i.summary ?? "Interaction captured"}
                    />
                  ))}
                  {a.history.recentLifeUpdates.slice(0, 2).map((u) => (
                    <TimelineItem
                      key={u.id}
                      date={formatDate(u.detectedAt)}
                      label={sentenceCase(u.field)}
                      body={`${u.oldValue ?? "Unknown"} -> ${u.newValue ?? "Updated"}`}
                    />
                  ))}
                  {a.history.recentJournal.slice(0, 2).map((j) => (
                    <TimelineItem
                      key={j.id}
                      date={formatDate(j.createdAt)}
                      label="Note"
                      body={truncate(j.content, 150)}
                    />
                  ))}
                </div>
              )}
            </IntelPanel>

            <IntelPanel icon={GraduationCap} title="Research profile">
              {!a.scholarly ? (
                a.researchBudget.scholarly === "skipped_by_limit" ? (
                  <EmptyLine>
                    Scholarly lookup was skipped to keep this large-meeting brief focused.
                  </EmptyLine>
                ) : (
                  <EmptyLine>No OpenAlex match yet.</EmptyLine>
                )
              ) : a.scholarly.candidatesFound > 1 && !a.scholarly.authorId ? (
                <EmptyLine>
                  {a.scholarly.candidatesFound} OpenAlex candidates matched. Open the
                  contact to manually choose the right profile.
                </EmptyLine>
              ) : (
                <div className="space-y-3">
                  <div>
                    <p className="text-[13px] font-semibold text-[#1F1D1A]">
                      {a.scholarly.authorName}
                    </p>
                    {a.scholarly.currentInstitution && (
                      <p className="mt-1 text-[12px] text-[#7D7468]">
                        {a.scholarly.currentInstitution}
                      </p>
                    )}
                    <p className="mt-2 text-[12px] text-[#7D7468]">
                      {a.scholarly.worksCount} works ·{" "}
                      {a.scholarly.citedByCount.toLocaleString()} citations
                      {a.scholarly.hIndex !== null && ` · h-index ${a.scholarly.hIndex}`}
                    </p>
                  </div>
                  {a.scholarly.recentWorks.slice(0, 3).map((w) => (
                    <SourceLink
                      key={w.id}
                      href={w.url}
                      title={w.title}
                      meta={[
                        w.publicationYear?.toString(),
                        w.venue,
                        w.citedByCount > 0 ? `${w.citedByCount} cites` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  ))}
                </div>
              )}
            </IntelPanel>

            <IntelPanel icon={Newspaper} title="Open web">
              {!a.openWeb ? (
                a.researchBudget.openWeb === "skipped_by_limit" ? (
                  <EmptyLine>
                    Open-web lookup was skipped to keep this large-meeting brief focused.
                  </EmptyLine>
                ) : (
                  <EmptyLine>Web search is not available for this attendee.</EmptyLine>
                )
              ) : a.openWeb.emptyResult ? (
                <EmptyLine>No recent public mentions found in the last 90 days.</EmptyLine>
              ) : (
                <div className="space-y-3">
                  <p className="text-[13px] leading-6 text-[#514A42]">
                    {a.openWeb.summary}
                  </p>
                  {a.openWeb.citations.slice(0, 3).map((c) => (
                    <SourceLink
                      key={c.url}
                      href={c.url}
                      title={c.title ?? c.url}
                      meta={hostname(c.url)}
                    />
                  ))}
                </div>
              )}
            </IntelPanel>
          </div>
        </div>
      </div>
    </article>
  );
}

function DossierMetric({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="rounded-[20px] border border-[#ECE2D5] bg-white px-5 py-4 shadow-[0_10px_32px_rgba(53,43,34,0.05)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#A59B8E]">
        {label}
      </div>
      <div className="mt-2 font-serif text-[34px] leading-none text-[#1F1D1A]">{value}</div>
      <div className="mt-2 text-[12px] text-[#8A8175]">{caption}</div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  eyebrow,
  title,
}: {
  icon: typeof Clock;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EFE7DB] text-[#9B5B3E]">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#A59B8E]">
          {eyebrow}
        </div>
        <h2 className="mt-1 font-serif text-[26px] font-medium leading-tight text-[#1F1D1A]">
          {title}
        </h2>
      </div>
    </div>
  );
}

function PrepItem({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Clock;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3 rounded-[18px] bg-white/75 p-3 shadow-[0_1px_2px_rgba(53,43,34,0.04)]">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ECE3D6] text-[#8E563E]">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div>
        <div className="text-[13px] font-semibold text-[#1F1D1A]">{title}</div>
        <p className="mt-1 text-[12px] leading-5 text-[#6E655B]">{body}</p>
      </div>
    </div>
  );
}

function SignalCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[18px] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(53,43,34,0.04)]">
      <div className="text-[13px] font-semibold text-[#1F1D1A]">{title}</div>
      <p className="mt-1 text-[12px] leading-5 text-[#6E655B]">{body}</p>
    </div>
  );
}

function MetaPill({
  icon: Icon,
  children,
}: {
  icon?: typeof Clock;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#F4EEE5] px-3 py-1.5 text-[12px] font-semibold text-[#655D52]">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-[14px] bg-white/70 px-3 py-2">
      <span className="text-[12px] text-[#7D7468]">{label}</span>
      <span className="text-[12px] font-semibold text-[#1F1D1A]">{value}</span>
    </div>
  );
}

function HighlightCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[18px] border border-[#EEE6DB] bg-[#FBF9F5] p-4">
      <div className="text-[12px] font-semibold text-[#1F1D1A]">{title}</div>
      <p className="mt-2 text-[12px] leading-5 text-[#655D52]">{body}</p>
    </div>
  );
}

function IntelPanel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Clock;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[22px] bg-[#F8F5EF] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#8E7F70]" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8E7F70]">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

function TimelineItem({
  date,
  label,
  body,
}: {
  date: string;
  label: string;
  body: string;
}) {
  return (
    <div className="border-l border-[#DED5C8] pl-3">
      <div className="text-[11px] font-medium text-[#968C7E]">
        {date} · {label}
      </div>
      <p className="mt-1 text-[13px] leading-5 text-[#514A42]">{truncate(body, 130)}</p>
    </div>
  );
}

function SourceLink({
  href,
  title,
  meta,
}: {
  href: string | null;
  title: string;
  meta: string;
}) {
  const content = (
    <>
      <span className="line-clamp-2 text-[12px] font-semibold leading-5 text-[#1F1D1A]">
        {title}
      </span>
      {meta && <span className="mt-1 block text-[11px] text-[#8A8175]">{meta}</span>}
    </>
  );

  if (!href) {
    return <div className="rounded-[14px] bg-white px-3 py-2">{content}</div>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group block rounded-[14px] bg-white px-3 py-2 transition hover:bg-[#F1ECE3]"
    >
      {content}
    </a>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-6 text-[#81786C]">{children}</p>;
}

function buildPrepItems(data: PrepResponse) {
  const openThreads = data.eventPrep?.openThreads ?? 0;
  const facts = data.eventPrep?.facts ?? 0;
  const unknown = data.unknownAttendeeEmails.length;
  const recent = data.eventPrep?.recentInteractions ?? 0;

  return [
    {
      icon: BookOpenText,
      title: openThreads > 0 ? "Resolve the open loop" : "Start with context",
      body:
        openThreads > 0
          ? `${openThreads} open thread${openThreads === 1 ? "" : "s"} may need acknowledgment before new agenda items.`
          : `${facts} saved fact${facts === 1 ? "" : "s"} and ${recent} recent touchpoint${recent === 1 ? "" : "s"} are available for grounding.`,
    },
    {
      icon: UserRoundPlus,
      title: unknown > 0 ? "Identify new attendees" : "Known room",
      body:
        unknown > 0
          ? `${unknown} attendee${unknown === 1 ? "" : "s"} are not in the CRM yet; capture role and relevance after the meeting.`
          : "All listed attendees matched existing CRM contacts.",
    },
    {
      icon: Sparkles,
      title: "Use recent signals",
      body: strongestAttendeeSignal(data.attendees),
    },
  ];
}

function buildSignalCards(data: PrepResponse) {
  const stale = data.attendees
    .filter((a) => a.lastMeetingDelta && a.lastMeetingDelta.daysSince > 45)
    .slice(0, 2);
  const publicUpdates = data.attendees
    .filter((a) => a.openWeb && !a.openWeb.emptyResult)
    .slice(0, 2);
  const changes = data.attendees
    .flatMap((a) =>
      a.history.recentLifeUpdates.slice(0, 1).map((u) => ({
        name: a.contactName,
        update: `${sentenceCase(u.field)} changed to ${u.newValue ?? "new value"}`,
      })),
    )
    .slice(0, 2);

  const cards = [
    {
      title: stale.length ? "Reconnect deliberately" : "Relationship temperature",
      body: stale.length
        ? `${stale.map((a) => a.contactName).join(", ")} last met more than 45 days ago. Open with continuity.`
        : "No clearly stale known attendee relationships were detected from CRM history.",
    },
    {
      title: publicUpdates.length ? "Recent public context" : "Public context",
      body: publicUpdates.length
        ? publicUpdates
            .map((a) => `${a.contactName}: ${truncate(a.openWeb?.summary ?? "", 90)}`)
            .join(" ")
        : "No recent public web signal is attached to the matched attendees.",
    },
    {
      title: changes.length ? "Changed facts" : "Fact hygiene",
      body: changes.length
        ? changes.map((c) => `${c.name}: ${c.update}`).join(" ")
        : "No pending contact changes were detected for this attendee set.",
    },
    {
      title: "Follow-up capture",
      body: "After the meeting, record decisions, promised follow-ups, and any attendee roles that were missing.",
    },
  ];

  return cards;
}

function buildAttendeeHighlights(a: AttendeePrep) {
  const lastInteraction = a.history.recentInteractions[0];
  const lifeUpdate = a.history.recentLifeUpdates[0];
  const webSummary = a.openWeb && !a.openWeb.emptyResult ? a.openWeb.summary : null;

  return [
    {
      title: "Relationship",
      body: a.lastMeetingDelta
        ? `Last meeting was ${a.lastMeetingDelta.daysSince} days ago with ${a.lastMeetingDelta.changesSinceCount} tracked change${a.lastMeetingDelta.changesSinceCount === 1 ? "" : "s"} since.`
        : `${a.history.totalInteractions} prior interaction${a.history.totalInteractions === 1 ? "" : "s"} in the CRM.`,
    },
    {
      title: "Latest signal",
      body: lastInteraction
        ? truncate(lastInteraction.subject ?? lastInteraction.summary ?? "Recent interaction captured.", 120)
        : lifeUpdate
          ? `${sentenceCase(lifeUpdate.field)} changed to ${lifeUpdate.newValue ?? "a new value"}.`
          : "No recent private signal captured yet.",
    },
    {
      title: "What changed publicly",
      body: webSummary
        ? truncate(webSummary, 130)
        : a.scholarly?.recentWorks[0]
          ? truncate(a.scholarly.recentWorks[0].title, 130)
          : "No recent public context available.",
    },
  ];
}

function parseAgenda(description: string | null) {
  if (!description) return { cleanText: "", links: [] as Array<{ url: string; label: string }> };

  const links = Array.from(
    new Set(description.match(/https?:\/\/[^\s<>"')]+/g) ?? []),
  ).map((url) => ({
    url,
    label: labelForUrl(url),
  }));

  const noisyPatterns = [
    /-{2,}\s*Or via the ZOOM app:[\s\S]*$/i,
    /One tap mobile:[\s\S]*$/i,
    /This e-mail may contain information[\s\S]*$/i,
    /Meeting Password:\s*\S+/gi,
    /Meeting ID:\s*[\d\s]+/gi,
    /Meeting URL:\s*https?:\/\/[^\s<>"')]+/gi,
    /Join from PC, Mac, Linux, iOS or Android:\s*https?:\/\/[^\s<>"')]+/gi,
  ];

  let cleanText = description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

  for (const pattern of noisyPatterns) {
    cleanText = cleanText.replace(pattern, "");
  }

  cleanText = cleanText
    .replace(/https?:\/\/[^\s<>"')]+/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(Reference Material|Zoom Details|Dial by your location)/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    cleanText: truncate(cleanText, 850),
    links,
  };
}

function fallbackSummary(data: PrepResponse) {
  const known = data.eventPrep?.knownAttendees ?? data.attendees.length;
  const recent = data.eventPrep?.recentInteractions ?? 0;
  return `Prep has ${known} known attendee${known === 1 ? "" : "s"} and ${recent} recent interaction${recent === 1 ? "" : "s"} available for context.`;
}

function strongestAttendeeSignal(attendees: AttendeePrep[]) {
  const web = attendees.find((a) => a.openWeb && !a.openWeb.emptyResult);
  if (web?.openWeb?.summary) return truncate(`${web.contactName}: ${web.openWeb.summary}`, 130);

  const interaction = attendees.find((a) => a.history.recentInteractions.length > 0);
  const latest = interaction?.history.recentInteractions[0];
  if (interaction && latest) {
    return truncate(
      `${interaction.contactName}: ${latest.subject ?? latest.summary ?? "recent touchpoint captured."}`,
      130,
    );
  }

  return "No standout recent signal yet; use the attendee cards to capture context after the meeting.";
}

function compactLocation(location: string) {
  if (/zoom|meet\.google|teams/i.test(location)) return "Video call";
  return truncate(location, 42);
}

function labelForUrl(url: string) {
  const host = hostname(url);
  if (/zoom/i.test(host)) return "Zoom link";
  if (/calendar\.google/i.test(host)) return "Calendar link";
  return host || "Meeting link";
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function sentenceCase(value: string) {
  const normalized = value.replace(/_/g, " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function truncate(text: string, length: number) {
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1).trim()}...`;
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
