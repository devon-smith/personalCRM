// ═══════════════════════════════════════════════════════════════
// Content Script — LinkedIn Profile Pages (/in/*)
// ═══════════════════════════════════════════════════════════════

(() => {
  "use strict";

  const DEBOUNCE_MS = 3000;
  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  let sidebarInjected = false;
  let lastProcessedUrl = null;

  // ─── DOM helpers ──────────────────────────────────────────

  function getText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }
    return null;
  }

  function getAttr(attr, selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const val = el?.getAttribute(attr);
      if (val) return val;
    }
    return null;
  }

  // ─── Profile extraction ──────────────────────────────────

  function extractProfile() {
    const name = getText([
      "h1.text-heading-xlarge",
      ".pv-top-card h1",
      "h1.inline.t-24",
      "h1",
    ]);

    const headline = getText([
      ".text-body-medium.break-words",
      ".pv-top-card--list .text-body-medium",
      ".pv-text-details__left-panel .text-body-medium",
    ]);

    const location = getText([
      ".text-body-small.inline.t-black--light.break-words",
      ".pv-top-card--list-bullet .text-body-small",
      ".pv-text-details__left-panel .text-body-small:last-child",
    ]);

    const avatarUrl = getAttr("src", [
      ".pv-top-card-profile-picture__image--show",
      ".pv-top-card-profile-picture__image",
      ".presence-entity__image",
      'img.profile-photo-edit__preview[src*="profile"]',
    ]);

    const degree = getText([
      ".dist-value",
      ".pvs-header__subtitle .text-body-small",
      'span[class*="distance-badge"]',
    ]);

    const aboutText = getText([
      "#about ~ .display-flex .pv-shared-text-with-see-more span.visually-hidden",
      ".pv-about-section .pv-about__summary-text",
      'section[data-section="summary"] .pv-shared-text-with-see-more span',
    ]);

    const { company, role } = parseHeadline(headline);

    return {
      linkedinUrl: window.location.href.split("?")[0].replace(/\/+$/, ""),
      name,
      headline,
      company,
      role,
      location,
      avatarUrl,
      connectionDegree: degree,
      emails: [],
      phones: [],
      websites: [],
      birthday: null,
      aboutText: aboutText?.slice(0, 200) ?? null,
      mutualConnections: extractMutualCount(),
    };
  }

  function parseHeadline(headline) {
    if (!headline) return { company: null, role: null };

    // "Product Manager at Stripe"
    const atMatch = headline.match(/^(.+?)\s+at\s+(.+)$/i);
    if (atMatch) return { role: atMatch[1].trim(), company: atMatch[2].trim() };

    // "CEO & Co-founder, Acme Inc"
    const commaMatch = headline.match(/^(.+?),\s+(.+)$/);
    if (commaMatch) return { role: commaMatch[1].trim(), company: commaMatch[2].trim() };

    // "CEO | Stripe" or "CEO - Stripe"
    const pipeMatch = headline.match(/^(.+?)\s*[|–—-]\s*(.+)$/);
    if (pipeMatch) return { role: pipeMatch[1].trim(), company: pipeMatch[2].trim() };

    return { company: null, role: headline };
  }

  function extractMutualCount() {
    const text = getText([
      'a[href*="mutual-connections"] span',
      ".pv-top-card--list-bullet .text-body-small a",
    ]);
    if (!text) return null;
    const match = text.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  // ─── Contact info extraction (best-effort) ───────────────

  async function tryExtractContactInfo(profile) {
    const contactLink = document.querySelector(
      'a[href*="overlay/contact-info"], a[data-control-name="contact_see_more"]'
    );
    if (!contactLink) return profile;

    try {
      contactLink.click();
      await sleep(1500);

      const modal = document.querySelector(
        ".pv-contact-info, .artdeco-modal__content"
      );
      if (!modal) return profile;

      // Extract emails
      const emailSection = modal.querySelector(
        'section[class*="email"], section:has(a[href^="mailto:"])'
      );
      if (emailSection) {
        const links = emailSection.querySelectorAll('a[href^="mailto:"]');
        profile = {
          ...profile,
          emails: [...links].map((a) => a.href.replace("mailto:", "").trim()),
        };
      }

      // Extract phones
      const phoneSection = modal.querySelector(
        'section[class*="phone"], section:has(a[href^="tel:"])'
      );
      if (phoneSection) {
        const links = phoneSection.querySelectorAll('a[href^="tel:"]');
        profile = {
          ...profile,
          phones: [...links].map((a) => a.href.replace("tel:", "").trim()),
        };
      }

      // Extract websites
      const websiteSection = modal.querySelector(
        'section[class*="website"], section:has(a[href*="http"])'
      );
      if (websiteSection) {
        const links = websiteSection.querySelectorAll("a[href]");
        profile = {
          ...profile,
          websites: [...links]
            .map((a) => a.href)
            .filter((h) => h.startsWith("http") && !h.includes("linkedin.com")),
        };
      }

      // Close modal
      const closeBtn = document.querySelector(
        '.artdeco-modal__dismiss, button[data-control-name="contact_close"]'
      );
      if (closeBtn) closeBtn.click();
    } catch {
      // Best-effort — close modal if open
      const closeBtn = document.querySelector(".artdeco-modal__dismiss");
      if (closeBtn) closeBtn.click();
    }

    return profile;
  }

  // ─── CRM API calls ───────────────────────────────────────

  function crmFetch(path, options = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "CRM_FETCH", path, ...options },
        resolve
      );
    });
  }

  async function syncProfile(profile) {
    const result = await crmFetch("/api/extension/sync-profile", {
      method: "POST",
      body: profile,
    });
    if (!result.error) {
      chrome.runtime.sendMessage({ type: "INCREMENT_STAT", key: "profilesSynced" });
    }
    return result;
  }

  async function lookupContact(linkedinUrl) {
    return crmFetch(
      `/api/extension/lookup?linkedin_url=${encodeURIComponent(linkedinUrl)}`
    );
  }

  // ─── Sidebar rendering ───────────────────────────────────

  function createSidebar() {
    // Remove existing
    const existing = document.getElementById("crm-sidebar");
    if (existing) existing.remove();

    const sidebar = document.createElement("div");
    sidebar.id = "crm-sidebar";
    sidebar.innerHTML = `
      <div class="crm-sidebar-header">
        <span class="crm-sidebar-title">CRM</span>
        <button class="crm-sidebar-close" id="crm-close">&times;</button>
      </div>
      <div class="crm-sidebar-body" id="crm-body">
        <div class="crm-loading">Loading...</div>
      </div>
    `;
    document.body.appendChild(sidebar);
    sidebarInjected = true;

    // Close button
    document.getElementById("crm-close").addEventListener("click", () => {
      sidebar.classList.add("crm-collapsed");
      showToggleButton();
      chrome.storage.local.set({ sidebarCollapsed: true });
    });

    // Check collapse state
    chrome.storage.local.get("sidebarCollapsed", (result) => {
      if (result.sidebarCollapsed) {
        sidebar.classList.add("crm-collapsed");
        showToggleButton();
      }
    });

    return sidebar;
  }

  function showToggleButton() {
    let btn = document.getElementById("crm-toggle-btn");
    if (btn) return;

    btn = document.createElement("button");
    btn.id = "crm-toggle-btn";
    btn.textContent = "CRM";
    btn.addEventListener("click", () => {
      const sidebar = document.getElementById("crm-sidebar");
      if (sidebar) {
        sidebar.classList.remove("crm-collapsed");
        btn.remove();
        chrome.storage.local.set({ sidebarCollapsed: false });
      }
    });
    document.body.appendChild(btn);
  }

  function renderContact(contact, syncResult) {
    const body = document.getElementById("crm-body");
    if (!body) return;

    const changes = syncResult?.data?.changes ?? [];
    const healthLabel = contact.healthLabel || "Unknown";
    const healthScore = contact.healthScore ?? "–";

    const circlesHtml = contact.circles.length > 0
      ? contact.circles
          .map((c) => `<span class="crm-circle-tag" style="--dot-color: ${c.color}">${c.name}</span>`)
          .join("")
      : "";

    const tagsHtml = contact.tags.length > 0
      ? contact.tags.map((t) => `<span class="crm-tag">${escapeHtml(t)}</span>`).join("")
      : '<span class="crm-muted">No tags</span>';

    const lastIx = contact.recentInteractions[0];
    const lastIxHtml = lastIx
      ? `<span class="crm-muted">${timeAgo(lastIx.occurredAt)} &middot; ${lastIx.channel || lastIx.type}</span>
         <p class="crm-preview">&ldquo;${escapeHtml((lastIx.summary || "").slice(0, 120))}&rdquo;</p>`
      : '<span class="crm-muted">No interactions yet</span>';

    const followUpHtml = contact.needsFollowUp
      ? `<span class="crm-overdue">Overdue by ${contact.followUpOverdueDays} day(s)</span>`
      : contact.daysSinceLastInteraction != null
        ? `<span class="crm-on-track">On track (${contact.daysSinceLastInteraction}d ago)</span>`
        : '<span class="crm-muted">No follow-up set</span>';

    const changesHtml = changes.length > 0
      ? `<div class="crm-section crm-changes">
           <div class="crm-section-label">Job change detected</div>
           ${changes.map((c) => `<div class="crm-change-row">
             <span class="crm-muted">${c.field}:</span>
             <span class="crm-old">${escapeHtml(c.old || "–")}</span> → <span class="crm-new">${escapeHtml(c.new)}</span>
           </div>`).join("")}
         </div>`
      : "";

    body.innerHTML = `
      <div class="crm-contact-card">
        <div class="crm-name">${escapeHtml(contact.name)}</div>
        ${contact.role ? `<div class="crm-role">${escapeHtml(contact.role)}</div>` : ""}
        ${contact.company ? `<div class="crm-company">${escapeHtml(contact.company)}</div>` : ""}
        <div class="crm-tier">${contact.tier.replace("_", " ")}</div>
        ${circlesHtml ? `<div class="crm-circles">${circlesHtml}</div>` : ""}
        ${contact.healthScore != null ? `<div class="crm-health">Health: ${healthScore} — ${healthLabel}</div>` : ""}
      </div>

      ${changesHtml}

      <div class="crm-section">
        <div class="crm-section-label">Last interaction</div>
        ${lastIxHtml}
      </div>

      <div class="crm-section">
        <div class="crm-section-label">Quick actions</div>
        <div class="crm-actions">
          <button class="crm-btn" id="crm-add-note">+ Note</button>
          <button class="crm-btn" id="crm-add-tag">+ Tag</button>
          <a class="crm-btn crm-btn-link" id="crm-open" target="_blank">View in CRM ↗</a>
        </div>
      </div>

      <div class="crm-section">
        <div class="crm-section-label">Follow-up</div>
        ${followUpHtml}
      </div>

      <div class="crm-section">
        <div class="crm-section-label">Tags</div>
        <div class="crm-tags" id="crm-tags-list">${tagsHtml}</div>
      </div>

      ${contact.notes ? `<div class="crm-section">
        <div class="crm-section-label">Notes</div>
        <p class="crm-notes-text">${escapeHtml(contact.notes.slice(0, 300))}</p>
      </div>` : ""}

      <div class="crm-section crm-stats">
        <span class="crm-muted">${contact.interactionCount} interactions total</span>
      </div>
    `;

    // Set CRM link
    chrome.storage.local.get("crmUrl", (result) => {
      const base = result.crmUrl || "http://localhost:3003";
      const link = document.getElementById("crm-open");
      if (link) link.href = `${base}/contacts/${contact.id}`;
    });

    // Wire up action buttons
    setupActionButtons(contact.id);
  }

  function renderNotInCrm(profile, syncResult) {
    const body = document.getElementById("crm-body");
    if (!body) return;

    // Check if it was just created
    if (syncResult?.data?.status === "created") {
      body.innerHTML = `
        <div class="crm-not-found">
          <div class="crm-success-icon">✓</div>
          <p class="crm-msg">Saved to CRM</p>
          <p class="crm-sub">${escapeHtml(syncResult.data.contactName || profile.name)}</p>
        </div>
      `;
      // Reload after a moment to show full card
      setTimeout(() => processProfile(), 1500);
      return;
    }

    body.innerHTML = `
      <div class="crm-not-found">
        <p class="crm-msg">Not in your CRM</p>
        <p class="crm-sub">${escapeHtml(profile.name || "Unknown")}</p>
        ${profile.headline ? `<p class="crm-sub">${escapeHtml(profile.headline)}</p>` : ""}
        <button class="crm-btn crm-btn-primary" id="crm-save">Save to CRM</button>
        <p class="crm-hint">Creates a new contact from their LinkedIn profile.</p>
      </div>
    `;

    document.getElementById("crm-save")?.addEventListener("click", async () => {
      const btn = document.getElementById("crm-save");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Saving...";
      }
      const result = await syncProfile(profile);
      renderNotInCrm(profile, result);
    });
  }

  // ─── Action buttons ───────────────────────────────────────

  function setupActionButtons(contactId) {
    document.getElementById("crm-add-note")?.addEventListener("click", () => {
      showInlineInput("Add a note...", async (text) => {
        await crmFetch("/api/extension/add-note", {
          method: "POST",
          body: { contactId, note: text },
        });
        showToast("Note saved");
      });
    });

    document.getElementById("crm-add-tag")?.addEventListener("click", () => {
      showInlineInput("Add tags (comma separated)...", async (text) => {
        const tags = text.split(",").map((t) => t.trim()).filter(Boolean);
        if (tags.length === 0) return;
        const result = await crmFetch("/api/extension/add-tags", {
          method: "POST",
          body: { contactId, tags },
        });
        if (result.data?.tags) {
          const container = document.getElementById("crm-tags-list");
          if (container) {
            container.innerHTML = result.data.tags
              .map((t) => `<span class="crm-tag">${escapeHtml(t)}</span>`)
              .join("");
          }
        }
        showToast(`Added ${tags.length} tag(s)`);
      });
    });
  }

  function showInlineInput(placeholder, onSubmit) {
    const existing = document.querySelector(".crm-inline-input");
    if (existing) existing.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "crm-inline-input";
    wrapper.innerHTML = `
      <input type="text" placeholder="${placeholder}" class="crm-input" />
      <button class="crm-btn crm-btn-sm">Save</button>
    `;

    const body = document.getElementById("crm-body");
    if (!body) return;

    // Insert after actions section
    const actionsSection = body.querySelector(".crm-actions");
    if (actionsSection?.parentElement) {
      actionsSection.parentElement.after(wrapper);
    } else {
      body.prepend(wrapper);
    }

    const input = wrapper.querySelector("input");
    const btn = wrapper.querySelector("button");
    input?.focus();

    const submit = async () => {
      const text = input?.value?.trim();
      if (!text) return;
      btn.disabled = true;
      btn.textContent = "...";
      await onSubmit(text);
      wrapper.remove();
    };

    btn?.addEventListener("click", submit);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") wrapper.remove();
    });
  }

  // ─── Toast ────────────────────────────────────────────────

  function showToast(message) {
    const existing = document.querySelector(".crm-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "crm-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add("crm-toast-visible"), 10);
    setTimeout(() => {
      toast.classList.remove("crm-toast-visible");
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // ─── Utils ────────────────────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ─── Main flow ────────────────────────────────────────────

  async function processProfile() {
    const currentUrl = window.location.href.split("?")[0].replace(/\/+$/, "");

    // Debounce: skip if same URL processed recently
    const cache = await chrome.storage.local.get("lastSyncedProfile");
    if (
      cache.lastSyncedProfile?.url === currentUrl &&
      Date.now() - cache.lastSyncedProfile.timestamp < CACHE_TTL_MS &&
      lastProcessedUrl === currentUrl
    ) {
      return;
    }

    lastProcessedUrl = currentUrl;

    // Wait for profile to load
    await waitForProfile();

    let profile = extractProfile();
    if (!profile.name) return;

    // Create/show sidebar
    createSidebar();

    // Try to extract contact info (best-effort, 1st-degree only)
    profile = await tryExtractContactInfo(profile);

    // Sync profile to CRM
    const syncResult = await syncProfile(profile);

    // Lookup full contact data
    const lookupResult = await lookupContact(currentUrl);

    if (lookupResult?.data?.found && lookupResult.data.contact) {
      renderContact(lookupResult.data.contact, syncResult);

      // Log profile view
      crmFetch("/api/extension/log-activity", {
        method: "POST",
        body: {
          contactId: lookupResult.data.contact.id,
          linkedinUrl: currentUrl,
          activityType: "profile_view",
        },
      });
    } else {
      renderNotInCrm(profile, syncResult);
    }

    // Cache this URL
    await chrome.storage.local.set({
      lastSyncedProfile: { url: currentUrl, timestamp: Date.now() },
    });
  }

  function waitForProfile() {
    return new Promise((resolve) => {
      // Check if already loaded
      const h1 = document.querySelector("h1");
      if (h1?.textContent?.trim()) {
        resolve();
        return;
      }

      // Watch for changes
      const observer = new MutationObserver(() => {
        const h1 = document.querySelector("h1");
        if (h1?.textContent?.trim()) {
          observer.disconnect();
          resolve();
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Timeout fallback
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, DEBOUNCE_MS);
    });
  }

  // ─── SPA navigation detection ─────────────────────────────

  let currentPath = window.location.pathname;

  const navigationObserver = new MutationObserver(() => {
    if (window.location.pathname !== currentPath) {
      currentPath = window.location.pathname;
      if (currentPath.startsWith("/in/")) {
        lastProcessedUrl = null;
        setTimeout(processProfile, 1000);
      }
    }
  });

  navigationObserver.observe(document.body, { childList: true, subtree: true });

  // ─── Init ─────────────────────────────────────────────────

  processProfile();
})();
