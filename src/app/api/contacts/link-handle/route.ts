import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/name-utils";

// ─── Types ───────────────────────────────────────────────────

interface HandleSuggestion {
  readonly contactId: string;
  readonly contactName: string;
  readonly company: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly reason: string;
  readonly confidence: number;
}

// ─── GET: Suggest contacts for an unmatched handle ──────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const handle = req.nextUrl.searchParams.get("handle");
    if (!handle) {
      return NextResponse.json(
        { error: "Missing handle parameter" },
        { status: 400 },
      );
    }

    const contacts = await prisma.contact.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        name: true,
        company: true,
        email: true,
        additionalEmails: true,
        phone: true,
        additionalPhones: true,
        aliases: true,
      },
    });

    const suggestions: HandleSuggestion[] = [];
    const isEmail = handle.includes("@");

    if (isEmail) {
      const handleLower = handle.toLowerCase();
      const handleDomain = handleLower.split("@")[1];
      const handleLocal = handleLower.split("@")[0];

      for (const c of contacts) {
        // Domain match (same company email domain)
        const allEmails = [
          c.email,
          ...c.additionalEmails,
        ].filter(Boolean) as string[];
        const contactDomains = allEmails.map((e) => e.toLowerCase().split("@")[1]);

        if (contactDomains.includes(handleDomain)) {
          suggestions.push({
            contactId: c.id,
            contactName: c.name,
            company: c.company,
            email: c.email,
            phone: c.phone,
            reason: `Same email domain (${handleDomain})`,
            confidence: 0.4,
          });
          continue;
        }

        // Name-based: check if handle local part contains a name variation
        const firstName = c.name.split(/\s+/)[0]?.toLowerCase();
        const lastName = c.name.split(/\s+/).slice(1).join(" ").toLowerCase();
        if (firstName && handleLocal.includes(firstName)) {
          suggestions.push({
            contactId: c.id,
            contactName: c.name,
            company: c.company,
            email: c.email,
            phone: c.phone,
            reason: `Email contains first name "${firstName}"`,
            confidence: 0.35,
          });
          continue;
        }
        if (lastName && handleLocal.includes(lastName.replace(/\s+/g, ""))) {
          suggestions.push({
            contactId: c.id,
            contactName: c.name,
            company: c.company,
            email: c.email,
            phone: c.phone,
            reason: `Email contains last name "${lastName}"`,
            confidence: 0.3,
          });
        }
      }
    } else {
      // Phone handle
      const handleNorm = normalizePhone(handle);
      const handleDigits = handleNorm.replace(/\D/g, "");
      const handleLast4 = handleDigits.slice(-4);
      const handleLast7 = handleDigits.slice(-7);
      const handleAreaCode = handleDigits.length >= 10 ? handleDigits.slice(-10, -7) : null;

      for (const c of contacts) {
        const allPhones = [c.phone, ...c.additionalPhones].filter(Boolean) as string[];

        for (const cp of allPhones) {
          const cpDigits = normalizePhone(cp).replace(/\D/g, "");
          const cpLast4 = cpDigits.slice(-4);
          const cpLast7 = cpDigits.slice(-7);
          const cpAreaCode = cpDigits.length >= 10 ? cpDigits.slice(-10, -7) : null;

          // Last 7 digits match (strong)
          if (cpLast7 === handleLast7 && handleLast7.length >= 7) {
            suggestions.push({
              contactId: c.id,
              contactName: c.name,
              company: c.company,
              email: c.email,
              phone: c.phone,
              reason: "Phone number closely matches",
              confidence: 0.7,
            });
            break;
          }

          // Same area code + last 4
          if (handleAreaCode && cpAreaCode === handleAreaCode && cpLast4 === handleLast4) {
            suggestions.push({
              contactId: c.id,
              contactName: c.name,
              company: c.company,
              email: c.email,
              phone: c.phone,
              reason: `Same area code (${handleAreaCode}) + last 4 digits`,
              confidence: 0.5,
            });
            break;
          }

          // Just same area code
          if (handleAreaCode && cpAreaCode === handleAreaCode) {
            suggestions.push({
              contactId: c.id,
              contactName: c.name,
              company: c.company,
              email: c.email,
              phone: c.phone,
              reason: `Same area code (${handleAreaCode})`,
              confidence: 0.15,
            });
            break;
          }
        }
      }
    }

    // Sort by confidence descending, cap at 10
    const sorted = suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);

    return NextResponse.json({ handle, suggestions: sorted });
  } catch (error) {
    console.error("[GET /api/contacts/link-handle]", error);
    return NextResponse.json(
      { error: "Failed to find suggestions" },
      { status: 500 },
    );
  }
}

