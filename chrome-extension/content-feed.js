// ═══════════════════════════════════════════════════════════════
// Content Script — LinkedIn Feed & Network (/feed/*, /mynetwork/*)
// Adds small badge on profile links for contacts in your CRM.
// ═══════════════════════════════════════════════════════════════

(() => {
  "use strict";

  // Cache of LinkedIn URLs that are in the CRM (loaded on init)
  let knownLinkedinUrls = new Set();
  let isLoaded = false;

  // ─── CRM fetch via background ──────────────────────────────

  function crmFetch(path, options = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "CRM_FETCH", path, ...options },
        resolve
      );
    });
  }

  // ─── Load known contacts ───────────────────────────────────

  async function loadKnownContacts() {
    if (isLoaded) return;

    // Check cache first
    const cached = await chrome.storage.local.get("feedKnownUrls");
    if (
      cached.feedKnownUrls?.urls &&
      Date.now() - (cached.feedKnownUrls.timestamp || 0) < 30 * 60 * 1000
    ) {
      knownLinkedinUrls = new Set(cached.feedKnownUrls.urls);
      isLoaded = true;
      return;
    }

    // Fetch from CRM — use the ping endpoint to check connection first
    const ping = await crmFetch("/api/extension/ping");
    if (!ping.data?.ok) return;

    // We don't have a bulk endpoint, so we'll badge as we encounter profiles
    // and look them up individually. For efficiency, cache results.
    isLoaded = true;
  }

  // ─── Badge profile links ──────────────────────────────────

  async function badgeProfileLinks() {
    const links = document.querySelectorAll('a[href*="/in/"]');
    const toBadge = [];

    for (const link of links) {
      // Skip if already badged
      if (link.dataset.crmChecked) continue;
      link.dataset.crmChecked = "true";

      const href = link.href;
      if (!href || !href.includes("/in/")) continue;

      // Normalize URL
      const normalized = href.split("?")[0].replace(/\/+$/, "");
      if (!normalized.includes("/in/")) continue;

      // Check cache
      if (knownLinkedinUrls.has(normalized)) {
        addBadge(link);
        continue;
      }

      toBadge.push({ link, url: normalized });
    }

    // Batch lookup (limit to 5 at a time to avoid overwhelming the API)
    const batch = toBadge.slice(0, 5);
    for (const { link, url } of batch) {
      const result = await crmFetch(
        `/api/extension/lookup?linkedin_url=${encodeURIComponent(url)}`
      );

      if (result.data?.found) {
        knownLinkedinUrls.add(url);
        addBadge(link);
      }
    }

    // Save to cache
    if (knownLinkedinUrls.size > 0) {
      await chrome.storage.local.set({
        feedKnownUrls: {
          urls: [...knownLinkedinUrls],
          timestamp: Date.now(),
        },
      });
    }
  }

  function addBadge(link) {
    // Don't double-badge
    if (link.querySelector(".crm-feed-badge")) return;

    const badge = document.createElement("span");
    badge.className = "crm-feed-badge";
    badge.textContent = "✓";
    badge.title = "In your CRM";

    // Insert badge after the link text
    link.style.display = "inline-flex";
    link.style.alignItems = "center";
    link.appendChild(badge);
  }

  // ─── Observe for new content (infinite scroll) ─────────────

  function init() {
    loadKnownContacts().then(() => {
      badgeProfileLinks();

      // Re-scan when new content loads (infinite scroll)
      const observer = new MutationObserver(() => {
        badgeProfileLinks();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    });
  }

  // Delay init slightly to not compete with LinkedIn's own loading
  setTimeout(init, 2000);
})();
