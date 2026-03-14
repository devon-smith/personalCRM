// ═══════════════════════════════════════════════════════════════
// Background Service Worker
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CRM_URL = "http://localhost:3003";
const PING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ─── State ────────────────────────────────────────────────────

let connectionStatus = "unknown"; // "connected" | "disconnected" | "unknown"

// ─── Helpers ──────────────────────────────────────────────────

async function getCrmUrl() {
  const result = await chrome.storage.local.get("crmUrl");
  return result.crmUrl || DEFAULT_CRM_URL;
}

async function crmFetch(path, options = {}) {
  const base = await getCrmUrl();
  const url = `${base}${path}`;
  return fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

// ─── Health check ─────────────────────────────────────────────

async function pingCrm() {
  try {
    const res = await crmFetch("/api/extension/ping");
    if (res.ok) {
      const data = await res.json();
      connectionStatus = data.ok ? "connected" : "disconnected";
      await chrome.storage.local.set({
        connectionStatus,
        contactCount: data.contactCount || 0,
        lastPing: Date.now(),
      });
    } else {
      connectionStatus = "disconnected";
      await chrome.storage.local.set({ connectionStatus, lastPing: Date.now() });
    }
  } catch {
    connectionStatus = "disconnected";
    await chrome.storage.local.set({ connectionStatus, lastPing: Date.now() });
  }
}

// Ping on startup and every 5 minutes
pingCrm();
setInterval(pingCrm, PING_INTERVAL_MS);

// ─── Stats tracking ──────────────────────────────────────────

async function incrementStat(key) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await chrome.storage.local.get("dailyStats");
  const stats = result.dailyStats || {};

  if (!stats[today]) {
    stats[today] = { profilesSynced: 0, messagesSynced: 0, activitiesLogged: 0 };
  }
  stats[today][key] = (stats[today][key] || 0) + 1;

  // Clean up old days (keep last 7)
  const dates = Object.keys(stats).sort();
  while (dates.length > 7) {
    delete stats[dates.shift()];
  }

  await chrome.storage.local.set({ dailyStats: stats });
}

async function getTodayStats() {
  const today = new Date().toISOString().slice(0, 10);
  const result = await chrome.storage.local.get("dailyStats");
  return (result.dailyStats || {})[today] || {
    profilesSynced: 0,
    messagesSynced: 0,
    activitiesLogged: 0,
  };
}

// ─── Message handling ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "CRM_FETCH") {
    handleCrmFetch(msg).then(sendResponse);
    return true; // Async response
  }

  if (msg.type === "GET_STATUS") {
    handleGetStatus().then(sendResponse);
    return true;
  }

  if (msg.type === "INCREMENT_STAT") {
    incrementStat(msg.key);
    sendResponse({ ok: true });
  }

  if (msg.type === "PING") {
    pingCrm().then(() => sendResponse({ status: connectionStatus }));
    return true;
  }
});

async function handleCrmFetch(msg) {
  try {
    const res = await crmFetch(msg.path, {
      method: msg.method || "GET",
      body: msg.body ? JSON.stringify(msg.body) : undefined,
    });

    if (!res.ok) {
      return { error: `HTTP ${res.status}`, status: res.status };
    }

    const data = await res.json();
    return { data };
  } catch (err) {
    return { error: err.message || "Network error" };
  }
}

async function handleGetStatus() {
  const stats = await getTodayStats();
  const stored = await chrome.storage.local.get([
    "connectionStatus",
    "contactCount",
    "crmUrl",
  ]);
  return {
    connected: stored.connectionStatus === "connected",
    contactCount: stored.contactCount || 0,
    crmUrl: stored.crmUrl || DEFAULT_CRM_URL,
    stats,
  };
}
