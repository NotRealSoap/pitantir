"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicAccountDto } from "../../src/types/public-dtos";

function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function AccountsPage() {
  const [watchlist, setWatchlist] = useState<PublicAccountDto[]>([]);
  const [contacts, setContacts] = useState<PublicAccountDto[]>([]);
  const [scansPaused, setScansPaused] = useState(false);
  const [circuitOpen, setCircuitOpen] = useState(false);
  const [circuitDetail, setCircuitDetail] = useState<string | null>(null);
  const [pitpalAuthoritative, setPitpalAuthoritative] = useState(false);
  const [username, setUsername] = useState("");
  const [mcUuid, setMcUuid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hypixelUsageLabel, setHypixelUsageLabel] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [accountsResponse, usageResponse] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/settings/hypixel/usage"),
      ]);
      const payload = (await accountsResponse.json()) as {
        watchlist?: PublicAccountDto[];
        contacts?: PublicAccountDto[];
        scansPaused?: boolean;
        circuitOpen?: boolean;
        lastFailureDetail?: string | null;
        pitpalAuthoritative?: boolean;
        error?: string;
      };
      if (!accountsResponse.ok) {
        setError(payload.error ?? "Unable to load accounts.");
        setWatchlist([]);
        setContacts([]);
        return;
      }
      setWatchlist(payload.watchlist ?? []);
      setContacts(payload.contacts ?? []);
      setScansPaused(Boolean(payload.scansPaused));
      setPitpalAuthoritative(Boolean(payload.pitpalAuthoritative));
      setCircuitOpen(Boolean(payload.circuitOpen));
      setCircuitDetail(payload.lastFailureDetail ?? null);

      if (usageResponse.ok) {
        const usage = (await usageResponse.json()) as {
          used?: number | null;
          snapshot?: { limit?: number; remaining?: number } | null;
          recommendedIntervalSeconds?: number | null;
        };
        if (usage.snapshot?.limit != null && usage.used != null) {
          const rec =
            usage.recommendedIntervalSeconds != null
              ? ` · aim ~${Math.round(usage.recommendedIntervalSeconds / 60)}m`
              : "";
          setHypixelUsageLabel(
            `Hypixel ${usage.used}/${usage.snapshot.limit} used (${usage.snapshot.remaining} left)${rec}`,
          );
        } else {
          setHypixelUsageLabel("Hypixel quota: no sample yet — open Settings");
        }
      }
    } catch {
      setError("Unable to load accounts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function addToWatchlist() {
    setError(null);
    setNote(null);
    const response = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mcUsername: username,
        mcUuid: mcUuid.trim() ? mcUuid.trim() : null,
        watchlisted: true,
        enabled: true,
      }),
    });
    const payload = (await response.json()) as {
      error?: string;
      created?: boolean;
      promoted?: boolean;
      account?: { mcUsername?: string };
    };
    if (!response.ok) {
      setError(payload.error ?? "Unable to add account.");
      return;
    }
    const name = payload.account?.mcUsername ?? username;
    setUsername("");
    setMcUuid("");
    if (payload.promoted) {
      setNote(`Moved ${name} from ownership contacts onto the refresh watch list.`);
    } else if (payload.created === false) {
      setNote(`${name} was already on the watch list.`);
    } else {
      setNote(`Added ${name} to the refresh watch list.`);
    }
    await load();
  }

  async function setPaused(paused: boolean) {
    setError(null);
    const response = await fetch("/api/scan-control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused }),
    });
    const payload = (await response.json()) as {
      paused?: boolean;
      circuitOpen?: boolean;
      lastFailureDetail?: string | null;
      error?: string;
    };
    if (!response.ok) {
      setError(payload.error ?? "Unable to update scan pause.");
      return;
    }
    setScansPaused(Boolean(payload.paused));
    setCircuitOpen(Boolean(payload.circuitOpen));
    setCircuitDetail(payload.lastFailureDetail ?? null);
    setNote(
      payload.paused
        ? "Hypixel API calls paused (scheduled + manual)."
        : "Hypixel refreshing resumed — failure circuit cleared.",
    );
  }

  async function fixUsernameCasing(scope: "watchlist" | "contacts" | "all") {
    setError(null);
    setNote(null);
    const response = await fetch("/api/accounts/fix-usernames", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    const payload = (await response.json()) as {
      error?: string;
      message?: string;
      updated?: number;
      results?: Array<{ previousUsername: string; mcUsername: string; changed: boolean }>;
    };
    if (!response.ok) {
      setError(payload.error ?? "Unable to fix username casing.");
      return;
    }
    const samples = (payload.results ?? [])
      .filter((row) => row.changed && row.previousUsername !== row.mcUsername)
      .slice(0, 5)
      .map((row) => `${row.previousUsername} → ${row.mcUsername}`);
    const sampleNote = samples.length > 0 ? ` Examples: ${samples.join(", ")}.` : "";
    setNote((payload.message ?? "Username casing updated.") + sampleNote);
    await load();
  }

  async function patchAccount(account: PublicAccountDto, body: Record<string, unknown>) {
    setError(null);
    const response = await fetch(`/api/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Unable to update account.");
      return;
    }
    await load();
  }

  async function removeAccount(account: PublicAccountDto) {
    await fetch(`/api/accounts/${account.id}`, { method: "DELETE" });
    await load();
  }

  async function scanNow(account: PublicAccountDto) {
    setError(null);
    setNote(null);
    const response = await fetch(`/api/accounts/${account.id}/scan`, { method: "POST" });
    const payload = (await response.json()) as { error?: string; message?: string };
    if (!response.ok) {
      setError(payload.error ?? "Unable to enqueue scan.");
      return;
    }
    setNote(payload.message ?? "Scan enqueued.");
  }

  return (
    <>
      <h1 className="page-title">Watch list</h1>
      <p className="page-lede">
        Primary roster for Hypixel inventory refresh. Ownership IGNs collected from item histories
        stay in a separate contacts list and never consume your scan quota.
      </p>

      <div className="panel" style={{ marginTop: "1rem" }}>
        <div className="row-actions" style={{ margin: 0, alignItems: "center" }}>
          <span className="chip">
            Scheduled refresh: <strong>{scansPaused ? "paused" : "running"}</strong>
          </span>
          {circuitOpen ? (
            <span className="chip" style={{ background: "color-mix(in srgb, #c45c3e 25%, transparent)" }}>
              API circuit open
            </span>
          ) : null}
          {scansPaused ? (
            <button type="button" className="primary" onClick={() => void setPaused(false)}>
              Resume refreshing
            </button>
          ) : (
            <button type="button" onClick={() => void setPaused(true)}>
              Pause all refreshing
            </button>
          )}
          <button type="button" onClick={() => void fixUsernameCasing("watchlist")}>
            Fix username casing
          </button>
        </div>
        <p className="muted" style={{ marginBottom: 0, marginTop: "0.65rem" }}>
          Pause stops all Hypixel API calls (scheduled + manual). After 3 consecutive hard
          Hypixel failures (not rate limits) the worker auto-pauses and pings Discord ops. Rate
          limits back off on their own — if you see “API circuit open” from a 429, wait for the
          quota window to reset (or click Resume refreshing). “Fix username casing” uses Mojang
          (not Hypixel) so lowercase imports like <code>3amcatnoises9</code> become{" "}
          <code>3AMCatNoises9</code>.
        </p>
        {circuitOpen ? (
          <p role="alert" className="alert" style={{ marginBottom: 0, marginTop: "0.65rem" }}>
            Hypixel API circuit is open
            {circuitDetail ? <> — {circuitDetail}</> : null}.
            {circuitDetail && /\b429\b|rate limit/i.test(circuitDetail) ? (
              <>
                {" "}
                This looks like a rate-limit lockout. Wait until the live quota bar resets, then
                click Resume refreshing (or pull the latest worker — it auto-resumes after the
                window).
              </>
            ) : (
              <> Fix the outage, then click Resume refreshing.</>
            )}
          </p>
        ) : null}
        {hypixelUsageLabel ? (
          <p className="muted" style={{ marginBottom: 0, marginTop: "0.5rem" }}>
            <Link href="/settings">{hypixelUsageLabel}</Link>
          </p>
        ) : null}
      </div>

      <form
        className="form-stack panel"
        style={{ marginTop: "1.25rem" }}
        onSubmit={(event) => {
          event.preventDefault();
          void addToWatchlist();
        }}
      >
        <h2 className="section-title" style={{ marginTop: 0, fontSize: "1.05rem" }}>
          Add to watch list
        </h2>
        <label>
          Minecraft username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Steve"
            required
            maxLength={16}
          />
        </label>
        <label>
          UUID (optional)
          <input
            value={mcUuid}
            onChange={(event) => setMcUuid(event.target.value)}
            placeholder="Will resolve on scan"
          />
        </label>
        <button type="submit" className="primary">
          Add to watch list
        </button>
      </form>

      {note ? (
        <p role="status" style={{ marginTop: "1rem" }}>
          {note}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="alert" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      ) : null}
      {loading ? <p className="muted">Loading…</p> : null}

      <h2 className="section-title">Refreshing ({watchlist.length})</h2>
      {watchlist.length === 0 ? (
        <p className="muted">No watch-list accounts yet. Add IGNs you want scanned often.</p>
      ) : (
        <ul className="mystic-list">
          {watchlist.map((account) => (
            <li key={account.id} className="account-card">
              <div>
                <Link href={`/accounts/${account.id}`} className="mystic-title">
                  {account.mcUsername}
                </Link>
              </div>
              <div className="meta-row">
                <span className="chip">{account.enabled ? "refresh on" : "refresh off"}</span>
                <span className="chip">
                  {(() => {
                    const pitpalFresh =
                      Boolean(account.lastPitpalLobby || account.lastPitpalLocation) &&
                      account.lastPitpalSeenAt &&
                      Date.now() - new Date(account.lastPitpalSeenAt).getTime() <= 90_000;
                    // Fresh PitPal feed: listing alone decides online. Otherwise
                    // fall back to PitPal OR Hypixel (legacy soft-online).
                    const online = pitpalAuthoritative
                      ? Boolean(pitpalFresh)
                      : Boolean(pitpalFresh) || account.lastHypixelOnline === true;
                    const apiOff = Boolean(pitpalFresh) && account.lastHypixelOnline !== true;
                    if (!online) {
                      return account.lastHypixelOnline === false ? "offline" : "presence ?";
                    }
                    const where = [
                      account.lastPitpalLobby,
                      account.lastPitpalLocation,
                      account.lastPitpalArmorType,
                      !account.lastPitpalLobby && account.lastSessionGame
                        ? account.lastSessionGame
                        : null,
                      apiOff ? "API Off" : null,
                      account.lastPitpalIsNicked === true ? "Nicked" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return where ? `online · ${where}` : "online";
                  })()}
                </span>
                {account.lastInventoryChangedAt ? (
                  <span className="chip">
                    inventory changed <strong>{formatWhen(account.lastInventoryChangedAt)}</strong>
                  </span>
                ) : null}
                <span className="chip">
                  every <strong>{Math.round(account.scanIntervalSeconds / 60)}m</strong>
                </span>
                <span className="chip">
                  next <strong>{formatWhen(account.nextScanAt)}</strong>
                </span>
                <span className="chip">
                  UUID <strong>{account.mcUuid ? account.mcUuid.slice(0, 8) : "pending"}</strong>
                </span>
              </div>
              <div className="row-actions" style={{ margin: "0.35rem 0 0" }}>
                <Link className="button" href={`/accounts/${account.id}`}>
                  History
                </Link>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void scanNow(account)}
                  disabled={!account.enabled}
                >
                  Scan now
                </button>
                <button
                  type="button"
                  onClick={() => void patchAccount(account, { enabled: !account.enabled })}
                >
                  {account.enabled ? "Pause this IGN" : "Resume this IGN"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void patchAccount(account, { watchlisted: false, enabled: false })
                  }
                >
                  Move to contacts
                </button>
                <button type="button" onClick={() => void removeAccount(account)}>
                  Soft delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-title">Ownership contacts ({contacts.length})</h2>
      <p className="muted">
        IGNs seen on PitPanda item timelines / cache runs. Stored for attribution only — not
        auto-refreshed.{" "}
        <button type="button" onClick={() => void fixUsernameCasing("contacts")}>
          Fix contact casing
        </button>
      </p>
      {contacts.length === 0 ? (
        <p className="muted">No ownership contacts yet. Caching item histories will fill this in.</p>
      ) : (
        <ul className="mystic-list">
          {contacts.map((account) => (
            <li key={account.id} className="account-card">
              <div>
                <Link href={`/accounts/${account.id}`} className="mystic-title">
                  {account.mcUsername}
                </Link>
                {account.notes ? <div className="muted">{account.notes}</div> : null}
              </div>
              <div className="meta-row">
                <span className="chip">contact</span>
                <span className="chip">
                  UUID <strong>{account.mcUuid ? account.mcUuid.slice(0, 8) : "pending"}</strong>
                </span>
              </div>
              <div className="row-actions" style={{ margin: "0.35rem 0 0" }}>
                <Link className="button" href={`/accounts/${account.id}`}>
                  View
                </Link>
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    void patchAccount(account, { watchlisted: true, enabled: true })
                  }
                >
                  Add to watch list
                </button>
                <button type="button" onClick={() => void removeAccount(account)}>
                  Soft delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
