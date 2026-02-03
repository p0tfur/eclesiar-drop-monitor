// ==UserScript==
// @name         Eclesiar Drop Monitor
// @namespace    https://eclesiar.com/
// @version      0.1.2
// @description  Wykrywa dropy podczas bitew, zbiera kontekst gracza/wojny i wysyła dane do centralnego backendu.
// @author       p0tfur
// @match        https://eclesiar.com/war/*
// @match        https://www.eclesiar.com/war/*
// @match        https://apollo.eclesiar.com/war/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @require      https://drop-monitor.rpaby.pw/scripts/api.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  if (!/\/(?:war|battle)\/(\d+)/.test(window.location.pathname)) {
    return;
  }

  const DROP_TITLES = new Set(["Znalazłeś nowy przedmiot!", "You found a new equipment!"]);

  const DEFAULT_BASE_URL =
    (window.EclesiarApi && window.EclesiarApi.dropMonitor?.baseUrl) || "https://drop-monitor.rpaby.pw";
  const DEFAULT_ENDPOINT = (window.EclesiarApi && window.EclesiarApi.dropMonitor?.endpoints?.hits) || "/api/hits";

  const STORAGE_KEYS = {
    baseUrl: "dropMonitor.baseUrl",
    apiKey: "dropMonitor.apiKey",
    apiKeyPrompted: "dropMonitor.apiKeyPrompted",
    statsOnlyMine: "dropMonitor.statsOnlyMine",
    statsShowAllColumns: "dropMonitor.statsShowAllColumns",
  };

  const state = {
    processedNotifications: new Set(),
    cachedDropChance: null,
    cachedDropChanceFetchedAt: 0,
    lastHitId: null,
    lastHitTimestamp: null,
    statsModalVisible: false,
    domCache: new Map(),
    lastCacheTime: 0,
  };

  const settings = {
    baseUrl: GM_getValue(STORAGE_KEYS.baseUrl, DEFAULT_BASE_URL),
    apiKey: GM_getValue(STORAGE_KEYS.apiKey, ""),
    statsOnlyMine: Boolean(GM_getValue(STORAGE_KEYS.statsOnlyMine, true)),
    statsShowAllColumns: Boolean(GM_getValue(STORAGE_KEYS.statsShowAllColumns, false)),
  };

  const apiKeyPrompted = Boolean(GM_getValue(STORAGE_KEYS.apiKeyPrompted, false));
  if (!settings.apiKey && !apiKeyPrompted) {
    GM_setValue(STORAGE_KEYS.apiKeyPrompted, true);
    const value = prompt("Drop Monitor: Podaj X-DROP-API-KEY (anuluj aby pominąć)", "");
    const normalized = (value || "").trim();
    if (normalized) {
      settings.apiKey = normalized;
      GM_setValue(STORAGE_KEYS.apiKey, normalized);
    }
  }

  console.info("[DropMonitor] Konfiguracja", {
    baseUrl: settings.baseUrl || DEFAULT_BASE_URL,
    endpoint: DEFAULT_ENDPOINT,
    hasApiKey: Boolean(settings.apiKey),
  });

  GM_registerMenuCommand("Drop Monitor: Ustaw bazowy URL API", () => {
    const value = prompt("Podaj bazowy URL API drop-monitor", settings.baseUrl || DEFAULT_BASE_URL);
    if (value) {
      const trimmed = value.trim();
      settings.baseUrl = trimmed;
      GM_setValue(STORAGE_KEYS.baseUrl, trimmed);
      console.info("[DropMonitor] Zaktualizowano bazowy URL API", trimmed);
    }
  });

  GM_registerMenuCommand("Drop Monitor: Ustaw API key", () => {
    const value = prompt("Podaj X-DROP-API-KEY (pozostaw puste aby usunąć)", settings.apiKey || "");
    const normalized = (value || "").trim();
    settings.apiKey = normalized;
    GM_setValue(STORAGE_KEYS.apiKey, normalized);
    console.info("[DropMonitor] Zaktualizowano API key (ustawiony?", Boolean(normalized), ")");
  });

  function getCachedElement(selector, ttl = 5000) {
    const now = Date.now();
    const cached = state.domCache.get(selector);
    if (cached && now - cached.timestamp < ttl) {
      return cached.element;
    }
    const element = document.querySelector(selector);
    state.domCache.set(selector, { element, timestamp: now });
    return element;
  }

  function clearDomCache() {
    state.domCache.clear();
    state.lastCacheTime = Date.now();
  }

  function safeText(node) {
    return node ? (node.textContent || "").trim() : "";
  }

  function throttle(func, delay) {
    let timeout = null;
    let lastRan = 0;
    return function (...args) {
      const now = Date.now();
      if (now - lastRan >= delay) {
        func.apply(this, args);
        lastRan = now;
      } else {
        clearTimeout(timeout);
        timeout = setTimeout(
          () => {
            func.apply(this, args);
            lastRan = Date.now();
          },
          delay - (now - lastRan),
        );
      }
    };
  }

  function parseNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    const raw = String(value || "")
      .replace(/[^0-9,\.\-]/g, "")
      .replace(/\s+/g, "");
    if (!raw) return null;
    const normalized = raw.replace(/,(?=\d{3}(?:\D|$))/g, "").replace(/,/g, ".");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseFraction(text) {
    const [currentRaw, maxRaw] = String(text || "")
      .split("/")
      .map((part) => part.trim());
    const current = parseNumber(currentRaw);
    const max = parseNumber(maxRaw);
    if (current == null && max == null) {
      return null;
    }
    return {
      current: current ?? null,
      max: max ?? null,
    };
  }

  function parseWarId() {
    const match = window.location.pathname.match(/(?:war|battle)\/(\d+)/);
    if (!match) return null;
    return Number.parseInt(match[1], 10) || null;
  }

  function parseRegionInfo() {
    const regionLink = document.querySelector(".war-content-area__header--top a[href*='/region/']");
    if (!regionLink) return { id: null, name: null };
    const hrefMatch = regionLink.getAttribute("href")?.match(/region\/(\d+)/);
    return {
      id: hrefMatch ? Number.parseInt(hrefMatch[1], 10) : null,
      name: safeText(regionLink),
    };
  }

  function parseCountryInfo(position) {
    const columns = document.querySelectorAll(".war-content-area__header--top .col-4");
    if (!columns.length) return { id: null, name: null };
    let column = null;
    if (position === "attacker") {
      column = columns[0] || null;
    } else if (position === "defender") {
      column = columns[columns.length - 1] || null;
    }
    const anchor = column ? column.querySelector("a[href*='/country/']") : null;
    if (!anchor) return { id: null, name: null };
    const hrefMatch = anchor.getAttribute("href")?.match(/country\/(\d+)/);
    return {
      id: hrefMatch ? Number.parseInt(hrefMatch[1], 10) : null,
      name: safeText(anchor),
    };
  }

  function parseWarEffects() {
    const summary = document.getElementById("ec-war-effects-summary");
    return safeText(summary) || null;
  }

  function parseRoundInfo() {
    const container = document.querySelector(".war-content-area__header--time-area");
    if (!container) return null;
    const roundLabel = safeText(container.querySelector("span:last-of-type"));
    const numberMatch = roundLabel.match(/(\d+)/);
    const hours = parseNumber(safeText(container.querySelector("#hours")));
    const minutes = parseNumber(safeText(container.querySelector("#minutes")));
    const seconds = parseNumber(safeText(container.querySelector("#seconds")));
    const roundTimerSeconds =
      hours != null && minutes != null && seconds != null ? hours * 3600 + minutes * 60 + seconds : null;
    return {
      number: numberMatch ? Number.parseInt(numberMatch[1], 10) : null,
      label: roundLabel || null,
      timerSeconds: roundTimerSeconds,
    };
  }

  function parsePlayerInfo() {
    const name = safeText(getCachedElement(".username.bold")) || "(unknown)";
    const location = safeText(getCachedElement(".header-location-display .header-text")) || null;
    const energyFraction = parseFraction(safeText(getCachedElement(".health-bar .display")));
    const foodFraction = parseFraction(safeText(getCachedElement(".foodlimit-bar .display")));
    const consumablesFraction = parseFraction(safeText(getCachedElement(".generic-value .display")));

    return {
      name,
      location,
      energy: energyFraction || undefined,
      food: foodFraction || undefined,
      consumables: consumablesFraction || undefined,
    };
  }

  function parseCurrencyByAlt(altText) {
    const icon = document.querySelector(`.premium-finances img.list-icon[alt='${altText}']`);
    if (!icon) return null;
    const container = icon.closest(".text") || icon.parentElement;
    const valueEl = container ? container.querySelector("b") : null;
    return parseNumber(safeText(valueEl));
  }

  function parseCurrencies() {
    const gold = parseCurrencyByAlt("Złoto");
    const plnIcon = document.querySelector(".premium-finances .currency-clickable b");
    const pln = parseNumber(safeText(plnIcon));
    let detailsText = null;
    const tooltip = document.querySelector(".premium-finances .currency-clickable .tooltip-content");
    if (tooltip) {
      const parts = Array.from(tooltip.querySelectorAll(".d-flex .text b"))
        .map((node) => safeText(node))
        .filter(Boolean);
      if (parts.length) {
        detailsText = parts.join(", ");
      }
    }
    if (gold == null && pln == null) {
      return null;
    }
    return {
      gold: gold ?? undefined,
      pln: pln ?? undefined,
      details: detailsText || undefined,
    };
  }

  function collectWarContext() {
    const warId = parseWarId();
    const region = parseRegionInfo();
    const attacker = parseCountryInfo("attacker");
    const defender = parseCountryInfo("defender");
    const effects = parseWarEffects();
    return {
      id: warId,
      url: window.location.href,
      battleId: null,
      region,
      attacker,
      defender,
      effects,
    };
  }

  async function fetchDropChance() {
    const now = Date.now();
    if (state.cachedDropChance != null && now - state.cachedDropChanceFetchedAt < 5 * 60 * 1000) {
      return state.cachedDropChance;
    }
    try {
      const response = await fetch("/training", { credentials: "include" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const dropEl = doc.querySelector(".drop-chance-input");
      const text = dropEl ? dropEl.textContent || dropEl.innerText : "";
      const value = parseNumber(text);
      state.cachedDropChance = value;
      state.cachedDropChanceFetchedAt = Date.now();
      return value;
    } catch (error) {
      console.warn("[DropMonitor] Nie udało się pobrać drop chance", error);
      return null;
    }
  }

  function getApiUrl() {
    const base = (settings.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    const endpoint = DEFAULT_ENDPOINT.startsWith("/") ? DEFAULT_ENDPOINT : `/${DEFAULT_ENDPOINT}`;
    return `${base}${endpoint}`;
  }

  function generateHitId() {
    return `hit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }

  async function buildHitPayload(options) {
    const war = collectWarContext();
    const round = parseRoundInfo();
    const player = parsePlayerInfo();
    const currencies = parseCurrencies();
    const dropChance = await fetchDropChance();

    return {
      hitId: options.hitId,
      triggeredAt: options.triggeredAt,
      buttonLabel: options.buttonLabel,
      isDrop: options.isDrop,
      source: "eclesiar-war-drop-monitor",
      pageUrl: window.location.href,
      war,
      round,
      player,
      currencies,
      dropChance,
      drop: options.dropMeta || undefined,
      extra: options.extra || undefined,
    };
  }

  async function sendHitRecord(options, retries = 3) {
    const payload = await buildHitPayload(options);
    const body = JSON.stringify(payload);
    const headers = { "Content-Type": "application/json" };
    if (settings.apiKey) {
      headers["X-DROP-API-KEY"] = settings.apiKey;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(getApiUrl(), {
          method: "POST",
          headers,
          body,
          credentials: "omit",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          let details = "";
          try {
            const data = await response.json();
            if (data && typeof data === "object") {
              details = data.message || JSON.stringify(data);
              if (Array.isArray(data.issues) && data.issues.length) {
                console.warn("[DropMonitor] Błąd walidacji payload", data.issues);
              }
            }
          } catch (_err) {
            try {
              details = await response.text();
            } catch (_err2) {
              details = "";
            }
          }

          const error = new Error(`API returned ${response.status}${details ? `: ${details}` : ""}`);
          error.status = response.status;
          error.details = details;
          throw error;
        }
        await response.json().catch(() => null);
        return;
      } catch (error) {
        console.warn(`[DropMonitor] Próba ${attempt}/${retries} nieudana`, error);
        if (error && (error.status === 401 || error.status === 403)) {
          console.error("[DropMonitor] Brak autoryzacji do API (sprawdź X-DROP-API-KEY)", error);
          return;
        }
        if (error && error.status === 400) {
          console.error("[DropMonitor] Payload odrzucony przez API (400) - to nie jest błąd tymczasowy", error);
          return;
        }
        if (attempt === retries) {
          console.error("[DropMonitor] Nie udało się wysłać rekordu po wszystkich próbach", error);
        } else {
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt - 1), 5000)));
        }
      }
    }
  }

  function processNotificationElement(element) {
    const heading = safeText(element.querySelector("h3"));
    if (!DROP_TITLES.has(heading)) {
      return;
    }
    const messageId = element.getAttribute("data-messageid") || `${heading}-${Date.now()}`;
    if (state.processedNotifications.has(messageId)) {
      return;
    }
    state.processedNotifications.add(messageId);
    const dropDescription = safeText(element.querySelector("p"));
    const hitId = state.lastHitId || generateHitId();
    void sendHitRecord({
      hitId,
      triggeredAt: state.lastHitTimestamp || new Date().toISOString(),
      buttonLabel: "drop-notification",
      isDrop: true,
      dropMeta: {
        messageId,
        heading,
        description: dropDescription,
      },
      extra: {
        notificationHtml: element.outerHTML,
      },
    });
  }

  function scanExistingNotifications() {
    document.querySelectorAll(".notification-popup").forEach((node) => {
      processNotificationElement(node);
    });
  }

  function observeNotifications() {
    const processAddedNodes = throttle((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.classList.contains("notification-popup")) {
            processNotificationElement(node);
            return;
          }
          node.querySelectorAll?.(".notification-popup").forEach((child) => {
            processNotificationElement(child);
          });
        });
      }
    }, 100);

    const observer = new MutationObserver(processAddedNodes);

    observer.observe(document.body, { childList: true, subtree: true });
    scanExistingNotifications();
  }

  function bindFightButton(button) {
    if (!button || button.dataset.dropMonitorBound === "1") {
      return;
    }
    button.dataset.dropMonitorBound = "1";
    button.addEventListener(
      "click",
      () => {
        clearDomCache();
        const hitId = generateHitId();
        state.lastHitId = hitId;
        state.lastHitTimestamp = new Date().toISOString();
        const label = button.dataset.ecOrigFightLabel || safeText(button.querySelector("p")) || safeText(button);
        void sendHitRecord({
          hitId,
          triggeredAt: state.lastHitTimestamp,
          buttonLabel: label || "Walcz",
          isDrop: false,
        });
      },
      { capture: true },
    );
  }

  function observeFightButtons() {
    const initialButtons = document.querySelectorAll(".fight-button");
    initialButtons.forEach(bindFightButton);

    const processButtons = throttle((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }
          if (node.matches && node.matches(".fight-button")) {
            bindFightButton(node);
          }
          node.querySelectorAll?.(".fight-button").forEach((btn) => bindFightButton(btn));
        });
      }
    }, 100);

    const observer = new MutationObserver(processButtons);

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function ensureStatsButton() {
    if (document.getElementById("drop-monitor-stats-button")) {
      return;
    }
    const btn = document.createElement("button");
    btn.id = "drop-monitor-stats-button";
    btn.textContent = "📊 Drop Stats";
    btn.style.position = "fixed";
    btn.style.bottom = "100px";
    btn.style.right = "20px";
    btn.style.zIndex = "99999";
    btn.style.padding = "10px 14px";
    btn.style.borderRadius = "999px";
    btn.style.border = "none";
    btn.style.background = "#1f2937";
    btn.style.color = "#fff";
    btn.style.fontSize = "13px";
    btn.style.boxShadow = "0 10px 25px rgba(0,0,0,0.35)";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", () => openStatsModal());
    document.body.appendChild(btn);
  }

  function createStatsModalShell() {
    let overlay = document.getElementById("drop-monitor-stats-modal");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "drop-monitor-stats-modal";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.75)";
    overlay.style.display = "none";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "100000";

    const panel = document.createElement("div");
    panel.className = "drop-monitor-stats-panel";
    panel.style.background = "#111827";
    panel.style.borderRadius = "10px";
    panel.style.padding = "20px";
    panel.style.width = "min(420px, 90vw)";
    panel.style.maxHeight = "80vh";
    panel.style.overflowY = "auto";
    panel.style.color = "#f3f4f6";
    panel.innerHTML = `<div class="drop-monitor-stats-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:10px;"><h3 style="margin:0;font-size:16px;">Statystyki hitów</h3><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end;"><label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#d1d5db;user-select:none;"><input id="drop-monitor-stats-only-mine" type="checkbox" style="accent-color:#60a5fa;" />Tylko ja</label><label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#d1d5db;user-select:none;"><input id="drop-monitor-stats-all-columns" type="checkbox" style="accent-color:#60a5fa;" />Wszystkie kolumny</label></div><button type="button" id="drop-monitor-stats-close" style="background:none;border:none;color:#f3f4f6;font-size:20px;cursor:pointer;">×</button></div><div id="drop-monitor-stats-content" style="font-size:13px;line-height:1.5;">Ładowanie...</div>`;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeStatsModal();
      }
    });
    overlay.querySelector("#drop-monitor-stats-close")?.addEventListener("click", closeStatsModal);

    async function refreshStats() {
      const content = overlay.querySelector("#drop-monitor-stats-content");
      if (content) {
        content.textContent = "Ładowanie...";
      }

      try {
        const hits = await fetchRecentHits(100, settings.statsOnlyMine);
        renderStats(content, hits, {
          showAllColumns: settings.statsShowAllColumns,
        });
      } catch (error) {
        console.error("[DropMonitor] Nie udało się pobrać statystyk", error);
        if (content) {
          content.textContent = "Nie udało się pobrać danych. Sprawdź konfigurację API.";
        }
      }
    }

    const onlyMineCheckbox = overlay.querySelector("#drop-monitor-stats-only-mine");
    if (onlyMineCheckbox) {
      onlyMineCheckbox.checked = Boolean(settings.statsOnlyMine);
      onlyMineCheckbox.addEventListener("change", async () => {
        settings.statsOnlyMine = Boolean(onlyMineCheckbox.checked);
        GM_setValue(STORAGE_KEYS.statsOnlyMine, settings.statsOnlyMine);
        await refreshStats();
      });
    }

    const allColumnsCheckbox = overlay.querySelector("#drop-monitor-stats-all-columns");
    if (allColumnsCheckbox) {
      allColumnsCheckbox.checked = Boolean(settings.statsShowAllColumns);
      allColumnsCheckbox.addEventListener("change", async () => {
        settings.statsShowAllColumns = Boolean(allColumnsCheckbox.checked);
        GM_setValue(STORAGE_KEYS.statsShowAllColumns, settings.statsShowAllColumns);
        await refreshStats();
      });
    }

    return overlay;
  }

  async function openStatsModal() {
    const overlay = createStatsModalShell();
    const content = overlay.querySelector("#drop-monitor-stats-content");
    overlay.style.display = "flex";
    state.statsModalVisible = true;
    if (content) {
      content.textContent = "Ładowanie...";
    }

    try {
      const hits = await fetchRecentHits(100, settings.statsOnlyMine);
      renderStats(content, hits, {
        showAllColumns: settings.statsShowAllColumns,
      });
    } catch (error) {
      console.error("[DropMonitor] Nie udało się pobrać statystyk", error);
      if (content) {
        content.textContent = "Nie udało się pobrać danych. Sprawdź konfigurację API.";
      }
    }
  }

  function closeStatsModal() {
    const overlay = document.getElementById("drop-monitor-stats-modal");
    if (overlay) {
      overlay.style.display = "none";
    }
    state.statsModalVisible = false;
  }

  async function fetchRecentHits(limit = 100, onlyMine = true) {
    const baseUrl = getApiUrl();
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    const player = parsePlayerInfo();
    if (onlyMine && player?.name) {
      params.set("playerName", player.name.trim());
    }
    const url = `${baseUrl}?${params.toString()}`;
    const headers = {};
    if (settings.apiKey) {
      headers["X-DROP-API-KEY"] = settings.apiKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, { headers, credentials: "omit", signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      const payload = await response.json();
      return Array.isArray(payload?.data) ? payload.data : [];
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  function renderStats(container, hits, options = {}) {
    if (!container) return;
    const total = hits.length;
    const drops = hits.filter((hit) => hit.isDrop).length;
    const rate = total ? ((drops / total) * 100).toFixed(2) : "0.00";
    const lastDrop = hits.find((hit) => hit.isDrop);
    const lastDropText = lastDrop ? new Date(lastDrop.createdAt).toLocaleString() : "Brak";

    const showAllColumns = Boolean(options.showAllColumns);

    function normalizeValue(value) {
      if (value == null) return "";
      if (typeof value === "string") return value;
      if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
      if (typeof value === "boolean") return value ? "true" : "false";
      try {
        return JSON.stringify(value);
      } catch (_err) {
        return String(value);
      }
    }

    function escapeHtml(text) {
      return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;");
    }

    function formatDropChance(value) {
      if (value == null) return "";
      const num = typeof value === "number" ? value : Number.parseFloat(String(value));
      if (!Number.isFinite(num)) return String(value);
      return num.toFixed(2);
    }

    function buildWhereCell(hit) {
      const parts = [];
      if (hit.regionName) {
        parts.push(hit.regionName);
      }
      if (hit.warId != null) {
        parts.push(`#${hit.warId}`);
      }
      const label = parts.join(" ") || hit.warUrl || "";
      if (hit.warUrl) {
        const safeHref = escapeHtml(hit.warUrl);
        const safeLabel = escapeHtml(label || hit.warUrl);
        return `<a href="${safeHref}" target="_blank" rel="noreferrer" style="color:#93c5fd;text-decoration:none;">${safeLabel}</a>`;
      }
      return escapeHtml(label);
    }

    if (showAllColumns) {
      const preferred = [
        "createdAt",
        "hitId",
        "playerName",
        "buttonLabel",
        "isDrop",
        "dropChance",
        "warId",
        "regionName",
        "warUrl",
        "dropHeading",
        "dropDescription",
      ];

      const keys = new Set();
      hits.slice(0, 10).forEach((hit) => {
        Object.keys(hit || {}).forEach((key) => keys.add(key));
      });

      const remaining = Array.from(keys).filter((k) => !preferred.includes(k));
      remaining.sort((a, b) => a.localeCompare(b));
      const columns = preferred.filter((k) => keys.has(k)).concat(remaining);

      const head = columns
        .map(
          (k) => `<th style="text-align:left;padding:4px 8px;border-bottom:1px solid #374151;">${escapeHtml(k)}</th>`,
        )
        .join("");

      const rows = hits
        .slice(0, 10)
        .map((hit) => {
          const tds = columns
            .map((key) => {
              const raw = hit ? hit[key] : "";
              let value = normalizeValue(raw);
              if (key === "warUrl" && value) {
                const safeHref = escapeHtml(value);
                value = `<a href="${safeHref}" target="_blank" rel="noreferrer" style="color:#93c5fd;text-decoration:none;">${safeHref}</a>`;
              } else {
                value = escapeHtml(value);
              }
              if (value.length > 120) {
                value = `${value.slice(0, 120)}…`;
              }
              return `<td style="padding:4px 8px;border-bottom:1px solid #1f2937;vertical-align:top;white-space:nowrap;">${value}</td>`;
            })
            .join("");
          return `<tr>${tds}</tr>`;
        })
        .join("");

      const summaryHtml = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"><div style="flex:1 1 120px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:26px;font-weight:600;">${total}</div><div style="font-size:12px;color:#9ca3af;">Ostatnie hity</div></div><div style="flex:1 1 120px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:26px;font-weight:600;">${drops}</div><div style="font-size:12px;color:#9ca3af;">Dropy</div></div><div style="flex:1 1 120px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:26px;font-weight:600;">${rate}%</div><div style="font-size:12px;color:#9ca3af;">Drop rate</div></div></div>`;
      const rowsHtml = rows || '<tr><td colspan="99" style="padding:8px 0;text-align:center;">Brak danych</td></tr>';
      container.innerHTML = `${summaryHtml}<p style="margin:4px 0 12px 0;font-size:12px;color:#9ca3af;">Ostatni drop: ${lastDropText}</p><div style="overflow-x:auto;border:1px solid #1f2937;border-radius:8px;"><table style="width:max-content;min-width:100%;border-collapse:collapse;font-size:12px;"><thead><tr>${head}</tr></thead><tbody>${rowsHtml}</tbody></table></div><p style="margin-top:10px;font-size:11px;color:#6b7280;">Pokazano maks. 10 z ${total} pobranych rekordów.</p>`;

      return;
    }

    const rowsHtml = hits
      .slice(0, 10)
      .map((hit) => {
        const time = new Date(hit.createdAt || hit.hitTriggeredAt || Date.now()).toLocaleTimeString();
        return `<tr><td style="padding:4px 0;border-bottom:1px solid #1f2937;">${escapeHtml(time)}</td><td style="padding:4px 0;border-bottom:1px solid #1f2937;">${escapeHtml(hit.buttonLabel || "Walcz")}</td><td style="padding:4px 0;border-bottom:1px solid #1f2937;text-align:center;">${hit.isDrop ? "🎁" : "-"}</td><td style="padding:4px 0;border-bottom:1px solid #1f2937;text-align:right;">${escapeHtml(formatDropChance(hit.dropChance))}</td><td style="padding:4px 0;border-bottom:1px solid #1f2937;">${buildWhereCell(hit)}</td><td style="padding:4px 0;border-bottom:1px solid #1f2937;">${escapeHtml(hit.dropHeading || hit.dropDescription || "")}</td></tr>`;
      })
      .join("");

    const summaryHtml = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"><div style="flex:1 1 120px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:26px;font-weight:600;">${total}</div><div style="font-size:12px;color:#9ca3af;">Ostatnie hity</div></div><div style="flex:1 1 120px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:26px;font-weight:600;">${drops}</div><div style="font-size:12px;color:#9ca3af;">Dropy</div></div><div style="flex:1 1 120px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:26px;font-weight:600;">${rate}%</div><div style="font-size:12px;color:#9ca3af;">Drop rate</div></div></div>`;
    const bodyHtml = rowsHtml || '<tr><td colspan="6" style="padding:8px 0;text-align:center;">Brak danych</td></tr>';
    container.innerHTML = `${summaryHtml}<p style="margin:4px 0 12px 0;font-size:12px;color:#9ca3af;">Ostatni drop: ${lastDropText}</p><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th style="text-align:left;padding:4px 0;border-bottom:1px solid #374151;">Czas</th><th style="text-align:left;padding:4px 0;border-bottom:1px solid #374151;">Akcja</th><th style="text-align:center;padding:4px 0;border-bottom:1px solid #374151;">Drop</th><th style="text-align:right;padding:4px 0;border-bottom:1px solid #374151;">Chance</th><th style="text-align:left;padding:4px 0;border-bottom:1px solid #374151;">Gdzie</th><th style="text-align:left;padding:4px 0;border-bottom:1px solid #374151;">Opis</th></tr></thead><tbody>${bodyHtml}</tbody></table><p style="margin-top:10px;font-size:11px;color:#6b7280;">Pokazano maks. 10 z ${total} pobranych rekordów.</p>`;
  }

  observeNotifications();
  observeFightButtons();
  ensureStatsButton();
})();
