"use client";

import { useCallback, useEffect, useState } from "react";

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

  return (
    <section className="panel" style={{ marginTop: "1.5rem", maxWidth: "36rem" }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Hypixel API usage
      </h2>
      <p className="muted">
        Live from Hypixel <code>RateLimit-*</code> headers on each scan (or Refresh quota). The
        worker aims for ~80% of the key window (e.g. ~240 of 300 / 5 minutes). Accounts with{" "}
        <code>140er</code> in notes are Hypixel-indexed at most every 30 minutes.
      </p>

      {!enabled ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          Save a Hypixel API key above to track quota.
        </p>
      ) : (
        <>
          <div className="meta-row" style={{ marginTop: "0.75rem" }}>
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
          </div>

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
                (<strong>{usage.normalRefreshingCount ?? 0}</strong> normal ·{" "}
                <strong>{usage.slowRefreshingCount}</strong> 140er)
              </>
            ) : null}
            . Current cool interval:{" "}
            <strong>{formatDuration(usage?.currentIntervalSeconds)}</strong>
            {usage?.recommendedIntervalSeconds != null ? (
              <>
                {" "}
                · recommended non-140er:{" "}
                <strong>{formatDuration(usage.recommendedIntervalSeconds)}</strong>
                {usage.recommendedSlowIntervalSeconds != null ? (
                  <>
                    {" "}
                    · 140er:{" "}
                    <strong>{formatDuration(usage.recommendedSlowIntervalSeconds)}</strong>
                  </>
                ) : null}
              </>
            ) : null}
          </p>
          {usage?.estimatedBudgetPerWindow != null ? (
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              Target budget ≈ <strong>{usage.estimatedBudgetPerWindow}</strong> scans / ~
              {formatDuration(snapshot?.windowSeconds ?? null)} window (
              {Math.round((usage.budgetUtilization ?? 0.8) * 100)}% of limit). Estimated load at
              current intervals ≈ <strong>{usage.estimatedRequestsPerWindow ?? "—"}</strong> /
              window. Click <em>Apply recommended interval</em> to retune cool cadence (and lock
              140ers to 30m).
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

type DiscordPlayerRuleState = {
  accountId: string;
  mcUsername: string;
  notifyCameOnline: boolean;
  notifyWentOffline: boolean;
  notifyEveryOnlineScan: boolean;
  notifyItemGainedLost: boolean;
  notifyInventoryUpdated: boolean;
  notifyPitpalStatusChanges: boolean;
};

type DiscordWebhookPayload = {
  configured?: boolean;
  presenceWebhookUrlMasked?: string | null;
  presenceAlertsWebhookUrlMasked?: string | null;
  inventoryWebhookUrlMasked?: string | null;
  itemMovesWebhookUrlMasked?: string | null;
  pitpalStatusWebhookUrlMasked?: string | null;
  non140erDashboardWebhookUrlMasked?: string | null;
  opsAlertDiscordUserId?: string | null;
  notifyCameOnline?: boolean;
  notifyWentOffline?: boolean;
  notifyEveryOnlineScan?: boolean;
  notifyItemGainedLost?: boolean;
  notifyInventoryUpdated?: boolean;
  notifyPitpalStatusChanges?: boolean;
  onlineDashboardEnabled?: boolean;
  onlineDashboardConfigured?: boolean;
  non140erDashboardConfigured?: boolean;
  playerRules?: DiscordPlayerRuleState[];
  watchlist?: Array<{ id: string; mcUsername: string }>;
  ok?: boolean;
  message?: string;
  error?: string;
};

const DEFAULT_PLAYER_FLAGS = {
  notifyCameOnline: true,
  notifyWentOffline: false,
  notifyEveryOnlineScan: true,
  notifyItemGainedLost: true,
  notifyInventoryUpdated: false,
  notifyPitpalStatusChanges: true,
};

function buildPlayerRows(
  watchlist: Array<{ id: string; mcUsername: string }>,
  rules: DiscordPlayerRuleState[],
  defaults: typeof DEFAULT_PLAYER_FLAGS,
): DiscordPlayerRuleState[] {
  const byId = new Map(rules.map((rule) => [rule.accountId, rule]));
  return watchlist
    .slice()
    .sort((a, b) => a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" }))
    .map((account) => {
      const rule = byId.get(account.id);
      return {
        accountId: account.id,
        mcUsername: account.mcUsername,
        notifyCameOnline: rule?.notifyCameOnline ?? defaults.notifyCameOnline,
        notifyWentOffline: rule?.notifyWentOffline ?? defaults.notifyWentOffline,
        notifyEveryOnlineScan: rule?.notifyEveryOnlineScan ?? defaults.notifyEveryOnlineScan,
        notifyItemGainedLost: rule?.notifyItemGainedLost ?? defaults.notifyItemGainedLost,
        notifyInventoryUpdated: rule?.notifyInventoryUpdated ?? defaults.notifyInventoryUpdated,
        notifyPitpalStatusChanges:
          rule?.notifyPitpalStatusChanges ?? defaults.notifyPitpalStatusChanges,
      };
    });
}

function flagsEqual(a: DiscordPlayerRuleState, defaults: typeof DEFAULT_PLAYER_FLAGS): boolean {
  return (
    a.notifyCameOnline === defaults.notifyCameOnline &&
    a.notifyWentOffline === defaults.notifyWentOffline &&
    a.notifyEveryOnlineScan === defaults.notifyEveryOnlineScan &&
    a.notifyItemGainedLost === defaults.notifyItemGainedLost &&
    a.notifyInventoryUpdated === defaults.notifyInventoryUpdated &&
    a.notifyPitpalStatusChanges === defaults.notifyPitpalStatusChanges
  );
}

function DiscordWebhookPanel() {
  const [status, setStatus] = useState<DiscordWebhookPayload | null>(null);
  const [presenceWebhookUrl, setPresenceWebhookUrl] = useState("");
  const [presenceAlertsWebhookUrl, setPresenceAlertsWebhookUrl] = useState("");
  const [inventoryWebhookUrl, setInventoryWebhookUrl] = useState("");
  const [itemMovesWebhookUrl, setItemMovesWebhookUrl] = useState("");
  const [pitpalStatusWebhookUrl, setPitpalStatusWebhookUrl] = useState("");
  const [non140erDashboardWebhookUrl, setNon140erDashboardWebhookUrl] = useState("");
  const [opsAlertDiscordUserId, setOpsAlertDiscordUserId] = useState("");
  const [notifyCameOnline, setNotifyCameOnline] = useState(true);
  const [notifyWentOffline, setNotifyWentOffline] = useState(false);
  const [notifyEveryOnlineScan, setNotifyEveryOnlineScan] = useState(true);
  const [notifyItemGainedLost, setNotifyItemGainedLost] = useState(true);
  const [notifyInventoryUpdated, setNotifyInventoryUpdated] = useState(false);
  const [notifyPitpalStatusChanges, setNotifyPitpalStatusChanges] = useState(true);
  const [onlineDashboardEnabled, setOnlineDashboardEnabled] = useState(true);
  const [playerRows, setPlayerRows] = useState<DiscordPlayerRuleState[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyPayload(payload: DiscordWebhookPayload) {
    setStatus(payload);
    const defaults = {
      notifyCameOnline: payload.notifyCameOnline ?? DEFAULT_PLAYER_FLAGS.notifyCameOnline,
      notifyWentOffline: payload.notifyWentOffline ?? DEFAULT_PLAYER_FLAGS.notifyWentOffline,
      notifyEveryOnlineScan:
        payload.notifyEveryOnlineScan ?? DEFAULT_PLAYER_FLAGS.notifyEveryOnlineScan,
      notifyItemGainedLost:
        payload.notifyItemGainedLost ?? DEFAULT_PLAYER_FLAGS.notifyItemGainedLost,
      notifyInventoryUpdated:
        payload.notifyInventoryUpdated ?? DEFAULT_PLAYER_FLAGS.notifyInventoryUpdated,
      notifyPitpalStatusChanges:
        payload.notifyPitpalStatusChanges ?? DEFAULT_PLAYER_FLAGS.notifyPitpalStatusChanges,
    };
    setNotifyCameOnline(defaults.notifyCameOnline);
    setNotifyWentOffline(defaults.notifyWentOffline);
    setNotifyEveryOnlineScan(defaults.notifyEveryOnlineScan);
    setNotifyItemGainedLost(defaults.notifyItemGainedLost);
    setNotifyInventoryUpdated(defaults.notifyInventoryUpdated);
    setNotifyPitpalStatusChanges(defaults.notifyPitpalStatusChanges);
    setOnlineDashboardEnabled(payload.onlineDashboardEnabled ?? true);
    setOpsAlertDiscordUserId(payload.opsAlertDiscordUserId ?? "");
    setPlayerRows(
      buildPlayerRows(payload.watchlist ?? [], payload.playerRules ?? [], defaults),
    );
  }

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/discord-webhook");
      const payload = (await response.json()) as DiscordWebhookPayload;
      if (!response.ok) {
        setStatus(null);
        return;
      }
      applyPayload(payload);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/discord-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as DiscordWebhookPayload;
      if (!response.ok || payload.ok === false) {
        setError(payload.error ?? "Request failed.");
        return;
      }
      applyPayload(payload);
      setMessage(payload.message ?? "Saved.");
      if (body.action === "save" || body.action === "test") {
        setPresenceWebhookUrl("");
        setPresenceAlertsWebhookUrl("");
        setInventoryWebhookUrl("");
        setItemMovesWebhookUrl("");
        setPitpalStatusWebhookUrl("");
        setNon140erDashboardWebhookUrl("");
      }
    } catch {
      setError("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function updatePlayer(
    accountId: string,
    key: keyof DiscordPlayerRuleState,
    value: boolean,
  ) {
    setPlayerRows((rows) =>
      rows.map((row) => (row.accountId === accountId ? { ...row, [key]: value } : row)),
    );
  }

  const defaults = {
    notifyCameOnline,
    notifyWentOffline,
    notifyEveryOnlineScan,
    notifyItemGainedLost,
    notifyInventoryUpdated,
    notifyPitpalStatusChanges,
  };

  return (
    <section className="panel" style={{ marginTop: "1.5rem", maxWidth: "52rem" }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Discord webhooks
      </h2>
      <p className="muted">
        Use <strong>dedicated channels</strong>. Online dashboard = roster only (edited in place).
        Non-140er dashboard = same roster minus players whose notes contain <code>140er</code>.
        Online/offline alerts = Hypixel came-online / went-offline / still-online index pings (also used
        for Hypixel outage alerts that ping ops). PitPal status = lobbies changes (append-only). Leave a
        URL blank to keep the saved value.
      </p>
      <p>
        Status:{" "}
        <span className="chip">
          {status == null ? "Checking…" : status.configured ? "configured" : "not configured"}
        </span>
        {status?.presenceWebhookUrlMasked ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            dashboard saved
          </span>
        ) : null}
        {status?.presenceAlertsWebhookUrlMasked ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            alerts saved
          </span>
        ) : null}
        {status?.pitpalStatusWebhookUrlMasked ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            pitpal saved
          </span>
        ) : null}
        {status?.onlineDashboardConfigured ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            dashboard live
          </span>
        ) : null}
        {status?.non140erDashboardWebhookUrlMasked ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            non-140er saved
          </span>
        ) : null}
        {status?.non140erDashboardConfigured ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            non-140er live
          </span>
        ) : null}
      </p>

      <form
        className="form-stack"
        style={{ marginTop: "0.75rem", maxWidth: "100%" }}
        onSubmit={(event) => {
          event.preventDefault();
          const playerRules = playerRows.filter((row) => !flagsEqual(row, defaults));
          void run({
            action: "save",
            presenceWebhookUrl: presenceWebhookUrl.trim() || undefined,
            presenceAlertsWebhookUrl: presenceAlertsWebhookUrl.trim() || undefined,
            inventoryWebhookUrl: inventoryWebhookUrl.trim() || undefined,
            itemMovesWebhookUrl: itemMovesWebhookUrl.trim() || undefined,
            pitpalStatusWebhookUrl: pitpalStatusWebhookUrl.trim() || undefined,
            non140erDashboardWebhookUrl: non140erDashboardWebhookUrl.trim() || undefined,
            opsAlertDiscordUserId: opsAlertDiscordUserId.trim(),
            notifyCameOnline,
            notifyWentOffline,
            notifyEveryOnlineScan,
            notifyItemGainedLost,
            notifyInventoryUpdated,
            notifyPitpalStatusChanges,
            onlineDashboardEnabled,
            playerRules,
          });
        }}
      >
        <label>
          Online roster dashboard webhook (lone channel · edited in place)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={presenceWebhookUrl}
            onChange={(event) => setPresenceWebhookUrl(event.target.value)}
            placeholder={
              status?.presenceWebhookUrlMasked
                ? `Saved: ${status.presenceWebhookUrlMasked}`
                : "https://discord.com/api/webhooks/…"
            }
          />
        </label>
        <label>
          Non-140er roster dashboard webhook (excludes notes with 140er · edited in place)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={non140erDashboardWebhookUrl}
            onChange={(event) => setNon140erDashboardWebhookUrl(event.target.value)}
            placeholder={
              status?.non140erDashboardWebhookUrlMasked
                ? `Saved: ${status.non140erDashboardWebhookUrlMasked}`
                : "Optional — separate channel for non-140er online roster"
            }
          />
        </label>
        <label>
          Ops alert Discord user ID (pings ambienangel on Hypixel outage)
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={opsAlertDiscordUserId}
            onChange={(event) => setOpsAlertDiscordUserId(event.target.value)}
            placeholder={
              status?.opsAlertDiscordUserId
                ? `Saved: ${status.opsAlertDiscordUserId}`
                : "Discord Developer Mode → Copy User ID (17–20 digits)"
            }
          />
        </label>
        <label>
          Online/offline alerts webhook (came online · went offline · still-online index)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={presenceAlertsWebhookUrl}
            onChange={(event) => setPresenceAlertsWebhookUrl(event.target.value)}
            placeholder={
              status?.presenceAlertsWebhookUrlMasked
                ? `Saved: ${status.presenceAlertsWebhookUrlMasked}`
                : "Optional — falls back to dashboard channel until set"
            }
          />
        </label>
        <label>
          Inventory updates webhook (lives / enchants / slot)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={inventoryWebhookUrl}
            onChange={(event) => setInventoryWebhookUrl(event.target.value)}
            placeholder={
              status?.inventoryWebhookUrlMasked
                ? `Saved: ${status.inventoryWebhookUrlMasked}`
                : "Optional — falls back to alerts/dashboard"
            }
          />
        </label>
        <label>
          Item additions / subtractions webhook
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={itemMovesWebhookUrl}
            onChange={(event) => setItemMovesWebhookUrl(event.target.value)}
            placeholder={
              status?.itemMovesWebhookUrlMasked
                ? `Saved: ${status.itemMovesWebhookUrlMasked}`
                : "Optional — falls back to alerts/dashboard"
            }
          />
        </label>
        <label>
          PitPal status webhook (all pitpal.rocks/admin/lobbies changes · append-only)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={pitpalStatusWebhookUrl}
            onChange={(event) => setPitpalStatusWebhookUrl(event.target.value)}
            placeholder={
              status?.pitpalStatusWebhookUrlMasked
                ? `Saved: ${status.pitpalStatusWebhookUrlMasked}`
                : "https://discord.com/api/webhooks/… (required for PitPal)"
            }
          />
        </label>

        <h3 className="section-title" style={{ fontSize: "1rem", marginBottom: 0 }}>
          Default notify flags
        </h3>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyEveryOnlineScan}
            onChange={(event) => setNotifyEveryOnlineScan(event.target.checked)}
          />
          Every online scan
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyCameOnline}
            onChange={(event) => setNotifyCameOnline(event.target.checked)}
            disabled={notifyEveryOnlineScan}
          />
          Came online only {notifyEveryOnlineScan ? "(covered by every-scan)" : ""}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyWentOffline}
            onChange={(event) => setNotifyWentOffline(event.target.checked)}
          />
          Went offline
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyItemGainedLost}
            onChange={(event) => setNotifyItemGainedLost(event.target.checked)}
          />
          Item additions / subtractions
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyInventoryUpdated}
            onChange={(event) => setNotifyInventoryUpdated(event.target.checked)}
          />
          Inventory field updates (no gain/loss)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyPitpalStatusChanges}
            onChange={(event) => setNotifyPitpalStatusChanges(event.target.checked)}
          />
          PitPal lobby status changes (SPAWN/DOWN/OTHER)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={onlineDashboardEnabled}
            onChange={(event) => setOnlineDashboardEnabled(event.target.checked)}
          />
          Presence channel: keep latest message as online roster
        </label>

        <h3 className="section-title" style={{ fontSize: "1rem", marginBottom: 0 }}>
          Per-player overrides
        </h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Only rows that differ from the defaults above are saved. Leave someone matching defaults
          to inherit.
        </p>
        {playerRows.length === 0 ? (
          <p className="muted">No watchlist accounts yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="discord-player-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Online scan</th>
                  <th>Offline</th>
                  <th>+/− items</th>
                  <th>Inv update</th>
                  <th>PitPal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {playerRows.map((row) => {
                  const custom = !flagsEqual(row, defaults);
                  return (
                    <tr key={row.accountId} className={custom ? "is-custom" : undefined}>
                      <td>
                        <strong>{row.mcUsername}</strong>
                        {custom ? <div className="muted">custom</div> : null}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.notifyEveryOnlineScan}
                          onChange={(event) =>
                            updatePlayer(row.accountId, "notifyEveryOnlineScan", event.target.checked)
                          }
                          aria-label={`${row.mcUsername} every online scan`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.notifyWentOffline}
                          onChange={(event) =>
                            updatePlayer(row.accountId, "notifyWentOffline", event.target.checked)
                          }
                          aria-label={`${row.mcUsername} offline`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.notifyItemGainedLost}
                          onChange={(event) =>
                            updatePlayer(row.accountId, "notifyItemGainedLost", event.target.checked)
                          }
                          aria-label={`${row.mcUsername} item moves`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.notifyInventoryUpdated}
                          onChange={(event) =>
                            updatePlayer(
                              row.accountId,
                              "notifyInventoryUpdated",
                              event.target.checked,
                            )
                          }
                          aria-label={`${row.mcUsername} inventory updates`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.notifyPitpalStatusChanges}
                          onChange={(event) =>
                            updatePlayer(
                              row.accountId,
                              "notifyPitpalStatusChanges",
                              event.target.checked,
                            )
                          }
                          aria-label={`${row.mcUsername} PitPal status`}
                        />
                      </td>
                      <td>
                        {custom ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPlayerRows((rows) =>
                                rows.map((entry) =>
                                  entry.accountId === row.accountId
                                    ? {
                                        ...entry,
                                        ...defaults,
                                        accountId: entry.accountId,
                                        mcUsername: entry.mcUsername,
                                      }
                                    : entry,
                                ),
                              )
                            }
                          >
                            Reset
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="row-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save Discord settings"}
          </button>
          <button
            type="button"
            disabled={
              busy ||
              (!status?.presenceAlertsWebhookUrlMasked &&
                !status?.presenceWebhookUrlMasked &&
                !presenceAlertsWebhookUrl.trim() &&
                !presenceWebhookUrl.trim())
            }
            onClick={() =>
              void run({
                action: "test",
                channel: "presenceAlerts",
                webhookUrl: presenceAlertsWebhookUrl.trim() || undefined,
              })
            }
          >
            Test online/offline alerts
          </button>
          <button
            type="button"
            disabled={busy || (!status?.presenceWebhookUrlMasked && !presenceWebhookUrl.trim())}
            onClick={() =>
              void run({
                action: "test",
                channel: "presence",
                webhookUrl: presenceWebhookUrl.trim() || undefined,
              })
            }
          >
            Test dashboard channel
          </button>
          <button
            type="button"
            disabled={
              busy ||
              (!status?.non140erDashboardWebhookUrlMasked && !non140erDashboardWebhookUrl.trim())
            }
            onClick={() =>
              void run({
                action: "test",
                channel: "non140erDashboard",
                webhookUrl: non140erDashboardWebhookUrl.trim() || undefined,
              })
            }
          >
            Test non-140er dashboard
          </button>
          <button
            type="button"
            disabled={busy || (!status?.configured && !itemMovesWebhookUrl.trim())}
            onClick={() =>
              void run({
                action: "test",
                channel: "itemMoves",
                webhookUrl: itemMovesWebhookUrl.trim() || undefined,
              })
            }
          >
            Test item moves
          </button>
          <button
            type="button"
            disabled={busy || (!status?.configured && !inventoryWebhookUrl.trim())}
            onClick={() =>
              void run({
                action: "test",
                channel: "inventory",
                webhookUrl: inventoryWebhookUrl.trim() || undefined,
              })
            }
          >
            Test inventory
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !pitpalStatusWebhookUrl.trim()}
            onClick={() =>
              void run({
                action: "save",
                pitpalStatusWebhookUrl: pitpalStatusWebhookUrl.trim(),
              })
            }
          >
            Save PitPal webhook only
          </button>
          <button
            type="button"
            disabled={
              busy ||
              (!status?.pitpalStatusWebhookUrlMasked && !pitpalStatusWebhookUrl.trim())
            }
            onClick={() =>
              void run({
                action: "test",
                channel: "pitpalStatus",
                webhookUrl: pitpalStatusWebhookUrl.trim() || undefined,
              })
            }
          >
            Test PitPal status
          </button>
          <button
            type="button"
            disabled={
              busy ||
              !onlineDashboardEnabled ||
              (!status?.presenceWebhookUrlMasked &&
                !status?.non140erDashboardWebhookUrlMasked &&
                !status?.configured)
            }
            onClick={() => void run({ action: "refresh_dashboard" })}
          >
            Refresh dashboard(s)
          </button>
          <button
            type="button"
            disabled={busy || !status?.configured}
            onClick={() => void run({ action: "clear" })}
          >
            Clear all
          </button>
        </div>
      </form>

      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function PitPalBridgePanel() {
  const [snapshot, setSnapshot] = useState<{
    observedAt?: string | null;
    playerCount?: number;
    lobbyCount?: number;
    source?: string | null;
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

  return (
    <section className="panel" style={{ marginTop: "1.5rem", maxWidth: "52rem" }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        PitPal lobby bridge
      </h2>
      <p className="muted">
        A Tampermonkey script (while you&apos;re logged into PitPal admin) reads{" "}
        <code>/api/proxy/pitmod/players</code> and <code>/api/furry-stashes</code>, then posts into
        Pitantir. Lobby events go to the PitPal status webhook; furry-stashes IGNs are added to the
        watchlist. Notes containing <code>140er</code> get dashboard + online/offline only (no
        inventory / item +/− / PitPal status). No admin password is shared with the worker.
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
          Keep Pitantir web running on <code>http://127.0.0.1:3000</code> (change the script URL if
          needed).
        </li>
        <li>
          Open <code>https://pitpal.rocks/admin/lobbies</code> (and ideally{" "}
          <code>/admin/furry-stashes</code>) while logged in as admin. The badge shows lobby + stash
          sync; <code>140er</code> notes → online/dashboard only.
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
