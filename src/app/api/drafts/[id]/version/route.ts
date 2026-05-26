import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  parseVersions,
  nextVersionNumber,
  type WorkspaceVersion,
  type WorkspaceVersionSource,
} from "@/lib/drafts/workspace-types";

/**
 * POST /api/drafts/[id]/version
 *
 * Append a new version to the workspace — used for:
 *   - Manual edits (typed-in changes Jennifer wants to checkpoint)
 *   - Variant picks (one of the 3 variants becomes the current draft)
 *   - Reverts to a prior version (which appends a copy of that
 *     version as the new current; we never lose history)
 *
 * Body: { content, subjectLine?, sourceRequest?, source }
 */
const VALID_SOURCES: WorkspaceVersionSource[] = [
  "manual_edit",
  "variant_pick",
  "refinement", // for completeness — refinement endpoint usually writes its own
  "initial",
];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await params;

    const body = await req.json().catch(() => ({})) as {
      content?: string;
      subjectLine?: string | null;
      sourceRequest?: string;
      source?: WorkspaceVersionSource;
    };
    if (typeof body.content !== "string" || body.content.length === 0) {
      return NextResponse.json(
        { error: "content required" },
        { status: 400 },
      );
    }
    const source: WorkspaceVersionSource =
      body.source && VALID_SOURCES.includes(body.source)
        ? body.source
        : "manual_edit";

    const draft = await prisma.draft.findFirst({
      where: { id, userId },
      select: { id: true, workspaceVersions: true },
    });
    if (!draft) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const versions = parseVersions(draft.workspaceVersions);
    const versionNumber = nextVersionNumber(versions);
    const newVersion: WorkspaceVersion = {
      version: versionNumber,
      content: body.content,
      subjectLine:
        typeof body.subjectLine === "string" ? body.subjectLine : null,
      generatedAt: new Date().toISOString(),
      sourceRequest:
        typeof body.sourceRequest === "string"
          ? body.sourceRequest
          : source === "manual_edit"
            ? "Manual edit"
            : "version save",
      source,
    };
    const nextVersions = [...versions, newVersion];

    await prisma.draft.update({
      where: { id },
      data: {
        content: body.content,
        subjectLine: newVersion.subjectLine,
        workspaceVersions: nextVersions as unknown as object,
      },
    });

    return NextResponse.json({ version: newVersion });
  } catch (error) {
    console.error("[POST /api/drafts/[id]/version]", error);
    return NextResponse.json(
      { error: "Failed to save version" },
      { status: 500 },
    );
  }
}
