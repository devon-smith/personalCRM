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

  try {
    const dossier = await buildMeetingPrep(
      session.user.id,
      eventId,
      attendeeEmails,
    );

    return NextResponse.json({
      eventTitle: event.title,
      eventDescription: event.description,
      eventLocation: event.location,
      eventStartTime: event.startTime,
      eventEndTime: event.endTime,
      eventHtmlLink: event.htmlLink,
      eventPrep: event.prep,
      unknownAttendeeEmails: attendeeEmails.filter(
        (e) => !dossier.attendees.some((a) => a.email?.toLowerCase() === e.toLowerCase()),
      ),
      ...dossier,
    });
  } catch (err) {
    // Surface the real error so the UI can render something useful
    // instead of an opaque "Prep failed (500)". buildMeetingPrep
    // catches per-attendee errors internally; a thrown error here
    // means something is broken at the top level (DB / OpenAlex
    // outside the per-attendee try blocks / Voyage / etc.).
    console.error("[GET /api/meetings/[eventId]/prep]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Prep failed: ${message.slice(0, 300)}` },
      { status: 500 },
    );
  }
}
