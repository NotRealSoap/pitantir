"use client";

import { useCallback, useEffect, useState } from "react";

export function DownwatchPanel() {
  const [entries, setEntries] = useState<Array<{ mcUsername: string; addedAt: string }>>([]);
  const [ign, setIgn] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [botConfigured, setBotConfigured] = useState(false);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/downwatch");
      const payload = (await response.json()) as {
        entries?: Array<{ mcUsername: string; addedAt: string }>;
        botTokenConfigured?: boolean;
        downwatchRoleId?: string | null;
        downwatchChannelId?: string | null;
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "Unable to load downwatch.");
        return;
      }
      setEntries(payload.entries ?? []);
      setBotConfigured(Boolean(payload.botTokenConfigured));
      setRoleId(payload.downwatchRoleId ?? null);
      setChannelId(payload.downwatchChannelId ?? null);
    } catch {
      setError("Unable to load downwatch.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: "add" | "remove", mcUsername: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/downwatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, mcUsername }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        entries?: Array<{ mcUsername: string; addedAt: string }>;
      };
      if (!response.ok || payload.ok === false) {
        setError(payload.error ?? "Request failed.");
        return;
      }
      setEntries(payload.entries ?? []);
      setMessage(payload.message ?? "Updated.");
      setIgn("");
    } catch {
      setError("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginTop: "1.5rem", maxWidth: "52rem" }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Downwatch
      </h2>
      <p className="muted">
        Special list: when a listed player goes PitPal <code>DOWN</code>, Discord pings a role.
        Manage from Settings or Discord: <code>!downwatch add IGN</code> / <code>!dw remove IGN</code>{" "}
        / <code>!downwatch list</code> in the command channel (worker polls with{" "}
        <code>DISCORD_BOT_TOKEN</code>).
      </p>
      <p>
        Status:{" "}
        <span className="chip">{botConfigured ? "bot token set" : "bot token missing"}</span>
        {roleId ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            role configured
          </span>
        ) : null}
        {channelId ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            channel configured
          </span>
        ) : null}
        <span className="chip" style={{ marginLeft: "0.35rem" }}>
          {entries.length} watched
        </span>
      </p>
      <form
        className="form-stack"
        style={{ marginTop: "0.75rem", maxWidth: "24rem" }}
        onSubmit={(event) => {
          event.preventDefault();
          if (ign.trim()) void run("add", ign.trim());
        }}
      >
        <label>
          Add IGN
          <input
            value={ign}
            onChange={(event) => setIgn(event.target.value)}
            placeholder="MinecraftUsername"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="row-actions">
          <button type="submit" className="primary" disabled={busy || !ign.trim()}>
            {busy ? "Saving…" : "Add to downwatch"}
          </button>
        </div>
      </form>
      {entries.length === 0 ? (
        <p className="muted">No downwatch accounts yet.</p>
      ) : (
        <ul style={{ marginTop: "0.75rem", paddingLeft: "1.1rem" }}>
          {entries.map((entry) => (
            <li key={entry.mcUsername} style={{ marginBottom: "0.35rem" }}>
              <strong>{entry.mcUsername}</strong>{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => void run("remove", entry.mcUsername)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

