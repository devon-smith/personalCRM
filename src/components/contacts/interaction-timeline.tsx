"use client";

import { Mail, MessageSquare, Users, Phone, StickyNote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "@/lib/date-utils";
import type { Interaction } from "@/generated/prisma/client";

const typeIcons: Record<string, React.ElementType> = {
  EMAIL: Mail,
  MESSAGE: MessageSquare,
  MEETING: Users,
  CALL: Phone,
  NOTE: StickyNote,
};

const typeLabels: Record<string, string> = {
  EMAIL: "Email",
  MESSAGE: "Message",
  MEETING: "Meeting",
  CALL: "Call",
  NOTE: "Note",
};

const directionLabels: Record<string, string> = {
  INBOUND: "Received",
  OUTBOUND: "Sent",
};

interface InteractionTimelineProps {
  interactions: Interaction[];
}

export function InteractionTimeline({ interactions }: InteractionTimelineProps) {
  if (interactions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No interactions yet
      </p>
    );
  }

  return (
    <div className="space-y-3 pt-2">
      {interactions.map((interaction) => {
        const Icon = typeIcons[interaction.type] ?? StickyNote;
        return (
          <div
            key={interaction.id}
            className="flex gap-3 rounded-lg border border-gray-100 p-3"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100">
              <Icon className="h-4 w-4 text-gray-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {typeLabels[interaction.type]}
                </Badge>
                <span className="text-xs text-gray-400">
                  {directionLabels[interaction.direction]}
                </span>
                {interaction.channel && (
                  <span className="text-xs text-gray-400">
                    via {interaction.channel}
                  </span>
                )}
              </div>
              {interaction.subject && (
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {interaction.subject}
                </p>
              )}
              {interaction.summary && (
                <p className="mt-0.5 text-sm text-gray-600">
                  {interaction.summary}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                {formatDistanceToNow(new Date(interaction.occurredAt))}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
