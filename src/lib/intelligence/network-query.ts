/**
 * Network query orchestrator (M7.3 — Phase 7 flagship).
 *
 * Given a natural-language question about the user's network, calls
 * Claude Sonnet with tool use to walk the contact graph and produce
 * a grounded, structured answer.
 *
 * Example queries that work:
 *   - "Who should I invite to dinner with Marcus and Sarah?"
 *   - "Which former students work in behavioral economics?"
 *   - "Who in my network has talked about loneliness recently?"
 *
 * Tools available to Claude:
 *   - search_contacts: name/company text search (uses existing trigram)
 *   - find_contacts_by_topic: semantic search via Voyage embeddings
 *   - get_contact_profile: ContactProfile attributes (M7.1)
 *   - get_network_neighbors: ContactEdge traversal (M7.2)
 *   - get_interaction_history: recent interactions for a contact
 *
 * Loop terminates when Claude returns end_turn without tool_use, or
 * after MAX_ITERATIONS to bound cost. Each tool call is recorded in
 * the trace for the "How I thought about this" panel (M7.4).
 *
 * Design choices:
 *   - No streaming yet (M7.3b) — non-streaming keeps the orchestrator
 *     simple and the API endpoint stateless. Each query is one POST,
 *     one response, no SSE plumbing.
 *   - Tool registry is a flat array of {name, schema, execute}.
 *     Adding a new tool means registering one entry; no dispatch
 *     table to maintain.
 *   - Cost bound: hard cap at 8 iterations (≈8 Claude calls per
 *     query). Most queries finish in 3-4 round-trips.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import { findNeighbors } from "./graph-traverse";
import { searchContacts as fuzzyContactSearch } from "@/lib/search/contacts";

export const NETWORK_QUERY_MODEL = "claude-sonnet-4-5";
const MAX_ITERATIONS = 8;
const MAX_TOKENS = 2500;

export interface RunNetworkQueryParams {
  prisma: PrismaClient;
  userId: string;
  query: string;
  /** M0.x.11 — when set, the orchestrator seeds the conversation
   *  with the prior turn so Claude treats `query` as a follow-up.
   *  Used by the Refine flow on /ask and the embedded follow-up
   *  input on /ask/[id]. Without context, the refinement gets
   *  shoved into a single-turn prompt and frequently produces
   *  empty answers ("Additional constraint: …" pattern confuses
   *  the structured-output flow). */
  priorContext?: {
    readonly question: string;
    readonly answer: string;
  };
}

export interface SuggestedContact {
  contactId: string;
  name: string;
  reason: string;
}

export interface ReasoningStep {
  tool: string;
  input: unknown;
  /** One-sentence human-readable summary of what the tool returned. */
  summary: string;
}

export interface NetworkQueryResult {
  /** The final answer paragraph(s) Claude wrote. */
  answer: string;
  /** Optional title Claude assigned (extracted from response shape). */
  title: string | null;
  /** Structured suggestions parsed from Claude's response. */
  suggestedContacts: SuggestedContact[];
  /** Each tool call in order, for the "How I thought about this" UI. */
  reasoningTrace: ReasoningStep[];
  /** Claude's full final message text (for debugging / future
   *  comparison-UI display). */
  rawAnswer: string;
  /** Aggregate token usage for cost tracking. */
  usage: { inputTokens: number; outputTokens: number };
}

interface ToolContext {
  prisma: PrismaClient;
  userId: string;
}

/**
 * Build the initial messages array. When priorContext is set, seed
 * the conversation with the prior turn so Claude treats `query` as a
 * follow-up: the prior question/answer becomes turn 1, the new query
 * becomes turn 2. Otherwise it's a single-turn conversation.
 *
 * Pure — exported for unit testing.
 */
export function buildSeedMessages(
  query: string,
  priorContext?: { question: string; answer: string },
): Anthropic.Messages.MessageParam[] {
  if (!priorContext) {
    return [{ role: "user", content: query }];
  }
  return [
    { role: "user", content: priorContext.question },
    { role: "assistant", content: priorContext.answer },
    { role: "user", content: query },
  ];
}

