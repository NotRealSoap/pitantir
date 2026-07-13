"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicAccount } from "@pitantir/db";

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [username, setUsername] = useState("");
  const [mcUuid, setMcUuid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    await load();
  }

  async function scanNow(account: PublicAccount) {
    setError(null);
    const response = await fetch(`/api/accounts/${account.id}/scan`, { method: "POST" });
    const payload = (await response.json()) as { error?: string; message?: string };
    if (!response.ok) {
      setError(payload.error ?? "Unable to enqueue scan.");
      return;
    }
    setError(payload.message ?? "Scan enqueued.");
  }

  return (
    <>
      <h1 className="page-title">Accounts</h1>
      <p className="page-lede">
        Manage Minecraft accounts to scan. With Hypixel configured and the worker running, Scan now
        pulls real Pit inventories. UUID is optional — resolved from the username on first scan.
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

      {error ? (
        <p role="alert" className="alert" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      ) : null}
      {loading ? <p className="muted">Loading…</p> : null}

      <ul className="mystic-list" style={{ marginTop: "1.5rem" }}>
        {accounts.map((account) => (
          <li key={account.id} className="account-card">
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
              <button type="button" className="primary" onClick={() => void scanNow(account)} disabled={!account.enabled}>
                Scan now
              </button>
              <button type="button" onClick={() => void toggleEnabled(account)}>
                {account.enabled ? "Disable" : "Enable"}
              </button>
              <button type="button" onClick={() => void removeAccount(account)}>
                Soft delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
