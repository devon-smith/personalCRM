/**
 * Daily "morning brief" — assembles today's priorities, meetings,
 * and overnight signals into a single HTML email
 * that lands in the user's inbox before their day starts.
 *
 * The CRM dashboard already shows all of this; the brief exists so
 * Jennifer doesn't have to open the app to start her day. Pure data +
 * render: the worker task glues it to a Gmail draft.
 */

import { prisma } from "@/lib/prisma";
import { getUpcomingEvents, type UpcomingEvent } from "@/lib/calendar";

// ─── Types ──────────────────────────────────────────────────

export interface BriefPriority {
  id: string;
  contactName: string;
  company: string | null;
  channel: string;
  tier: string;
  priorityScore: number;
  surfacedReason: string | null;
  triggerAt: string;
  inboxUrl: string;
}

export interface BriefMeeting {
  id: string;
  title: string;
  startTime: string;
  endTime: string | null;
  attendees: Array<{ name: string; email: string; contactId: string | null }>;
  prepUrl: string;
  htmlLink: string | null;
}

export interface BriefSignal {
  id: string;
  contactId: string;
  contactName: string;
  detail: string;
  url: string | null;
  detectedAt: string;
  contactUrl: string;
}

/**
 * "Thinking" preamble counts (M9.2 task 3) — what the system
 * considered when building the brief. Surfaced as a single calm
 * sentence at the top so Jennifer can trust the curation: she sees
 * what was scanned, not just what was selected.
 */
export interface BriefConsideredCounts {
  emailsScanned: number;
  meetingsScanned: number;
  signalsScanned: number;
  observationsScanned: number;
}

export interface MorningBriefData {
  userId: string;
  userName: string;
  userEmail: string;
  /** YYYY-MM-DD in the user's local-ish frame (UTC fallback). */
  forDate: string;
  /** Pretty version for the heading ("Monday · May 25"). */
  forDatePretty: string;
  appBaseUrl: string;
  priorities: BriefPriority[];
  meetings: BriefMeeting[];
  overnightSignals: BriefSignal[];
  considered: BriefConsideredCounts;
}

// ─── Data assembly ──────────────────────────────────────────

const MAX_PRIORITIES = 5;
const SIGNAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Pull all the brief inputs in parallel. Each loader handles its own
 * failure mode (returns empty rather than throwing) so one upstream
 * outage doesn't suppress the whole email.
 */
export async function gatherMorningBrief(
  userId: string,
  appBaseUrl: string,
  now: Date = new Date(),
): Promise<MorningBriefData | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  if (!user?.email) return null;

  const forDate = isoDate(now);
  const forDatePretty = prettyDate(now);

  const [priorities, meetings, signals, considered] = await Promise.all([
    loadPriorities(userId, appBaseUrl).catch(() => []),
    loadTodaysMeetings(userId, appBaseUrl, now).catch(() => []),
    loadOvernightSignals(userId, appBaseUrl, now).catch(() => []),
    loadConsideredCounts(userId, now).catch(
      () =>
        ({
          emailsScanned: 0,
          meetingsScanned: 0,
          signalsScanned: 0,
          observationsScanned: 0,
        }) satisfies BriefConsideredCounts,
    ),
  ]);

  return {
    userId,
    userName: user.name ?? user.email.split("@")[0],
    userEmail: user.email,
    forDate,
    forDatePretty,
    appBaseUrl,
    priorities,
    meetings,
    overnightSignals: signals,
    considered,
  };
}

/**
 * Count what the system looked at over the past 24h. These are the
 * inputs the brief was built from — surfacing them in the preamble
 * lets Jennifer trust the curation rather than wondering what was
 * filtered out.
 */
async function loadConsideredCounts(
  userId: string,
  now: Date,
): Promise<BriefConsideredCounts> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const endOfTomorrow = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const [emails, meetings, signals, observations] = await Promise.all([
    prisma.emailMessage.count({
      where: { userId, occurredAt: { gte: since } },
    }),
    // Calendar events go through Interaction with type=MEETING; same
    // window we use for "today's meetings" in the brief itself.
    prisma.interaction.count({
      where: {
        userId,
        type: "MEETING",
        occurredAt: { gte: since, lt: endOfTomorrow },
      },
    }),
    prisma.contactChangelog.count({
      where: { userId, detectedAt: { gte: since } },
    }),
    prisma.assistantObservation.count({
      where: { userId, createdAt: { gte: since } },
    }),
  ]);

  return {
    emailsScanned: emails,
    meetingsScanned: meetings,
    signalsScanned: signals,
    observationsScanned: observations,
  };
}

