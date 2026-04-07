// ═══════════════════════════════════════════════════════════════
// Content Script — LinkedIn Messaging (/messaging/*)
// Auto-syncs conversations with the CRM.
//
// Architecture:
// 1. MutationObserver detects conversation switches and new messages
// 2. autoSyncConversation() fires on switch/new-message (debounced)
// 3. Conversation list polling every 30s finds changed conversations
// 4. Rate limited: max 1 sync per conversation per 60 seconds
// 5. Manual "Sync to CRM" button kept as fallback with sync indicator
// ═══════════════════════════════════════════════════════════════

(() => {
  "use strict";

  if (!window.location.pathname.startsWith("/messaging")) return;

  let contextValid = true;

  // ─── Rate limiting: conversationKey → lastSyncTimestamp ─────
  const syncTimestamps = new Map();
  const RATE_LIMIT_MS = 60 * 1000; // 1 sync per conversation per 60s

  // ─── Conversation list polling state ────────────────────────
  const lastKnownTimestamps = new Map(); // conversationKey → last message timestamp
  let pollTimer = null;
  const POLL_INTERVAL_MS = 30 * 1000;

  // ─── Tracks which conversations auto-sync has already captured
  const syncedConversations = new Set();

  // ─── Previous conversation fingerprint for switch detection ──
  let lastConversationKey = null;

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

  // ─── Conversation key (for dedup + rate limiting) ──────────

  function getConversationKey(partnerName, linkedinUrl) {
    return linkedinUrl || partnerName || "";
  }

  // ─── Rate limit check ─────────────────────────────────────

  function isRateLimited(conversationKey) {
    const lastSync = syncTimestamps.get(conversationKey);
    if (!lastSync) return false;
    return Date.now() - lastSync < RATE_LIMIT_MS;
  }

  function recordSync(conversationKey) {
    syncTimestamps.set(conversationKey, Date.now());
  }

  // ─── Extract conversation partner info ─────────────────────

  function extractPartnerInfo() {
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

    return { partnerName: partnerName || null, partnerLinkedinUrl };
  }

  // ─── Extract visible messages from current conversation ────

  function extractMessages(partnerName) {
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

      // Prefer datetime attribute for accurate timestamps; approximate otherwise
      const timestamp = timeEl?.getAttribute("datetime") || new Date().toISOString();

      // Direction: if sender name contains partner's first name → received
      const partnerFirst = (partnerName || "").split(" ")[0].toLowerCase();
      const isFromMe = partnerFirst
        ? !senderName.toLowerCase().includes(partnerFirst)
        : true;

      messages.push({
        text: text.slice(0, 500),
        timestamp,
        isFromMe,
        senderName,
      });
    }

    return messages;
  }

  // ─── Full conversation extraction ──────────────────────────

  function extractConversation() {
    const { partnerName, partnerLinkedinUrl } = extractPartnerInfo();
    if (!partnerName) return null;

    const messages = extractMessages(partnerName);
    if (messages.length === 0) return null;

    return {
      conversationWith: {
        name: partnerName,
        linkedinUrl: partnerLinkedinUrl,
      },
      messages,
    };
  }

  // ─── Auto-sync the current conversation ────────────────────

  async function autoSyncConversation() {
    if (!isContextValid()) return;

    const conversation = extractConversation();
    if (!conversation) return;

    const key = getConversationKey(
      conversation.conversationWith.name,
      conversation.conversationWith.linkedinUrl,
    );

    // Rate limit: max 1 sync per conversation per 60s
    if (isRateLimited(key)) return;

    // Only sync recent messages for auto-capture (last 5)
    const recentMessages = conversation.messages.slice(-5);
    const payload = {
      conversationWith: conversation.conversationWith,
      messages: recentMessages,
    };

    recordSync(key);

    const result = await crmFetch("/api/extension/sync-messages", {
      method: "POST",
      body: payload,
    });

    if (result.data?.synced > 0) {
      notifyCapture(result.data.synced);
      syncedConversations.add(key);
      updateSyncIndicator(true);
    }
  }

  // ─── Conversation list polling ─────────────────────────────
  // Extracts the left-panel conversation list, detects changes,
  // and triggers sync for conversations with new messages.

  function extractConversationList() {
    const cards = document.querySelectorAll(
      ".msg-conversation-listitem, .msg-conversation-card, .msg-conversations-container__convo-item"
    );

    const conversations = [];
    for (const card of cards) {
      const nameEl = card.querySelector(
        ".msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names"
      );
      const previewEl = card.querySelector(
        ".msg-conversation-card__message-snippet, .msg-conversation-listitem__message-snippet"
      );
      const timeEl = card.querySelector(
        ".msg-conversation-card__time-stamp, .msg-conversation-listitem__time-stamp, time"
      );
      const unreadEl = card.querySelector(
        ".msg-conversation-card__unread-count, .notification-badge, .msg-conversation-listitem__unread-count"
      );

      const name = nameEl?.textContent?.trim();
      if (!name) continue;

      const preview = previewEl?.textContent?.trim() || "";
      const timestamp = timeEl?.getAttribute("datetime") || timeEl?.textContent?.trim() || "";
      const hasUnread = unreadEl != null;

      // Profile URL from link in the card
      const linkEl = card.querySelector('a[href*="/in/"]');
      const linkedinUrl = linkEl
        ? linkEl.href.split("?")[0].replace(/\/+$/, "")
        : null;

      conversations.push({ name, preview, timestamp, hasUnread, linkedinUrl });
    }

    return conversations;
  }

  async function pollConversationList() {
    if (!isContextValid()) return;

    const conversations = extractConversationList();

    for (const conv of conversations) {
      // Only sync conversations with unread messages from others
      if (!conv.hasUnread) continue;

      const key = getConversationKey(conv.name, conv.linkedinUrl);
      const lastTimestamp = lastKnownTimestamps.get(key);

      // Skip if timestamp hasn't changed since last poll
      if (lastTimestamp && lastTimestamp === conv.timestamp) continue;

      lastKnownTimestamps.set(key, conv.timestamp);

      // Rate limit check
      if (isRateLimited(key)) continue;

      // We can only extract full messages from the ACTIVE conversation.
      // For non-active conversations, we just note that they changed.
      // The full sync happens when the user opens the conversation
      // (detected by the MutationObserver).
    }
  }

  // ─── Sync indicator on the manual button ───────────────────

  function updateSyncIndicator(synced) {
    const btn = document.getElementById("crm-sync-messages-btn");
    if (!btn) return;

    const indicator = btn.querySelector(".crm-sync-indicator");
    if (synced && !indicator) {
      const check = document.createElement("span");
      check.className = "crm-sync-indicator";
      check.style.cssText = `
        display: inline-block; width: 6px; height: 6px;
        background: #059669; border-radius: 50%;
        margin-left: 6px; vertical-align: middle;
      `;
      check.title = "Auto-synced";
      btn.appendChild(check);
    } else if (!synced && indicator) {
      indicator.remove();
    }
  }

  // ─── Inject manual sync button (fallback) ──────────────────

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

      const key = getConversationKey(
        conversation.conversationWith.name,
        conversation.conversationWith.linkedinUrl,
      );

      // Manual sync: force through rate limit
      recordSync(key);

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
          syncedConversations.add(key);
        }
      }

      btn.disabled = false;
      btn.textContent = "Sync to CRM";
      updateSyncIndicator(true);
    });

    // Check if auto-sync already captured this conversation
    const { partnerName, partnerLinkedinUrl } = extractPartnerInfo();
    const key = getConversationKey(partnerName, partnerLinkedinUrl);
    header.appendChild(btn);
    if (syncedConversations.has(key)) {
      updateSyncIndicator(true);
    }
  }

  // ─── Detect conversation switches ──────────────────────────

  function detectConversationSwitch() {
    const { partnerName, partnerLinkedinUrl } = extractPartnerInfo();
    const key = getConversationKey(partnerName, partnerLinkedinUrl);

    if (key && key !== lastConversationKey) {
      lastConversationKey = key;

      // Update sync indicator for the new conversation
      updateSyncIndicator(syncedConversations.has(key));

      // Auto-sync the newly opened conversation (debounced via rate limit)
      autoSyncConversation();
    }
  }

  // ─── Init ─────────────────────────────────────────────────

  function init() {
    injectSyncButton();

    // Debounced auto-sync on DOM mutations (conversation switches + new messages)
    let syncTimer = null;
    const observer = new MutationObserver(() => {
      if (!isContextValid()) { observer.disconnect(); clearInterval(pollTimer); return; }

      // Re-inject button if removed (LinkedIn SPA navigation)
      if (!document.getElementById("crm-sync-messages-btn")) {
        injectSyncButton();
      }

      // Detect conversation switch immediately
      detectConversationSwitch();

      // Debounced auto-sync for new messages within current conversation
      clearTimeout(syncTimer);
      syncTimer = setTimeout(autoSyncConversation, 3000);
    });

    const msgContainer =
      document.querySelector(".msg-conversations-container") ||
      document.querySelector("main") ||
      document.body;
    observer.observe(msgContainer, { childList: true, subtree: true });

    // Conversation list polling every 30 seconds
    pollTimer = setInterval(() => {
      if (!isContextValid()) { clearInterval(pollTimer); return; }
      pollConversationList();
    }, POLL_INTERVAL_MS);

    // Initial sync after page load
    setTimeout(autoSyncConversation, 3000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 1000);
  }
})();