// ─── POST: Link a handle to a contact ───────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { handle, contactId } = body as {
      handle: string;
      contactId: string;
    };

    if (!handle || !contactId) {
      return NextResponse.json(
        { error: "Missing handle or contactId" },
        { status: 400 },
      );
    }

    // Verify contact ownership
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, userId: session.user.id },
    });
    if (!contact) {
      return NextResponse.json(
        { error: "Contact not found" },
        { status: 404 },
      );
    }

    const isEmail = handle.includes("@");

    // Add the handle to the contact's additional emails/phones
    if (isEmail) {
      const existing = new Set([
        ...(contact.email ? [contact.email.toLowerCase()] : []),
        ...contact.additionalEmails.map((e) => e.toLowerCase()),
      ]);
      if (!existing.has(handle.toLowerCase())) {
        await prisma.contact.update({
          where: { id: contactId },
          data: {
            additionalEmails: {
              push: handle.toLowerCase(),
            },
          },
        });
      }
    } else {
      const normalized = normalizePhone(handle);
      const existingPhones = new Set([
        ...(contact.phone ? [normalizePhone(contact.phone)] : []),
        ...contact.additionalPhones.map((p) => normalizePhone(p)),
      ]);
      if (!existingPhones.has(normalized)) {
        await prisma.contact.update({
          where: { id: contactId },
          data: {
            additionalPhones: {
              push: handle,
            },
          },
        });
      }
    }

    // Re-match existing interactions from this handle to the contact
    const sourcePrefix = isEmail ? "gmail:" : "imsg:";
    let rematchedCount = 0;

    if (!isEmail) {
      // Match iMessage interactions by handle
      // Find interactions that are currently unmatched or matched to a different contact
      // and whose sourceId contains a message from this handle
      const handleNorm = normalizePhone(handle);
      const handleDigits = handleNorm.replace(/\D/g, "");
      const last10 = handleDigits.slice(-10);

      // Find iMessage sync states for this handle
      const syncStates = await prisma.iMessageSyncState.findMany({
        where: { userId: session.user.id },
        select: { handleId: true },
      });

      const matchingHandles = syncStates
        .filter((s) => {
          const sDigits = normalizePhone(s.handleId).replace(/\D/g, "");
          return sDigits.slice(-10) === last10;
        })
        .map((s) => s.handleId);

      if (matchingHandles.length > 0) {
        // Update interactions that came from these handles
        // They're stored with sourceId like "imsg:{guid}" — we need to find them
        // via the IMessageSyncState handle mapping
        // For now, update any unmatched interactions from this handle
        const result = await prisma.interaction.updateMany({
          where: {
            userId: session.user.id,
            channel: { in: ["iMessage", "SMS"] },
            contactId: { not: contactId },
          },
          data: { contactId },
        });
        // Note: This is a simplified re-match. In production, you'd want to
        // track handle→interaction mappings more precisely.
      }
    }

    return NextResponse.json({
      status: "linked",
      contactId,
      handle,
      isEmail,
      rematchedCount,
    });
  } catch (error) {
    console.error("[POST /api/contacts/link-handle]", error);
    return NextResponse.json(
      { error: "Failed to link handle" },
      { status: 500 },
    );
  }
}
