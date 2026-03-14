// ═══════════════════════════════════════════════════════════════
// Popup Script
// ═══════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", async () => {
  // ─── Load status ─────────────────────────────────────────

  const status = await sendMessage({ type: "GET_STATUS" });

  // Connection status
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  if (status.connected) {
    dot.classList.add("connected");
    text.textContent = "Connected";
  } else {
    dot.classList.add("disconnected");
    text.textContent = "Disconnected";
  }

  // Stats
  document.getElementById("stat-profiles").textContent =
    status.stats?.profilesSynced ?? 0;
  document.getElementById("stat-messages").textContent =
    status.stats?.messagesSynced ?? 0;
  document.getElementById("stat-contacts").textContent =
    status.contactCount ?? "–";

  // CRM URL
  const urlInput = document.getElementById("url-input");
  urlInput.value = status.crmUrl || "http://localhost:3003";

  // Open CRM link
  const openCrmLink = document.getElementById("open-crm");
  openCrmLink.href = status.crmUrl || "http://localhost:3003";

  // ─── Save URL ────────────────────────────────────────────

  document.getElementById("url-save").addEventListener("click", async () => {
    const newUrl = urlInput.value.trim().replace(/\/+$/, "");
    if (!newUrl) return;
    await chrome.storage.local.set({ crmUrl: newUrl });
    openCrmLink.href = newUrl;

    // Re-ping with new URL
    const result = await sendMessage({ type: "PING" });
    if (result.status === "connected") {
      dot.className = "status-dot connected";
      text.textContent = "Connected";
    } else {
      dot.className = "status-dot disconnected";
      text.textContent = "Disconnected";
    }
  });

  // ─── Follow-ups ──────────────────────────────────────────

  const followupResult = await sendMessage({
    type: "CRM_FETCH",
    path: "/api/extension/follow-ups",
  });

  const followupCount = followupResult.data?.count ?? 0;
  document.getElementById("followup-count").textContent = followupCount;

  document.getElementById("open-followups").addEventListener("click", () => {
    const url = status.crmUrl || "http://localhost:3003";
    chrome.tabs.create({ url: `${url}/dashboard` });
  });
});

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, resolve);
  });
}
