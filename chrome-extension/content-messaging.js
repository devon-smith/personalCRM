// ═══════════════════════════════════════════════════════════════
// Content Script — LinkedIn Messaging (/messaging/*)
// Passively captures conversations with CRM contacts.
// ═══════════════════════════════════════════════════════════════

(() => {
  "use strict";

  if (!window.location.pathname.startsWith("/messaging")) return;

  let contextValid = true;
  const capturedFingerprints = new Set();

  // ─── Context guard ──────────────────────────────────────────

  function isContextValid() {
    try {
      return contextValid && chrome.runtime?.id != null;
    } catch { contextValid = false; return false; }
  }

  function safeSendMessage(msg) {
    return new Promise((resolve) => {
      if (!isContextValid()) return resolve({ error: "context invalidated" });
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) { contextValid = false; resolve({ error: chrome.runtime.lastError.message }); }
          else resolve(response);
        });
      } catch { contextValid = false; resolve({ error: "context invalidated" }); }
    });
  }

  function crmFetch(path, options = {}) {
    return safeSendMessage({ type: "CRM_FETCH", path, ...options });
  }

  function notifyCapture(count) {
    safeSendMessage({ type: "ITEM_CAPTURED", category: "message", count });
  }

  // ─── Toast ────────────────────────────────────────────────

  function showToast(message) {
    const existing = document.querySelector(".crm-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "crm-toast";
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 10000;
      padding: 8px 16px; background: #1a1a1a; color: #fff;
      border-radius: 8px; font-size: 12px; font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      opacity: 0; transform: translateY(8px);
      transition: opacity 0.2s, transform 0.2s;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    }, 10);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ─── Extract conversation data ────────────────────────────

  function extractConversation() {
    const partnerName = (
      document.querySelector(".msg-conversation-card__participant-names") ||
      document.querySelector(".msg-thread__link-to-profile") ||
      document.querySelector(".msg-overlay-bubble-header__title a") ||
      document.querySelector("h2.msg-entity-lockup__entity-title")
    )?.textContent?.trim();

    const partnerLink = (
      document.querySelector(".msg-thread__link-to-profile") ||
      document.querySelector(".msg-overlay-bubble-header__title a") ||
      document.querySelector('a[href*="/in/"]')
    )?.href;

    const partnerLinkedinUrl = partnerLink
      ? partnerLink.split("?")[0].replace(/\/+$/, "")
      : null;

    if (!partnerName) return null;

    const messageEls = document.querySelectorAll(
      ".msg-s-message-list__event, .msg-s-event-listitem"
    );

    const messages = [];
    for (const el of messageEls) {
      const senderEl = el.querySelector(
        ".msg-s-message-group__name, .msg-s-event-listitem__name"
      );
      const textEl = el.querySelector(
        ".msg-s-event-listitem__body, .msg-s-message-list-content__body"
      );
      const timeEl = el.querySelector(
        "time, .msg-s-message-group__timestamp"
      );

      const text = textEl?.textContent?.trim();
      if (!text) continue;

      const senderName = senderEl?.textContent?.trim() || "Unknown";
      const timestamp = timeEl?.getAttribute("datetime") || new Date().toISOString();

      const isFromMe = !senderName.toLowerCase().includes(
        (partnerName || "").split(" ")[0].toLowerCase()
      );

      messages.push({
        text: text.slice(0, 500),
        timestamp,
        isFromMe,
        senderName,
      });
    }

    return {
      conversationWith: {
        name: partnerName,
        linkedinUrl: partnerLinkedinUrl,
      },
      messages,
    };
  }

  // ─── Passive capture ──────────────────────────────────────

  async function passiveCapture() {
    if (!isContextValid()) return;

    const conversation = extractConversation();
    if (!conversation || conversation.messages.length === 0) return;

    // Fingerprint: partner name + message count + last message snippet
    const lastMsg = conversation.messages[conversation.messages.length - 1];
    const fingerprint = `${conversation.conversationWith.name}:${conversation.messages.length}:${lastMsg?.text?.slice(0, 30) || ""}`;

    if (capturedFingerprints.has(fingerprint)) return;
    capturedFingerprints.add(fingerprint);

    // Only sync the last 5 messages for passive capture
    const recentMessages = conversation.messages.slice(-5);
    const payload = {
      conversationWith: conversation.conversationWith,
      messages: recentMessages,
    };

    console.log("[CRM]", "✅ Messaging: Passive sync —", conversation.conversationWith.name, `(${recentMessages.length} msgs)`);

    const result = await crmFetch("/api/extension/sync-messages", {
      method: "POST",
      body: payload,
    });

    if (result.data?.synced > 0) {
      notifyCapture(result.data.synced);
    }
  }

  // ─── Inject sync button ───────────────────────────────────

  function injectSyncButton() {
    if (document.getElementById("crm-sync-messages-btn")) return;

    const header = document.querySelector(
      ".msg-thread__topcard, .msg-overlay-bubble-header, .msg-conversations-container__title-row"
    );
    if (!header) return;

    const btn = document.createElement("button");
    btn.id = "crm-sync-messages-btn";
    btn.textContent = "Sync to CRM";
    btn.style.cssText = `
      padding: 4px 10px; margin-left: 8px;
      border: 1px solid #e2e4e8; border-radius: 6px;
      background: #fff; color: #4a4e54;
      font-size: 11px; font-weight: 600; cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      transition: background 0.15s;
    `;

    btn.addEventListener("mouseenter", () => { btn.style.background = "#f5f6f8"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = "#fff"; });

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Syncing...";

      const conversation = extractConversation();
      if (!conversation || conversation.messages.length === 0) {
        showToast("No messages found to sync");
        btn.disabled = false;
        btn.textContent = "Sync to CRM";
        return;
      }

      const result = await crmFetch("/api/extension/sync-messages", {
        method: "POST",
        body: conversation,
      });

      if (result.error) {
        showToast("Sync failed: " + result.error);
      } else {
        const msg = result.data?.message || `Synced ${result.data?.synced || 0} messages`;
        showToast(msg);
        if (result.data?.synced > 0) {
          notifyCapture(result.data.synced);
        }
      }

      btn.disabled = false;
      btn.textContent = "Sync to CRM";
    });

    header.appendChild(btn);
  }

  // ─── Init ─────────────────────────────────────────────────

  function init() {
    injectSyncButton();

    // Debounced passive capture on conversation changes
    let captureTimer = null;
    const observer = new MutationObserver(() => {
      if (!isContextValid()) { observer.disconnect(); return; }

      // Re-inject button if removed
      if (!document.getElementById("crm-sync-messages-btn")) {
        injectSyncButton();
      }

      // Debounced passive capture
      if (!captureTimer) {
        captureTimer = setTimeout(() => {
          captureTimer = null;
          passiveCapture();
        }, 3000);
      }
    });

    const msgContainer = document.querySelector(".msg-conversations-container") || document.querySelector("main") || document.body;
    observer.observe(msgContainer, { childList: true, subtree: true });

    // Initial passive capture after delay
    setTimeout(passiveCapture, 3000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 1000);
  }
})();
