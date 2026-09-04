// ==UserScript==
// @name         Pitantir ← PitPal Lobby + Furry Stashes
// @namespace    pitantir
// @version      1.4.0
// @description  Push PitPal lobby monitor + furry-stashes watchlist (140er = online-only) to Pitantir (local or VPS).
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

  /**
   * Local: http://127.0.0.1:3000
   * VPS (DEPLOY.md): http://YOUR_VPS_IP:3000 and add a Tampermonkey @connect for that host.
   */
  const PITANTIR_BASE = "http://127.0.0.1:3000";
  const PITANTIR_LOBBIES = PITANTIR_BASE + "/api/pitpal/lobbies";
  const PITANTIR_STASHES = PITANTIR_BASE + "/api/pitpal/furry-stashes";
  const PITPAL_PLAYERS = "/api/proxy/pitmod/players";
  const PITPAL_STASHES = "/api/furry-stashes";
  /** Lobby roster — keep this snappy; Pitantir ingest allows 60 posts/min. */
  const LOBBY_POLL_MS = 3_000;
  const STASH_POLL_MS = 60_000;

  let lobbyInFlight = false;
  let stashInFlight = false;
  let lastLobbyOkAt = 0;
  let lastStashOkAt = 0;
  let lastError = "";
  let lastLobbySummary = "lobbies: —";
  let lastStashSummary = "stashes: —";

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
      "max-width:320px",
      "white-space:pre-line",
    ].join(";");
    el.textContent = "Pitantir: waiting…";
    document.documentElement.appendChild(el);
    return el;
  }

  function setBadge(ok) {
    const el = ensureBadge();
    el.textContent =
      "Pitantir\n" + lastLobbySummary + "\n" + lastStashSummary + (lastError ? "\n" + lastError : "");
    el.style.borderColor = ok
      ? "rgba(125,206,160,0.7)"
      : "rgba(240,113,120,0.7)";
  }

  function postToPitantir(url, payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(payload),
        timeout: 15000,
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

  function is140erNotes(notes) {
    if (!notes || typeof notes !== "string") return false;
    return /140er/i.test(notes);
  }

  async function pollLobbies() {
    if (lobbyInFlight) return;
    lobbyInFlight = true;
    try {
      const response = await fetch(PITPAL_PLAYERS, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401 || response.status === 403) {
        lastLobbySummary = "lobbies: log into PitPal admin";
        setBadge(false);
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

      const result = await postToPitantir(PITANTIR_LOBBIES, {
        observedAt: new Date().toISOString(),
        source: "pitpal_tampermonkey",
        players,
      });
      lastLobbyOkAt = Date.now();
      lastError = "";
      lastLobbySummary =
        `lobbies: ${result.playerCount}p / ${result.lobbyCount}L · watch ${result.watchlistMatched}` +
        (result.statusEventsPosted ? ` · ${result.statusEventsPosted} status` : "") +
        (result.presenceConfirmsQueued ? ` · ${result.presenceConfirmsQueued} confirm` : "");
      setBadge(true);
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      lastLobbySummary = "lobbies: error";
      setBadge(false);
    } finally {
      lobbyInFlight = false;
    }
  }

  async function pollFurryStashes() {
    if (stashInFlight) return;
    stashInFlight = true;
    try {
      const response = await fetch(PITPAL_STASHES, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401 || response.status === 403) {
        lastStashSummary = "stashes: need furry-stashes access";
        setBadge(false);
        return;
      }
      if (!response.ok) {
        throw new Error(`PitPal furry-stashes HTTP ${response.status}`);
      }
      const json = await response.json();
      const raw = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      const entries = raw
        .map((row) => {
          const username = (row?.username ?? row?.mcUsername ?? row?.name ?? "").trim();
          const notes = typeof row?.notes === "string" ? row.notes.trim() : "";
          return {
            username,
            notes: notes || null,
            is140er: is140erNotes(notes),
          };
        })
        .filter((row) => /^[A-Za-z0-9_]{3,16}$/.test(row.username));

      const result = await postToPitantir(PITANTIR_STASHES, {
        observedAt: new Date().toISOString(),
        source: "pitpal_furry_stashes",
        entries,
      });
      lastStashOkAt = Date.now();
      lastError = "";
      lastStashSummary =
        `stashes: ${result.entryCount} · +${result.created}/${result.promoted} · 140er ${result.marked140er}`;
      setBadge(true);
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      lastStashSummary = "stashes: error";
      setBadge(false);
    } finally {
      stashInFlight = false;
    }
  }

  function boot() {
    ensureBadge();
    void pollLobbies();
    void pollFurryStashes();
    window.setInterval(() => void pollLobbies(), LOBBY_POLL_MS);
    window.setInterval(() => void pollFurryStashes(), STASH_POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        void pollLobbies();
        void pollFurryStashes();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