async function loadPriorities(
  userId: string,
  appBaseUrl: string,
): Promise<BriefPriority[]> {
  const items = await prisma.inboxItem.findMany({
    where: { userId, status: "OPEN" },
    orderBy: [{ priorityScore: "desc" }, { triggerAt: "desc" }],
    take: MAX_PRIORITIES,
    select: {
      id: true,
      contactName: true,
      company: true,
      channel: true,
      tier: true,
      priorityScore: true,
      surfacedReason: true,
      triggerAt: true,
    },
  });
  return items.map((i) => ({
    id: i.id,
    contactName: i.contactName,
    company: i.company,
    channel: i.channel,
    tier: i.tier,
    priorityScore: i.priorityScore ?? 0,
    surfacedReason: i.surfacedReason,
    triggerAt: i.triggerAt.toISOString(),
    inboxUrl: `${appBaseUrl}/dashboard?inboxItem=${i.id}`,
  }));
}

async function loadTodaysMeetings(
  userId: string,
  appBaseUrl: string,
  now: Date,
): Promise<BriefMeeting[]> {
  // getUpcomingEvents returns the next N days; we filter to "today" by date.
  const events = await getUpcomingEvents(userId, 1);
  const today = isoDate(now);
  return events
    .filter((e) => isoDate(new Date(e.startTime)) === today)
    .map((e) => toBriefMeeting(e, appBaseUrl));
}

function toBriefMeeting(e: UpcomingEvent, appBaseUrl: string): BriefMeeting {
  return {
    id: e.id,
    title: e.title,
    startTime: e.startTime,
    endTime: e.endTime,
    attendees: e.attendees.map((a) => ({
      name: a.name ?? a.email,
      email: a.email,
      contactId: a.contactId,
    })),
    prepUrl: `${appBaseUrl}/meetings/${encodeURIComponent(e.id)}/prep`,
    htmlLink: e.htmlLink,
  };
}

async function loadOvernightSignals(
  userId: string,
  appBaseUrl: string,
  now: Date,
): Promise<BriefSignal[]> {
  const since = new Date(now.getTime() - SIGNAL_WINDOW_MS);
  // For NEWS_MENTION (written by signal-detection): oldValue holds the
  // article title, newValue holds the URL. See worker/tasks/signal-detection.ts.
  const rows = await prisma.contactChangelog.findMany({
    where: {
      userId,
      type: "NEWS_MENTION",
      detectedAt: { gte: since },
    },
    orderBy: { detectedAt: "desc" },
    take: 5,
    include: {
      contact: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    contactId: r.contactId,
    contactName: r.contact?.name ?? "Unknown",
    detail: r.oldValue ?? "Mention detected",
    url: r.newValue,
    detectedAt: r.detectedAt.toISOString(),
    contactUrl: `${appBaseUrl}/people?contact=${r.contactId}`,
  }));
}

// ─── Render: HTML ───────────────────────────────────────────

/**
 * Render the brief to an HTML email body. Inline styles only — Gmail
 * strips <style> blocks. Single-column layout for predictable rendering
 * across mail clients.
 */