interface RegisteredTool {
  name: string;
  description: string;
  input_schema: Anthropic.Messages.Tool.InputSchema;
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

interface ToolResult {
  /** JSON-serializable result returned to Claude. */
  data: unknown;
  /** Human-readable one-liner for the reasoning trace. */
  summary: string;
}

// ─── Tool registry ─────────────────────────────────────────

const TOOLS: RegisteredTool[] = [
  {
    name: "search_contacts",
    description:
      "Search the user's contacts by name, company, or role text. Returns up to 20 matches. Use this when the query mentions specific people, organizations, or job titles.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search text (name, company, or role)",
        },
        limit: {
          type: "number",
          description: "Max results, default 20",
        },
      },
      required: ["query"],
    },
    execute: async (input, ctx) => {
      const { query, limit = 20 } = input as { query: string; limit?: number };
      const hits = await fuzzyContactSearch(ctx.userId, query, limit, {
        includeSemantic: false,
      });
      return {
        data: hits.map((h) => ({
          contactId: h.id,
          name: h.name,
          email: h.email,
          company: h.company,
          role: h.role,
          tier: h.tier,
        })),
        summary: `Found ${hits.length} contact${hits.length === 1 ? "" : "s"} matching "${query}"`,
      };
    },
  },
  {
    name: "find_contacts_by_topic",
    description:
      "Semantic search across contact profiles + notes. Use when the query is about a topic or domain ('behavioral economics', 'AI ethics') rather than a specific name. Returns contacts whose embedding is closest to the topic.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Topic or domain to search for",
        },
        limit: { type: "number", description: "Max results, default 15" },
      },
      required: ["topic"],
    },
    execute: async (input, ctx) => {
      const { topic, limit = 15 } = input as { topic: string; limit?: number };
      // Reuses the existing fuzzy + semantic search hybrid. When
      // VOYAGE_API_KEY isn't set this falls back to text matching.
      const hits = await fuzzyContactSearch(ctx.userId, topic, limit, {
        includeSemantic: true,
      });
      return {
        data: hits.map((h) => ({
          contactId: h.id,
          name: h.name,
          company: h.company,
          role: h.role,
          score: h.score,
        })),
        summary: `Found ${hits.length} contact${hits.length === 1 ? "" : "s"} relevant to "${topic}"`,
      };
    },
  },
  {
    name: "get_contact_profile",
    description:
      "Get the structured attribute profile for a contact (expertise, communication style, geographic context, personality signals, relationship stage). Use after identifying a contact by name or ID to learn more.",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "The contact's ID" },
      },
      required: ["contactId"],
    },
    execute: async (input, ctx) => {
      const { contactId } = input as { contactId: string };
      const contact = await ctx.prisma.contact.findFirst({
        where: { id: contactId, userId: ctx.userId },
        select: {
          name: true,
          email: true,
          company: true,
          role: true,
          city: true,
          state: true,
          country: true,
          notes: true,
          profile: {
            select: {
              expertiseAreas: true,
              communicationStyle: true,
              geographicContext: true,
              personalitySignals: true,
              relationshipStage: true,
            },
          },
        },
      });
      if (!contact) {
        return {
          data: { error: "contact not found" },
          summary: `Contact ${contactId} not found`,
        };
      }
      return {
        data: {
          name: contact.name,
          email: contact.email,
          company: contact.company,
          role: contact.role,
          location: [contact.city, contact.state, contact.country]
            .filter(Boolean)
            .join(", "),
          userNotes: contact.notes,
          profile: contact.profile,
        },
        summary: contact.profile
          ? `Pulled profile for ${contact.name}`
          : `${contact.name} has no extracted profile yet`,
      };
    },
  },
  {
    name: "get_network_neighbors",
    description:
      "Get the contacts directly connected to a given contact through shared threads, same-org, or other relationship edges. Use to find 'who else knows X' or 'who is in X's circle'.",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "Source contact's ID" },
        edgeTypes: {
          type: "array",
          items: { type: "string" },
          description:
            "Restrict to specific edge types: mutual_thread (shared conversation), same_org (same company/email-domain), mentioned (one named the other in an email body), introduced_by_user (user initiated a thread connecting them). Omit for all.",
        },
        limit: { type: "number", description: "Max neighbors, default 15" },
      },
      required: ["contactId"],
    },
    execute: async (input, ctx) => {
      const { contactId, edgeTypes, limit = 15 } = input as {
        contactId: string;
        edgeTypes?: string[];
        limit?: number;
      };
      const neighbors = await findNeighbors({
        prisma: ctx.prisma,
        userId: ctx.userId,
        contactId,
        edgeTypes,
        limit,
      });
      return {
        data: neighbors.map((n) => ({
          contactId: n.contactId,
          name: n.name,
          company: n.company,
          role: n.role,
          edgeType: n.edgeType,
          strength: n.strength,
          observationCount: n.observationCount,
        })),
        summary: `${neighbors.length} contact${neighbors.length === 1 ? "" : "s"} connected to this person`,
      };
    },
  },
  {
    name: "get_interaction_history",
    description:
      "Recent interactions (emails, meetings, etc.) with a contact, most recent first. Use to understand what's been discussed lately or judge how active the relationship is.",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "The contact's ID" },
        limit: { type: "number", description: "Max interactions, default 10" },
      },
      required: ["contactId"],
    },
    execute: async (input, ctx) => {
      const { contactId, limit = 10 } = input as {
        contactId: string;
        limit?: number;
      };
      const interactions = await ctx.prisma.interaction.findMany({
        where: { contactId, userId: ctx.userId },
        orderBy: { occurredAt: "desc" },
        take: limit,
        select: {
          type: true,
          direction: true,
          subject: true,
          summary: true,
          occurredAt: true,
        },
      });
      return {
        data: interactions.map((i) => ({
          type: i.type,
          direction: i.direction,
          subject: i.subject,
          summary: i.summary,
          date: i.occurredAt.toISOString().slice(0, 10),
        })),
        summary:
          interactions.length > 0
            ? `Last ${interactions.length} interactions, most recent ${interactions[0].occurredAt.toISOString().slice(0, 10)}`
            : "No interactions on record",
      };
    },
  },
  // ─── Memory tools (M8.2) ────────────────────────────────
  {
    name: "get_memory_summary",
    description:
      "Pull the synthesized conversational memory for a contact: recent topics discussed, things they've mentioned about themselves, open threads (questions or commitments still pending), personal context (family, location). Use when the user asks 'what did we last discuss', 'what did I promise', 'has X mentioned Y'.",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "The contact's ID" },
      },
      required: ["contactId"],
    },
    execute: async (input, ctx) => {
      const { contactId } = input as { contactId: string };
      const contact = await ctx.prisma.contact.findFirst({
        where: { id: contactId, userId: ctx.userId },
        select: {
          name: true,
          memory: {
            select: {
              discussedTopics: true,
              theyMentioned: true,
              openThreads: true,
              personalContext: true,
              recurringThemes: true,
              synthesizedAt: true,
            },
          },
        },
      });
      if (!contact?.memory) {
        return {
          data: { error: "no memory synthesized yet" },
          summary: `${contact?.name ?? "Contact"} has no memory yet (worker runs daily)`,
        };
      }
      return {
        data: contact.memory,
        summary: `Pulled conversational memory for ${contact.name}`,
      };
    },
  },
  {
    name: "find_open_threads",
    description:
      "Across all contacts (or a specific one if contactId provided), find open conversational threads — questions raised but not answered, commitments made but not fulfilled. Use for 'what do I owe people', 'what's still open'.",
    input_schema: {
      type: "object",
      properties: {
        contactId: {
          type: "string",
          description:
            "Optional — restrict to one contact. Omit to scan globally.",
        },
        limit: { type: "number", description: "Max threads, default 20" },
      },
    },
    execute: async (input, ctx) => {
      const { contactId, limit = 20 } = input as {
        contactId?: string;
        limit?: number;
      };
      const memories = await ctx.prisma.contactMemory.findMany({
        where: contactId
          ? { contactId, contact: { userId: ctx.userId } }
          : { contact: { userId: ctx.userId } },
        select: {
          openThreads: true,
          contact: { select: { id: true, name: true } },
        },
      });
      const allThreads: Array<{
        contactId: string;
        contactName: string;
        subject: string;
        raisedBy: string;
        raisedAt: string;
        status: string;
      }> = [];
      for (const m of memories) {
        if (!Array.isArray(m.openThreads)) continue;
        for (const t of m.openThreads as Array<Record<string, unknown>>) {
          if (typeof t !== "object" || t === null) continue;
          if (t.status === "resolved") continue;
          allThreads.push({
            contactId: m.contact.id,
            contactName: m.contact.name,
            subject: String(t.subject ?? ""),
            raisedBy: String(t.raisedBy ?? ""),
            raisedAt: String(t.raisedAt ?? ""),
            status: String(t.status ?? "open"),
          });
        }
      }
      // Sort by raisedAt desc so most-recent unresolved threads land first.
      allThreads.sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
      const trimmed = allThreads.slice(0, limit);
      return {
        data: trimmed,
        summary: `${trimmed.length} open thread${trimmed.length === 1 ? "" : "s"}${contactId ? " for this contact" : " across all contacts"}`,
      };
    },
  },
  {
    name: "find_personal_mentions",
    description:
      "Search across all contacts' memory for things THEY have mentioned about themselves matching a query (e.g., 'daughter applying to Stanford', 'sabbatical', 'moving to NYC'). Returns contacts who said something matching with the context.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for — keyword or short phrase",
        },
        limit: { type: "number", description: "Max results, default 15" },
      },
      required: ["query"],
    },
    execute: async (input, ctx) => {
      const { query, limit = 15 } = input as { query: string; limit?: number };
      const memories = await ctx.prisma.contactMemory.findMany({
        where: { contact: { userId: ctx.userId } },
        select: {
          theyMentioned: true,
          contact: { select: { id: true, name: true } },
        },
      });
      const q = query.toLowerCase();
      const matches: Array<{
        contactId: string;
        contactName: string;
        subject: string;
        context: string;
        mentionedAt: string;
      }> = [];
      for (const m of memories) {
        if (!Array.isArray(m.theyMentioned)) continue;
        for (const item of m.theyMentioned as Array<Record<string, unknown>>) {
          if (typeof item !== "object" || item === null) continue;
          const subject = String(item.subject ?? "");
          const context = String(item.context ?? "");
          if (
            subject.toLowerCase().includes(q) ||
            context.toLowerCase().includes(q)
          ) {
            matches.push({
              contactId: m.contact.id,
              contactName: m.contact.name,
              subject,
              context,
              mentionedAt: String(item.mentionedAt ?? ""),
            });
          }
        }
      }
      matches.sort((a, b) => b.mentionedAt.localeCompare(a.mentionedAt));
      return {
        data: matches.slice(0, limit),
        summary: `${matches.length} contact${matches.length === 1 ? "" : "s"} mentioned something matching "${query}"`,
      };
    },
  },
  {
    name: "find_themes",
    description:
      "Get the recurring themes (topics that surface repeatedly) for a contact. Use to understand what's most on someone's mind across all their interactions with the user.",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "The contact's ID" },
      },
      required: ["contactId"],
    },
    execute: async (input, ctx) => {
      const { contactId } = input as { contactId: string };
      const memory = await ctx.prisma.contactMemory.findFirst({
        where: { contactId, contact: { userId: ctx.userId } },
        select: { recurringThemes: true, contact: { select: { name: true } } },
      });
      if (!memory) {
        return {
          data: { error: "no memory synthesized yet" },
          summary: "No memory data for this contact",
        };
      }
      return {
        data: { themes: memory.recurringThemes },
        summary:
          memory.recurringThemes.length > 0
            ? `${memory.recurringThemes.length} recurring themes for ${memory.contact.name}`
            : `${memory.contact.name} has no recurring themes identified yet`,
      };
    },
  },
];

