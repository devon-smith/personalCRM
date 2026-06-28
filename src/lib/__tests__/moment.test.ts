import { describe, it, expect } from "vitest";
import { evaluateDayShape } from "@/lib/suggestions/moment";
import type { UpcomingEvent } from "@/lib/calendar";

function makeEvent(startHour: number, durationMin: number, title = "Meeting"): UpcomingEvent {
  const start = new Date();
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(start.getTime() + durationMin * 60_000);
  return {
    id: `e-${startHour}-${durationMin}`,
    title,
    description: null,
    location: null,
    allDay: false,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    organizer: null,
    attendees: [],
    prep: {
      knownAttendees: 0,
      unknownAttendees: 0,
      openThreads: 0,
      facts: 0,
      recentInteractions: 0,
      lastMetAt: null,
      summary: "No external attendees found on this event.",
    },
    htmlLink: null,
  };
}

describe("evaluateDayShape", () => {
  it("flags a totally empty day as light_day", () => {
    expect(evaluateDayShape([])).toBe("light_day");
  });

  it("flags a single short meeting as light_day", () => {
    expect(evaluateDayShape([makeEvent(10, 30)])).toBe("light_day");
  });

  it("returns null on a back-to-back packed day", () => {
    // 9am → 5pm fully booked in 1-hour blocks: no gaps anywhere, 8hr busy.
    const events = [
      makeEvent(9, 60),
      makeEvent(10, 60),
      makeEvent(11, 60),
      makeEvent(12, 60),
      makeEvent(13, 60),
      makeEvent(14, 60),
      makeEvent(15, 60),
      makeEvent(16, 60),
    ];
    expect(evaluateDayShape(events)).toBeNull();
  });

  it("flags gap_in_schedule when a 90+ min window exists between meetings", () => {
    // 9-10 busy, then free until 13:00, then 13-14 busy. 3hr gap.
    // Total busy = 2hr (above light-day floor doesn't help — actually it's
    // BELOW the 4hr threshold so it'd return light_day first). Bump the
    // busy time so we exercise the gap path specifically.
    const events = [
      makeEvent(9, 60),
      makeEvent(10, 60),
      makeEvent(11, 60),
      makeEvent(12, 60), // 4hr busy by noon
      // gap: 13:00 → 17:00 = 4 hours
      makeEvent(13, 0),  // zero-length (placeholder) to confirm no false-busy
    ];
    expect(evaluateDayShape(events)).toBe("gap_in_schedule");
  });

  it("counts only the 9-5 workday window (early-morning meetings don't count as busy)", () => {
    // 6am to 8am meeting = outside workday window, shouldn't push us over.
    const events = [
      makeEvent(6, 120),
      makeEvent(10, 30),
    ];
    expect(evaluateDayShape(events)).toBe("light_day");
  });

  it("treats a tail gap to end-of-workday as a gap", () => {
    // 9-13 packed, then 13 onwards free. 4hr tail gap.
    const events = [
      makeEvent(9, 60),
      makeEvent(10, 60),
      makeEvent(11, 60),
      makeEvent(12, 60),
    ];
    expect(evaluateDayShape(events)).toBe("gap_in_schedule");
  });
});
