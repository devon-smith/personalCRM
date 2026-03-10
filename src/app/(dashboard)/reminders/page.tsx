"use client";

import { useState } from "react";
import { Clock, AlertTriangle, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useReminders } from "@/lib/hooks/use-reminders";
import { LogInteractionDialog } from "@/components/contacts/log-interaction-dialog";
import { FollowUpDraftModal } from "@/components/contacts/follow-up-draft-modal";
import type { FollowUpContact } from "@/lib/types";
import Link from "next/link";

const tierColors: Record<string, string> = {
  INNER_CIRCLE: "bg-purple-100 text-purple-700",
  PROFESSIONAL: "bg-blue-100 text-blue-700",
  ACQUAINTANCE: "bg-gray-100 text-gray-700",
};

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export default function RemindersPage() {
  const { data, isLoading } = useReminders();
  const [logTarget, setLogTarget] = useState<{ id: string; name: string } | null>(null);
  const [draftTarget, setDraftTarget] = useState<{ id: string; name: string } | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading reminders...</p>
      </div>
    );
  }

  const overdue = data?.overdue ?? [];
  const upcoming = data?.upcoming ?? [];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Follow-Up Reminders</h1>

      {/* Overdue */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <h2 className="text-lg font-semibold text-red-700">
            Overdue ({overdue.length})
          </h2>
        </div>
        {overdue.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              You're all caught up! No overdue follow-ups.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {overdue.map((contact) => (
              <ReminderCard
                key={contact.id}
                contact={contact}
                variant="overdue"
                onLog={() => setLogTarget({ id: contact.id, name: contact.name })}
                onDraft={() => setDraftTarget({ id: contact.id, name: contact.name })}
              />
            ))}
          </div>
        )}
      </section>

      {/* Upcoming */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5 text-yellow-500" />
          <h2 className="text-lg font-semibold text-yellow-700">
            Coming Up ({upcoming.length})
          </h2>
        </div>
        {upcoming.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No follow-ups due in the next 7 days.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {upcoming.map((contact) => (
              <ReminderCard
                key={contact.id}
                contact={contact}
                variant="upcoming"
                onLog={() => setLogTarget({ id: contact.id, name: contact.name })}
                onDraft={() => setDraftTarget({ id: contact.id, name: contact.name })}
              />
            ))}
          </div>
        )}
      </section>

      {logTarget && (
        <LogInteractionDialog
          open={!!logTarget}
          onOpenChange={(open) => !open && setLogTarget(null)}
          contactId={logTarget.id}
          contactName={logTarget.name}
        />
      )}

      {draftTarget && (
        <FollowUpDraftModal
          open={!!draftTarget}
          onOpenChange={(open) => !open && setDraftTarget(null)}
          contactId={draftTarget.id}
          contactName={draftTarget.name}
        />
      )}
    </div>
  );
}

function ReminderCard({
  contact,
  variant,
  onLog,
  onDraft,
}: {
  contact: FollowUpContact;
  variant: "overdue" | "upcoming";
  onLog: () => void;
  onDraft: () => void;
}) {
  const isOverdue = variant === "overdue";

  return (
    <Card className={isOverdue ? "border-red-200" : "border-yellow-200"}>
      <CardContent className="flex items-center gap-4 py-4">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-blue-100 text-sm text-blue-700">
            {getInitials(contact.name)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/contacts`}
              className="font-medium text-gray-900 hover:underline"
            >
              {contact.name}
            </Link>
            <Badge variant="secondary" className={tierColors[contact.tier]}>
              {contact.tier.replace("_", " ")}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            {contact.company && <span>{contact.company}</span>}
            {contact.lastInteractionType && contact.lastInteractionSummary && (
              <span className="truncate">
                Last: {contact.lastInteractionType.toLowerCase()} — {contact.lastInteractionSummary}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className={`text-sm font-semibold ${isOverdue ? "text-red-600" : "text-yellow-600"}`}>
            {isOverdue
              ? `${contact.daysOverdue}d overdue`
              : `Due in ${Math.abs(contact.daysOverdue)}d`}
          </p>
          <p className="text-xs text-gray-400">
            Every {contact.cadenceDays}d
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={onDraft}>
            <Sparkles className="mr-1 h-3 w-3" />
            Draft
          </Button>
          <Button size="sm" variant="outline" onClick={onLog}>
            Log
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