// ─── Orchestrator ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are helping the user reason about the people in their professional network. They ask questions in natural language; you investigate by calling tools, then synthesize an answer.

CORE RULES:
- Ground every claim in tool output. NEVER invent contacts, attributes, or relationships that don't appear in the data.
- Call tools liberally — search_contacts and find_contacts_by_topic to identify candidates, then get_contact_profile / get_network_neighbors / get_interaction_history to verify they fit.
- Stop calling tools once you have enough evidence. Don't loop indefinitely.
- When recommending people, explain the EVIDENCE: cite which interactions, which shared threads, which profile attributes informed the suggestion.

OUTPUT FORMAT:
After tool exploration is complete, return your final answer as JSON in this shape (no markdown, no preamble):

{
  "title": "Short headline for the answer (e.g. 'Dinner companions for Marcus and Sarah')",
  "answer": "1-3 sentence summary of your conclusion",
  "suggestions": [
    {
      "contactId": "<exact ID from tool output>",
      "name": "<their name>",
      "reason": "<1-2 sentence grounded explanation of why they fit>"
    }
  ]
}

The "answer" field is REQUIRED and must contain your full 1-3 sentence summary. Do NOT leave it empty by putting your reasoning only in between-tool-call commentary. Even if you wrote prose while investigating, you must restate the conclusion in "answer".