export function renderBriefHtml(d: MorningBriefData): string {
  const sections: string[] = [];
  sections.push(renderHeader(d));
  const preamble = renderThinkingPreamble(d.considered);
  if (preamble) sections.push(preamble);
  sections.push(renderPriorities(d));
  sections.push(renderMeetings(d));
  if (d.overnightSignals.length > 0) sections.push(renderSignals(d.overnightSignals));
  sections.push(renderFooter(d));

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917">
<div style="max-width:600px;margin:0 auto;padding:32px 24px">
${sections.join("\n")}
</div></body></html>`;
}

function renderHeader(d: MorningBriefData): string {
  const greeting = `Good morning, ${escape(firstName(d.userName))}`;
  return `<div style="margin-bottom:24px">
  <div style="font-size:13px;color:#78716c;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:6px">${escape(d.forDatePretty)}</div>
  <div style="font-size:28px;font-weight:600;line-height:1.2">${escape(greeting)}</div>
</div>`;
}

/**
 * "Thinking" preamble — small italic line that sits between the
 * greeting and the priorities block. Returns null when there's
 * nothing to say (all counts zero) so we don't render an empty
 * sentence.
 */
function renderThinkingPreamble(c: BriefConsideredCounts): string | null {
  const sentence = formatConsideredSentence(c);
  if (!sentence) return null;
  return `<div style="margin-bottom:20px;padding:10px 14px;background:#fafaf9;border-radius:8px;border-left:3px solid #d6d3d1">
  <div style="font-size:13px;color:#57534e;font-style:italic;line-height:1.5">${escape(sentence)}</div>
</div>`;
}

/**
 * Pure sentence builder — exported for testing. Honors English
 * pluralization, joins with commas + Oxford "and". Returns empty
 * string when nothing was scanned (the brief is mostly informational
 * in that case; no point pretending we did work).
 */
export function formatConsideredSentence(c: BriefConsideredCounts): string {
  const parts: string[] = [];
  if (c.emailsScanned > 0) {
    parts.push(`${c.emailsScanned} new email${c.emailsScanned === 1 ? "" : "s"}`);
  }
  if (c.meetingsScanned > 0) {
    parts.push(
      `${c.meetingsScanned} calendar event${c.meetingsScanned === 1 ? "" : "s"}`,
    );
  }
  if (c.signalsScanned > 0) {
    parts.push(
      `${c.signalsScanned} new signal${c.signalsScanned === 1 ? "" : "s"} from your network`,
    );
  }
  if (c.observationsScanned > 0) {
    parts.push(
      `${c.observationsScanned} observation${c.observationsScanned === 1 ? "" : "s"} from yesterday`,
    );
  }
  if (parts.length === 0) return "";
  // Oxford comma join: ["a", "b", "c"] → "a, b, and c"
  let joined: string;
  if (parts.length === 1) joined = parts[0];
  else if (parts.length === 2) joined = `${parts[0]} and ${parts[1]}`;
  else
    joined = `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `Looked at ${joined}. Here's what stood out.`;
}

function renderPriorities(d: MorningBriefData): string {
  if (d.priorities.length === 0) {
    return sectionWrapper(
      "Awaiting your reply",
      `<div style="color:#78716c;font-size:14px">Inbox zero — no one is waiting on you.</div>`,
    );
  }
  const rows = d.priorities
    .map((p) => {
      const meta = [p.tier === "INNER_CIRCLE" ? "Inner circle" : titleCase(p.tier), p.channel, p.company]
        .filter(Boolean)
        .join(" · ");
      return `<a href="${escape(p.inboxUrl)}" style="display:block;padding:12px 14px;margin-bottom:8px;background:white;border:1px solid #e7e5e4;border-radius:8px;text-decoration:none;color:inherit">
  <div style="display:flex;justify-content:space-between;gap:12px">
    <div style="font-weight:600;font-size:15px">${escape(p.contactName)}</div>
    <div style="font-size:12px;color:#a8a29e;white-space:nowrap">${relativeTime(new Date(p.triggerAt))}</div>
  </div>
  <div style="font-size:13px;color:#57534e;margin-top:2px">${escape(meta)}</div>
  ${p.surfacedReason ? `<div style="font-size:12px;color:#78716c;margin-top:6px;font-style:italic">${escape(p.surfacedReason)}</div>` : ""}
</a>`;
    })
    .join("\n");
  return sectionWrapper("Awaiting your reply", rows);
}

function renderMeetings(d: MorningBriefData): string {
  if (d.meetings.length === 0) {
    return sectionWrapper(
      "Today's calendar",
      `<div style="color:#78716c;font-size:14px">No meetings on the calendar — protect the time.</div>`,
    );
  }
  const rows = d.meetings
    .map((m) => {
      const time = formatMeetingTime(m.startTime, m.endTime);
      const attendeeText =
        m.attendees.length > 0
          ? `with ${m.attendees.map((a) => escape(a.name)).join(", ")}`
          : "no other attendees";
      return `<div style="padding:12px 14px;margin-bottom:8px;background:white;border:1px solid #e7e5e4;border-radius:8px">
  <div style="display:flex;justify-content:space-between;gap:12px">
    <div style="font-weight:600;font-size:15px">${escape(m.title)}</div>
    <div style="font-size:12px;color:#a8a29e;white-space:nowrap">${escape(time)}</div>
  </div>
  <div style="font-size:13px;color:#57534e;margin-top:2px">${attendeeText}</div>
  <div style="margin-top:8px">
    <a href="${escape(m.prepUrl)}" style="font-size:13px;color:#0369a1;text-decoration:none">Meeting prep →</a>
  </div>
</div>`;
    })
    .join("\n");
  return sectionWrapper("Today's calendar", rows);
}

