// ═══════════════════════════════════════════════════════════════
// Content Script — LinkedIn Feed Intelligence
// Passively captures posts, job changes, engagements,
// content shares, and celebrations from CRM contacts.
// ═══════════════════════════════════════════════════════════════

(() => {
  "use strict";

  let contextValid = true;
  const pendingItems = [];
  let flushTimer = null;
  const processedFingerprints = new Set();
  const BATCH_DELAY_MS = 5000;
  const MAX_BATCH = 10;

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
    safeSendMessage({ type: "ITEM_CAPTURED", category: "feed", count });
  }

  // ─── Known contacts cache ──────────────────────────────────

  let knownUrls = new Set();
  let cacheLoaded = false;

  async function loadKnownUrls() {
    if (cacheLoaded || !isContextValid()) return;
    try {
      const cached = await chrome.storage.local.get("feedKnownUrls");
      if (cached.feedKnownUrls?.urls && Date.now() - (cached.feedKnownUrls.timestamp || 0) < 30 * 60 * 1000) {
        knownUrls = new Set(cached.feedKnownUrls.urls);
      }
    } catch { contextValid = false; }
    cacheLoaded = true;
  }

  async function saveKnownUrls() {
    if (knownUrls.size > 0 && isContextValid()) {
      try {
        await chrome.storage.local.set({
          feedKnownUrls: { urls: [...knownUrls], timestamp: Date.now() },
        });
      } catch { contextValid = false; }
    }
  }

  // ─── Feed scanning ─────────────────────────────────────────

  function scanFeed() {
    if (!isContextValid()) return;

    const feedItems = document.querySelectorAll(
      '[data-urn*="activity"], .feed-shared-update-v2, .occludable-update, [data-id], [data-urn*="urn:li:aggregate"]'
    );

    if (feedItems.length === 0) {
      console.log("[CRM]", "⚠️ Feed: No feed items found with known selectors. Trying broad scan...");
      // Fallback: try any main feed container children
      const mainFeed = document.querySelector('[role="main"]') || document.querySelector("main");
      if (mainFeed) {
        const children = mainFeed.querySelectorAll(':scope > div > div');
        console.log("[CRM]", `Feed: Found ${children.length} potential feed items via broad scan`);
      }
    }

    let scanned = 0, matched = 0;
    for (const item of feedItems) {
      const fingerprint = item.getAttribute("data-urn") ||
        item.getAttribute("data-id") ||
        item.textContent?.slice(0, 80) || "";
      if (!fingerprint || processedFingerprints.has(fingerprint)) continue;
      processedFingerprints.add(fingerprint);
      scanned++;

      // 1. Check for celebration / life event cards
      const celebration = extractCelebration(item);
      if (celebration) { queueItem(celebration); matched++; continue; }

      // 2. Check for engagement with YOUR posts
      const engagement = extractEngagement(item);
      if (engagement) { queueItem(engagement); matched++; continue; }

      // 3. Regular post by someone
      const post = extractPost(item);
      if (post) { queueItem(post); matched++; continue; }

      // 4. Content share (article)
      const share = extractContentShare(item);
      if (share) { queueItem(share); matched++; }
    }

    if (scanned > 0) {
      console.log("[CRM]", `Feed scan: ${scanned} new items scanned, ${matched} matched`);
    }
  }

  // ─── Celebration cards (job change, anniversary, birthday) ──

  function extractCelebration(item) {
    const headerText = (
      item.querySelector(".update-components-header__text-view") ||
      item.querySelector(".feed-shared-celebration-card") ||
      item.querySelector(".feed-shared-header__text") ||
      item.querySelector('[data-test-id="header-text"]')
    )?.textContent?.trim();

    if (!headerText) return null;

    const profileLink = findProfileLink(item);
    if (!profileLink) return null;

    const lower = headerText.toLowerCase();

    if (lower.includes("started a new position") || lower.includes("new role") ||
        lower.includes("joined") || lower.includes("hired") || lower.includes("promoted")) {
      const { company, role } = parseJobChangeDetails(item, headerText);
      console.log("[CRM]", "✅ Feed: Job change —", profileLink.name, "→", company || "(unknown)");
      return {
        linkedinUrl: profileLink.url, authorName: profileLink.name,
        type: "job_change", preview: headerText.slice(0, 200),
        newCompany: company, newRole: role,
      };
    }

    if (lower.includes("anniversary") || lower.includes("celebrating")) {
      console.log("[CRM]", "✅ Feed: Anniversary —", profileLink.name);
      return {
        linkedinUrl: profileLink.url, authorName: profileLink.name,
        type: "work_anniversary", preview: headerText.slice(0, 200),
      };
    }

    if (lower.includes("birthday")) {
      console.log("[CRM]", "✅ Feed: Birthday —", profileLink.name);
      return {
        linkedinUrl: profileLink.url, authorName: profileLink.name,
        type: "birthday", preview: headerText.slice(0, 200),
      };
    }

    if (lower.includes("graduated") || lower.includes("degree")) {
      return {
        linkedinUrl: profileLink.url, authorName: profileLink.name,
        type: "education", preview: headerText.slice(0, 200),
      };
    }

    return null;
  }

  function parseJobChangeDetails(item, headerText) {
    let company = null, role = null;
    const subtitle = item.querySelector(
      ".feed-shared-celebration-card__subtitle, .update-components-header__subtitle"
    )?.textContent?.trim();

    if (subtitle) {
      const m = subtitle.match(/^(.+?)\s+at\s+(.+)$/i);
      if (m) { role = m[1].trim(); company = m[2].trim(); }
    }

    if (!company) {
      const m = headerText.match(/joined\s+(.+?)(?:\s+as\s+(.+))?$/i);
      if (m) { company = m[1]?.trim(); role = m[2]?.trim() || null; }
    }

    return { company, role };
  }

  // ─── Engagements with your posts ────────────────────────────

  function extractEngagement(item) {
    // Look for "X liked your post" / "X commented on your post"
    const headerText = (
      item.querySelector(".update-components-header__text-view") ||
      item.querySelector(".feed-shared-header__text")
    )?.textContent?.trim();

    if (!headerText) return null;

    const lower = headerText.toLowerCase();
    if (!(lower.includes("your post") || lower.includes("your article") ||
          lower.includes("your comment"))) return null;

    if (!(lower.includes("liked") || lower.includes("commented") ||
          lower.includes("reposted") || lower.includes("reacted"))) return null;

    const profileLink = findProfileLink(item);
    if (!profileLink) return null;

    console.log("[CRM]", "✅ Feed: Engagement —", profileLink.name, "→", headerText.slice(0, 60));
    return {
      linkedinUrl: profileLink.url, authorName: profileLink.name,
      type: "engagement", preview: headerText.slice(0, 200),
    };
  }

  // ─── Regular posts ──────────────────────────────────────────

  function extractPost(item) {
    // Strategy 1: Specific selectors
    let authorLink = item.querySelector(
      '.update-components-actor__name a[href*="/in/"], ' +
      '.feed-shared-actor__name a[href*="/in/"], ' +
      'a.update-components-actor__container-link[href*="/in/"]'
    );

    // Strategy 2: Any /in/ link near the top of the item (actor area)
    if (!authorLink) {
      const allLinks = item.querySelectorAll('a[href*="/in/"]');
      // Use the first /in/ link — it's usually the author
      for (const link of allLinks) {
        const href = link.href || "";
        if (href.includes("/in/") && !href.includes("/in/mini-profile")) {
          authorLink = link;
          break;
        }
      }
    }

    if (!authorLink) return null;

    const url = authorLink.href?.split("?")[0]?.replace(/\/+$/, "");
    if (!url) return null;

    // Get name from various possible elements
    const name = (
      item.querySelector(".update-components-actor__name") ||
      item.querySelector(".feed-shared-actor__name") ||
      item.querySelector('[data-test-id="actor-name"]') ||
      authorLink
    )?.textContent?.trim()?.replace(/\s+/g, " ") || "";

    // Get post text from various possible elements
    const postText = (
      item.querySelector(".feed-shared-update-v2__description") ||
      item.querySelector(".update-components-text") ||
      item.querySelector(".feed-shared-text") ||
      item.querySelector('[data-test-id="main-feed-activity-card__commentary"]') ||
      item.querySelector(".break-words") ||
      item.querySelector('[dir="ltr"]')
    )?.textContent?.trim() || "";

    if (!postText || postText.length < 10) return null;

    console.log("[CRM]", "✅ Feed: Post by", name, "—", postText.slice(0, 50) + "...");
    return {
      linkedinUrl: url, authorName: name,
      type: "post", preview: postText.slice(0, 200),
    };
  }

  // ─── Content shares (articles) ──────────────────────────────

  function extractContentShare(item) {
    // Check if post contains an article link
    const articleEl = item.querySelector(
      ".feed-shared-article, .update-components-article, " +
      'a[data-test-id="feed-shared-article"]'
    );
    if (!articleEl) return null;

    const authorLink = item.querySelector('a[href*="/in/"]');
    if (!authorLink) return null;

    const url = authorLink.href?.split("?")[0]?.replace(/\/+$/, "");
    const name = authorLink.textContent?.trim() || "";

    const articleTitle = (
      articleEl.querySelector(
        ".feed-shared-article__title, .update-components-article__title"
      )
    )?.textContent?.trim() || "";

    if (!articleTitle) return null;

    console.log("[CRM]", "✅ Feed: Article shared by", name, "—", articleTitle.slice(0, 50));
    return {
      linkedinUrl: url, authorName: name,
      type: "content_share", preview: articleTitle.slice(0, 200),
    };
  }

  // ─── Helpers ────────────────────────────────────────────────

  function findProfileLink(item) {
    const link = item.querySelector('a[href*="/in/"]');
    if (!link) return null;
    const url = link.href?.split("?")[0]?.replace(/\/+$/, "");
    const name = link.textContent?.trim() || "";
    return url ? { url, name } : null;
  }

  // ─── Batching ───────────────────────────────────────────────

  function queueItem(item) {
    pendingItems.push(item);
    if (pendingItems.length >= MAX_BATCH) {
      flushItems();
    } else if (!flushTimer) {
      flushTimer = setTimeout(flushItems, BATCH_DELAY_MS);
    }
  }

  async function flushItems() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (pendingItems.length === 0 || !isContextValid()) return;

    const items = pendingItems.splice(0, MAX_BATCH);

    const result = await crmFetch("/api/extension/feed-intel", {
      method: "POST", body: { items },
    });

    if (result.data?.processed > 0) {
      notifyCapture(result.data.processed);
      console.log("[CRM]", `✅ Feed: Synced ${result.data.processed} items to CRM`);
      for (const r of (result.data.results || [])) {
        console.log("[CRM]", "  →", r.name, ":", r.action);
      }
    }

    // Update known URLs cache with any that were found
    for (const item of items) {
      if (item.linkedinUrl) knownUrls.add(item.linkedinUrl);
    }
    saveKnownUrls();
  }

  // ─── Badge profile links ───────────────────────────────────

  async function badgeProfileLinks() {
    if (!isContextValid()) return;

    const links = document.querySelectorAll('a[href*="/in/"]');
    for (const link of links) {
      if (link.dataset.crmChecked) continue;
      link.dataset.crmChecked = "true";

      const href = link.href;
      if (!href?.includes("/in/")) continue;
      const normalized = href.split("?")[0].replace(/\/+$/, "");

      if (knownUrls.has(normalized)) {
        addBadge(link);
      }
    }
  }

  function addBadge(link) {
    if (link.querySelector(".crm-feed-badge")) return;
    const badge = document.createElement("span");
    badge.className = "crm-feed-badge";
    badge.textContent = "✓";
    badge.title = "In your CRM";
    link.style.display = "inline-flex";
    link.style.alignItems = "center";
    link.appendChild(badge);
  }

  // ─── Init ──────────────────────────────────────────────────

  function init() {
    loadKnownUrls().then(() => {
      scanFeed();
      badgeProfileLinks();

      // Debounced re-scan on scroll / new content
      let scanTimer = null;
      const observer = new MutationObserver(() => {
        if (!isContextValid()) { observer.disconnect(); return; }
        if (!scanTimer) {
          scanTimer = setTimeout(() => {
            scanTimer = null;
            scanFeed();
            badgeProfileLinks();
          }, 3000);
        }
      });

      // Target the feed container specifically if possible, fallback to body
      const feedContainer = document.querySelector("main") || document.body;
      observer.observe(feedContainer, { childList: true, subtree: true });
    });
  }

  const path = window.location.pathname;
  if (path.startsWith("/feed") || path.startsWith("/mynetwork") || path === "/" || path === "") {
    setTimeout(init, 2000);
  }
})();
