// ==UserScript==
// @name         Eclesiar Drop Monitor
// @namespace    https://eclesiar.com/
// @version      0.2.1
// @description  Wykrywa dropy podczas bitew, zbiera kontekst gracza/wojny i wysyła dane do centralnego backendu.
// @author       p0tfur
// @match        https://eclesiar.com/war/*
// @match        https://www.eclesiar.com/war/*
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

  const DROP_MESSAGES = new Set(["znalazles nowy przedmiot", "you found a new equipment"]);
  const USE_POPUP_DETECTION = false;

  const DEFAULT_BASE_URL =
    (window.EclesiarApi && window.EclesiarApi.dropMonitor?.baseUrl) || "https://drop-monitor.rpaby.pw";
  const DEFAULT_ENDPOINT = (window.EclesiarApi && window.EclesiarApi.dropMonitor?.endpoints?.hits) || "/api/hits";

  const STORAGE_KEYS = {
    baseUrl: "dropMonitor.baseUrl",
    apiKey: "dropMonitor.apiKey",
    apiKeyPrompted: "dropMonitor.apiKeyPrompted",
    statsOnlyMine: "dropMonitor.statsOnlyMine",
    statsShowAllColumns: "dropMonitor.statsShowAllColumns",
    statsRowLimit: "dropMonitor.statsRowLimit",
  };

  const state = {
    processedNotifications: new Set(),
    cachedDropChance: null,
    cachedDropChanceFetchedAt: 0,
    statsModalVisible: false,
    statsViewMode: "hits",
    domCache: new Map(),
    lastCacheTime: 0,
    notificationRescanTimer: null,
    notificationRescanUntil: 0,
    networkHookInstalled: false,
    processedFightResponses: new Set(),
  };

  const settings = {
    baseUrl: GM_getValue(STORAGE_KEYS.baseUrl, DEFAULT_BASE_URL),
    apiKey: GM_getValue(STORAGE_KEYS.apiKey, ""),
    statsOnlyMine: Boolean(GM_getValue(STORAGE_KEYS.statsOnlyMine, true)),
    statsShowAllColumns: Boolean(GM_getValue(STORAGE_KEYS.statsShowAllColumns, false)),
    statsRowLimit: Math.max(1, Math.min(500, Number(GM_getValue(STORAGE_KEYS.statsRowLimit, 10)) || 10)),
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

  function safeText(node) {
    return node ? (node.textContent || "").trim() : "";
  }

  function normalizeForMatch(value) {
    const text = String(value || "")
      .toLowerCase()
      .trim();
    if (!text) return "";
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[!?.,:;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isDropNotificationText(heading, fullText) {
    const normalizedHeading = normalizeForMatch(heading);
    const normalizedFull = normalizeForMatch(fullText);
    if (DROP_MESSAGES.has(normalizedHeading)) {
      return true;
    }
    return Array.from(DROP_MESSAGES).some((message) => normalizedFull.includes(message));
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

  function getApiBase() {
    return (settings.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  function buildApiUrl(path) {
    const base = getApiBase();
    const suffix = !path ? "" : path.startsWith("/") ? path : `/${path}`;
    return `${base}${suffix}`;
  }

  function getApiUrl() {
    const endpoint = DEFAULT_ENDPOINT.startsWith("/") ? DEFAULT_ENDPOINT : `/${DEFAULT_ENDPOINT}`;
    return `${getApiBase()}${endpoint}`;
  }

  function generateHitId() {
    return `hit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }

  // Button clicks are not a reliable hit source (spam, 429, no energy, captcha, lag).
  // For statistics we treat POST /war/fight (code=200) responses as the source of truth.

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
      source: options.source || "eclesiar-war-drop-monitor",
      pageUrl: window.location.href,
      war,
      round,
      player,
      currencies,
      dropChance,
      drop: options.dropMeta || undefined,
      fightDrop: options.fightDrop || undefined,
      extra: options.extra || undefined,
    };
  }

  function isWarFightUrl(inputUrl) {
    const raw = String(inputUrl || "");
    return raw.includes("/war/fight");
  }

  function normalizeFightDropPayload(payload) {
    if (!payload || typeof payload !== "object" || payload.code !== 200) {
      return null;
    }
    const drop = payload?.data?.drop;
    if (!drop || typeof drop !== "object") {
      return null;
    }
    const chance = parseNumber(drop.chance);
    const seed = parseNumber(drop.seed);
    const debug = drop.debug && typeof drop.debug === "object" ? drop.debug : null;
    return {
      chance: chance ?? null,
      seed: seed ?? null,
      debug,
    };
  }

  function parseFightRequestBody(body) {
    if (!body || typeof body !== "string") return null;
    try {
      const params = new URLSearchParams(body);
      const roundId = params.get("round_id");
      const weaponId = params.get("weapon_id");
      const side = params.get("side");
      return {
        roundId: roundId ? Number.parseInt(roundId, 10) || roundId : null,
        weaponId: weaponId || null,
        side: side || null,
      };
    } catch (_err) {
      return null;
    }
  }

  function buildFightResponseFingerprint(url, payload) {
    const drop = payload?.data?.drop || {};
    const timestamp = payload?.data?.timestamp ?? "na";
    return `${url}|${timestamp}|${drop.seed ?? "na"}|${drop.chance ?? "na"}`;
  }

  function processFightResponsePayload(url, payload, requestBody) {
    if (!isWarFightUrl(url)) return;
    const fightDrop = normalizeFightDropPayload(payload);
    if (!fightDrop) return;
    const inferredIsDrop =
      Number.isFinite(fightDrop.seed) &&
      Number.isFinite(fightDrop.chance) &&
      Number(fightDrop.seed) <= Number(fightDrop.chance);
    const fingerprint = buildFightResponseFingerprint(url, payload);
    if (state.processedFightResponses.has(fingerprint)) return;
    state.processedFightResponses.add(fingerprint);
    if (state.processedFightResponses.size > 3000) {
      const keep = Array.from(state.processedFightResponses).slice(-1500);
      state.processedFightResponses = new Set(keep);
    }

    const warId = parseWarId();
    const responseTimestamp = payload?.data?.timestamp;
    const triggeredAt =
      typeof responseTimestamp === "number" && Number.isFinite(responseTimestamp)
        ? new Date(responseTimestamp * 1000).toISOString()
        : new Date().toISOString();

    const safeTs =
      typeof responseTimestamp === "number" && Number.isFinite(responseTimestamp)
        ? String(responseTimestamp)
        : String(Date.now());
    const hitId = `fight-${warId ?? "na"}-${safeTs}-${fightDrop.seed ?? "na"}-${fightDrop.chance ?? "na"}`;
    void sendHitRecord({
      hitId,
      triggeredAt,
      buttonLabel: "fight-response",
      isDrop: inferredIsDrop,
      source: "eclesiar-war-fight-response",
      dropMeta: inferredIsDrop
        ? {
            messageId: `fight-seed-${fightDrop.seed}-${fightDrop.chance}`,
            heading: "Fight response drop",
            description: `seed=${fightDrop.seed}, chance=${fightDrop.chance}`,
          }
        : undefined,
      fightDrop,
      extra: {
        responseUrl: url,
        responseCode: payload?.code ?? null,
        responseDescription: payload?.description ?? null,
        inferredIsDrop,
        request: parseFightRequestBody(requestBody),
      },
    });
  }

  function installFightResponseNetworkHook() {
    if (state.networkHookInstalled) return;
    state.networkHookInstalled = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
      const requestUrl = String(args?.[0]?.url || args?.[0] || "");
      const requestBody = args?.[1]?.body ?? null;
      const response = await originalFetch(...args);
      try {
        if (isWarFightUrl(requestUrl)) {
          const clone = response.clone();
          const payload = await clone.json();
          processFightResponsePayload(requestUrl, payload, requestBody);
        }
      } catch (_error) {}
      return response;
    };

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._dropMonitorUrl = String(url || "");
      return originalXhrOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      this._dropMonitorBody = args?.[0] ?? null;
      this.addEventListener("load", () => {
        try {
          const url = String(this._dropMonitorUrl || "");
          if (!isWarFightUrl(url)) return;
          const payload = JSON.parse(this.responseText || "{}");
          processFightResponsePayload(url, payload, this._dropMonitorBody);
        } catch (_error) {}
      });
      return originalXhrSend.apply(this, args);
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
    if (!USE_POPUP_DETECTION) {
      return;
    }
    const heading = safeText(element.querySelector("h3, h2, .notification-title, .title, [class*='title'], strong, b"));
    const descriptionNode = element.querySelector("p, .notification-description, .description, [class*='description']");
    const dropDescription = safeText(descriptionNode);
    const fullText = safeText(element);
    if (!isDropNotificationText(heading, `${heading} ${dropDescription} ${fullText}`)) {
      return;
    }
    let messageId =
      element.getAttribute("data-messageid") ||
      element.getAttribute("data-id") ||
      element.querySelector("[data-messageid]")?.getAttribute("data-messageid") ||
      element.querySelector(".close-notification[data-messageid]")?.getAttribute("data-messageid");
    if (!messageId) {
      messageId = element.dataset.dropMonitorLocalId;
      if (!messageId) {
        messageId = `notif-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        element.dataset.dropMonitorLocalId = messageId;
      }
    }
    if (state.processedNotifications.has(messageId)) {
      return;
    }
    state.processedNotifications.add(messageId);
    const hitId = generateHitId();
    const triggeredAt = new Date().toISOString();
    void sendHitRecord({
      hitId,
      triggeredAt,
      buttonLabel: "drop-notification",
      isDrop: true,
      dropMeta: {
        messageId,
        heading,
        description: dropDescription,
      },
      extra: {
        normalizedHeading: normalizeForMatch(heading),
        notificationHtml: element.outerHTML,
      },
    });
  }

  function scanExistingNotifications() {
    document.querySelectorAll(".notification-popup, [class*='notification']").forEach((node) => {
      processNotificationElement(node);
    });
  }

  function scanDropMessageHeadings() {
    document.querySelectorAll("h3, h2, .notification-title, .title, [class*='title'], strong, b").forEach((node) => {
      const headingText = safeText(node);
      if (!isDropNotificationText(headingText, headingText)) {
        return;
      }
      const container =
        node.closest?.(".notification-popup, [class*='notification']") ||
        node.parentElement?.closest?.(".notification-popup, [class*='notification']") ||
        node.parentElement;
      if (container instanceof HTMLElement) {
        processNotificationElement(container);
      }
    });
  }

  function scheduleNotificationRescan(durationMs = 12000, intervalMs = 250) {
    const now = Date.now();
    state.notificationRescanUntil = Math.max(state.notificationRescanUntil || 0, now + durationMs);
    if (state.notificationRescanTimer) {
      return;
    }

    state.notificationRescanTimer = setInterval(() => {
      scanExistingNotifications();
      scanDropMessageHeadings();
      if (Date.now() >= state.notificationRescanUntil) {
        clearInterval(state.notificationRescanTimer);
        state.notificationRescanTimer = null;
        state.notificationRescanUntil = 0;
      }
    }, intervalMs);
  }

  function observeNotifications() {
    const processAddedNodes = (mutations) => {
      for (const mutation of mutations) {
        const candidates = new Set();

        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            if (node.classList.contains("notification-popup")) {
              candidates.add(node);
            }
            node.querySelectorAll?.(".notification-popup").forEach((child) => candidates.add(child));
            const closestPopup = node.closest?.(".notification-popup");
            if (closestPopup) {
              candidates.add(closestPopup);
            }
          } else if (node instanceof Text && node.parentElement) {
            const closestPopup = node.parentElement.closest?.(".notification-popup");
            if (closestPopup) {
              candidates.add(closestPopup);
            }
          }
        });

        if (mutation.type === "attributes" || mutation.type === "characterData") {
          const targetElement =
            mutation.target instanceof HTMLElement ? mutation.target : mutation.target?.parentElement;
          const closestPopup =
            targetElement?.closest?.(".notification-popup") || targetElement?.closest?.("[class*='notification']");
          if (closestPopup) {
            candidates.add(closestPopup);
          }
        }

        candidates.forEach((popup) => processNotificationElement(popup));
      }
      scanDropMessageHeadings();
    };

    const observer = new MutationObserver(processAddedNodes);

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-messageid", "data-id"],
    });
    scanExistingNotifications();
    scanDropMessageHeadings();
    scheduleNotificationRescan(4000, 300);
  }

  function ensureStatsButton() {
    if (document.getElementById("drop-monitor-stats-button")) {
      return;
    }
    const btn = document.createElement("button");
    btn.id = "drop-monitor-stats-button";
    btn.textContent = "📊 Drop Stats";
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "100px",
      right: "20px",
      zIndex: "99999",
      padding: "10px 14px",
      borderRadius: "999px",
      border: "none",
      background: "#1f2937",
      color: "#fff",
      fontSize: "13px",
      boxShadow: "0 10px 25px rgba(0,0,0,0.35)",
      cursor: "pointer",
    });
    btn.addEventListener("click", () => openStatsModal());
    document.body.appendChild(btn);
  }

  function createStatsModalShell() {
    let overlay = document.getElementById("drop-monitor-stats-modal");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "drop-monitor-stats-modal";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.75)",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "100000",
    });

    const panel = document.createElement("div");
    panel.className = "drop-monitor-stats-panel";
    const panelWide = () =>
      settings.statsShowAllColumns
        ? { width: "min(1200px, 96vw)", maxHeight: "92vh" }
        : { width: "min(420px, 90vw)", maxHeight: "80vh" };
    Object.assign(panel.style, {
      background: "#111827",
      borderRadius: "10px",
      padding: "20px",
      overflowY: "auto",
      color: "#f3f4f6",
      ...panelWide(),
    });
    panel.innerHTML = `<div class="drop-monitor-stats-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:10px;"><h3 style="margin:0;font-size:16px;">Statystyki hitów</h3><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end;"><label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#d1d5db;user-select:none;"><input id="drop-monitor-stats-only-mine" type="checkbox" style="accent-color:#60a5fa;" />Tylko ja</label><label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#d1d5db;user-select:none;"><input id="drop-monitor-stats-all-columns" type="checkbox" style="accent-color:#60a5fa;" />Wszystkie kolumny</label><label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#d1d5db;user-select:none;">Wiersze <select id="drop-monitor-stats-row-limit" style="background:#0b1220;color:#f3f4f6;border:1px solid #374151;border-radius:6px;padding:2px 6px;outline:none;"><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="200">200</option><option value="500">500</option></select></label><button type="button" id="drop-monitor-stats-view-toggle" style="background:#0b1220;border:1px solid #374151;color:#f3f4f6;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;">Analizy</button></div><button type="button" id="drop-monitor-stats-close" style="background:none;border:none;color:#f3f4f6;font-size:20px;cursor:pointer;">×</button></div><div id="drop-monitor-stats-content" style="font-size:13px;line-height:1.5;">Ładowanie...</div>`;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeStatsModal();
    });
    overlay.querySelector("#drop-monitor-stats-close")?.addEventListener("click", closeStatsModal);
    overlay.querySelector("#drop-monitor-stats-view-toggle")?.addEventListener("click", async () => {
      state.statsViewMode = state.statsViewMode === "analysis" ? "hits" : "analysis";
      await refreshStats();
    });

    const updatePanelSize = () => {
      const panelEl = overlay.querySelector(".drop-monitor-stats-panel");
      if (panelEl) Object.assign(panelEl.style, panelWide());
    };

    async function refreshStats() {
      const content = overlay.querySelector("#drop-monitor-stats-content");
      if (content) content.textContent = "Ładowanie...";
      const viewToggle = overlay.querySelector("#drop-monitor-stats-view-toggle");
      if (viewToggle) {
        viewToggle.textContent = state.statsViewMode === "analysis" ? "Tabela" : "Analizy";
      }

      try {
        updatePanelSize();
        if (state.statsViewMode === "analysis") {
          const analysis = await fetchAnalysis(settings.statsOnlyMine, 30);
          renderAnalysis(content, analysis);
        } else {
          const statsPayload = await fetchRecentHits(settings.statsRowLimit, settings.statsOnlyMine);
          renderStats(content, statsPayload, {
            showAllColumns: settings.statsShowAllColumns,
            rowLimit: settings.statsRowLimit,
          });
        }
      } catch (error) {
        console.error("[DropMonitor] Nie udało się pobrać statystyk", error);
        if (content) content.textContent = "Nie udało się pobrać danych. Sprawdź konfigurację API.";
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

    const rowLimitSelect = overlay.querySelector("#drop-monitor-stats-row-limit");
    if (rowLimitSelect) {
      rowLimitSelect.value = String(settings.statsRowLimit || 10);
      rowLimitSelect.addEventListener("change", async () => {
        settings.statsRowLimit = Math.max(1, Math.min(500, Number(rowLimitSelect.value) || 10));
        GM_setValue(STORAGE_KEYS.statsRowLimit, settings.statsRowLimit);
        await refreshStats();
      });
    }

    overlay._dropMonitorRefreshStats = refreshStats;

    return overlay;
  }

  async function openStatsModal() {
    const overlay = createStatsModalShell();
    overlay.style.display = "flex";
    state.statsModalVisible = true;
    await overlay._dropMonitorRefreshStats?.();
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
      const hits = Array.isArray(payload?.data) ? payload.data : [];
      return {
        hits,
        meta: {
          totalHits: Number(payload?.meta?.totalHits ?? hits.length),
          totalDrops: Number(payload?.meta?.totalDrops ?? hits.filter((hit) => hit.isDrop).length),
          lastDropAt: payload?.meta?.lastDropAt || null,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  function renderStats(container, statsPayload, options = {}) {
    if (!container) return;
    const hits = Array.isArray(statsPayload?.hits)
      ? statsPayload.hits
      : Array.isArray(statsPayload)
        ? statsPayload
        : [];
    const totalFetched = hits.length;
    const total = Number(statsPayload?.meta?.totalHits ?? totalFetched);
    const drops = Number(statsPayload?.meta?.totalDrops ?? hits.filter((hit) => hit.isDrop).length);
    const rate = total ? ((drops / total) * 100).toFixed(2) : "0.00";
    const lastDrop = statsPayload?.meta?.lastDropAt || hits.find((hit) => hit.isDrop)?.createdAt || null;
    const lastDropText = lastDrop ? new Date(lastDrop).toLocaleString() : "Brak";

    const showAllColumns = Boolean(options.showAllColumns);
    const rowLimit = Math.max(1, Math.min(500, Number(options.rowLimit) || 10));
    const viewHits = hits.slice(0, rowLimit);
    const shown = viewHits.length;

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

    function formatFightDebug(value) {
      if (!value) return "";
      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          return formatFightDebug(parsed);
        } catch (_err) {
          return value.length > 60 ? `${value.slice(0, 60)}...` : value;
        }
      }
      if (typeof value !== "object") return String(value);
      const parts = [];
      if (value.base != null) parts.push(`b:${value.base}`);
      if (value.equipment != null) parts.push(`eq:${value.equipment}`);
      if (value.event != null) parts.push(`ev:${value.event}`);
      if (value.militaryPassive != null) parts.push(`mp:${value.militaryPassive}`);
      if (value.militaryActive != null) parts.push(`ma:${value.militaryActive}`);
      return parts.join(" ");
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
        "fightDropChance",
        "fightDropSeed",
        "fightDropDebug",
        "warId",
        "regionName",
        "warUrl",
        "dropHeading",
        "dropDescription",
      ];

      const keys = new Set();
      viewHits.forEach((hit) => Object.keys(hit || {}).forEach((key) => keys.add(key)));

      const remaining = Array.from(keys).filter((k) => !preferred.includes(k));
      remaining.sort((a, b) => a.localeCompare(b));
      const columns = preferred.filter((k) => keys.has(k)).concat(remaining);

      const head = columns
        .map(
          (k) => `<th style="text-align:left;padding:4px 8px;border-bottom:1px solid #374151;">${escapeHtml(k)}</th>`,
        )
        .join("");
      const rows = viewHits
        .map((hit) => {
          const tds = columns
            .map((key) => {
              const raw = hit ? hit[key] : "";
              let value = normalizeValue(raw);
              if (key === "warUrl" && value) {
                const safeHref = escapeHtml(value);
                value = `<a href="${safeHref}" target="_blank" rel="noreferrer" style="color:#93c5fd;text-decoration:none;">${safeHref}</a>`;
              } else value = escapeHtml(value);
              if (value.length > 120) value = `${value.slice(0, 120)}…`;
              return `<td style="padding:4px 8px;border-bottom:1px solid #1f2937;vertical-align:top;white-space:nowrap;">${value}</td>`;
            })
            .join("");
          return `<tr>${tds}</tr>`;
        })
        .join("");

      const summaryHtml = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"><div style="flex:1 1 120px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:26px;font-weight:600;">${total}</div><div style="font-size:12px;color:#9ca3af;">Wszystkie hity w bazie</div></div><div style="flex:1 1 120px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:26px;font-weight:600;">${drops}</div><div style="font-size:12px;color:#9ca3af;">Wszystkie dropy w bazie</div></div><div style="flex:1 1 120px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:26px;font-weight:600;">${rate}%</div><div style="font-size:12px;color:#9ca3af;">Drop rate (baza)</div></div></div>`;
      const rowsHtml = rows || '<tr><td colspan="99" style="padding:8px 0;text-align:center;">Brak danych</td></tr>';
      container.innerHTML = `${summaryHtml}<p style="margin:4px 0 12px 0;font-size:12px;color:#9ca3af;">Ostatni drop: ${lastDropText}</p><div style="overflow-x:auto;border:1px solid #1f2937;border-radius:8px;"><table style="width:max-content;min-width:100%;border-collapse:collapse;font-size:12px;"><thead><tr>${head}</tr></thead><tbody>${rowsHtml}</tbody></table></div><p style="margin-top:10px;font-size:11px;color:#6b7280;">Pokazano ${shown} z ${totalFetched} pobranych rekordow (w bazie: ${total}).</p>`;

      return;
    }

    const rowsHtml = viewHits
      .map((hit) => {
        const time = new Date(hit.createdAt || hit.hitTriggeredAt || Date.now()).toLocaleTimeString();
        const fightInfo = [
          hit.fightDropChance != null ? `ch:${formatDropChance(hit.fightDropChance)}` : "",
          hit.fightDropSeed != null ? `seed:${hit.fightDropSeed}` : "",
          formatFightDebug(hit.fightDropDebug),
        ]
          .filter(Boolean)
          .join(" | ");
        return `<tr><td style="padding:4px 0;border-bottom:1px solid #1f2937;">${escapeHtml(time)}</td><td style="padding:4px 0;border-bottom:1px solid #1f2937;">${escapeHtml(hit.buttonLabel || "Walcz")}</td><td style="padding:4px 0;border-bottom:1px solid #1f2937;text-align:center;">${hit.isDrop ? "🎁" : "-"}</td><td style="padding:4px 0;border-bottom:1px solid #1f2937;text-align:right;">${escapeHtml(formatDropChance(hit.dropChance))}</td><td style="padding:4px 0;border-bottom:1px solid #1f2937;">${escapeHtml(fightInfo)}</td><td style="padding:4px 0;border-bottom:1px solid #1f2937;">${buildWhereCell(hit)}</td><td style="padding:4px 0;border-bottom:1px solid #1f2937;">${escapeHtml(hit.dropHeading || hit.dropDescription || "")}</td></tr>`;
      })
      .join("");

    const summaryHtml = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"><div style="flex:1 1 120px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:26px;font-weight:600;">${total}</div><div style="font-size:12px;color:#9ca3af;">Wszystkie hity w bazie</div></div><div style="flex:1 1 120px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:26px;font-weight:600;">${drops}</div><div style="font-size:12px;color:#9ca3af;">Wszystkie dropy w bazie</div></div><div style="flex:1 1 120px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:26px;font-weight:600;">${rate}%</div><div style="font-size:12px;color:#9ca3af;">Drop rate (baza)</div></div></div>`;
    const bodyHtml = rowsHtml || '<tr><td colspan="7" style="padding:8px 0;text-align:center;">Brak danych</td></tr>';
    container.innerHTML = `${summaryHtml}<p style="margin:4px 0 12px 0;font-size:12px;color:#9ca3af;">Ostatni drop: ${lastDropText}</p><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th style="text-align:left;padding:4px 0;border-bottom:1px solid #374151;">Czas</th><th style="text-align:left;padding:4px 0;border-bottom:1px solid #374151;">Akcja</th><th style="text-align:center;padding:4px 0;border-bottom:1px solid #374151;">Drop</th><th style="text-align:right;padding:4px 0;border-bottom:1px solid #374151;">Chance</th><th style="text-align:left;padding:4px 0;border-bottom:1px solid #374151;">Fight API</th><th style="text-align:left;padding:4px 0;border-bottom:1px solid #374151;">Gdzie</th><th style="text-align:left;padding:4px 0;border-bottom:1px solid #374151;">Opis</th></tr></thead><tbody>${bodyHtml}</tbody></table><p style="margin-top:10px;font-size:11px;color:#6b7280;">Pokazano ${shown} z ${totalFetched} pobranych rekordow (w bazie: ${total}).</p>`;
  }

  async function fetchAnalysis(onlyMine = true, days = 30) {
    const baseUrl = buildApiUrl("/api/analysis");
    const params = new URLSearchParams();
    if (Number.isFinite(days) && days > 0) {
      params.set("days", String(Math.trunc(days)));
    }
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
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, { headers, credentials: "omit", signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      const payload = await response.json();
      return payload?.data || null;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  function renderAnalysis(container, analysis) {
    if (!container) return;
    if (!analysis) {
      container.textContent = "Brak danych do analizy.";
      return;
    }

    const totals = analysis.totals || {};
    const roll = analysis.roll || {};
    const scope = analysis.scope || {};
    const debug = analysis.debugAverages || {};

    const fmtPct = (value) =>
      typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";
    const fmtNum = (value, digits = 2) =>
      typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "-";

    const cards = [
      { value: totals.hits ?? "-", label: "Hity (scope)" },
      { value: totals.observedDrops ?? "-", label: "Dropy (observed)" },
      { value: fmtPct(totals.observedDropRate), label: "Drop rate (observed)" },
      { value: totals.expectedDrops != null ? fmtNum(totals.expectedDrops, 2) : "-", label: "Dropy (expected)" },
      { value: fmtPct(totals.expectedDropRate), label: "Drop rate (expected)" },
      { value: totals.currentDryStreak ?? "-", label: "Obecny dry streak" },
      { value: totals.maxDryStreak ?? "-", label: "Max dry streak" },
      { value: roll.denominator ?? "-", label: "Denominator (seed)" },
    ];

    const debugKeys = Object.keys(debug).sort((a, b) => a.localeCompare(b));
    const debugHtml = debugKeys.length
      ? `<div style="margin-top:12px;border:1px solid #1f2937;border-radius:8px;padding:10px;background:#0b1220;"><div style="font-size:12px;color:#9ca3af;margin-bottom:6px;">Srednie skladowe debug</div><div style="display:flex;gap:8px;flex-wrap:wrap;">${debugKeys
          .map(
            (k) =>
              `<span style="font-size:12px;background:#111827;border:1px solid #1f2937;border-radius:999px;padding:4px 8px;">${k}: ${fmtNum(debug[k], 2)}</span>`,
          )
          .join("")}</div></div>`
      : "";

    const daily = Array.isArray(analysis.daily) ? analysis.daily.slice(-14) : [];
    const dailyRows = daily
      .map((d) => {
        const exp = d.expectedDrops != null ? fmtNum(d.expectedDrops, 2) : "-";
        return `<tr><td style="padding:4px 8px;border-bottom:1px solid #1f2937;">${d.date}</td><td style="padding:4px 8px;border-bottom:1px solid #1f2937;text-align:right;">${d.hits}</td><td style="padding:4px 8px;border-bottom:1px solid #1f2937;text-align:right;">${d.observedDrops}</td><td style="padding:4px 8px;border-bottom:1px solid #1f2937;text-align:right;">${exp}</td></tr>`;
      })
      .join("");

    const dailyTable =
      dailyRows.length > 0
        ? `<div style="margin-top:12px;border:1px solid #1f2937;border-radius:8px;overflow:hidden;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #374151;">Dzien</th><th style="text-align:right;padding:6px 8px;border-bottom:1px solid #374151;">Hity</th><th style="text-align:right;padding:6px 8px;border-bottom:1px solid #374151;">Dropy</th><th style="text-align:right;padding:6px 8px;border-bottom:1px solid #374151;">Expected</th></tr></thead><tbody>${dailyRows}</tbody></table></div>`
        : "";

    const seedHist = Array.isArray(analysis.seedHistogram) ? analysis.seedHistogram : [];
    const maxBin = seedHist.reduce((m, b) => Math.max(m, Number(b.count) || 0), 0) || 1;
    const seedBars = seedHist
      .map((b) => {
        const count = Number(b.count) || 0;
        const w = Math.round((count / maxBin) * 120);
        return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;"><div style="width:92px;color:#9ca3af;">${b.from}-${b.to}</div><div style="height:10px;width:${w}px;background:#60a5fa;border-radius:6px;"></div><div style="color:#9ca3af;">${count}</div></div>`;
      })
      .join("");
    const seedSection = seedBars
      ? `<div style="margin-top:12px;border:1px solid #1f2937;border-radius:8px;padding:10px;background:#0b1220;"><div style="font-size:12px;color:#9ca3af;margin-bottom:6px;">Histogram seed (10 binow)</div>${seedBars}</div>`
      : "";

    const note = `<p style="margin-top:10px;font-size:11px;color:#6b7280;">Scope: player=${scope.playerName || "ALL"}, war=${scope.warId || "ALL"}, days=${scope.days || "ALL"}, rows=${scope.rowCount}. Drop (observed) = isDrop w bazie LUB (seed &lt;= chance). Expected zaklada p ~= chance/denominator.</p>`;

    container.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">${cards
      .map(
        (c) =>
          `<div style="flex:1 1 150px;background:#1f2937;padding:10px;border-radius:8px;"><div style="font-size:22px;font-weight:600;">${c.value}</div><div style="font-size:12px;color:#9ca3af;">${c.label}</div></div>`,
      )
      .join("")}</div>${dailyTable}${seedSection}${debugHtml}${note}`;
  }

  installFightResponseNetworkHook();
  if (USE_POPUP_DETECTION) {
    observeNotifications();
  }
  ensureStatsButton();
})();
