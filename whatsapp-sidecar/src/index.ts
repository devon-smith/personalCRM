import makeWASocket, { DisconnectReason } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
import { config } from "./config.js";
import { initAuthState } from "./auth.js";
import {
  init as initMessageHandler,
  handleMessage,
  handleHistoryMessages,
  shutdown as shutdownHandler,
} from "./message-handler.js";
import { sendHeartbeat } from "./crm-client.js";

const logger = pino({ level: config.logLevel });

// ─── Exponential backoff for reconnection ───────────────────

const BACKOFF_STEPS = [5_000, 10_000, 20_000, 60_000]; // 5s → 10s → 20s → 60s max
let reconnectAttempt = 0;

function getBackoffDelay(): number {
  const idx = Math.min(reconnectAttempt, BACKOFF_STEPS.length - 1);
  return BACKOFF_STEPS[idx];
}

// ─── Heartbeat ──────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 60_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let connectedPhone: string | undefined;

function startHeartbeat(): void {
  stopHeartbeat();
  // Send immediately, then every 60s
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

// ─── Main connection ────────────────────────────────────────

async function start(): Promise<void> {
  const { state, saveCreds } = await initAuthState();

  const sock = makeWASocket({
    auth: state,
    browser: ["Personal CRM", "Chrome", "22.0"],
    logger,
  });

  // Initialize the message handler with the socket reference
  initMessageHandler(sock);

  // Persist credentials on update
  sock.ev.on("creds.update", saveCreds);

  // Connection state management
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n[whatsapp] Scan this QR code with WhatsApp:\n");
      qrcode.generate(qr, { small: true });
      console.log("");
    }

    if (connection === "open") {
      reconnectAttempt = 0;
      // Extract our phone from the socket's auth state
      connectedPhone = sock.user?.id?.split(":")[0] ?? undefined;
      console.log("[whatsapp] Connected successfully" + (connectedPhone ? ` (${connectedPhone})` : ""));
      startHeartbeat();
    }

    if (connection === "close") {
      stopHeartbeat();
      const boom = lastDisconnect?.error as Boom | undefined;
      const statusCode = boom?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      if (isLoggedOut) {
        console.log("[whatsapp] Logged out — exiting.");
        gracefulShutdown("loggedOut");
        return;
      }

      const delay = getBackoffDelay();
      reconnectAttempt++;
      console.log(
        `[whatsapp] Connection closed (status: ${statusCode}). Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempt})...`,
      );
      setTimeout(start, delay);
    }
  });

  // History backfill on initial sync
  sock.ev.on("messaging-history.set", async ({ messages }) => {
    if (messages.length === 0) return;
    console.log(`[whatsapp] Received ${messages.length} history messages, processing...`);
    try {
      await handleHistoryMessages(messages);
    } catch (err) {
      console.error("[whatsapp] Error processing history:", err);
    }
  });

  // Listen for new messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        await handleMessage(msg);
      } catch (err) {
        console.error("[whatsapp] Error handling message:", err);
      }
    }
  });
}

// ─── Graceful shutdown ──────────────────────────────────────

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n[whatsapp] Received ${signal}, shutting down...`);
  stopHeartbeat();
  // Report disconnected status to CRM
  await sendHeartbeat(false, connectedPhone).catch(() => {});
  await shutdownHandler();
  console.log("[whatsapp] Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ─── Start ──────────────────────────────────────────────────

console.log("[whatsapp-sidecar] Starting...", {
  crmBaseUrl: config.crmBaseUrl,
  authDir: config.authDir,
  logLevel: config.logLevel,
  hasToken: config.crmToken.length > 0,
});

start().catch((err) => {
  console.error("[whatsapp] Fatal error:", err);
  process.exit(1);
});
