"use client";

import { useCallback, useEffect, useState } from "react";

type Entry = { mcUsername: string; addedAt: string };

export function DownwatchPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [quietEntries, setQuietEntries] = useState<Entry[]>([]);
  const [ign, setIgn] = useState("");
  const [quietIgn, setQuietIgn] = useState("");
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
        entries?: Entry[];
        quietEntries?: Entry[];
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
      setQuietEntries(payload.quietEntries ?? []);
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

  async function run(
    action: "add" | "remove" | "quiet_add" | "quiet_remove",
    mcUsername: string,
  ) {
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
        entries?: Entry[];
        quietEntries?: Entry[];
      };
      if (!response.ok || payload.ok === false) {
        setError(payload.error ?? "Request failed.");
        return;
      }
      setEntries(payload.entries ?? []);
      setQuietEntries(payload.quietEntries ?? []);
      setMessage(payload.message ?? "Updated.");
      if (action === "add" || action === "remove") setIgn("");
      if (action === "quiet_add" || action === "quiet_remove") setQuietIgn("");
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
        When a listed player goes PitPal <code>DOWN</code>, Discord posts to the Downwatch webhook.
        The <strong>ping</strong> list also mentions the role; the <strong>quiet</strong> list posts
        the same style of message without pinging anyone. An IGN can only be on one list — adding to
        one moves them off the other. Discord: <code>!downwatch add IGN</code> /{" "}
        <code>!dw quiet add IGN</code> / <code>!downwatch list</code>.
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
          {entries.length} ping
        </span>
        <span className="chip" style={{ marginLeft: "0.35rem" }}>
          {quietEntries.length} quiet
        </span>
      </p>

      <h3 className="section-title">Ping list (role mention)</h3>
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
            {busy ? "Saving…" : "Add to ping list"}
          </button>
        </div>
      </form>
      {entries.length === 0 ? (
        <p className="muted">No ping-list accounts yet.</p>
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

      <h3 className="section-title">Quiet list (message only)</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Same Downwatch channel/webhook — no <code>@role</code> ping.
      </p>
      <form
        className="form-stack"
        style={{ marginTop: "0.75rem", maxWidth: "24rem" }}
        onSubmit={(event) => {
          event.preventDefault();
          if (quietIgn.trim()) void run("quiet_add", quietIgn.trim());
        }}
      >
        <label>
          Add IGN
          <input
            value={quietIgn}
            onChange={(event) => setQuietIgn(event.target.value)}
            placeholder="MinecraftUsername"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="row-actions">
          <button type="submit" className="primary" disabled={busy || !quietIgn.trim()}>
            {busy ? "Saving…" : "Add to quiet list"}
          </button>
        </div>
      </form>
      {quietEntries.length === 0 ? (
        <p className="muted">No quiet-list accounts yet.</p>
      ) : (
        <ul style={{ marginTop: "0.75rem", paddingLeft: "1.1rem" }}>
          {quietEntries.map((entry) => (
            <li key={entry.mcUsername} style={{ marginBottom: "0.35rem" }}>
              <strong>{entry.mcUsername}</strong>{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => void run("quiet_remove", entry.mcUsername)}
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
