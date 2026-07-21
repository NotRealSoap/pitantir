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
  currentIntervalSeconds?: number | null;
  recommendedIntervalSeconds?: number | null;
  estimatedRequestsPerWindow?: number | null;
  estimatedBudgetPerWindow?: number | null;
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
        Live from Hypixel <code>RateLimit-*</code> headers on each scan (or Refresh quota). Leave
        headroom so you do not trip the key throttle while refreshing as often as possible.
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
            {usage?.watchlistCount ?? 0} total. Current interval:{" "}
            <strong>{formatDuration(usage?.currentIntervalSeconds)}</strong>
            {usage?.recommendedIntervalSeconds != null ? (
              <>
                {" "}
                · recommended: <strong>{formatDuration(usage.recommendedIntervalSeconds)}</strong>
              </>
            ) : null}
          </p>
          {usage?.estimatedBudgetPerWindow != null ? (
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              Budget ≈ <strong>{usage.estimatedBudgetPerWindow}</strong> scans / ~
              {formatDuration(snapshot?.windowSeconds ?? null)} window (85% of limit). At the current
              interval, estimated load ≈{" "}
              <strong>{usage.estimatedRequestsPerWindow ?? "—"}</strong> / window.
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

type DiscordWebhookPayload = {
  configured?: boolean;
  webhookUrlMasked?: string | null;
  notifyCameOnline?: boolean;
  notifyWentOffline?: boolean;
  notifyInventoryChanged?: boolean;
  ok?: boolean;
  message?: string;
  error?: string;
};

function DiscordWebhookPanel() {
  const [status, setStatus] = useState<DiscordWebhookPayload | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [notifyCameOnline, setNotifyCameOnline] = useState(true);
  const [notifyWentOffline, setNotifyWentOffline] = useState(false);
  const [notifyInventoryChanged, setNotifyInventoryChanged] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/discord-webhook");
      const payload = (await response.json()) as DiscordWebhookPayload;
      if (!response.ok) {
        setStatus(null);
        return;
      }
      setStatus(payload);
      setNotifyCameOnline(payload.notifyCameOnline ?? true);
      setNotifyWentOffline(payload.notifyWentOffline ?? false);
      setNotifyInventoryChanged(payload.notifyInventoryChanged ?? true);
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
      setStatus(payload);
      setMessage(payload.message ?? "Saved.");
      setNotifyCameOnline(payload.notifyCameOnline ?? notifyCameOnline);
      setNotifyWentOffline(payload.notifyWentOffline ?? notifyWentOffline);
      setNotifyInventoryChanged(payload.notifyInventoryChanged ?? notifyInventoryChanged);
      if (body.action === "save" && typeof body.webhookUrl === "string" && body.webhookUrl) {
        setWebhookUrl("");
      }
    } catch {
      setError("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginTop: "1.5rem", maxWidth: "36rem" }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Discord webhook
      </h2>
      <p className="muted">
        Post a channel notification when a watched player comes online. Optionally also notify on
        inventory moves or offline transitions. The worker sends these after each scan.
      </p>
      <p>
        Status:{" "}
        <span className="chip">
          {status == null ? "Checking…" : status.configured ? "configured" : "not configured"}
        </span>
      </p>
      {status?.webhookUrlMasked ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Saved URL: <code>{status.webhookUrlMasked}</code>
        </p>
      ) : null}

      <form
        className="form-stack"
        style={{ marginTop: "0.75rem", maxWidth: "100%" }}
        onSubmit={(event) => {
          event.preventDefault();
          void run({
            action: "save",
            webhookUrl: webhookUrl.trim() || undefined,
            notifyCameOnline,
            notifyWentOffline,
            notifyInventoryChanged,
          });
        }}
      >
        <label>
          Webhook URL
          <input
            type="password"
            autoComplete="off"
            value={webhookUrl}
            onChange={(event) => setWebhookUrl(event.target.value)}
            placeholder={
              status?.configured
                ? "Paste a new URL to replace"
                : "https://discord.com/api/webhooks/…"
            }
          />
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyCameOnline}
            onChange={(event) => setNotifyCameOnline(event.target.checked)}
          />
          Notify when a player comes online
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyInventoryChanged}
            onChange={(event) => setNotifyInventoryChanged(event.target.checked)}
          />
          Notify on inventory changes
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyWentOffline}
            onChange={(event) => setNotifyWentOffline(event.target.checked)}
          />
          Notify when a player goes offline
        </label>

        <div className="row-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : status?.configured ? "Save changes" : "Save webhook"}
          </button>
          <button
            type="button"
            disabled={busy || !status?.configured}
            onClick={() => void run({ action: "test" })}
          >
            Send test
          </button>
          <button
            type="button"
            disabled={busy || !status?.configured}
            onClick={() => void run({ action: "clear" })}
          >
            Clear
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
            Discord webhooks fire from the worker when a watched account comes online (and optionally
            for inventory / offline). Create a webhook in Discord channel settings → Integrations.
          </li>
        </ul>
      </section>
    </>
  );
}
