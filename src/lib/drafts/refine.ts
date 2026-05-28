/**
 * Streaming draft-refinement runner (M0.x.6).
 *
 * Takes the current draft + Jennifer's refinement request + optional
 * context (recipient, inbound message, memory, voice references), and
 * streams a revised draft from Claude Sonnet. The system prompt
 * enforces "minimum viable change" so unrelated parts of the draft
 * stay stable across iterations.
 *
 * Yields an async iterator of typed events that the SSE endpoint
 * forwards verbatim.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getUserProfile } from "@/lib/user-profile";
import type { ReplyContext } from "@/lib/draft-reply-context";
import type {
  RefinementChatMessage,
  WorkspaceVersion,
} from "./workspace-types";
import type { VoiceReferenceForPrompt } from "@/lib/voice/draft-prompt";

const REFINE_MODEL = "claude-sonnet-4-20250514";

export interface RefineContextSummary {
  /** Recipient first name — used in any model-side framing. */
  readonly recipientFirstName: string;
  readonly recipientFullName: string;
  readonly recipientEmail: string | null;
  readonly relationshipType: string;
  /** "What I know about them" already-formatted block (M8.3). Empty
   *  string when memory hasn't been synthesized for this contact. */
  readonly memorySummary: string;
  /** When this draft is a reply, the inbound message context Claude
   *  should anchor to. M0.x.4 loader output. */
  readonly replyContext: ReplyContext | null;
  /** Voice references to keep "in the room" across refinements. M0.x.5. */
  readonly references: ReadonlyArray<VoiceReferenceForPrompt>;
  /** M0.x.12 — Jennifer's free-form custom voice instructions from
   *  /voice. Threaded into refinement + variants prompts so
   *  iterative edits respect the same global voice rules drafts use. */
  readonly userInstructions: string | null;
}

export interface RefineRunArgs {
  /** The latest version content the user is iterating on. */
  readonly currentDraft: string;
  readonly currentSubjectLine: string | null;
  readonly userRequest: string;
  readonly chatHistory: ReadonlyArray<RefinementChatMessage>;
  readonly priorVersions: ReadonlyArray<WorkspaceVersion>;
  readonly context: RefineContextSummary;
}

export type RefineEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "complete";
      content: string;
      subjectLine: string | null;
      assistantNote: string;
      tokensIn: number;
      tokensOut: number;
    }
  | { type: "error"; message: string };

const REFINE_SYSTEM_PROMPT = (userName: string) =>
  `You are helping ${userName} refine an email draft through iterative conversation. ${userName} is currently looking at a draft you produced earlier; she asks for a change; you produce an updated draft.

OUTPUT FORMAT — strict:
Return ONLY a valid JSON object on a single line, then nothing else:
{"content":"<full new draft body>","subjectLine":"<subject or null>","note":"<one short sentence explaining what you changed>"}

RULES:
- Be conservative. Make the MINIMUM VIABLE CHANGE that fulfills the request. If she asks for a shorter draft, tighten — don't rewrite the opening unless asked. If she asks to add humor, splice it in — don't restructure the whole message.
- Preserve unchanged sentences verbatim where possible — she may have already approved them.
- If the request is ambiguous, prefer the smaller interpretation. She'll iterate again if needed.
- "content" is the FULL DRAFT BODY, not just the changed parts.
- "subjectLine" is null for casual / text messages; otherwise carry it forward (modifying only if her request implies it).
- "note" is one short sentence, plain language, addressed to ${userName}, describing what you changed. No preamble, no apologies.
- Never use markdown formatting in "content" unless the prior draft already had it. Email body is plain text by default.`;

interface AnthropicLike {
  messages: {
    stream: (args: {
      model: string;
      max_tokens: number;
      system: Anthropic.Messages.TextBlockParam[];
      messages: Anthropic.Messages.MessageParam[];
    }) => AsyncIterable<Anthropic.Messages.RawMessageStreamEvent> & {
      finalMessage: () => Promise<Anthropic.Messages.Message>;
    };
  };
}

let _client: AnthropicLike | null = null;
function getClient(): AnthropicLike {
  if (_client) return _client;
  _client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  }) as unknown as AnthropicLike;
  return _client;
}

/** Build the user-side prompt envelope — context first, then current
 *  draft, then the refinement request. Pure for testing. */
