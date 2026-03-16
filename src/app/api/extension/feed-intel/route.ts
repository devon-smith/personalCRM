import { NextResponse } from "next/server";
import { authExtension } from "@/lib/extension-auth";
import { prisma } from "@/lib/prisma";

interface FeedItem {
  linkedinUrl: string;
  authorName: string;
  type: "post" | "job_change" | "work_anniversary" | "birthday" | "education" | "engagement" | "content_share";
  preview: string;
  newCompany?: string;
  newRole?: string;
}

/**
 * POST /api/extension/feed-intel
 * Receives feed items detected from LinkedIn feed scrolling.
 * Creates interactions for posts, and updates contact records for job changes.
 */
export async function POST(request: Request) {
  try {
    const authResult = await authExtension(request);
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.userId;

    const body = await request.json();
    const items: FeedItem[] = body.items;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "items array required" },
        { status: 400 },
      );
    }

    let processed = 0;
    let skipped = 0;
    const results: Array<{ name: string; action: string }> = [];

    for (const item of items.slice(0, 20)) {
      if (!item.linkedinUrl || !item.type) {
        skipped++;
        continue;
      }

      const normalized = item.linkedinUrl
        .split("?")[0]
        .replace(/\/overlay\/.*$/, "")
        .replace(/\/+$/, "");

      // Find contact
      const contact = await prisma.contact.findFirst({
        where: { userId, linkedinUrl: { startsWith: normalized } },
        select: { id: true, name: true, company: true, role: true },
      });

      if (!contact) {
        skipped++;
        continue;
      }

      if (item.type === "post") {
        // Dedup: don't log same person's post within 4 hours
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
        const recent = await prisma.interaction.findFirst({
          where: {
            userId,
            contactId: contact.id,
            channel: "linkedin",
            type: "NOTE",
            summary: { startsWith: "Posted on LinkedIn:" },
            occurredAt: { gte: fourHoursAgo },
          },
        });

        if (!recent) {
          const preview = (item.preview || "").slice(0, 200);
          await prisma.interaction.create({
            data: {
              userId,
              contactId: contact.id,
              type: "NOTE",
              direction: "INBOUND",
              channel: "linkedin",
              summary: `Posted on LinkedIn: ${preview}`,
              occurredAt: new Date(),
              sourceId: `linkedin-post:${contact.id}:${Date.now()}`,
            },
          });

          await prisma.contact.update({
            where: { id: contact.id },
            data: { lastInteraction: new Date() },
          });

          processed++;
          results.push({ name: contact.name, action: "post logged" });
        } else {
          skipped++;
        }
      } else if (item.type === "job_change") {
        // Update contact record if company/role changed
        const updates: Record<string, string> = {};
        if (item.newCompany && item.newCompany !== contact.company) {
          updates.company = item.newCompany;
        }
        if (item.newRole && item.newRole !== contact.role) {
          updates.role = item.newRole;
        }

        if (Object.keys(updates).length > 0) {
          await prisma.contact.update({
            where: { id: contact.id },
            data: updates,
          });
        }

        // Log as interaction
        const summary = item.newRole && item.newCompany
          ? `Job change: ${item.newRole} at ${item.newCompany}`
          : `Job change: ${item.preview.slice(0, 150)}`;

        // Dedup: 24 hours for job changes
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentChange = await prisma.interaction.findFirst({
          where: {
            userId,
            contactId: contact.id,
            channel: "linkedin",
            summary: { startsWith: "Job change:" },
            occurredAt: { gte: oneDayAgo },
          },
        });

        if (!recentChange) {
          await prisma.interaction.create({
            data: {
              userId,
              contactId: contact.id,
              type: "NOTE",
              direction: "INBOUND",
              channel: "linkedin",
              summary,
              occurredAt: new Date(),
              sourceId: `linkedin-jobchange:${contact.id}:${Date.now()}`,
            },
          });
          processed++;
          results.push({ name: contact.name, action: "job change detected" });
        } else {
          skipped++;
        }
      } else if (
        item.type === "work_anniversary" ||
        item.type === "birthday" ||
        item.type === "education"
      ) {
        // Log milestone events (dedup 24h)
        const summaryMap = {
          work_anniversary: "Work anniversary",
          birthday: "Birthday",
          education: "Education update",
        };
        const label = summaryMap[item.type];
        const summary = `${label}: ${item.preview.slice(0, 150)}`;

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recent = await prisma.interaction.findFirst({
          where: {
            userId,
            contactId: contact.id,
            channel: "linkedin",
            summary: { startsWith: `${label}:` },
            occurredAt: { gte: oneDayAgo },
          },
        });

        if (!recent) {
          await prisma.interaction.create({
            data: {
              userId,
              contactId: contact.id,
              type: "NOTE",
              direction: "INBOUND",
              channel: "linkedin",
              summary,
              occurredAt: new Date(),
              sourceId: `linkedin-${item.type}:${contact.id}:${Date.now()}`,
            },
          });
          processed++;
          results.push({ name: contact.name, action: label });
        } else {
          skipped++;
        }
      } else if (item.type === "engagement") {
        // Someone in CRM engaged with the user's post (liked, commented)
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
        const recent = await prisma.interaction.findFirst({
          where: {
            userId,
            contactId: contact.id,
            channel: "linkedin",
            summary: { startsWith: "Engaged with your" },
            occurredAt: { gte: fourHoursAgo },
          },
        });

        if (!recent) {
          const summary = `Engaged with your LinkedIn post: ${(item.preview || "").slice(0, 150)}`;
          await prisma.interaction.create({
            data: {
              userId,
              contactId: contact.id,
              type: "NOTE",
              direction: "INBOUND",
              channel: "linkedin",
              summary,
              occurredAt: new Date(),
              sourceId: `linkedin-engagement:${contact.id}:${Date.now()}`,
            },
          });

          await prisma.contact.update({
            where: { id: contact.id },
            data: { lastInteraction: new Date() },
          });

          processed++;
          results.push({ name: contact.name, action: "engagement" });
        } else {
          skipped++;
        }
      } else if (item.type === "content_share") {
        // CRM contact shared an article or wrote about a topic
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
        const recent = await prisma.interaction.findFirst({
          where: {
            userId,
            contactId: contact.id,
            channel: "linkedin",
            summary: { startsWith: "Shared on LinkedIn:" },
            occurredAt: { gte: fourHoursAgo },
          },
        });

        if (!recent) {
          const preview = (item.preview || "").slice(0, 200);
          await prisma.interaction.create({
            data: {
              userId,
              contactId: contact.id,
              type: "NOTE",
              direction: "INBOUND",
              channel: "linkedin",
              summary: `Shared on LinkedIn: ${preview}`,
              occurredAt: new Date(),
              sourceId: `linkedin-share:${contact.id}:${Date.now()}`,
            },
          });

          await prisma.contact.update({
            where: { id: contact.id },
            data: { lastInteraction: new Date() },
          });

          processed++;
          results.push({ name: contact.name, action: "content share" });
        } else {
          skipped++;
        }
      }
    }

    return NextResponse.json({
      processed,
      skipped,
      results,
    });
  } catch (error) {
    console.error("[POST /api/extension/feed-intel]", error);
    return NextResponse.json(
      { error: "Failed to process feed intel" },
      { status: 500 },
    );
  }
}