function renderSignals(signals: BriefSignal[]): string {
  const rows = signals
    .map(
      (s) => `<div style="padding:12px 14px;margin-bottom:8px;background:white;border:1px solid #e7e5e4;border-radius:8px">
  <div style="font-weight:600;font-size:15px"><a href="${escape(s.contactUrl)}" style="color:inherit;text-decoration:none">${escape(s.contactName)}</a></div>
  <div style="font-size:13px;color:#57534e;margin-top:4px">${escape(s.detail)}</div>
  ${s.url ? `<div style="margin-top:6px"><a href="${escape(s.url)}" style="font-size:12px;color:#0369a1;text-decoration:none">Source →</a></div>` : ""}
</div>`,
    )
    .join("\n");
  return sectionWrapper("Overnight signals", rows);
}

function renderFooter(d: MorningBriefData): string {
  return `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e7e5e4;font-size:12px;color:#a8a29e">
  <a href="${escape(d.appBaseUrl)}/dashboard" style="color:#78716c;text-decoration:none">Open dashboard →</a>
</div>`;
}

function sectionWrapper(title: string, inner: string): string {
  return `<div style="margin-bottom:28px">
  <div style="font-size:13px;color:#78716c;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:10px;font-weight:600">${escape(title)}</div>
  ${inner}
</div>`;
}

// ─── Render: plain text ─────────────────────────────────────

/**
 * Plain-text fallback for clients that don't render HTML. Mirrors the
 * HTML structure but is happily skim-able as text.
 */
export function renderBriefText(d: MorningBriefData): string {
  const lines: string[] = [];
  lines.push(`${d.forDatePretty}`);
  lines.push(`Good morning, ${firstName(d.userName)}.`);
  lines.push("");
  const preamble = formatConsideredSentence(d.considered);
  if (preamble) {
    lines.push(preamble);
    lines.push("");
  }
  lines.push("AWAITING YOUR REPLY");
  if (d.priorities.length === 0) {
    lines.push("  (inbox zero)");
  } else {
    for (const p of d.priorities) {
      lines.push(`  • ${p.contactName}${p.company ? ` — ${p.company}` : ""}`);
      if (p.surfacedReason) lines.push(`    ${p.surfacedReason}`);
      lines.push(`    ${p.inboxUrl}`);
    }
  }
  lines.push("");
  lines.push("TODAY'S CALENDAR");
  if (d.meetings.length === 0) {
    lines.push("  (no meetings)");
  } else {
    for (const m of d.meetings) {
      lines.push(
        `  • ${formatMeetingTime(m.startTime, m.endTime)} — ${m.title}`,
      );
      if (m.attendees.length > 0) {
        lines.push(`    with ${m.attendees.map((a) => a.name).join(", ")}`);
      }
      lines.push(`    Prep: ${m.prepUrl}`);
    }
  }
  if (d.overnightSignals.length > 0) {
    lines.push("");
    lines.push("OVERNIGHT SIGNALS");
    for (const s of d.overnightSignals) {
      lines.push(`  • ${s.contactName}: ${s.detail}`);
      if (s.url) lines.push(`    ${s.url}`);
    }
  }
  lines.push("");
  lines.push(`Dashboard: ${d.appBaseUrl}/dashboard`);
  return lines.join("\n");
}

// ─── Subject line ───────────────────────────────────────────

export function buildBriefSubject(d: MorningBriefData): string {
  const headline = headlineFor(d);
  return `[ProfessorCRM] ${d.forDatePretty} — ${headline}`;
}

function headlineFor(d: MorningBriefData): string {
  const parts: string[] = [];
  if (d.priorities.length > 0) {
    parts.push(`${d.priorities.length} awaiting reply`);
  }
  if (d.meetings.length > 0) {
    parts.push(`${d.meetings.length} meeting${d.meetings.length === 1 ? "" : "s"}`);
  }
  if (d.overnightSignals.length > 0) {
    parts.push(`${d.overnightSignals.length} signal${d.overnightSignals.length === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return "all quiet";
  return parts.join(" · ");
}

// ─── Helpers ────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function prettyDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function relativeTime(then: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - then.getTime();
  const diffHrs = Math.floor(diffMs / (60 * 60 * 1000));
  if (diffHrs < 1) return "just now";
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const days = Math.floor(diffHrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMeetingTime(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  const startFmt = start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  if (!endIso) return startFmt;
  const end = new Date(endIso);
  const endFmt = end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${startFmt} – ${endFmt}`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
