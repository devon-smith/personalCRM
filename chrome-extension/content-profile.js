// ═══════════════════════════════════════════════════════════════
// Content Script — LinkedIn Profile Intelligence (/in/*)
// Passively extracts profile data, enrichment, experience,
// education, and renders the CRM sidebar.
// ═══════════════════════════════════════════════════════════════

(() => {
  "use strict";

  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  let sidebarInjected = false;
  let lastProcessedUrl = null;
  let contextValid = true;
  let isProcessing = false;

  // ─── Context guard ──────────────────────────────────────────

  function isContextValid() {
    try {
      return contextValid && chrome.runtime?.id != null;
    } catch {
      contextValid = false;
      return false;
    }
  }

  function safeSendMessage(msg) {
    return new Promise((resolve) => {
      if (!isContextValid()) return resolve({ error: "context invalidated" });
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            contextValid = false;
            resolve({ error: chrome.runtime.lastError.message });
          } else {
            resolve(response);
          }
        });
      } catch {
        contextValid = false;
        resolve({ error: "context invalidated" });
      }
    });
  }

  async function safeStorageGet(keys) {
    if (!isContextValid()) return {};
    try {
      return await chrome.storage.local.get(keys);
    } catch {
      contextValid = false;
      return {};
    }
  }

  async function safeStorageSet(data) {
    if (!isContextValid()) return;
    try {
      await chrome.storage.local.set(data);
    } catch {
      contextValid = false;
    }
  }

  // ─── CRM API ────────────────────────────────────────────────

  function crmFetch(path, options = {}) {
    return safeSendMessage({ type: "CRM_FETCH", path, ...options });
  }

  function notifyCapture(category, count = 1) {
    safeSendMessage({ type: "ITEM_CAPTURED", category, count });
  }

  // ─── DOM helpers ────────────────────────────────────────────

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

  function normalizeProfileUrl(url) {
    return url
      .split("?")[0]
      .split("#")[0]
      .replace(/\/overlay\/.*$/, "")
      .replace(/\/+$/, "");
  }

  function getProfileSlug(pathname) {
    const match = pathname.match(/^(\/in\/[^/]+)/);
    return match ? match[1] : pathname;
  }

  // ─── Profile extraction ─────────────────────────────────────

  function extractProfile() {
    const allH1s = document.querySelectorAll("h1");
    let name = null;

    // Strategy 1: h1 inside main
    const main = document.querySelector("main") || document.querySelector('[role="main"]');
    if (main) {
      const mainH1 = main.querySelector("h1");
      if (mainH1?.textContent?.trim()) name = mainH1.textContent.trim();
    }

    // Strategy 2: specific selectors
    if (!name) {
      name = getText([
        "h1.text-heading-xlarge",
        ".pv-top-card h1",
        '[data-anonymize="person-name"]',
      ]);
    }

    // Strategy 3: any suitable h1
    if (!name) {
      for (const h1 of allH1s) {
        const text = h1.textContent?.trim();
        if (!text || text.length > 60 || text.includes("LinkedIn") || text.includes("Premium")) continue;
        if (text.length >= 2) { name = text; break; }
      }
    }

    // Strategy 4: page title
    if (!name) {
      const m = document.title?.match(/^(.+?)\s*[|–—\-]\s*LinkedIn/);
      if (m) name = m[1].trim();
    }

    const headline = getText([
      ".text-body-medium.break-words",
      ".pv-top-card--list .text-body-medium",
      'div[data-anonymize="headline"]',
    ]);

    const location = getText([
      ".text-body-small.inline.t-black--light.break-words",
      ".pv-top-card--list-bullet .text-body-small",
      'span[data-anonymize="location"]',
    ]);

    const avatarUrl = getAttr("src", [
      ".pv-top-card-profile-picture__image--show",
      ".pv-top-card-profile-picture__image",
      'img[data-anonymize="headshot-photo"]',
      'main img[src*="profile-displayphoto"]',
    ]);

    const degree = getText([
      ".dist-value",
      ".pvs-header__subtitle .text-body-small",
      'span[class*="distance-badge"]',
    ]);

    const { company, role } = parseHeadline(headline);

    return {
      linkedinUrl: normalizeProfileUrl(window.location.href),
      name, headline, company, role, location, avatarUrl,
      connectionDegree: degree,
      emails: [], phones: [], websites: [],
      birthday: null,
      aboutText: extractAbout(),
      mutualConnections: extractMutualCount(),
    };
  }

  function parseHeadline(headline) {
    if (!headline) return { company: null, role: null };
    const atMatch = headline.match(/^(.+?)\s+at\s+(.+)$/i);
    if (atMatch) return { role: atMatch[1].trim(), company: atMatch[2].trim() };
    const commaMatch = headline.match(/^(.+?),\s+(.+)$/);
    if (commaMatch) return { role: commaMatch[1].trim(), company: commaMatch[2].trim() };
    const pipeMatch = headline.match(/^(.+?)\s*[|–—-]\s*(.+)$/);
    if (pipeMatch) return { role: pipeMatch[1].trim(), company: pipeMatch[2].trim() };
    return { company: null, role: headline };
  }

  function extractAbout() {
    const text = getText([
      "#about ~ .display-flex .pv-shared-text-with-see-more span.visually-hidden",
      ".pv-about-section .pv-about__summary-text",
      'section[data-section="summary"] .pv-shared-text-with-see-more span',
      '#about + .display-flex span[aria-hidden="true"]',
    ]);
    return text?.slice(0, 300) ?? null;
  }

  function extractMutualCount() {
    const text = getText([
      'a[href*="mutual-connections"] span',
      ".pv-top-card--list-bullet .text-body-small a",
    ]);
    if (!text) return null;
    const m = text.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // ─── Enrichment extraction ──────────────────────────────────

  function extractEnrichment() {
    return {
      currentExperience: extractCurrentExperience(),
      education: extractEducation(),
      contactInfoEmails: extractVisibleEmails(),
      contactInfoPhones: extractVisiblePhones(),
    };
  }

  function extractCurrentExperience() {
    // First experience entry in the Experience section
    const expSection = document.querySelector('#experience') ||
      document.querySelector('section[data-section="experience"]');
    if (!expSection) return null;

    // Navigate to the parent section container
    const section = expSection.closest("section") || expSection.parentElement?.closest("section");
    if (!section) return null;

    const roleEl = section.querySelector(
      '.hoverable-link-text span[aria-hidden="true"], ' +
      '.pv-entity__summary-info h3, ' +
      'div[data-anonymize="job-title"]'
    );
    const companyEl = section.querySelector(
      '.t-14.t-normal span[aria-hidden="true"], ' +
      '.pv-entity__secondary-title, ' +
      'div[data-anonymize="company-name"]'
    );
    const dateEl = section.querySelector(
      '.pvs-entity__caption-wrapper span[aria-hidden="true"], ' +
      '.pv-entity__date-range span:nth-child(2)'
    );

    const role = roleEl?.textContent?.trim() || null;
    const company = companyEl?.textContent?.trim() || null;
    if (!role && !company) return null;

    const dateText = dateEl?.textContent?.trim() || null;
    // Extract start date from "Jan 2024 - Present"
    const startDate = dateText?.split("-")[0]?.split("–")[0]?.trim() || null;

    return { company, role, startDate };
  }

  function extractEducation() {
    const eduSection = document.querySelector('#education') ||
      document.querySelector('section[data-section="education"]');
    if (!eduSection) return null;

    const section = eduSection.closest("section") || eduSection.parentElement?.closest("section");
    if (!section) return null;

    const schoolEl = section.querySelector(
      '.hoverable-link-text span[aria-hidden="true"], ' +
      '.pv-entity__school-name, ' +
      'div[data-anonymize="school-name"]'
    );
    const degreeEl = section.querySelector(
      '.t-14.t-normal span[aria-hidden="true"], ' +
      '.pv-entity__degree-name span:nth-child(2)'
    );
    const yearEl = section.querySelector(
      '.pvs-entity__caption-wrapper span[aria-hidden="true"], ' +
      '.pv-entity__dates span:nth-child(2)'
    );

    const school = schoolEl?.textContent?.trim() || null;
    if (!school) return null;

    return {
      school,
      degree: degreeEl?.textContent?.trim() || null,
      year: yearEl?.textContent?.trim() || null,
    };
  }

  function extractVisibleEmails() {
    // Some profiles show email in the contact info section without clicking
    const emails = [];
    const emailLinks = document.querySelectorAll('a[href^="mailto:"]');
    for (const link of emailLinks) {
      const email = link.href.replace("mailto:", "").trim();
      if (email && email.includes("@")) emails.push(email);
    }
    return emails;
  }

  function extractVisiblePhones() {
    const phones = [];
    const phoneLinks = document.querySelectorAll('a[href^="tel:"]');
    for (const link of phoneLinks) {
      const phone = link.href.replace("tel:", "").trim();
      if (phone) phones.push(phone);
    }
    return phones;
  }

  // ─── Sidebar rendering ──────────────────────────────────────

  function createSidebar() {
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

    document.getElementById("crm-close").addEventListener("click", () => {
      sidebar.classList.add("crm-collapsed");
      showToggleButton();
      safeStorageSet({ sidebarCollapsed: true });
    });

    safeStorageGet("sidebarCollapsed").then((result) => {
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
        safeStorageSet({ sidebarCollapsed: false });
      }
    });
    document.body.appendChild(btn);
  }

  function renderContact(contact) {
    const body = document.getElementById("crm-body");
    if (!body) return;

    const healthLabel = contact.healthLabel || "Unknown";
    const healthScore = contact.healthScore ?? "–";

    const circlesHtml = (contact.circles || []).length > 0
      ? contact.circles.map((c) =>
          `<span class="crm-circle-tag" style="--dot-color: ${c.color}">${c.name}</span>`
        ).join("")
      : "";

    const tagsHtml = (contact.tags || []).length > 0
      ? contact.tags.map((t) => `<span class="crm-tag">${esc(t)}</span>`).join("")
      : '<span class="crm-muted">No tags</span>';

    const lastIx = (contact.recentInteractions || [])[0];
    const lastIxHtml = lastIx
      ? `<span class="crm-muted">${timeAgo(lastIx.occurredAt)} &middot; ${lastIx.channel || lastIx.type}</span>
         <p class="crm-preview">&ldquo;${esc((lastIx.summary || "").slice(0, 120))}&rdquo;</p>`
      : '<span class="crm-muted">No interactions yet</span>';

    const followUpHtml = contact.needsFollowUp
      ? `<span class="crm-overdue">Overdue by ${contact.followUpOverdueDays} day(s)</span>`
      : contact.daysSinceLastInteraction != null
        ? `<span class="crm-on-track">On track (${contact.daysSinceLastInteraction}d ago)</span>`
        : '<span class="crm-muted">No follow-up set</span>';

    body.innerHTML = `
      <div class="crm-contact-card">
        <div class="crm-name">${esc(contact.name)}</div>
        ${contact.role ? `<div class="crm-role">${esc(contact.role)}</div>` : ""}
        ${contact.company ? `<div class="crm-company">${esc(contact.company)}</div>` : ""}
        <div class="crm-tier">${(contact.tier || "").replace("_", " ")}</div>
        ${circlesHtml ? `<div class="crm-circles">${circlesHtml}</div>` : ""}
        ${contact.healthScore != null ? `<div class="crm-health">Health: ${healthScore} — ${healthLabel}</div>` : ""}
      </div>
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
        <p class="crm-notes-text">${esc(contact.notes.slice(0, 300))}</p>
      </div>` : ""}
      <div class="crm-section crm-stats">
        <span class="crm-muted">${contact.interactionCount || 0} interactions total</span>
      </div>
    `;

    safeStorageGet("crmUrl").then((result) => {
      const base = result.crmUrl || "http://localhost:3003";
      const link = document.getElementById("crm-open");
      if (link) link.href = `${base}/contacts/${contact.id}`;
    });

    setupActionButtons(contact.id);
  }

  function renderNotInCrm(profile, syncResult) {
    const body = document.getElementById("crm-body");
    if (!body) return;

    if (syncResult?.data?.status === "created") {
      body.innerHTML = `
        <div class="crm-not-found">
          <div class="crm-success-icon">✓</div>
          <p class="crm-msg">Saved to CRM</p>
          <p class="crm-sub">${esc(syncResult.data.contactName || profile.name)}</p>
        </div>
      `;
      setTimeout(() => processProfile(), 1500);
      return;
    }

    body.innerHTML = `
      <div class="crm-not-found">
        <p class="crm-msg">Not in your CRM</p>
        <p class="crm-sub">${esc(profile.name || "Unknown")}</p>
        ${profile.headline ? `<p class="crm-sub">${esc(profile.headline)}</p>` : ""}
        <button class="crm-btn crm-btn-primary" id="crm-save">Save to CRM</button>
      </div>
    `;

    document.getElementById("crm-save")?.addEventListener("click", async () => {
      const btn = document.getElementById("crm-save");
      if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
      const result = await crmFetch("/api/extension/sync-profile", {
        method: "POST", body: profile,
      });
      if (!result.error) notifyCapture("profile");
      renderNotInCrm(profile, result);
    });
  }

  // ─── Action buttons ────────────────────────────────────────

  function setupActionButtons(contactId) {
    document.getElementById("crm-add-note")?.addEventListener("click", () => {
      showInlineInput("Add a note...", async (text) => {
        await crmFetch("/api/extension/add-note", {
          method: "POST", body: { contactId, note: text },
        });
        showToast("Note saved");
      });
    });

    document.getElementById("crm-add-tag")?.addEventListener("click", () => {
      showInlineInput("Add tags (comma separated)...", async (text) => {
        const tags = text.split(",").map((t) => t.trim()).filter(Boolean);
        if (tags.length === 0) return;
        const result = await crmFetch("/api/extension/add-tags", {
          method: "POST", body: { contactId, tags },
        });
        if (result.data?.tags) {
          const container = document.getElementById("crm-tags-list");
          if (container) {
            container.innerHTML = result.data.tags
              .map((t) => `<span class="crm-tag">${esc(t)}</span>`).join("");
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

  // ─── Utils ──────────────────────────────────────────────────

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }

  // ─── Main flow ──────────────────────────────────────────────

  async function processProfile() {
    if (!isContextValid() || isProcessing) return;
    isProcessing = true;

    try {
      const currentUrl = normalizeProfileUrl(window.location.href);

      // If sidebar already visible for this URL, skip
      if (lastProcessedUrl === currentUrl && document.getElementById("crm-sidebar")) return;

      // Wait for content
      await waitForProfile();

      const profile = extractProfile();
      if (!profile.name) return;

      // Always show sidebar
      createSidebar();

      // Check if we should sync or just display
      const skipSync = lastProcessedUrl === currentUrl;
      lastProcessedUrl = currentUrl;

      if (!skipSync) {
        const cache = await safeStorageGet("lastSyncedProfile");
        const cached = cache.lastSyncedProfile?.url === currentUrl &&
          Date.now() - cache.lastSyncedProfile.timestamp < CACHE_TTL_MS;

        if (!cached) {
          // Sync profile
          await crmFetch("/api/extension/sync-profile", {
            method: "POST", body: profile,
          });
          notifyCapture("profile");
          console.log("[CRM]", "✅ Profile synced:", profile.name);

          // Send enrichment data (experience, education, about)
          const enrichment = extractEnrichment();
          const enrichResult = await crmFetch("/api/extension/enrich-profile", {
            method: "POST",
            body: {
              linkedinUrl: currentUrl,
              aboutText: profile.aboutText,
              ...enrichment,
              mutualConnections: profile.mutualConnections,
            },
          });

          if (enrichResult.data?.enriched) {
            notifyCapture("enrichment");
            console.log("[CRM]", "✅ Enriched:", enrichResult.data.enrichments.join(", "));
          }

          await safeStorageSet({
            lastSyncedProfile: { url: currentUrl, timestamp: Date.now() },
          });
        } else {
          console.log("[CRM]", "⏭️ Skipped sync:", profile.name, "(cached)");
        }
      }

      // Always lookup and render
      const lookupResult = await crmFetch(
        `/api/extension/lookup?linkedin_url=${encodeURIComponent(currentUrl)}`
      );

      if (lookupResult?.data?.found && lookupResult.data.contact) {
        renderContact(lookupResult.data.contact);
      } else {
        renderNotInCrm(profile, {});
      }
    } finally {
      isProcessing = false;
    }
  }

  function waitForProfile() {
    return new Promise((resolve) => {
      function ready() {
        const h1s = document.querySelectorAll("h1");
        for (const h1 of h1s) if (h1.textContent?.trim()) return true;
        for (const sel of [".text-heading-xlarge", ".pv-top-card", "section.artdeco-card"]) {
          if (document.querySelector(sel)) return true;
        }
        if (document.title && document.title !== "LinkedIn" && document.title.includes("LinkedIn")) return true;
        return false;
      }

      if (ready()) { resolve(); return; }

      const observer = new MutationObserver(() => {
        if (ready()) { observer.disconnect(); resolve(); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(); }, 5000);
    });
  }

  // ─── SPA navigation (polling, no MutationObserver loops) ────

  let currentSlug = getProfileSlug(window.location.pathname);

  function checkNavigation() {
    if (!isContextValid()) return;
    const newSlug = getProfileSlug(window.location.pathname);
    if (newSlug !== currentSlug) {
      currentSlug = newSlug;
      if (newSlug.startsWith("/in/")) {
        sidebarInjected = false;
        lastProcessedUrl = null;
        setTimeout(processProfile, 1500);
      } else {
        document.getElementById("crm-sidebar")?.remove();
        document.getElementById("crm-toggle-btn")?.remove();
        sidebarInjected = false;
      }
    }
  }

  setInterval(checkNavigation, 2000);
  window.addEventListener("popstate", () => setTimeout(checkNavigation, 500));

  // ─── Init ───────────────────────────────────────────────────

  if (window.location.pathname.startsWith("/in/")) {
    processProfile().catch((err) =>
      console.error("[CRM]", "❌ processProfile error:", err)
    );
  }
})();
