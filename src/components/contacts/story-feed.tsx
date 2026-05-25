"use client";

import * as React from "react";
import { Mail, MessageSquare, Users, Phone, StickyNote, BookOpen } from "lucide-react";
import { formatDistanceToNow } from "@/lib/date-utils";

/**
 * Story = chronological feed merging interactions (Email, Message,
 * Meeting, Call, Note) with private journal entries. Replaces the
 * separate Timeline + Journal tabs.
 *
 * The visual treatment leans on the warm palette: each row is a
 * soft border on the Mist surface (the contact panel's background).
 * Journal entries are visually distinct via a mood-colored side
 * accent so they don't fight the interaction rows.
 */

interface InteractionLite {
  id: string;
  type: string;
  direction: string;
  channel: string | null;
  subject: string | null;
  summary: string | null;
  occurredAt: Date | string;
}

interface JournalEntryLite {
  id: string;
  content: string;
  mood: string;
  createdAt: Date | string;
}

interface StoryFeedProps {
  interactions: InteractionLite[];
  journal: JournalEntryLite[];
  /** Renderable content (voice recorder, journal add form) pinned at top. */
  composer?: React.ReactNode;
  onJournalDelete?: (id: string) => void;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  EMAIL: Mail,
  MESSAGE: MessageSquare,
  MEETING: Users,
  CALL: Phone,
  NOTE: StickyNote,
};

const TYPE_LABELS: Record<string, string> = {
  EMAIL: "Email",
  MESSAGE: "Message",
  MEETING: "Meeting",
  CALL: "Call",
  NOTE: "Note",
};

const DIRECTION_LABELS: Record<string, string> = {
  INBOUND: "Received",
  OUTBOUND: "Sent",
};

const MOOD_ACCENT: Record<string, string> = {
  POSITIVE: "#6B8A6E",
  NEUTRAL: "#5A574F",
  CONCERN: "#7A4F3C",
};

type FeedItem =
  | { kind: "interaction"; at: Date; data: InteractionLite }
  | { kind: "journal"; at: Date; data: JournalEntryLite };

export function StoryFeed({
  interactions,
  journal,
  composer,
  onJournalDelete,
}: StoryFeedProps) {
  const feed = React.useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [
      ...interactions.map((i) => ({
        kind: "interaction" as const,
        at: new Date(i.occurredAt),
        data: i,
      })),
      ...journal.map((j) => ({
        kind: "journal" as const,
        at: new Date(j.createdAt),
        data: j,
      })),
    ];
    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    return items;
  }, [interactions, journal]);

  return (
    <div className="pt-2">
      {composer ? <div className="mb-4">{composer}</div> : null}
      {feed.length === 0 ? (
        <p className="py-8 text-center text-[13px]" style={{ color: "#8C8A82" }}>
          Nothing in the story yet. Add a note or sync your inbox to start.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {feed.map((item) =>
            item.kind === "interaction" ? (
              <InteractionRow key={`i-${item.data.id}`} interaction={item.data} />
            ) : (
              <JournalRow
                key={`j-${item.data.id}`}
                entry={item.data}
                onDelete={onJournalDelete}
              />
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function InteractionRow({ interaction }: { interaction: InteractionLite }) {
  const Icon = TYPE_ICONS[interaction.type] ?? StickyNote;
  return (
    <li
      className="flex gap-3 rounded-2xl p-3"
      style={{ backgroundColor: "#EEEAE2", border: "1px solid #ECE7D9" }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: "#F1ECDE", color: "#5A574F" }}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "#8C8A82" }}>
          <span className="font-medium" style={{ color: "#5A574F" }}>
            {TYPE_LABELS[interaction.type] ?? interaction.type}
          </span>
          <span>·</span>
          <span>{DIRECTION_LABELS[interaction.direction] ?? interaction.direction}</span>
          {interaction.channel ? (
            <>
              <span>·</span>
              <span>{interaction.channel}</span>
            </>
          ) : null}
          <span className="ml-auto tabular-nums">
            {formatDistanceToNow(new Date(interaction.occurredAt))}
          </span>
        </div>
        {interaction.subject ? (
          <p className="mt-1 text-[13px] font-medium" style={{ color: "#1B1A17" }}>
            {interaction.subject}
          </p>
        ) : null}
        {interaction.summary ? (
          <p className="mt-0.5 text-[13px]" style={{ color: "#5A574F" }}>
            {interaction.summary}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function JournalRow({
  entry,
  onDelete,
}: {
  entry: JournalEntryLite;
  onDelete?: (id: string) => void;
}) {
  const accent = MOOD_ACCENT[entry.mood] ?? MOOD_ACCENT.NEUTRAL;
  return (
    <li
      className="group flex gap-3 rounded-2xl p-3"
      style={{
        backgroundColor: "#F1ECDE",
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: "#EFEAE0", color: accent }}
      >
        <BookOpen className="h-3.5 w-3.5" strokeWidth={1.7} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "#8C8A82" }}>
          <span className="font-medium" style={{ color: accent }}>
            Journal
          </span>
          <span className="ml-auto tabular-nums">
            {formatDistanceToNow(new Date(entry.createdAt))}
          </span>
        </div>
        <p
          className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap"
          style={{ color: "#1B1A17" }}
        >
          {entry.content}
        </p>
      </div>
      {onDelete ? (
        <button
          onClick={() => onDelete(entry.id)}
          className="self-start opacity-0 group-hover:opacity-100 transition-opacity text-[11px] font-medium"
          style={{ color: "#8C8A82" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#7A4F3C";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#8C8A82";
          }}
          aria-label="Delete entry"
        >
          ×
        </button>
      ) : null}
    </li>
  );
}
