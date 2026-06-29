import { describe, expect, it } from "vitest";
import { buildContactPrepSummary } from "@/lib/contact-prep-summary";

describe("buildContactPrepSummary", () => {
  it("prioritizes role, relationship context, themes, and open loops", () => {
    const summary = buildContactPrepSummary({
      name: "Priya Anand",
      company: "Stanford",
      role: "Professor",
      profile: {
        expertiseAreas: ["behavioral science", "AI"],
        relationshipStage: "peer",
      },
      memory: {
        recurringThemes: ["research", "teaching"],
        openThreads: [
          { subject: "send draft syllabus", status: "open" },
          { subject: "resolved item", status: "resolved" },
        ],
        theyMentioned: [{ subject: "daughter applying to college" }],
      },
      recentInteractions: [],
    });

    expect(summary).toContain("Priya Anand is Professor at Stanford");
    expect(summary).toContain("relationship stage: peer");
    expect(summary).toContain("Recurring themes: research, teaching");
    expect(summary).toContain("Open loops to acknowledge: send draft syllabus");
    expect(summary).not.toContain("resolved item");
  });

  it("falls back to recent interaction context when memory is empty", () => {
    const summary = buildContactPrepSummary({
      name: "Marcus Reyes",
      company: null,
      role: null,
      profile: null,
      memory: null,
      recentInteractions: [
        {
          type: "EMAIL",
          direction: "INBOUND",
          subject: "Grant timeline",
          summary: "Asked about the July submission deadline",
          occurredAt: new Date("2026-06-25T12:00:00Z"),
        },
      ],
    });

    expect(summary).toContain("Marcus Reyes.");
    expect(summary).toContain("Most recent touchpoint was");
    expect(summary).toContain("Asked about the July submission deadline");
  });
});
