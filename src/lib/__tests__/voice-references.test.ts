import { describe, it, expect, vi } from "vitest";
import {
  detectExtension,
  normalizeWhitespace,
  extractText,
  UnsupportedReferenceError,
  MAX_REFERENCE_TEXT_BYTES,
} from "@/lib/voice/references/parser";
import { parseGuidanceResponse } from "@/lib/voice/references/guidance";
import { getVoiceReferences } from "@/lib/voice/references/retrieval";
import {
  buildReferencesBlock,
  buildVoiceBlock,
  hasVoiceContext,
  type VoiceReferenceForPrompt,
} from "@/lib/voice/draft-prompt";
import type { PrismaClient } from "@/generated/prisma/client";

describe("parser.detectExtension", () => {
  it("recognizes supported extensions", () => {
    expect(detectExtension("notes.txt")).toBe("txt");
    expect(detectExtension("guide.md")).toBe("md");
    expect(detectExtension("guide.markdown")).toBe("md");
    expect(detectExtension("Style.PDF")).toBe("pdf");
    expect(detectExtension("voice.docx")).toBe("docx");
  });

  it("throws on unsupported types", () => {
    expect(() => detectExtension("photo.jpg")).toThrow(
      UnsupportedReferenceError,
    );
    expect(() => detectExtension("noext")).toThrow(UnsupportedReferenceError);
  });
});

describe("parser.normalizeWhitespace", () => {
  it("collapses 3+ newlines to a single blank", () => {
    expect(normalizeWhitespace("a\n\n\n\nb")).toBe("a\n\nb");
  });
  it("collapses runs of spaces", () => {
    expect(normalizeWhitespace("a    b")).toBe("a b");
  });
  it("normalizes Windows newlines", () => {
    expect(normalizeWhitespace("a\r\nb")).toBe("a\nb");
  });
  it("trims leading/trailing whitespace", () => {
    expect(normalizeWhitespace("  hi  ")).toBe("hi");
  });
});

describe("parser.extractText (text + markdown)", () => {
  it("reads .txt as utf-8", async () => {
    const buf = Buffer.from("Hello, voice references!");
    const out = await extractText(buf, "notes.txt");
    expect(out.text).toBe("Hello, voice references!");
    expect(out.ext).toBe("txt");
    expect(out.truncated).toBe(false);
  });

  it("reads .md as utf-8", async () => {
    const buf = Buffer.from("# Style guide\n\n- Be warm\n- Be brief");
    const out = await extractText(buf, "style.md");
    expect(out.text).toContain("# Style guide");
    expect(out.ext).toBe("md");
  });

  it("truncates oversize content with a marker", async () => {
    const huge = "x".repeat(MAX_REFERENCE_TEXT_BYTES + 1000);
    const buf = Buffer.from(huge);
    const out = await extractText(buf, "huge.txt");
    expect(out.truncated).toBe(true);
    expect(out.text).toContain("[…truncated…]");
    expect(Buffer.byteLength(out.text, "utf-8")).toBeLessThanOrEqual(
      MAX_REFERENCE_TEXT_BYTES + 50,
    );
  });

  it("rejects empty extraction", async () => {
    await expect(extractText(Buffer.from("   "), "blank.txt")).rejects.toThrow(
      UnsupportedReferenceError,
    );
  });

  it("rejects unsupported extensions", async () => {
    await expect(
      extractText(Buffer.from("data"), "image.png"),
    ).rejects.toThrow(UnsupportedReferenceError);
  });
});

