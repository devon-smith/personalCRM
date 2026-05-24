import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUpcomingEvents } from "@/lib/calendar";
import { buildMeetingPrep } from "@/lib/meeting-prep";

/**
 * GET /api/meetings/[eventId]/prep
 *
 * Returns the full meeting prep dossier for a calendar event:
 * each known attendee's CRM history, scholarly activity, and (in
 * Commit B) recent web mentions.
 *
 * Pulls the event from the user's upcoming-events window so we don't
 * need a separate event lookup endpoint. If the eventId isn't in the
 * upcoming window the response is 404.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 30-day window covers most prep cases. Could be widened if needed.
  let events;
  try {
    events = await getUpcomingEvents(session.user.id, 30);
  } catch {
    return NextResponse.json({ error: "Calendar not connected" }, { status: 503 });
  }

  const event = events.find((e) => e.id === eventId);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const attendeeEmails = event.attendees
    .map((a) => a.email)
    .filter((e): e is string => !!e);

  const dossier = await buildMeetingPrep(
    session.user.id,
    eventId,
    attendeeEmails,
  );

  return NextResponse.json({
    eventTitle: event.title,
    eventStartTime: event.startTime,
    eventEndTime: event.endTime,
    eventHtmlLink: event.htmlLink,
    unknownAttendeeEmails: attendeeEmails.filter(
      (e) => !dossier.attendees.some((a) => a.email?.toLowerCase() === e.toLowerCase()),
    ),
    ...dossier,
  });
}
