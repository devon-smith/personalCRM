// ═══════════════════════════════════════════════════════════════
// Background Service Worker — CRM Intelligence Hub
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CRM_URL = "http://localhost:3003";
const PING_INTERVAL_MS = 5 * 60 * 1000;

let connectionStatus = "unknown";
let sessionCount = 0;

// ─── Helpers ──────────────────────────────────────────────────

async function getCrmUrl() {
  const result = await chrome.storage.local.get("crmUrl");
  return result.crmUrl || DEFAULT_CRM_URL;
}

async function getAuthHeaders() {
  const result = await chrome.storage.local.get("apiToken");
  if (result.apiToken) {
    return { Authorization: `Bearer ${result.apiToken}` };
  }
  return {};
}

async function crmFetch(path, options = {}) {
  const base = await getCrmUrl();
  const url = `${base}${path}`;
  const authHeaders = await getAuthHeaders();
  return fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
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

pingCrm();
setInterval(pingCrm, PING_INTERVAL_MS);

// ─── Badge counter ────────────────────────────────────────────

function updateBadge() {
  if (sessionCount > 0) {
    chrome.action.setBadgeText({ text: String(sessionCount) });
    chrome.action.setBadgeBackgroundColor({ color: "#059669" });
  }
}

// ─── Stats tracking ──────────────────────────────────────────

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function getTodayStats() {
  const today = todayKey();
  const result = await chrome.storage.local.get("dailyStats");
  const stats = result.dailyStats || {};
  return stats[today] || {
    profilesSynced: 0,
    messagesSynced: 0,
    feedItemsCaptured: 0,
    enrichments: 0,
  };
}

async function incrementStat(key, amount = 1) {
  const today = todayKey();
  const result = await chrome.storage.local.get("dailyStats");
  const stats = result.dailyStats || {};

  if (!stats[today]) {
    stats[today] = {
      profilesSynced: 0,
      messagesSynced: 0,
      feedItemsCaptured: 0,
      enrichments: 0,
    };
  }
  stats[today][key] = (stats[today][key] || 0) + amount;

  // Clean up old days (keep last 7)
  const dates = Object.keys(stats).sort();
  while (dates.length > 7) {
    delete stats[dates.shift()];
  }

  await chrome.storage.local.set({ dailyStats: stats });
}

// ─── Message handling ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "CRM_FETCH") {
    handleCrmFetch(msg).then(sendResponse);
    return true;
  }

  if (msg.type === "GET_STATUS") {
    handleGetStatus().then(sendResponse);
    return true;
  }

  if (msg.type === "INCREMENT_STAT") {
    incrementStat(msg.key, msg.amount || 1);
    sendResponse({ ok: true });
  }

  if (msg.type === "ITEM_CAPTURED") {
    sessionCount += msg.count || 1;
    updateBadge();

    // Update category-specific stats
    if (msg.category === "profile") incrementStat("profilesSynced");
    if (msg.category === "message") incrementStat("messagesSynced", msg.count || 1);
    if (msg.category === "feed") incrementStat("feedItemsCaptured", msg.count || 1);
    if (msg.category === "enrichment") incrementStat("enrichments");

    sendResponse({ ok: true });
  }

  if (msg.type === "SET_TOKEN") {
    chrome.storage.local.set({ apiToken: msg.token }).then(() => {
      pingCrm().then(() => sendResponse({ ok: true, status: connectionStatus }));
    });
    return true;
  }

  if (msg.type === "CLEAR_TOKEN") {
    chrome.storage.local.remove("apiToken").then(() => {
      sendResponse({ ok: true });
    });
    return true;
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
    sessionCount,
  };
}
