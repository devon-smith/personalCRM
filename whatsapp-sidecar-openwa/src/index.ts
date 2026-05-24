import { create, type Client } from "@open-wa/wa-automate";
import { config } from "./config.js";
import {
  init as initMessageHandler,
  handleMessage,
  shutdown as shutdownHandler,
} from "./message-handler.js";
import { sendHeartbeat } from "./crm-client.js";
import { runHistoryBackfill } from "./history-backfill.js";

// ─── Heartbeat ──────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 60_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let connectedPhone: string | undefined;

function startHeartbeat(): void {
  stopHeartbeat();
  sendHeartbeat(true, connectedPhone).catch(() => {});
  heartbeatTimer = setInterval(() => {
    sendHeartbeat(true, connectedPhone).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─── Main ───────────────────────────────────────────────────

async function start(): Promise<void> {
  const client: Client = await create({
    sessionId: config.sessionId,
    multiDevice: true,
    headless: true,
    sessionDataPath: config.sessionDir,
    // open-wa prints its own QR to stdout by default; no qrcode-terminal
    // dependency needed here.
    qrTimeout: 0,
    authTimeout: 60,
    disableSpins: true,
    blockCrashLogs: true,
    logConsole: false,
    popup: false,
    ...(config.chromePath ? { executablePath: config.chromePath } : {}),
  });

  initMessageHandler(client);

  // open-wa connection state — fires CONNECTED / CONFLICT / UNPAIRED / etc.
  client.onStateChanged(async (state) => {
    console.log(`[openwa] state: ${state}`);
    if (state === "CONFLICT" || state === "UNLAUNCHED") {
      // Another linked device session is taking precedence (the baileys
      // sidecar can trigger this if WhatsApp routes a session preference).
      // forceRefocus reclaims control.
      await client.forceRefocus().catch(() => {});
    }
    if (state === "UNPAIRED" || state === "CONFLICT") {
      stopHeartbeat();
      await sendHeartbeat(false, connectedPhone).catch(() => {});
    }
  });

  // Identify our phone number for heartbeat reporting.
  try {
    const me = await client.getHostNumber();
    if (me) connectedPhone = me.toString().replace(/\D/g, "");
  } catch {
    // ignore; heartbeat just omits phone
  }

  console.log(
    "[openwa] Connected" + (connectedPhone ? ` (${connectedPhone})` : ""),
  );
  startHeartbeat();

  // Incoming messages (both 1:1 and group).
  client.onMessage(async (msg) => {
    try {
      await handleMessage(msg);
    } catch (err) {
      console.error("[openwa] handleMessage error:", err);
    }
  });

  // Messages we send from this device (open-wa fires onAnyMessage for the
  // wider stream; onMessage only fires for inbound). We need outbound to
  // mirror the baileys sidecar's behavior of logging both directions.
  client.onAnyMessage(async (msg) => {
    if (!msg.fromMe) return;
    try {
      await handleMessage(msg);
    } catch (err) {
      console.error("[openwa] handleMessage(outbound) error:", err);
    }
  });

  // History backfill: run once per session. Idempotent across restarts
  // via a sentinel file in SESSION_DIR. Fires in background so the
  // sidecar starts processing live messages immediately.
  runHistoryBackfill(client).catch((err) => {
    console.error("[openwa] history backfill failed:", err);
  });
}

// ─── Graceful shutdown ──────────────────────────────────────

let shuttingDown = false;
let activeClient: Client | null = null;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n[openwa] Received ${signal}, shutting down...`);
  stopHeartbeat();
  await sendHeartbeat(false, connectedPhone).catch(() => {});
  await shutdownHandler();
  if (activeClient) {
    await activeClient.kill().catch(() => {});
  }
  console.log("[openwa] Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

console.log("[openwa-sidecar] Starting...", {
  crmBaseUrl: config.crmBaseUrl,
  sessionId: config.sessionId,
  sessionDir: config.sessionDir,
  hasToken: config.crmToken.length > 0,
  hasChromePath: !!config.chromePath,
});

start().catch((err) => {
  console.error("[openwa] Fatal error:", err);
  process.exit(1);
});