export function buildRefinementUserPrompt(args: RefineRunArgs): string {
  const ctx = args.context;
  const parts: string[] = [];

  // M0.x.12 — Jennifer's custom voice instructions FIRST, before
  // any context. These are her own prompt-engineering and the
  // model should treat them as highest authority.
  const userInstructions = ctx.userInstructions?.trim();
  if (userInstructions) {
    parts.push(
      `CUSTOM VOICE INSTRUCTIONS (apply to every revision — these override conflicting guidance):\n${userInstructions}\n`,
    );
  }

  parts.push(`RECIPIENT: ${ctx.recipientFullName} (${ctx.relationshipType})`);
  if (ctx.recipientEmail) parts.push(`Email: ${ctx.recipientEmail}`);

  if (ctx.replyContext) {
    const inb = ctx.replyContext.latestInbound;
    parts.push(
      `\nTHEY WROTE (replying to this):\nFrom: ${inb.fromName ?? inb.fromEmail}\nSubject: ${inb.subject ?? "(no subject)"}\n\n${truncate(inb.body, 2500)}`,
    );
  }

  if (ctx.memorySummary) {
    parts.push(`\nWHAT YOU KNOW ABOUT ${ctx.recipientFirstName.toUpperCase()}:\n${ctx.memorySummary}`);
  }

  if (ctx.references.length > 0) {
    const refLines = ctx.references.map(
      (r) =>
        `- ${r.filename}: ${truncate(r.guidance?.toneNotes ?? r.content, 240)}`,
    );
    parts.push(
      `\nVOICE REFERENCES (match these — they describe ${args.context.recipientFirstName}'s ideal writing voice):\n${refLines.join("\n")}`,
    );
  }

  parts.push(
    `\nCURRENT DRAFT (version ${args.priorVersions.length}):${
      args.currentSubjectLine
        ? `\nSubject: ${args.currentSubjectLine}\n`
        : "\n"
    }\n${args.currentDraft}`,
  );

  // Carry recent chat context — last 6 turns. Helps Claude understand
  // accumulated direction ("you've already made it shorter; now add humor").
  const recentChat = args.chatHistory.slice(-6);
  if (recentChat.length > 0) {
    parts.push(
      `\nRECENT REFINEMENT TURNS:\n${recentChat
        .map((m) => `[${m.role}] ${m.content}`)
        .join("\n")}`,
    );
  }

  parts.push(`\nJENNIFER'S NEW REQUEST:\n${args.userRequest.trim()}`);
  parts.push(
    `\nProduce the updated draft as JSON. Preserve everything she didn't ask to change.`,
  );

  return parts.join("\n");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

/**
 * Stream the refinement. Emits text_delta events as Claude generates
 * (chunked at the SDK level), then a single complete event with the
 * parsed final JSON. Caller (the SSE endpoint) is responsible for
 * persisting the new version row.
 */
export async function* runRefinementStream(
  args: RefineRunArgs,
): AsyncGenerator<RefineEvent, void, undefined> {
  if (!process.env.ANTHROPIC_API_KEY) {
    yield {
      type: "error",
      message: "ANTHROPIC_API_KEY not configured",
    };
    return;
  }

  const profile = getUserProfile();
  const system: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: REFINE_SYSTEM_PROMPT(profile.firstName ?? "the user"),
    },
  ];
  const userPrompt = buildRefinementUserPrompt(args);

  try {
    const client = getClient();
    const stream = client.messages.stream({
      model: REFINE_MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Buffer raw text from text_delta events so we can re-parse the
    // final JSON without re-iterating the stream.
    let buffered = "";
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        buffered += event.delta.text;
        yield { type: "text_delta", text: event.delta.text };
      }
    }

    const finalMsg = await stream.finalMessage();
    const usage = finalMsg.usage;
    const parsed = parseRefinementResponse(buffered);
    if (!parsed) {
      yield {
        type: "error",
        message: "Couldn't parse the model's response as JSON",
      };
      return;
    }
    yield {
      type: "complete",
      content: parsed.content,
      subjectLine: parsed.subjectLine,
      assistantNote: parsed.note,
      tokensIn: usage?.input_tokens ?? 0,
      tokensOut: usage?.output_tokens ?? 0,
    };
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

interface ParsedRefinement {
  readonly content: string;
  readonly subjectLine: string | null;
  readonly note: string;
}

export function parseRefinementResponse(text: string): ParsedRefinement | null {
  // The model is told to emit a single-line JSON object, but Sonnet
  // sometimes wraps it in code fences or adds an explanation suffix.
  // Tolerate both.
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  // Find the first balanced { } block — handles trailing prose.
  const match = candidate.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    if (typeof obj.content !== "string" || obj.content.length === 0) {
      return null;
    }
    return {
      content: obj.content,
      subjectLine:
        typeof obj.subjectLine === "string" && obj.subjectLine.length > 0
          ? obj.subjectLine
          : null,
      note:
        typeof obj.note === "string" && obj.note.length > 0
          ? obj.note
          : "Updated the draft.",
    };
  } catch {
    return null;
  }
}

export const REFINE_MODEL_NAME = REFINE_MODEL;
