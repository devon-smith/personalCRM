import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─── Types ───────────────────────────────────────────────────

interface ContactCoverage {
  readonly contactId: string;
  readonly name: string;
  readonly company: string | null;
  readonly tier: string;
  readonly totalInteractions: number;
  readonly lastInboundAt: string | null;
  readonly lastOutboundAt: string | null;
  readonly channels: readonly string[];
  readonly needsResponse: boolean;
  readonly summary: string;
}

/**
 * GET /api/backfill/coverage
 *
 * Returns a relationship coverage report for all contacts with
 * interactions in the last 90 days.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const since = new Date();
  since.setDate(since.getDate() - 90);

  // Get all interactions in the last 90 days grouped by contact
  const interactions = await prisma.interaction.findMany({
    where: {
      userId,
      occurredAt: { gte: since },
    },
    select: {
      contactId: true,
      direction: true,
      channel: true,
      occurredAt: true,
    },
    orderBy: { occurredAt: "desc" },
  });

  // Get contact info
  const contactIds = [...new Set(interactions.map((i) => i.contactId))];
  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, userId },
    select: {
      id: true,
      name: true,
      company: true,
      tier: true,
    },
  });
  const contactMap = new Map(contacts.map((c) => [c.id, c]));

  // Build per-contact stats
  const statsMap = new Map<
    string,
    {
      total: number;
      lastInbound: Date | null;
      lastOutbound: Date | null;
      channels: Set<string>;
      channelCounts: Map<string, number>;
    }
  >();

  for (const ix of interactions) {
    let stats = statsMap.get(ix.contactId);
    if (!stats) {
      stats = {
        total: 0,
        lastInbound: null,
        lastOutbound: null,
        channels: new Set(),
        channelCounts: new Map(),
      };
      statsMap.set(ix.contactId, stats);
    }

    stats.total++;
    if (ix.channel) {
      stats.channels.add(ix.channel);
      stats.channelCounts.set(
        ix.channel,
        (stats.channelCounts.get(ix.channel) ?? 0) + 1,
      );
    }

    if (ix.direction === "INBOUND") {
      if (!stats.lastInbound || ix.occurredAt > stats.lastInbound) {
        stats.lastInbound = ix.occurredAt;
      }
    } else {
      if (!stats.lastOutbound || ix.occurredAt > stats.lastOutbound) {
        stats.lastOutbound = ix.occurredAt;
      }
    }
  }

  // Build coverage report
  const coverage: ContactCoverage[] = [];

  for (const [contactId, stats] of statsMap) {
    const contact = contactMap.get(contactId);
    if (!contact) continue;

    // Determine if needs response: last interaction was inbound with no later outbound
    const needsResponse =
      stats.lastInbound !== null &&
      (stats.lastOutbound === null || stats.lastInbound > stats.lastOutbound);

    // Build human-readable summary
    const channelParts = [...stats.channelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([ch, count]) => `${count} ${ch}`);

    const now = Date.now();
    let summary: string;

    if (needsResponse && stats.lastInbound) {
      const daysAgo = Math.round(
        (now - stats.lastInbound.getTime()) / (1000 * 60 * 60 * 24),
      );
      summary = `${stats.total} interactions (${channelParts.join(", ")}), last heard from ${daysAgo}d ago, NO REPLY from you`;
    } else if (stats.lastOutbound && stats.lastInbound) {
      const lastInDays = Math.round(
        (now - stats.lastInbound.getTime()) / (1000 * 60 * 60 * 24),
      );
      const repliedSameDay =
        stats.lastOutbound.getTime() - stats.lastInbound.getTime() <
        24 * 60 * 60 * 1000;
      summary = `${stats.total} interactions (${channelParts.join(", ")}), last heard from ${lastInDays}d ago${repliedSameDay ? ", you replied same day" : ", conversation appears done"}`;
    } else if (stats.lastOutbound) {
      summary = `${stats.total} interactions (${channelParts.join(", ")}), outbound only — you reached out`;
    } else {
      summary = `${stats.total} interactions (${channelParts.join(", ")})`;
    }

    coverage.push({
      contactId,
      name: contact.name,
      company: contact.company,
      tier: contact.tier,
      totalInteractions: stats.total,
      lastInboundAt: stats.lastInbound?.toISOString() ?? null,
      lastOutboundAt: stats.lastOutbound?.toISOString() ?? null,
      channels: [...stats.channels],
      needsResponse,
      summary,
    });
  }

  // Sort by total interactions descending
  coverage.sort((a, b) => b.totalInteractions - a.totalInteractions);

  // Summary stats
  const needingResponse = coverage.filter((c) => c.needsResponse).length;
  const totalWithInteractions = coverage.length;

  return NextResponse.json({
    coverage,
    stats: {
      contactsWithInteractions: totalWithInteractions,
      needingResponse,
      totalInteractions: interactions.length,
      channelBreakdown: Object.fromEntries(
        [...new Set(interactions.map((i) => i.channel).filter(Boolean))].map(
          (ch) => [ch, interactions.filter((i) => i.channel === ch).length],
        ),
      ),
    },
  });
}
