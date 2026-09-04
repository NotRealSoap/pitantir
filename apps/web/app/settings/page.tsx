"use client";

import { useCallback, useEffect, useState } from "react";
import { DiscordWebhookPanel } from "../../src/components/DiscordWebhookPanel";
import { DownwatchPanel } from "../../src/components/DownwatchPanel";

type KeySectionProps = {
  title: string;
  description: string;
  configured: boolean | null;
  endpoint: string;
  savedMessage: string;
  onConfiguredChange: (value: boolean) => void;
};

function KeySection({
  title,
  description,
  configured,
  endpoint,
  savedMessage,
  onConfiguredChange,
}: KeySectionProps) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeyInput }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        configured?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        setMessage(payload.error ?? "Could not save API key.");
        onConfiguredChange(false);
        return;
      }
      onConfiguredChange(true);
      setApiKeyInput("");
      setMessage(savedMessage);
    } catch {
      setMessage("Could not save API key.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" style={{ marginTop: "1.5rem", maxWidth: "36rem" }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        {title}
      </h2>
      <p className="muted">{description}</p>
      <p>
        Status:{" "}
        <span className="chip">
          {configured === null ? "Checking…" : configured ? "configured" : "not configured"}
        </span>
      </p>
      <form
        className="form-stack"
        style={{ marginTop: "0.75rem", maxWidth: "100%" }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          API key
          <input
            type="password"
            autoComplete="off"
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
            placeholder="Paste key (never shown again)"
            required
          />
        </label>
        <button type="submit" className="primary" disabled={saving || apiKeyInput.trim().length < 8}>
          {saving ? "Saving…" : configured ? "Replace key" : "Save key"}
        </button>
      </form>
      {message ? <p style={{ marginBottom: 0 }}>{message}</p> : null}
    </section>
  );
}

type ScanControlPayload = {
  paused?: boolean;
  circuitOpen?: boolean;
  circuitDetail?: string | null;
  consecutiveFailures?: number;
  error?: string;
};

/** Always at top of Settings — big obvious control to unpause Hypixel. */
function HypixelScanControlBanner() {
  const [control, setControl] = useState<ScanControlPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/scan-control", { cache: "no-store" });
      const payload = (await response.json()) as ScanControlPayload;
      if (response.ok) setControl(payload);
    } catch {
      // keep last state
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function resumeScans() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/scan-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: false }),
      });
      const payload = (await response.json()) as ScanControlPayload;
      if (!response.ok) {
        setError(payload.error ?? "Could not resume scanning.");
        return;
      }
      setControl(payload);
      setMessage("Hypixel scanning turned back on — pause and failure circuit cleared.");
    } catch {
      setError("Could not resume scanning.");
    } finally {
      setBusy(false);
    }
  }

  const scansOff = Boolean(control?.paused || control?.circuitOpen);
  const statusLabel = control == null ? "Checking…" : scansOff ? "OFF" : "ON";

  return (
    <section id="hypixel-scan-control" className="hypixel-scan-control panel">
      <div className="hypixel-scan-control-head">
        <div>
          <h2 className="section-title hypixel-scan-control-title">Hypixel player scanning</h2>
          <p className="muted hypixel-scan-control-lede">
            If inventory scans stopped after rate limits, use the button below. Also make sure the
            worker is running (<code>npx pnpm@10.11.0 start:worker</code>).
          </p>
        </div>
        <span
          className={`hypixel-scan-status-pill${scansOff ? " is-off" : control == null ? " is-unknown" : " is-on"}`}
        >
          {statusLabel}
        </span>
      </div>

      {scansOff ? (
        <p className="hypixel-scan-control-detail" role="status">
          {control?.circuitOpen
            ? `Blocked${control.circuitDetail ? `: ${control.circuitDetail}` : " by failure circuit"}.`
            : "Paused — scheduled and manual Hypixel calls are stopped."}
        </p>
      ) : control != null ? (
        <p className="muted hypixel-scan-control-detail">
          Status says scanning is enabled. If players still are not updating, click anyway to clear
          any stuck pause/circuit, then confirm the worker is running.
        </p>
      ) : null}

      <button
        type="button"
        className="primary hypixel-scan-resume-btn"
        disabled={busy}
        onClick={() => void resumeScans()}
      >
        {busy ? "Working…" : "Turn Hypixel scanning back on"}
      </button>

      {message ? (
        <p role="status" className="hypixel-scan-control-feedback">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="alert hypixel-scan-control-feedback">
          {error}
        </p>
      ) : null}
    </section>
  );
}

