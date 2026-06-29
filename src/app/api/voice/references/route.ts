import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadVoiceReference, type UploadOutcome } from "@/lib/voice/references/upload";

/**
 * POST /api/voice/references
 *
 * Multipart upload. Each "files" field is parsed, embedded, and
 * Haiku-summarized into a VoiceReference row. Returns one outcome
 * per file (imported / duplicate / failed) so the UI can show
 * granular feedback without a second request.
 *
 * Optional "sourceType" form field tags every uploaded file with
 * one of: gpt_knowledge_base | manual_upload | book_excerpt |
 * style_guide. Defaults to "gpt_knowledge_base".
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const form = await req.formData();
    const sourceTypeField = form.get("sourceType");
    const sourceType =
      typeof sourceTypeField === "string" && sourceTypeField.length > 0
        ? sourceTypeField
        : "gpt_knowledge_base";

    const fileEntries = form.getAll("files").filter((f): f is File => f instanceof File);
    if (fileEntries.length === 0) {
      return NextResponse.json(
        { error: "No files in upload" },
        { status: 400 },
      );
    }
    if (fileEntries.length > 25) {
      return NextResponse.json(
        { error: "Too many files in one request (max 25)" },
        { status: 400 },
      );
    }

    const outcomes: UploadOutcome[] = [];
    for (const file of fileEntries) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const outcome = await uploadVoiceReference({
        prisma,
        userId,
        filename: file.name,
        buffer,
        sourceType,
      });
      outcomes.push(outcome);
    }

    const importedIds = outcomes
      .filter((outcome) => outcome.status === "imported")
      .map((outcome) => outcome.id);
    const importedReferences = importedIds.length > 0
      ? await prisma.voiceReference.findMany({
          where: { userId, id: { in: importedIds } },
          orderBy: { addedAt: "desc" },
          select: {
            id: true,
            filename: true,
            sourceType: true,
            weight: true,
            byteSize: true,
            guidance: true,
            addedAt: true,
          },
        })
      : [];

    return NextResponse.json({
      outcomes,
      importedReferences: importedReferences.map((reference) => ({
        ...reference,
        addedAt: reference.addedAt.toISOString(),
      })),
      summary: {
        imported: outcomes.filter((o) => o.status === "imported").length,
        duplicates: outcomes.filter((o) => o.status === "duplicate").length,
        failed: outcomes.filter((o) => o.status === "failed").length,
      },
    });
  } catch (error) {
    console.error("[POST /api/voice/references]", error);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/voice/references — list the user's reference materials.
 * The `content` field is omitted to keep the list payload small;
 * fetch a specific row for full content.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const rows = await prisma.voiceReference.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
      select: {
        id: true,
        filename: true,
        sourceType: true,
        weight: true,
        byteSize: true,
        guidance: true,
        addedAt: true,
      },
    });

    return NextResponse.json({
      references: rows.map((r) => ({
        ...r,
        addedAt: r.addedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[GET /api/voice/references]", error);
    return NextResponse.json(
      { error: "Failed to list references" },
      { status: 500 },
    );
  }
}
