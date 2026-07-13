"use client";

import { useEffect, useState } from "react";
import type { PublicAccount } from "@pitantir/db";

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [username, setUsername] = useState("");
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
      body: JSON.stringify({ mcUsername: username }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Unable to create account.");
      return;
    }
    setUsername("");
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

  return (
    <main>
      <h1>Accounts</h1>
      <p>Manage Minecraft accounts that Pitantir will eventually scan. Requires Postgres.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void createAccount();
        }}
        style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", maxWidth: "28rem" }}
      >
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Minecraft username"
          required
          maxLength={16}
        />
        <button type="submit">Add account</button>
      </form>

      {error ? (
        <p role="alert" style={{ color: "#a00" }}>
          {error}
        </p>
      ) : null}
      {loading ? <p>Loading…</p> : null}

      <ul style={{ listStyle: "none", padding: 0, marginTop: "1.5rem" }}>
        {accounts.map((account) => (
          <li
            key={account.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: "6px",
              padding: "0.75rem",
              marginBottom: "0.75rem",
              maxWidth: "36rem",
            }}
          >
            <div>
              <strong>{account.mcUsername}</strong>
              {account.displayName ? ` (${account.displayName})` : ""}
            </div>
            <div>Status: {account.enabled ? "enabled" : "disabled"}</div>
            <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
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
    </main>
  );
}