If the question doesn't call for contact suggestions (e.g., "what topics has Marc been discussing?"), use an empty suggestions array and put the full answer in "answer".

If you can't find a good answer, say so honestly in "answer" with empty suggestions — DON'T invent options to fill the array.`;

export async function runNetworkQuery(
  params: RunNetworkQueryParams,
): Promise<NetworkQueryResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  // 60s per-request timeout + 2 retries. Tool-use loops typically
  // make 5-10 Claude calls per query; without timeouts, one stuck
  // call would hang the entire HTTP request.
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 60_000,
    maxRetries: 2,
  });
  const ctx: ToolContext = { prisma: params.prisma, userId: params.userId };

  const messages: Anthropic.Messages.MessageParam[] = buildSeedMessages(
    params.query,
    params.priorContext,
  );
  const trace: ReasoningStep[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalText = "";
  // M0.x.15 — every iteration's text content, concatenated. Used as
  // fallback in parseFinalAnswer when Claude emits `"answer": ""` in
  // the final JSON because all the narrative went into between-tool-
  // call commentary instead.
  let allText = "";

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await anthropic.messages.create({
      model: NETWORK_QUERY_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Push the assistant turn into the message history before we
    // execute tool calls — Anthropic requires the tool_use/tool_result
    // pair to live in adjacent turns.
    messages.push({ role: "assistant", content: response.content });

    // Accumulate every iteration's text, not just the final one.
    const iterationText = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    if (iterationText) {
      allText = allText ? `${allText}\n\n${iterationText}` : iterationText;
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );

    if (response.stop_reason === "end_turn" || toolUses.length === 0) {
      // Final answer turn. Collect text content.
      finalText = iterationText;
      break;
    }

    // Execute every tool call in parallel; results go in one user-role
    // turn with tool_result blocks.
    const toolResults = await Promise.all(
      toolUses.map(async (tu) => {
        const tool = TOOLS.find((t) => t.name === tu.name);
        if (!tool) {
          return {
            tu,
            result: {
              data: { error: `unknown tool: ${tu.name}` },
              summary: `Unknown tool: ${tu.name}`,
            },
          };
        }
        try {
          const result = await tool.execute(tu.input, ctx);
          trace.push({
            tool: tu.name,
            input: tu.input,
            summary: result.summary,
          });
          return { tu, result };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          trace.push({
            tool: tu.name,
            input: tu.input,
            summary: `Tool errored: ${msg}`,
          });
          return {
            tu,
            result: {
              data: { error: msg },
              summary: `Tool errored: ${msg}`,
            },
          };
        }
      }),
    );

    messages.push({
      role: "user",
      content: toolResults.map(({ tu, result }) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: JSON.stringify(result.data),
      })),
    });
  }

  return {
    ...parseFinalAnswer(finalText, allText),
    reasoningTrace: trace,
    rawAnswer: finalText || allText,
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    },
  };
}

// ─── Streaming variant (M7.3b) ─────────────────────────────

/**
 * Events emitted by `runNetworkQueryStream`. The endpoint
 * serializes these as SSE; the UI renders them as a live progress
 * trace.
 */
export type StreamEvent =
  | { type: "iteration_start"; iteration: number }
  | { type: "tool_called"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; summary: string; ok: boolean }
  | { type: "text_delta"; text: string }
  | { type: "complete"; result: NetworkQueryResult }
  | { type: "error"; message: string };

/**
 * Streaming version of runNetworkQuery. Yields events as the
 * orchestration unfolds — tool calls show up before they execute,
 * results appear when they return, the final answer streams in
 * word-by-word. Caller (the API route) bridges these events to
 * SSE.
 *
 * Same correctness semantics as the non-streaming version: same
 * tool registry, same termination conditions, same final result
 * shape. The streaming is purely an output channel — if the
 * client disconnects, we still complete + log.
 */
export async function* runNetworkQueryStream(
  params: RunNetworkQueryParams,
): AsyncGenerator<StreamEvent, void, void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    yield { type: "error", message: "ANTHROPIC_API_KEY not configured" };
    return;
  }
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 60_000,
    maxRetries: 2,
  });
  const ctx: ToolContext = { prisma: params.prisma, userId: params.userId };
  const messages: Anthropic.Messages.MessageParam[] = buildSeedMessages(
    params.query,
    params.priorContext,
  );
  const trace: ReasoningStep[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalText = "";
  // M0.x.15 — concatenated text across every iteration. Fallback for
  // parseFinalAnswer when Claude emits `"answer": ""` and all the
  // substantive prose lives in between-tool-call narration. See the
  // matching `allText` accumulator in runNetworkQuery above.
  let allText = "";
  // M0.x.11 — when a prior iteration produced any text, emit a
  // paragraph break before the next iteration's first text_delta
  // so the streaming render shows "...past students.\n\nGreat!..."
  // instead of "...past students.Great!..."
  let prevIterationHadText = false;

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      yield { type: "iteration_start", iteration: iter };
      if (iter > 0 && prevIterationHadText) {
        yield { type: "text_delta", text: "\n\n" };
      }
      let iterationHadText = false;

      const stream = anthropic.messages.stream({
        model: NETWORK_QUERY_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
        messages,
      });

      // Track partial tool_use blocks as they stream in. The full
      // input only assembles after all input_json_delta events for
      // a given index, terminated by content_block_stop. We surface
      // "tool_called" exactly once per tool, on block completion.
      const toolMeta = new Map<number, { name: string; id: string }>();
      const toolInputBuffer = new Map<number, string>();

      for await (const event of stream) {
        if (
          event.type === "content_block_start" &&
          event.content_block.type === "tool_use"
        ) {
          toolMeta.set(event.index, {
            name: event.content_block.name,
            id: event.content_block.id,
          });
          toolInputBuffer.set(event.index, "");
        } else if (
          event.type === "content_block_delta" &&
          event.delta.type === "input_json_delta"
        ) {
          const prev = toolInputBuffer.get(event.index) ?? "";
          toolInputBuffer.set(event.index, prev + event.delta.partial_json);
        } else if (event.type === "content_block_stop") {
          const meta = toolMeta.get(event.index);
          if (meta) {
            const jsonStr = toolInputBuffer.get(event.index) || "{}";
            let input: unknown = {};
            try {
              input = JSON.parse(jsonStr || "{}");
            } catch {
              input = {};
            }
            yield { type: "tool_called", tool: meta.name, input };
          }
        } else if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          iterationHadText = true;
          allText += event.delta.text;
          yield { type: "text_delta", text: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      totalInputTokens += finalMessage.usage.input_tokens;
      totalOutputTokens += finalMessage.usage.output_tokens;
      messages.push({ role: "assistant", content: finalMessage.content });
      prevIterationHadText = iterationHadText;

      const toolUses = finalMessage.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      if (finalMessage.stop_reason === "end_turn" || toolUses.length === 0) {
        finalText = finalMessage.content
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("");
        break;
      }

      // Execute tools — sequential here so each result event lands
      // in order in the client trace. Parallelism saves <1s in
      // practice; the readability win is worth more.
      const toolResults: Array<{
        tu: Anthropic.Messages.ToolUseBlock;
        result: ToolResult;
      }> = [];
      for (const tu of toolUses) {
        const tool = TOOLS.find((t) => t.name === tu.name);
        if (!tool) {
          const result: ToolResult = {
            data: { error: `unknown tool: ${tu.name}` },
            summary: `Unknown tool: ${tu.name}`,
          };
          toolResults.push({ tu, result });
          yield {
            type: "tool_result",
            tool: tu.name,
            summary: result.summary,
            ok: false,
          };
          continue;
        }
        try {
          const result = await tool.execute(tu.input, ctx);
          trace.push({
            tool: tu.name,
            input: tu.input,
            summary: result.summary,
          });
          toolResults.push({ tu, result });
          yield {
            type: "tool_result",
            tool: tu.name,
            summary: result.summary,
            ok: true,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          trace.push({
            tool: tu.name,
            input: tu.input,
            summary: `Tool errored: ${msg}`,
          });
          toolResults.push({
            tu,
            result: { data: { error: msg }, summary: `Tool errored: ${msg}` },
          });
          yield {
            type: "tool_result",
            tool: tu.name,
            summary: `Tool errored: ${msg}`,
            ok: false,
          };
        }
      }

      messages.push({
        role: "user",
        content: toolResults.map(({ tu, result }) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: JSON.stringify(result.data),
        })),
      });
    }

    const result: NetworkQueryResult = {
      ...parseFinalAnswer(finalText, allText),
      reasoningTrace: trace,
      rawAnswer: finalText || allText,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
    yield { type: "complete", result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: "error", message: msg };
  }
}

// ─── Pure parsers (exported for testing) ───────────────────

interface ParsedAnswer {
  title: string | null;
  answer: string;
  suggestedContacts: SuggestedContact[];
}

/**
 * Parse Claude's final text into the structured shape. Tolerates
 * leading/trailing prose around the JSON block. If JSON parsing
 * fails entirely, falls back to using the whole text as `answer`.
 *
 * M0.x.15 — `fallbackText` is the concatenated text from every
 * orchestrator iteration, not just the last one. When Claude emits
 * `"answer": ""` in the final JSON (treating the prose between tool
 * calls as the "real" answer), we use the accumulated prose so the
 * UI doesn't show "empty answer — not persisting." Strips out the
 * JSON block so the answer isn't a duplicated mess of narrative +
 * structured output.
 */
export function parseFinalAnswer(
  text: string,
  fallbackText?: string,
): ParsedAnswer {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      title: null,
      answer: pickAnswer(text, fallbackText) || "",
      suggestedContacts: [],
    };
  }
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
          .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
          .map((s) => ({
            contactId: typeof s.contactId === "string" ? s.contactId : "",
            name: typeof s.name === "string" ? s.name : "",
            reason: typeof s.reason === "string" ? s.reason : "",
          }))
          .filter((s) => s.contactId && s.name)
      : [];
    // Prefer Claude's structured `answer` field. Only fall back when
    // it's explicitly empty / missing / wrong-typed — Claude sometimes
    // does this when all the substantive prose went into the
    // narration between tool calls instead.
    const jsonAnswer =
      typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    const proseWithoutJson = text.replace(match[0], "").trim();
    const answer =
      jsonAnswer ||
      proseWithoutJson ||
      stripJsonFrom(fallbackText ?? "").trim() ||
      text.trim();
    return {
      title: typeof parsed.title === "string" ? parsed.title : null,
      answer,
      suggestedContacts: suggestions,
    };
  } catch {
    return {
      title: null,
      answer: pickAnswer(text, fallbackText) || "",
      suggestedContacts: [],
    };
  }
}

function pickAnswer(text: string, fallbackText?: string): string {
  const trimmed = text.trim();
  if (trimmed) return trimmed;
  return (fallbackText ?? "").trim();
}

function stripJsonFrom(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return text;
  return text.replace(match[0], "");
}

/** Exported for unit testing — internal registry size. */
export const NETWORK_QUERY_TOOL_COUNT = TOOLS.length;