describe("guidance.parseGuidanceResponse", () => {
  it("parses a full guidance object", () => {
    const out = parseGuidanceResponse(
      JSON.stringify({
        applicableRelationships: ["all"],
        greetings: ["Hey,", "Hi friend,"],
        closings: ["Warmly,", "Talk soon"],
        signaturePhrases: ["honestly", "look — "],
        avoidPhrases: ["I hope this finds you well", "Per my last email"],
        toneNotes: "Warm, dry, slightly self-deprecating.",
      }),
    );
    expect(out.applicableRelationships).toEqual(["all"]);
    expect(out.greetings).toEqual(["Hey,", "Hi friend,"]);
    expect(out.avoidPhrases).toContain("Per my last email");
    expect(out.toneNotes).toMatch(/self-deprecating/);
  });

  it("caps array lengths", () => {
    const tooMany = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const out = parseGuidanceResponse(
      JSON.stringify({
        applicableRelationships: ["all"],
        greetings: tooMany,
        avoidPhrases: tooMany,
        signaturePhrases: tooMany,
        closings: tooMany,
        toneNotes: "",
      }),
    );
    expect(out.greetings.length).toBeLessThanOrEqual(5);
    expect(out.closings.length).toBeLessThanOrEqual(5);
    expect(out.signaturePhrases.length).toBeLessThanOrEqual(5);
    expect(out.avoidPhrases.length).toBeLessThanOrEqual(8);
  });

  it("filters out invalid relationship types", () => {
    const out = parseGuidanceResponse(
      JSON.stringify({
        applicableRelationships: ["former_student", "bogus", "executives"],
        greetings: [],
        closings: [],
        signaturePhrases: [],
        avoidPhrases: [],
        toneNotes: "",
      }),
    );
    expect(out.applicableRelationships).toEqual(["former_student"]);
  });

  it("defaults to 'all' when no valid relationships", () => {
    const out = parseGuidanceResponse(
      JSON.stringify({
        applicableRelationships: ["bogus"],
        greetings: [],
        closings: [],
        signaturePhrases: [],
        avoidPhrases: [],
        toneNotes: "",
      }),
    );
    expect(out.applicableRelationships).toEqual(["all"]);
  });

  it("returns empty shape on malformed JSON", () => {
    const out = parseGuidanceResponse("not json at all");
    expect(out.greetings).toEqual([]);
    expect(out.avoidPhrases).toEqual([]);
    expect(out.toneNotes).toBe("");
  });

  it("tolerates JSON wrapped in prose", () => {
    const out = parseGuidanceResponse(
      `Sure — here it is: {"applicableRelationships":["all"],"greetings":["Hey"],"closings":[],"signaturePhrases":[],"avoidPhrases":[],"toneNotes":""} hope that helps.`,
    );
    expect(out.greetings).toEqual(["Hey"]);
  });
});

describe("buildReferencesBlock (M0.x.5)", () => {
  function mkRef(over: Partial<VoiceReferenceForPrompt> = {}): VoiceReferenceForPrompt {
    return {
      id: "vref_1",
      filename: "writers-room.md",
      sourceType: "gpt_knowledge_base",
      content:
        "Open with humor. Avoid corporate filler. Sign off warmly — never 'Best regards'.",
      guidance: {
        greetings: ["Hey,"],
        closings: ["Warmly,"],
        signaturePhrases: ["honestly"],
        avoidPhrases: ["Best regards"],
        toneNotes: "Warm + dry humor.",
      },
      ...over,
    };
  }

  it("renders header with 'PRIMARY' framing", () => {
    const out = buildReferencesBlock([mkRef()]);
    expect(out).toContain("PRIMARY VOICE REFERENCES");
    expect(out).toMatch(/highest priority/);
    expect(out).toMatch(/favor the references/);
  });

  it("includes each reference's filename, tone, and excerpt", () => {
    const out = buildReferencesBlock([mkRef({ filename: "humor-helper.txt" })]);
    expect(out).toContain("humor-helper.txt");
    expect(out).toContain("Warm + dry humor");
    expect(out).toContain("Avoid corporate filler");
  });

  it("lists explicit greetings/closings/phrases when present", () => {
    const out = buildReferencesBlock([mkRef()]);
    expect(out).toContain("Preferred greetings:");
    expect(out).toContain('"Hey,"');
    expect(out).toContain("Preferred closings:");
    expect(out).toContain("Signature phrases to lean into:");
  });

  it("truncates very long excerpts at ~4000 chars with a marker", () => {
    const huge = "Lorem ipsum ".repeat(2000); // ~24k chars
    const out = buildReferencesBlock([mkRef({ content: huge })]);
    expect(out).toContain("[…truncated…]");
  });

  it("handles refs without guidance gracefully", () => {
    const out = buildReferencesBlock([mkRef({ guidance: null })]);
    expect(out).toContain("Excerpt:");
    expect(out).not.toContain("Tone & rhythm:");
  });
});

