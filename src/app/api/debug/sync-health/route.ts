import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/debug/sync-health
 * Diagnostic endpoint showing the health of the full data pipeline.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const now = new Date();
    const days7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const days30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const days90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Run all queries in parallel
    const [
      channelCounts,
      directionCounts,
      oldest,
      newest,
      last7,
      last30,
      last90,
      totalInteractions,
      totalContacts,
      withEmail,
      withPhone,
      withBoth,
      withAdditionalEmails,
      actionCounts,
      gmailState,
      emailMessageCount,
    ] = await Promise.all([
      prisma.interaction.groupBy({
        by: ["channel"],
        where: { userId },
        _count: true,
        orderBy: { _count: { channel: "desc" } },
      }),
      prisma.interaction.groupBy({
        by: ["direction"],
        where: { userId },
        _count: true,
      }),
      prisma.interaction.findFirst({
        where: { userId },
        orderBy: { occurredAt: "asc" },
        select: { occurredAt: true },
      }),
      prisma.interaction.findFirst({
        where: { userId },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
      }),
      prisma.interaction.count({ where: { userId, occurredAt: { gte: days7 } } }),
      prisma.interaction.count({ where: { userId, occurredAt: { gte: days30 } } }),
      prisma.interaction.count({ where: { userId, occurredAt: { gte: days90 } } }),
      prisma.interaction.count({ where: { userId } }),
      prisma.contact.count({ where: { userId } }),
      prisma.contact.count({ where: { userId, email: { not: null } } }),
      prisma.contact.count({ where: { userId, phone: { not: null } } }),
      prisma.contact.count({ where: { userId, email: { not: null }, phone: { not: null } } }),
      prisma.contact.count({ where: { userId, additionalEmails: { isEmpty: false } } }),
      prisma.actionItem.groupBy({
        by: ["status"],
        where: { userId },
        _count: true,
      }),
      prisma.gmailSyncState.findFirst({ where: { userId } }),
      prisma.emailMessage.count({ where: { userId } }),
    ]);

    // Channel+direction breakdown
    const channelDirectionCounts = await prisma.interaction.groupBy({
      by: ["channel", "direction"],
      where: { userId },
      _count: true,
      orderBy: { _count: { channel: "desc" } },
    });

    const byChannel: Record<string, number> = {};
    for (const c of channelCounts) {
      byChannel[c.channel ?? "null"] = c._count;
    }

    const byDirection: Record<string, number> = {};
    for (const d of directionCounts) {
      byDirection[d.direction ?? "null"] = d._count;
    }

    const byChannelDirection: Record<string, number> = {};
    for (const cd of channelDirectionCounts) {
      byChannelDirection[`${cd.channel ?? "null"}:${cd.direction ?? "null"}`] = cd._count;
    }

    const actionsByStatus: Record<string, number> = {};
    for (const a of actionCounts) {
      actionsByStatus[a.status] = a._count;
    }

    return NextResponse.json({
      interactions: {
        total: totalInteractions,
        byChannel,
        byDirection,
        byChannelDirection,
        dateRange: {
          oldest: oldest?.occurredAt?.toISOString() ?? null,
          newest: newest?.occurredAt?.toISOString() ?? null,
        },
        last7Days: last7,
        last30Days: last30,
        last90Days: last90,
      },
      contacts: {
        total: totalContacts,
        withEmail,
        withPhone,
        withBoth,
        withAdditionalEmails,
      },
      actionItems: actionsByStatus,
      emailMessages: emailMessageCount,
      syncState: {
        gmailLastSync: gmailState?.lastSyncAt?.toISOString() ?? null,
        gmailHistoryId: gmailState?.historyId ?? null,
        gmailSyncEnabled: gmailState?.syncEnabled ?? false,
        additionalUserEmails: gmailState?.additionalUserEmails ?? [],
      },
    });
  } catch (error) {
    console.error("[GET /api/debug/sync-health]", error);
    return NextResponse.json(
      { error: "Failed to get sync health" },
      { status: 500 },
    );
  }
}
