// ==UserScript==
// @name         Pitantir ← PitPal Lobby Monitor
// @namespace    pitantir
// @version      1.0.0
// @description  While logged into PitPal admin lobbies, push lobby/location data to local Pitantir.
// @author       Pitantir
// @match        https://pitpal.rocks/*
// @match        https://www.pitpal.rocks/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /** Change if your Next.js app is not on 3000. */
  const PITANTIR_INGEST = "http://127.0.0.1:3000/api/pitpal/lobbies";
  const PITPAL_PLAYERS = "/api/proxy/pitmod/players";
  const POLL_MS = 15_000;

  let inFlight = false;
  let lastOkAt = 0;
  let lastError = "";

  function ensureBadge() {
    let el = document.getElementById("pitantir-pitpal-badge");
    if (el) return el;
    el = document.createElement("div");
    el.id = "pitantir-pitpal-badge";
    el.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:999999",
      "padding:8px 10px",
      "border-radius:10px",
      "background:rgba(16,20,28,0.92)",
      "color:#e8edf5",
      "font:12px/1.35 ui-sans-serif,system-ui,sans-serif",
      "border:1px solid rgba(78,205,196,0.45)",
      "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
      "max-width:280px",
    ].join(";");
    el.textContent = "Pitantir: waiting…";
    document.documentElement.appendChild(el);
    return el;
  }

  function setBadge(text, ok) {
    const el = ensureBadge();
    el.textContent = text;
    el.style.borderColor = ok
      ? "rgba(125,206,160,0.7)"
      : "rgba(240,113,120,0.7)";
  }

  function postToPitantir(payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: PITANTIR_INGEST,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(payload),
        timeout: 10000,
        onload: (res) => {
          let body = null;
          try {
            body = JSON.parse(res.responseText || "{}");
          } catch {
            body = null;
          }
          if (res.status >= 200 && res.status < 300 && body && body.ok) {
            resolve(body);
          } else {
            reject(
              new Error(
                (body && body.error) ||
                  `Pitantir HTTP ${res.status}: ${(res.responseText || "").slice(0, 120)}`,
              ),
            );
          }
        },
        onerror: () => reject(new Error("Could not reach Pitantir (is restart:web running?)")),
        ontimeout: () => reject(new Error("Pitantir request timed out")),
      });
    });
  }

  async function pollOnce() {
    if (inFlight) return;
    inFlight = true;
    try {
      const response = await fetch(PITPAL_PLAYERS, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401 || response.status === 403) {
        setBadge("Pitantir: log into PitPal admin first", false);
        return;
      }
      if (!response.ok) {
        throw new Error(`PitPal players HTTP ${response.status}`);
      }
      const json = await response.json();
      const raw = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      const players = raw.map((row) => ({
        name: row?.name ?? row?.mcUsername ?? "",
        lobbyName: row?.lobbyName ?? null,
        location: row?.location ?? null,
        armorType: row?.armorType ?? null,
        killStreak: typeof row?.killStreak === "number" ? row.killStreak : null,
        isNicked: typeof row?.isNicked === "boolean" ? row.isNicked : null,
      }));

      const result = await postToPitantir({
        observedAt: new Date().toISOString(),
        source: "pitpal_tampermonkey",
        players,
      });
      lastOkAt = Date.now();
      lastError = "";
      setBadge(
        `Pitantir OK · ${result.playerCount} players · ${result.lobbyCount} lobbies · watch ${result.watchlistMatched}`,
        true,
      );
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      setBadge(`Pitantir error: ${lastError}`, false);
    } finally {
      inFlight = false;
    }
  }

  function boot() {
    ensureBadge();
    void pollOnce();
    window.setInterval(() => void pollOnce(), POLL_MS);
    // Also refresh when returning to the lobbies tab.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void pollOnce();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
