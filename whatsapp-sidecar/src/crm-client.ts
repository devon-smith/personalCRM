import { config } from "./config.js";

// ─── Types ──────────────────────────────────────────────────

export interface SyncMessage {
  readonly text: string;
  readonly timestamp: string; // ISO 8601
  readonly isFromMe: boolean;
  readonly senderName: string;
  readonly messageId: string; // WhatsApp message ID for dedup
}

export interface SyncPayload {
  readonly phone: string;
  readonly displayName: string;
  readonly messages: readonly SyncMessage[];
  readonly isGroup: boolean;
  readonly groupName?: string;
  readonly groupId?: string;
}

// ─── HTTP client ────────────────────────────────────────────

interface CrmResponse {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

async function crmFetch(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<CrmResponse> {
  const url = `${config.crmBaseUrl}${path}`;

  try {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.crmToken}`,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status}: ${text}` };
    }

    const data = await res.json().catch(() => ({}));
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Post a batch of messages to the CRM sync endpoint.
 */
export async function syncMessages(payload: SyncPayload): Promise<CrmResponse> {
  return crmFetch("/api/whatsapp/sync", {
    method: "POST",
    body: payload,
  });
}

/**
 * Send a heartbeat to the CRM to report connection status.
 */
export async function sendHeartbeat(connected: boolean, phone?: string): Promise<CrmResponse> {
  return crmFetch("/api/whatsapp/heartbeat", {
    method: "POST",
    body: { connected, phone },
  });
}