describe("buildVoiceBlock with references (M0.x.5)", () => {
  function makeBlock(opts: {
    refs?: VoiceReferenceForPrompt[];
    examples?: unknown[];
    learnedNeverSays?: string[];
  }): string | null {
    return buildVoiceBlock({
      learnedProfile: opts.learnedNeverSays
        ? {
            byRelationship: { former_student: {
              count: 1, greetings: [], closings: [],
              avgSentenceLen: 0, wordCountMedian: 0,
              signaturePhrases: [],
            } } as unknown as Record<string, never>,
            neverSays: opts.learnedNeverSays,
            overallCount: 1,
            generatedAt: 0,
          }
        : null,
      examples: (opts.examples as never[]) ?? [],
      references: opts.refs,
      relationshipType: "former_student",
    });
  }

  function mkRef(over: Partial<VoiceReferenceForPrompt> = {}): VoiceReferenceForPrompt {
    return {
      id: "vref_x",
      filename: "kb.txt",
      sourceType: "gpt_knowledge_base",
      content: "be warm and brief",
      guidance: {
        greetings: ["Hey,"],
        closings: [],
        signaturePhrases: [],
        avoidPhrases: ["Per my last email"],
        toneNotes: "Brief and warm",
      },
      ...over,
    };
  }

  it("places references FIRST in the rendered block", () => {
    const out = makeBlock({ refs: [mkRef()] }) ?? "";
    const idxRef = out.indexOf("PRIMARY VOICE REFERENCES");
    const idxLearned = out.indexOf("How the user typically writes");
    expect(idxRef).toBeGreaterThanOrEqual(0);
    expect(idxLearned).toBeGreaterThan(idxRef);
  });

  it("merges reference avoidPhrases with learned neverSays", () => {
    const out =
      makeBlock({
        refs: [mkRef()],
        learnedNeverSays: ["Circle back"],
      }) ?? "";
    expect(out).toContain("Per my last email");
    expect(out).toContain("Circle back");
  });

  it("frames the secondary block when references are present", () => {
    const out = makeBlock({ refs: [mkRef()] }) ?? "";
    expect(out).toMatch(/secondary/i);
    expect(out).toMatch(/prefer the references/i);
  });

  it("hasVoiceContext is true when ONLY references exist", () => {
    expect(
      hasVoiceContext({
        learnedProfile: null,
        examples: [],
        references: [mkRef()],
        relationshipType: "former_student",
      }),
    ).toBe(true);
  });

  it("returns null when no refs, no examples, no profile", () => {
    expect(makeBlock({})).toBeNull();
  });
});

