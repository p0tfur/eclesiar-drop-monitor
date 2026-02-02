(function initEclesiarApiConfig(global) {
  const existing = global.EclesiarApi || {};
  const defaultBaseUrl = existing.dropMonitor?.baseUrl || "https://drop-monitor.example.com";
  const endpoints = Object.assign(
    {
      drops: "/api/drops",
    },
    existing.dropMonitor?.endpoints || {}
  );

  function buildUrl(path) {
    const base = (existing.dropMonitor?.baseUrl || defaultBaseUrl).replace(/\/$/, "");
    const suffix = !path ? "" : path.startsWith("/") ? path : `/${path}`;
    return `${base}${suffix}`;
  }

  const api = Object.assign({}, existing, {
    dropMonitor: {
      baseUrl: defaultBaseUrl,
      endpoints,
      buildUrl,
    },
    getDropMonitorUrl(customPath) {
      const path = typeof customPath === "string" && customPath.length ? customPath : endpoints.drops;
      return buildUrl(path);
    },
  });

  Object.defineProperty(api, "__timestamp", {
    value: Date.now(),
    enumerable: false,
    configurable: false,
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.EclesiarApi = api;
})(typeof window !== "undefined" ? window : globalThis);
