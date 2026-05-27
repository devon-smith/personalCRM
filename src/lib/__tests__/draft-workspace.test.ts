import { describe, it, expect } from "vitest";
import {
  parseVersions,
  parseChat,
  currentVersion,
  nextVersionNumber,
  type WorkspaceVersion,
} from "@/lib/drafts/workspace-types";
import {
  parseRefinementResponse,
  buildRefinementUserPrompt,
  type RefineRunArgs,
} from "@/lib/drafts/refine";
import {
  parseVariantsResponse,
  buildVariantsUserPrompt,
} from "@/lib/drafts/variants";

describe("parseVersions", () => {
  it("returns [] for non-arrays", () => {
    expect(parseVersions(null)).toEqual([]);
    expect(parseVersions({})).toEqual([]);
    expect(parseVersions("not an array")).toEqual([]);
  });

  it("filters out malformed entries", () => {
    const out = parseVersions([
      { version: 1, content: "ok", source: "initial" },
      { version: "bad", content: "x" }, // bad version
      null,
      { content: "no version" }, // missing version
      { version: 2, content: "ok2" },
    ]);
    expect(out.map((v) => v.version)).toEqual([1, 2]);
  });

  it("sorts by version ascending", () => {
    const out = parseVersions([
      { version: 3, content: "c" },
      { version: 1, content: "a" },
      { version: 2, content: "b" },
    ]);
    expect(out.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("defaults source to 'refinement' when missing/invalid", () => {
    const out = parseVersions([
      { version: 1, content: "x" },
      { version: 2, content: "y", source: "bogus" },
    ]);
    expect(out[0].source).toBe("refinement");
    expect(out[1].source).toBe("refinement");
  });
});

describe("parseChat", () => {
  it("filters non-user/assistant roles", () => {
    const out = parseChat([
      { role: "user", content: "a", timestamp: "t1" },
      { role: "system", content: "b" },
      { role: "assistant", content: "c", timestamp: "t2", versionId: 5 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].versionId).toBe(5);
  });

  it("falls back to now() when timestamp missing", () => {
    const before = Date.now();
    const out = parseChat([{ role: "user", content: "x" }]);
    const after = Date.now();
    const ts = new Date(out[0].timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe("currentVersion / nextVersionNumber", () => {
  function v(n: number): WorkspaceVersion {
    return {
      version: n,
      content: `v${n}`,
      subjectLine: null,
      generatedAt: new Date(0).toISOString(),
      sourceRequest: "test",
      source: "refinement",
    };
  }
  it("currentVersion returns the highest", () => {
    expect(currentVersion([v(1), v(2), v(3)])?.version).toBe(3);
  });
  it("currentVersion null on empty", () => {
    expect(currentVersion([])).toBeNull();
  });
  it("nextVersionNumber is 1 on empty", () => {
    expect(nextVersionNumber([])).toBe(1);
  });
  it("nextVersionNumber is max+1", () => {
    expect(nextVersionNumber([v(1), v(3), v(2)])).toBe(4);
  });
});

describe("parseRefinementResponse", () => {
  it("parses a clean single-line JSON response", () => {
    const out = parseRefinementResponse(
      '{"content":"Hey Marc — thanks for sending the draft. I can review by Friday.","subjectLine":"Re: paper","note":"Tightened the opening and removed two filler lines."}',
    );
    expect(out?.content).toContain("Hey Marc");
    expect(out?.subjectLine).toBe("Re: paper");
    expect(out?.note).toContain("Tightened");
  });

  it("tolerates fenced markdown blocks", () => {
    const out = parseRefinementResponse(
      '```json\n{"content":"Hello","subjectLine":null,"note":"Trimmed."}\n```',
    );
    expect(out?.content).toBe("Hello");
    expect(out?.subjectLine).toBeNull();
  });

  it("tolerates trailing prose", () => {
    const out = parseRefinementResponse(
      '{"content":"X","subjectLine":null,"note":"y"} \n\n And that\'s the change!',
    );
    expect(out?.content).toBe("X");
  });

  it("returns null when content is missing", () => {
    expect(parseRefinementResponse('{"note":"only"}')).toBeNull();
  });

  it("returns null on garbage", () => {
    expect(parseRefinementResponse("no json here")).toBeNull();
  });

  it("defaults note when empty", () => {
    const out = parseRefinementResponse(
      '{"content":"X","subjectLine":null,"note":""}',
    );
    expect(out?.note).toBe("Updated the draft.");
  });
});

describe("buildRefinementUserPrompt", () => {
  function baseArgs(): RefineRunArgs {
    return {
      currentDraft: "Hey Marc, sending the draft over.",
      currentSubjectLine: "Re: paper",
      userRequest: "Make it warmer",
      chatHistory: [],
      priorVersions: [
        {
          version: 1,
          content: "v1",
          subjectLine: null,
          generatedAt: new Date(0).toISOString(),
          sourceRequest: "initial",
          source: "initial",
        },
      ],
      context: {
        recipientFirstName: "Marc",
        recipientFullName: "Marc Beban",
        recipientEmail: "marc@example.com",
        relationshipType: "former_student",
        memorySummary: "",
        replyContext: null,
        references: [],
        userInstructions: null,
      },
    };
  }

  it("includes recipient + relationship type", () => {
    const out = buildRefinementUserPrompt(baseArgs());
    expect(out).toContain("Marc Beban");
    expect(out).toContain("former_student");
  });

  it("includes the current draft + version number", () => {
    const out = buildRefinementUserPrompt(baseArgs());
    expect(out).toContain("Hey Marc, sending the draft over");
    expect(out).toContain("version 1");
  });

  it("includes the user's request", () => {
    const out = buildRefinementUserPrompt(baseArgs());
    expect(out).toContain("Make it warmer");
  });

  it("includes the inbound message when replyContext present", () => {
    const base = baseArgs();
    const args: RefineRunArgs = {
      ...base,
      context: {
        ...base.context,
        replyContext: {
          latestInbound: {
            fromEmail: "marc@example.com",
            fromName: "Marc",
            subject: "Quick ask",
            body: "Could you review section 3 by Friday?",
            bodyIsFull: true,
            occurredAt: new Date(),
          },
          threadHistory: [],
        },
      },
    };
    const out = buildRefinementUserPrompt(args);
    expect(out).toContain("THEY WROTE");
    expect(out).toContain("section 3 by Friday");
  });

  it("includes voice references when present", () => {
    const base = baseArgs();
    const args: RefineRunArgs = {
      ...base,
      context: {
        ...base.context,
        references: [
          {
            id: "r1",
            filename: "humor-helper.md",
            sourceType: "gpt_knowledge_base",
            content: "...",
            guidance: {
              greetings: [],
              closings: [],
              signaturePhrases: [],
              avoidPhrases: [],
              toneNotes: "Warm + dry humor.",
            },
          },
        ],
      },
    };
    const out = buildRefinementUserPrompt(args);
    expect(out).toContain("humor-helper.md");
    expect(out).toContain("Warm + dry humor");
  });

  it("includes last 6 chat turns when chat history grows", () => {
    const args: RefineRunArgs = {
      ...baseArgs(),
      chatHistory: Array.from({ length: 10 }, (_, i) => ({
        role: "user" as const,
        content: `request ${i}`,
        timestamp: new Date(0).toISOString(),
      })),
    };
    const out = buildRefinementUserPrompt(args);
    // First 4 should be dropped, last 6 kept.
    expect(out).not.toContain("request 0");
    expect(out).not.toContain("request 3");
    expect(out).toContain("request 4");
    expect(out).toContain("request 9");
  });
});

describe("parseVariantsResponse", () => {
  it("parses three valid variants", () => {
    const json = JSON.stringify({
      variants: [
        {
          label: "shorter_direct",
          content: "Marc — short",
          subjectLine: "Re: paper",
        },
        {
          label: "warmer_personal",
          content: "Hey Marc, warm hello",
          subjectLine: null,
        },
        {
          label: "with_humor",
          content: "Marc, with a touch of dry humor",
          subjectLine: null,
        },
      ],
    });
    const out = parseVariantsResponse(json);
    expect(out).toHaveLength(3);
    expect(out.map((v) => v.label)).toEqual([
      "shorter_direct",
      "warmer_personal",
      "with_humor",
    ]);
    expect(out[0].title).toMatch(/Shorter/);
  });

  it("filters out unknown labels", () => {
    const out = parseVariantsResponse(
      JSON.stringify({
        variants: [
          { label: "bogus", content: "x", subjectLine: null },
          { label: "shorter_direct", content: "y", subjectLine: null },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("shorter_direct");
  });

  it("returns [] on malformed JSON", () => {
    expect(parseVariantsResponse("not json")).toEqual([]);
  });

  it("returns [] when content is missing on each variant", () => {
    const out = parseVariantsResponse(
      JSON.stringify({
        variants: [{ label: "shorter_direct", subjectLine: null }],
      }),
    );
    expect(out).toEqual([]);
  });
});

describe("buildVariantsUserPrompt", () => {
  it("includes all three variant instructions", () => {
    const out = buildVariantsUserPrompt(
      "current draft",
      "subject",
      {
        recipientFirstName: "Marc",
        recipientFullName: "Marc B",
        recipientEmail: "m@x.com",
        relationshipType: "former_student",
        memorySummary: "",
        replyContext: null,
        references: [],
        userInstructions: null,
      },
    );
    expect(out).toContain("shorter_direct");
    expect(out).toContain("warmer_personal");
    expect(out).toContain("with_humor");
    expect(out).toContain("current draft");
  });
});
