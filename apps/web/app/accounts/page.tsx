"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicAccount } from "@pitantir/db";

type CacheResult = {
  results: Array<{
    accountId: string;
    mcUsername: string;
    ok: boolean;
    status: string;
    itemsFetched: number;
    isComplete: boolean;
    message: string | null;
  }>;
  cachedAccounts: number;
  incompleteAccounts: number;
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [username, setUsername] = useState("");
  const [mcUuid, setMcUuid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [caching, setCaching] = useState(false);
  const [cacheResult, setCacheResult] = useState<CacheResult | null>(null);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, on]) => on).map(([id]) => id),
    [selected],
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/accounts");
      const payload = (await response.json()) as { accounts?: PublicAccount[]; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Unable to load accounts.");
        setAccounts([]);
        return;
      }
      setAccounts(payload.accounts ?? []);
    } catch {
      setError("Unable to load accounts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createAccount() {
    setError(null);
    const response = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mcUsername: username,
        mcUuid: mcUuid.trim() ? mcUuid.trim() : null,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Unable to create account.");
      return;
    }
    setUsername("");
    setMcUuid("");
    await load();
  }

  async function toggleEnabled(account: PublicAccount) {
    await fetch(`/api/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !account.enabled }),
    });
    await load();
  }

  async function removeAccount(account: PublicAccount) {
    await fetch(`/api/accounts/${account.id}`, { method: "DELETE" });
    setSelected((prev) => {
      const next = { ...prev };
      delete next[account.id];
      return next;
    });
    await load();
  }

  async function scanNow(account: PublicAccount) {
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

  async function cacheSelectedOwnership() {
    setError(null);
    setNote(null);
    setCacheResult(null);
    if (selectedIds.length === 0) {
      setError("Select at least one account to cache.");
      return;
    }
    setCaching(true);
    try {
      const response = await fetch("/api/accounts/cache-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds: selectedIds }),
      });
      const payload = (await response.json()) as CacheResult & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Unable to cache ownership.");
        return;
      }
      setCacheResult(payload);
      setNote(
        `Cached PitPanda ownership for ${payload.cachedAccounts}/${payload.results.length} account(s)` +
          (payload.incompleteAccounts
            ? ` (${payload.incompleteAccounts} incomplete — PitPanda index caps may apply).`
            : "."),
      );
    } catch {
      setError("Unable to cache ownership.");
    } finally {
      setCaching(false);
    }
  }

  function setAllSelected(on: boolean) {
    const next: Record<string, boolean> = {};
    for (const account of accounts) next[account.id] = on;
    setSelected(next);
  }

  return (
    <>
      <h1 className="page-title">Accounts</h1>
      <p className="page-lede">
        Manage Minecraft accounts to scan. Select accounts below to cache PitPanda ownership
        histories for every currently indexed item into local DB. Scan now still needs the worker.
      </p>

      <form
        className="form-stack panel"
        onSubmit={(event) => {
          event.preventDefault();
          void createAccount();
        }}
      >
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
          Add account
        </button>
      </form>

      <div className="row-actions" style={{ marginTop: "1.25rem" }}>
        <button type="button" onClick={() => setAllSelected(true)} disabled={accounts.length === 0}>
          Select all
        </button>
        <button type="button" onClick={() => setAllSelected(false)} disabled={selectedIds.length === 0}>
          Clear selection
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void cacheSelectedOwnership()}
          disabled={caching || selectedIds.length === 0}
        >
          {caching
            ? `Caching ${selectedIds.length}…`
            : `Cache PitPanda ownership (${selectedIds.length})`}
        </button>
      </div>

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
      {cacheResult ? (
        <ul className="mystic-list panel" style={{ marginTop: "1rem" }}>
          {cacheResult.results.map((row) => (
            <li key={row.accountId}>
              <strong>{row.mcUsername}</strong> · {row.status} · {row.itemsFetched} items
              {row.isComplete ? "" : " · incomplete"}
              {row.message ? ` — ${row.message}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {loading ? <p className="muted">Loading…</p> : null}

      <ul className="mystic-list" style={{ marginTop: "1.5rem" }}>
        {accounts.map((account) => (
          <li key={account.id} className="account-card">
            <label style={{ display: "flex", gap: "0.65rem", alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={Boolean(selected[account.id])}
                onChange={(event) =>
                  setSelected((prev) => ({ ...prev, [account.id]: event.target.checked }))
                }
                style={{ marginTop: "0.35rem" }}
              />
              <div style={{ flex: 1 }}>
                <div>
                  <Link href={`/accounts/${account.id}`} className="mystic-title">
                    {account.mcUsername}
                  </Link>
                  {account.displayName ? (
                    <span className="muted"> ({account.displayName})</span>
                  ) : null}
                </div>
                <div className="meta-row">
                  <span className="chip">{account.enabled ? "enabled" : "disabled"}</span>
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
                  <button type="button" onClick={() => void toggleEnabled(account)}>
                    {account.enabled ? "Disable" : "Enable"}
                  </button>
                  <button type="button" onClick={() => void removeAccount(account)}>
                    Soft delete
                  </button>
                </div>
              </div>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}
