export interface ManualGmailSyncResult {
  processed: number;
  contentChanged: boolean;
  scannedActions: boolean;
  actionsSaved: number;
  changedThreads: GmailChangedThreadRef[];
}

interface GmailChangedThreadRef {
  accountId: string;
  threadId: string;
}

function apiErrorMessage(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return fallback;
}

function parseChangedThreads(body: unknown): GmailChangedThreadRef[] {
  if (!body || typeof body !== "object" || !("changedThreads" in body)) {
    return [];
  }
  const value = body.changedThreads;
  if (!Array.isArray(value)) return [];

  return value.filter(
    (item): item is GmailChangedThreadRef =>
      typeof item === "object" &&
      item !== null &&
      "accountId" in item &&
      typeof item.accountId === "string" &&
      "threadId" in item &&
      typeof item.threadId === "string",
  );
}

export async function runManualGmailSync(): Promise<ManualGmailSyncResult> {
  const syncRes = await fetch("/api/gmail/sync", { method: "POST" });
  const syncBody = await syncRes.json().catch(() => ({}));
  if (!syncRes.ok) {
    throw new Error(apiErrorMessage(syncBody, "Gmail sync failed"));
  }

  const processed = Number((syncBody as { processed?: number }).processed ?? 0);
  const changedThreads = parseChangedThreads(syncBody);
  const contentChanged = processed > 0 || changedThreads.length > 0;
  if (!contentChanged) {
    return {
      processed: 0,
      contentChanged: false,
      scannedActions: false,
      actionsSaved: 0,
      changedThreads: [],
    };
  }

  if (changedThreads.length === 0) {
    return {
      processed,
      contentChanged: true,
      scannedActions: false,
      actionsSaved: 0,
      changedThreads,
    };
  }

  const extractRes = await fetch("/api/gmail/extract-actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changedThreads }),
  });
  const extractBody = await extractRes.json().catch(() => ({}));
  if (!extractRes.ok) {
    throw new Error(apiErrorMessage(extractBody, "Action scan failed"));
  }

  return {
    processed,
    contentChanged: true,
    scannedActions: true,
    actionsSaved: Number((extractBody as { actionsSaved?: number }).actionsSaved ?? 0),
    changedThreads,
  };
}
