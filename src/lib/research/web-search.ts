/**
 * Anthropic web_search tool wrapper for the meeting prep "Open web"
 * section. Returns a brief AI-written summary plus the cited URLs so
 * the user can verify any claim.
 *
 * Server-side tool: Claude itself executes the search; we just inspect
 * the response for text and citation blocks. No iterative tool-result
 * loop needed.
 *
 * Cached for 3 days in ExternalResearchCache — recent news for a given
 * contact doesn't change minute-to-minute, and we'd rather skip a paid
 * Claude call than show stale information.
 */

import Anthropic from "@anthropic-ai/sdk";
import { withCache } from "./cache";
import { logAIGeneration } from "@/lib/ai-generation-log";

const MODEL = "claude-sonnet-4-5";
const WEB_SEARCH_TOOL_NAME = "web_search_20250305" as const;
const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export interface WebSearchCitation {
  url: string;
  title: string | null;
  snippet: string | null;
}

export interface WebSearchResult {
  /** Short, AI-summarized recap of recent activity. */
  summary: string;
  /** Source URLs Claude cited. Empty when nothing was found. */
  citations: WebSearchCitation[];
  /** True when the tool reported no results — UI shows "no recent mentions". */
  emptyResult: boolean;
}

export interface SearchContactWebInput {
  userId: string;
  contactId: string;
  name: string;
  company: string | null;
}

/**
 * Search the open web for recent activity by a contact. Cached per
 * (contactId, name, company) so changing any of those reruns the
 * search. Returns null when ANTHROPIC_API_KEY is unset — UI then
 * hides the section silently.
 */
export async function searchContactWeb(
  input: SearchContactWebInput,
): Promise<WebSearchResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  // Cache key includes a fingerprint so a contact's company change
  // invalidates the cached search.
  const fingerprint = [input.name, input.company ?? ""].join("|").toLowerCase();
  const cacheKey = {
    source: "anthropic",
    kind: "web_search",
    externalKey: `${input.contactId}|${fingerprint}`,
  };

  return withCache(cacheKey, CACHE_TTL_MS, async () => {
    return runWebSearch(input);
  });
}

async function runWebSearch(
  input: SearchContactWebInput,
): Promise<WebSearchResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const startedAt = Date.now();

  const subject = input.company
    ? `${input.name} (${input.company})`
    : input.name;

  const prompt = `Search the web for recent news, talks, papers, or notable activity by ${subject} from the last 90 days. Summarize in 2-3 sentences, max 80 words. If nothing relevant comes up, say "No recent activity found." Cite every claim you make.`;

  let response: Anthropic.Messages.Message;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      tools: [
        {
          type: WEB_SEARCH_TOOL_NAME,
          name: "web_search",
          max_uses: 3,
        } as unknown as Anthropic.Messages.Tool,
      ],
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    await logAIGeneration({
      userId: input.userId,
      feature: "meeting_prep_web_search",
      model: MODEL,
      inputRefs: [`contact:${input.contactId}`],
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const { summary, citations } = parseResponse(response);
  const emptyResult = /no recent activity found/i.test(summary)
    || citations.length === 0;

  await logAIGeneration({
    userId: input.userId,
    feature: "meeting_prep_web_search",
    model: MODEL,
    inputRefs: [`contact:${input.contactId}`],
    tokensIn: response.usage?.input_tokens ?? null,
    tokensOut: response.usage?.output_tokens ?? null,
    latencyMs: Date.now() - startedAt,
  });

  return { summary, citations, emptyResult };
}

/**
 * Pull the assistant-text + citation blocks out of an Anthropic message.
 * The web_search tool emits text blocks that may include `citations`
 * metadata pointing at the URLs it consulted.
 */
function parseResponse(response: Anthropic.Messages.Message): {
  summary: string;
  citations: WebSearchCitation[];
} {
  const textParts: string[] = [];
  const seenUrls = new Set<string>();
  const citations: WebSearchCitation[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      textParts.push(block.text);

      // Citations can show up as a metadata array on text blocks.
      const cites = (block as unknown as {
        citations?: Array<{
          url?: string;
          title?: string;
          cited_text?: string;
        }>;
      }).citations;
      if (Array.isArray(cites)) {
        for (const c of cites) {
          if (!c.url || seenUrls.has(c.url)) continue;
          seenUrls.add(c.url);
          citations.push({
            url: c.url,
            title: c.title ?? null,
            snippet: c.cited_text ?? null,
          });
        }
      }
    }
  }

  return {
    summary: textParts.join(" ").trim(),
    citations,
  };
}