describe("getVoiceReferences (M0.x.5)", () => {
  function mkPrisma(rows: Array<Record<string, unknown>>) {
    const $queryRawUnsafe = vi.fn(async () => rows);
    return {
      prisma: { $queryRawUnsafe } as unknown as PrismaClient,
      spies: { $queryRawUnsafe },
    };
  }

  it("filters out references not applicable to the recipient relationship", async () => {
    const { prisma } = mkPrisma([
      {
        id: "a",
        filename: "all.md",
        sourceType: "gpt_knowledge_base",
        content: "x",
        guidance: { applicableRelationships: ["all"] },
        weight: 1.0,
        similarity: 0.5,
        addedAt: new Date(),
      },
      {
        id: "b",
        filename: "students-only.md",
        sourceType: "gpt_knowledge_base",
        content: "x",
        guidance: { applicableRelationships: ["former_student"] },
        weight: 1.0,
        similarity: 0.9,
        addedAt: new Date(),
      },
      {
        id: "c",
        filename: "execs-only.md",
        sourceType: "gpt_knowledge_base",
        content: "x",
        guidance: { applicableRelationships: ["industry_exec"] },
        weight: 1.0,
        similarity: 0.95,
        addedAt: new Date(),
      },
    ]);
    const out = await getVoiceReferences({
      prisma,
      userId: "u1",
      queryEmbeddingLiteral: "[0]",
      relationshipType: "former_student",
    });
    const ids = out.map((r) => r.id);
    expect(ids).toContain("a"); // "all"
    expect(ids).toContain("b"); // former_student match
    expect(ids).not.toContain("c"); // industry_exec — wrong audience
  });

  it("ranks by weight * similarity composite (KB beats lower-weight refs)", async () => {
    const { prisma } = mkPrisma([
      {
        id: "kb",
        filename: "kb.md",
        sourceType: "gpt_knowledge_base",
        content: "kb",
        guidance: { applicableRelationships: ["all"] },
        weight: 1.0,
        similarity: 0.6,
        addedAt: new Date(),
      },
      {
        id: "book",
        filename: "book.md",
        sourceType: "book_excerpt",
        content: "book",
        guidance: { applicableRelationships: ["all"] },
        weight: 0.3,
        similarity: 0.95,
        addedAt: new Date(),
      },
    ]);
    const out = await getVoiceReferences({
      prisma,
      userId: "u1",
      queryEmbeddingLiteral: "[0]",
      relationshipType: "former_student",
    });
    // KB at 1.0 * 0.6 = 0.6 beats book at 0.3 * 0.95 = 0.285
    expect(out[0].id).toBe("kb");
  });

  it("respects k cap", async () => {
    const { prisma } = mkPrisma([
      {
        id: "a", filename: "a.md", sourceType: "gpt_knowledge_base", content: "x",
        guidance: { applicableRelationships: ["all"] }, weight: 1.0, similarity: 0.9, addedAt: new Date(),
      },
      {
        id: "b", filename: "b.md", sourceType: "gpt_knowledge_base", content: "x",
        guidance: { applicableRelationships: ["all"] }, weight: 1.0, similarity: 0.8, addedAt: new Date(),
      },
      {
        id: "c", filename: "c.md", sourceType: "gpt_knowledge_base", content: "x",
        guidance: { applicableRelationships: ["all"] }, weight: 1.0, similarity: 0.7, addedAt: new Date(),
      },
      {
        id: "d", filename: "d.md", sourceType: "gpt_knowledge_base", content: "x",
        guidance: { applicableRelationships: ["all"] }, weight: 1.0, similarity: 0.6, addedAt: new Date(),
      },
    ]);
    const out = await getVoiceReferences({
      prisma,
      userId: "u1",
      queryEmbeddingLiteral: "[0]",
      relationshipType: "former_student",
      k: 2,
    });
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("treats null similarity as 0.5 baseline (refs without embedding still ranked)", async () => {
    const { prisma } = mkPrisma([
      {
        id: "no-embed", filename: "x.md", sourceType: "gpt_knowledge_base", content: "x",
        guidance: { applicableRelationships: ["all"] }, weight: 1.0, similarity: null, addedAt: new Date(),
      },
    ]);
    const out = await getVoiceReferences({
      prisma,
      userId: "u1",
      queryEmbeddingLiteral: null,
      relationshipType: "former_student",
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("no-embed");
  });

  it("returns empty list when no rows", async () => {
    const { prisma } = mkPrisma([]);
    const out = await getVoiceReferences({
      prisma,
      userId: "u1",
      queryEmbeddingLiteral: null,
      relationshipType: "former_student",
    });
    expect(out).toEqual([]);
  });
});
