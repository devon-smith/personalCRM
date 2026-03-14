import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/name-utils";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ─── Validation ─────────────────────────────────────────────

function validateAlias(alias: string): string | null {
  const trimmed = alias.trim();
  if (trimmed.length < 2) return "Alias must be at least 2 characters";
  return null;
}

function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed.includes("@")) return `Invalid email: ${trimmed}`;
  return null;
}

function validatePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return `Phone must have at least 7 digits: ${phone}`;
  return null;
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { aliases, additionalEmails, additionalPhones } = body as {
      aliases?: string[];
      additionalEmails?: string[];
      additionalPhones?: string[];
    };

    // Verify ownership
    const contact = await prisma.contact.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const errors: string[] = [];
    const data: Record<string, string[]> = {};

    // Validate and deduplicate aliases
    if (aliases !== undefined) {
      for (const a of aliases) {
        const err = validateAlias(a);
        if (err) errors.push(err);
      }
      const unique = [...new Set(aliases.map((a) => a.trim()))];
      data.aliases = unique;
    }

    // Validate and deduplicate additional emails
    if (additionalEmails !== undefined) {
      for (const e of additionalEmails) {
        const err = validateEmail(e);
        if (err) errors.push(err);
      }
      // Remove duplicates and exclude primary email
      const primaryEmail = contact.email?.toLowerCase();
      const unique = [
        ...new Set(
          additionalEmails
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e !== primaryEmail),
        ),
      ];
      data.additionalEmails = unique;
    }

    // Validate and deduplicate additional phones
    if (additionalPhones !== undefined) {
      for (const p of additionalPhones) {
        const err = validatePhone(p);
        if (err) errors.push(err);
      }
      // Remove duplicates and exclude primary phone
      const primaryNormalized = contact.phone
        ? normalizePhone(contact.phone)
        : null;
      const unique = [
        ...new Set(
          additionalPhones
            .map((p) => p.trim())
            .filter((p) => normalizePhone(p) !== primaryNormalized),
        ),
      ];
      data.additionalPhones = unique;
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Validation failed", details: errors },
        { status: 400 },
      );
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    const updated = await prisma.contact.update({
      where: { id },
      data,
      select: {
        id: true,
        aliases: true,
        additionalEmails: true,
        additionalPhones: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PUT /api/contacts/[id]/aliases]", error);
    return NextResponse.json(
      { error: "Failed to update aliases" },
      { status: 500 },
    );
  }
}