type HypixelUsagePayload = {
  configured?: boolean;
  used?: number | null;
  snapshot?: {
    limit: number;
    remaining: number;
    resetSeconds: number;
    observedAt: string;
    source: string;
    windowSeconds: number;
  } | null;
  resetAt?: string | null;
  secondsUntilReset?: number | null;
  stale?: boolean;
  watchlistCount?: number;
  refreshingCount?: number;
  normalRefreshingCount?: number;
  slowRefreshingCount?: number;
  currentIntervalSeconds?: number | null;
  recommendedIntervalSeconds?: number | null;
  recommendedSlowIntervalSeconds?: number | null;
  estimatedRequestsPerWindow?: number | null;
  estimatedBudgetPerWindow?: number | null;
  budgetUtilization?: number;
  databaseReady?: boolean;
  scansPaused?: boolean;
  circuitOpen?: boolean;
  circuitDetail?: string | null;
  consecutiveFailures?: number;
  inventorySourceStatus?: {
    mode: string;
    activeSource: string;
    activeSince: string;
    lastSuccessSource?: string | null;
    lastSuccessAt?: string | null;
    lastFallbackSource?: string | null;
    lastFallbackAt?: string | null;
    detail?: string | null;
  } | null;
  error?: string;
  message?: string;
  ok?: boolean;
};

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes < 60) return rem ? `${minutes}m ${rem}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function HypixelUsagePanel({ enabled }: { enabled: boolean }) {
  const [usage, setUsage] = useState<HypixelUsagePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customInterval, setCustomInterval] = useState("300");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/hypixel/usage");
      const payload = (await response.json()) as HypixelUsagePayload;
      setUsage(payload);
      if (payload.recommendedIntervalSeconds) {
        setCustomInterval(String(payload.recommendedIntervalSeconds));
      }
    } catch {
      setUsage(null);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function runAction(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/hypixel/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as HypixelUsagePayload;
      if (!response.ok) {
        setError(payload.error ?? "Request failed.");
        return;
      }
      setUsage(payload);
      setMessage(payload.message ?? "Updated.");
      if (payload.recommendedIntervalSeconds) {
        setCustomInterval(String(payload.recommendedIntervalSeconds));
      }
    } catch {
      setError("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const snapshot = usage?.snapshot ?? null;
  const pct =
    snapshot && snapshot.limit > 0
      ? Math.min(100, Math.round(((snapshot.limit - snapshot.remaining) / snapshot.limit) * 100))
      : 0;
  const scansOff = Boolean(usage?.scansPaused || usage?.circuitOpen);
  const sourceStatus = usage?.inventorySourceStatus ?? null;

  return (
    <section className="panel" style={{ marginTop: "1.5rem", maxWidth: "36rem" }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Hypixel API usage
      </h2>
      <p className="muted">
        Live from Hypixel <code>RateLimit-*</code> headers on each scan (or Refresh quota). The
        worker aims for ~45% of the key window (e.g. ~135 of 300 / 5 minutes), with a gap between
        calls. Accounts with <code>140er</code> in notes are <strong>never</strong> auto-scanned on
        Hypixel (PitPal presence only; Scan now still works).
      </p>

      {!enabled ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          Save a Hypixel API key above to track quota.
        </p>
      ) : (
        <>
          <div className="meta-row" style={{ marginTop: "0.75rem" }}>
            {sourceStatus ? (
              <span className="chip" title={sourceStatus.detail ?? sourceStatus.activeSource}>
                source <strong>{sourceStatus.activeSource}</strong>
              </span>
            ) : null}
            <span className="chip">
              used{" "}
              <strong>
                {usage?.used ?? "—"}/{snapshot?.limit ?? "—"}
              </strong>
            </span>
            <span className="chip">
              remaining <strong>{snapshot?.remaining ?? "—"}</strong>
            </span>
            <span className="chip">
              resets in <strong>{formatDuration(usage?.secondsUntilReset)}</strong>
            </span>
            {usage?.stale ? <span className="chip">stale — refresh</span> : null}
            {scansOff ? <span className="chip">scanning off</span> : null}
          </div>

          {scansOff ? (
            <p className="muted" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
              Paused or circuit open — use{" "}
              <a href="#hypixel-scan-control">Turn Hypixel scanning back on</a> at the top of
              Settings.
            </p>
          ) : null}

          {sourceStatus ? (
            <p className="muted" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
              Active inventory source: <strong>{sourceStatus.activeSource}</strong>
              {sourceStatus.lastFallbackSource === sourceStatus.activeSource &&
              sourceStatus.lastFallbackAt
                ? ` (fallback in use since ${formatDuration(Math.round((Date.now() - new Date(sourceStatus.lastFallbackAt).getTime()) / 1000))} ago)`
                : ""}
              {sourceStatus.detail ? <> — {sourceStatus.detail}</> : null}
            </p>
          ) : null}

          <div
            aria-hidden="true"
            style={{
              marginTop: "0.75rem",
              height: "0.55rem",
              borderRadius: "999px",
              background: "color-mix(in srgb, var(--text) 12%, transparent)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: pct >= 90 ? "#c45c3e" : "var(--accent, #2f6f5e)",
                transition: "width 0.3s ease",
              }}
            />
          </div>

          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Watch list: <strong>{usage?.refreshingCount ?? 0}</strong> refreshing /{" "}
            {usage?.watchlistCount ?? 0} total
            {usage?.slowRefreshingCount != null ? (
              <>
                {" "}
                (<strong>{usage.normalRefreshingCount ?? 0}</strong> Hypixel-scanned ·{" "}
                <strong>{usage.slowRefreshingCount}</strong> 140er skipped)
              </>
            ) : null}
            . Current cool interval:{" "}
            <strong>{formatDuration(usage?.currentIntervalSeconds)}</strong>
            {usage?.recommendedIntervalSeconds != null ? (
              <>
                {" "}
                · recommended:{" "}
                <strong>{formatDuration(usage.recommendedIntervalSeconds)}</strong>
              </>
            ) : null}
          </p>
          {usage?.estimatedBudgetPerWindow != null ? (
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              Target budget ≈ <strong>{usage.estimatedBudgetPerWindow}</strong> scans / ~
              {formatDuration(snapshot?.windowSeconds ?? null)} window (
              {Math.round((usage.budgetUtilization ?? 0.45) * 100)}% of limit). Estimated load at
              current intervals ≈ <strong>{usage.estimatedRequestsPerWindow ?? "—"}</strong> /
              window (140ers excluded). Click <em>Apply recommended interval</em> to retune cadence.
            </p>
          ) : (
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              No quota sample yet. Click Refresh quota (1 Hypixel request) or wait for a scan.
            </p>
          )}

          <div className="row-actions" style={{ marginTop: "0.85rem" }}>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void runAction({ action: "probe" })}
            >
              {busy ? "Working…" : "Refresh quota"}
            </button>
            <button
              type="button"
              disabled={busy || usage?.recommendedIntervalSeconds == null}
              onClick={() => void runAction({ action: "apply_recommended_interval" })}
            >
              Apply recommended interval
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAction({ action: "rebalance_schedule" })}
              title="Spread next-scan times so accounts are not all due together"
            >
              Stagger schedule
            </button>
          </div>

          <form
            className="form-stack"
            style={{ marginTop: "0.85rem", maxWidth: "100%" }}
            onSubmit={(event) => {
              event.preventDefault();
              const seconds = Number(customInterval);
              void runAction({ action: "set_interval", scanIntervalSeconds: seconds });
            }}
          >
            <label>
              Custom interval (seconds)
              <input
                type="number"
                min={30}
                max={86400}
                value={customInterval}
                onChange={(event) => setCustomInterval(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              Set watch-list interval
            </button>
          </form>

          {message ? <p role="status">{message}</p> : null}
          {error ? (
            <p role="alert" className="alert">
              {error}
            </p>
          ) : null}
          {snapshot ? (
            <p className="muted" style={{ marginBottom: 0, fontSize: "0.85rem" }}>
              Last sample: {new Date(snapshot.observedAt).toLocaleString()} ({snapshot.source})
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function PitPalBridgePanel() {
  const [snapshot, setSnapshot] = useState<{
    observedAt?: string | null;
    playerCount?: number;
    lobbyCount?: number;
    source?: string | null;
    monitorStatus?: string | null;
    monitorAgeMs?: number | null;
    monitorStaleMs?: number | null;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/pitpal/lobbies", { cache: "no-store" });
        const payload = (await response.json()) as {
          observedAt?: string | null;
          playerCount?: number;
          lobbyCount?: number;
          source?: string | null;
          players?: unknown[];
          monitor?: {
            status?: string | null;
            ageMs?: number | null;
            staleMs?: number | null;
          };
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) {
          setSnapshot({ error: payload.error ?? "Unavailable" });
          return;
        }
        setSnapshot({
          observedAt: payload.observedAt,
          playerCount: payload.playerCount ?? payload.players?.length ?? 0,
          lobbyCount: payload.lobbyCount,
          source: payload.source,
          monitorStatus: payload.monitor?.status ?? null,
          monitorAgeMs: payload.monitor?.ageMs ?? null,
          monitorStaleMs: payload.monitor?.staleMs ?? null,
        });
      } catch {
        if (!cancelled) setSnapshot({ error: "Unavailable" });
      }
    }
    void load();
    const id = window.setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const monitorLabel = (() => {
    if (!snapshot || snapshot.error) return null;
    const status = snapshot.monitorStatus ?? "unknown";
    const ageMs = snapshot.monitorAgeMs;
    const age =
      ageMs == null
        ? "never"
        : ageMs < 60_000
          ? `${Math.round(ageMs / 1000)}s ago`
          : `${Math.round(ageMs / 60_000)}m ago`;
    const staleMin = Math.round((snapshot.monitorStaleMs ?? 180_000) / 60_000);
    return `${status} · last ingest ${age} · alert after ${staleMin}m gap`;
  })();

  return (
    <section className="panel" style={{ marginTop: "1.5rem", maxWidth: "52rem" }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        PitPal lobby bridge
      </h2>
      <p className="muted">
        A Tampermonkey script (while you&apos;re logged into PitPal admin) reads{" "}
        <code>/api/proxy/pitmod/players</code> and <code>/api/furry-stashes</code>, then posts into
        Pitantir. Lobby events go to the PitPal status webhook; furry-stashes IGNs are added to the
        watchlist. Notes containing <code>140er</code> get the online roster dashboard only (no
        online/offline alerts, no inventory / item +/− / PitPal status). No admin password is shared with the worker. The
        worker also keeps a sticky Discord lobby-monitor message (edited in place) with ONLINE/OFFLINE
        and time since last ingest — set the lobby monitor webhook or reuse the alerts channel.
      </p>
      <p>
        Status:{" "}
        <span className="chip">
          {snapshot == null
            ? "Checking…"
            : snapshot.error
              ? snapshot.error
              : snapshot.observedAt
                ? "receiving"
                : "waiting for first ingest"}
        </span>
        {monitorLabel ? (
          <>
            {" "}
            <span className="chip">monitor {monitorLabel}</span>
          </>
        ) : null}
      </p>
      {snapshot?.observedAt ? (
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          Last ingest: {new Date(snapshot.observedAt).toLocaleString()} ·{" "}
          <strong>{snapshot.playerCount ?? 0}</strong> players ·{" "}
          <strong>{snapshot.lobbyCount ?? "—"}</strong> lobbies
          {snapshot.source ? (
            <>
              {" "}
              · <code>{snapshot.source}</code>
            </>
          ) : null}
        </p>
      ) : null}
      <ol className="muted" style={{ paddingLeft: "1.2rem" }}>
        <li>
          Install Tampermonkey, then add script from repo:{" "}
          <code>scripts/pitpal-lobbies.user.js</code>
        </li>
        <li>
          Keep Pitantir web reachable (local <code>http://127.0.0.1:3000</code>, or your VPS URL
          from <code>DEPLOY.md</code>). Update <code>PITANTIR_BASE</code> /{" "}
          <code>@connect</code> in the userscript.
        </li>
        <li>
          Open <code>https://pitpal.rocks/admin/lobbies</code> (and ideally{" "}
          <code>/admin/furry-stashes</code>) while logged in as admin. The badge shows lobby + stash
          sync; <code>140er</code> notes → roster dashboard only (no online/offline alerts).
        </li>
        <li>
          Run <code>npx pnpm@10.11.0 db:migrate</code> once for PitPal columns, then restart web.
        </li>
      </ol>
    </section>
  );
}

export default function SettingsPage() {
  const [pitpandaConfigured, setPitpandaConfigured] = useState<boolean | null>(null);
  const [hypixelConfigured, setHypixelConfigured] = useState<boolean | null>(null);
  const [inventorySource, setInventorySource] = useState<string>("mock");

  useEffect(() => {
    void (async () => {
      try {
        const [pitpanda, hypixel] = await Promise.all([
          fetch("/api/settings/pitpanda").then((r) => r.json()),
          fetch("/api/settings/hypixel").then((r) => r.json()),
        ]);
        setPitpandaConfigured(Boolean(pitpanda.configured));
        setHypixelConfigured(Boolean(hypixel.configured));
        if (typeof hypixel.inventorySource === "string") {
          setInventorySource(hypixel.inventorySource);
        }
      } catch {
        setPitpandaConfigured(false);
        setHypixelConfigured(false);
      }
    })();
  }, []);

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-lede">
        Server-only API keys for local/dev. Keys are written to <code>.env.local</code> and never
        returned to the browser.
      </p>
      <p className="muted">
        Current inventory source for the worker: <code>{inventorySource}</code>
      </p>

      <HypixelScanControlBanner />

      <KeySection
        title="PitPanda"
        description="Used by Item Search for upstream book lookups."
        configured={pitpandaConfigured}
        endpoint="/api/settings/pitpanda"
        savedMessage="PitPanda API key saved. You can use Item Search now."
        onConfiguredChange={setPitpandaConfigured}
      />

      <KeySection
        title="Hypixel"
        description="Used by the worker for Hypixel Pit inventory scans. After saving, restart the worker so it loads the new key."
        configured={hypixelConfigured}
        endpoint="/api/settings/hypixel"
        savedMessage="Hypixel API key saved. Restart the worker (INVENTORY_SOURCE=hypixel_pit)."
        onConfiguredChange={(value) => {
          setHypixelConfigured(value);
          if (value) setInventorySource("hypixel_pit");
        }}
      />

      <HypixelUsagePanel enabled={Boolean(hypixelConfigured)} />

      <DiscordWebhookPanel />

      <DownwatchPanel />

      <PitPalBridgePanel />

      <section className="panel" style={{ marginTop: "1.5rem", maxWidth: "36rem" }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Notes
        </h2>
        <ul className="muted">
          <li>Do not deploy this settings endpoint to a public host without auth.</li>
          <li>
            After saving the Hypixel key, restart the worker. Username-only accounts resolve UUID
            automatically via Mojang on first scan.
          </li>
          <li>
            Quota updates automatically as the worker scans. Refresh quota spends one request to
            sample headers without scanning an account.
          </li>
          <li>
            Online status uses <code>lastLogin</code>/<code>lastLogout</code> from each inventory
            scan (free). For Hypixel’s more accurate <code>/v2/status</code> (extra request per
            scan), set <code>HYPIXEL_STATUS_CHECKS=true</code> on the worker.
          </li>
          <li>
            Discord: online dashboard = roster-only channel (includes PitPal-visible API Off).
            Online/offline alerts = Hypixel came-online / went-offline / still-online index pings.
            PitPal status = every pitpal.rocks/admin/lobbies change. Inventory and item +/− stay on
            their own webhooks.
          </li>
          <li>
            Presence: PitPal lobbies is soft-online + username casing SoT. If Hypixel says offline
            while PitPal still lists them, the roster shows <code>API Off</code> and they stay Hot
            for scanning. PitPanda nonce lastseen is only a weak secondary hint.
          </li>
        </ul>
      </section>
    </>
  );
}
