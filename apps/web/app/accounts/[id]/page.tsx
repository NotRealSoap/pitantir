"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { AccountHistory, PublicScanSummary } from "@pitantir/db";

function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function ScanRow({ scan }: { scan: PublicScanSummary }) {
  const isFailure = scan.status === "failure";
  return (
    <li
      style={{
        border: "1px solid #ddd",
        borderRadius: "6px",
        padding: "0.75rem",
        marginBottom: "0.5rem",
        background: isFailure ? "#fff5f5" : "#fff",
      }}
    >
      <div>
        <strong>{scan.status}</strong>
        {" · "}
        {scan.triggeredBy}
        {" · processing: "}
        {scan.processingStatus}
      </div>
      <div>Created: {formatWhen(scan.createdAt)}</div>
      <div>Observed: {formatWhen(scan.observedAt)}</div>
      {scan.status === "success" ? (
        <div>Items extracted: {scan.itemCount ?? 0}</div>
      ) : null}
      {isFailure ? (
        <div role="status" style={{ color: "#a00", marginTop: "0.35rem" }}>
          Failure: {scan.errorCode ?? "unknown"}
          {scan.errorMessage ? ` — ${scan.errorMessage}` : ""}
          <div style={{ fontSize: "0.9rem", color: "#666" }}>
            No inventory stored (failed scan ≠ empty inventory).
          </div>
        </div>
      ) : null}
      <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
        Scan id: {scan.id}
      </div>
    </li>
  );
}

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const accountId = params.id;
  const [history, setHistory] = useState<AccountHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/accounts/${accountId}`);
      const payload = (await response.json()) as { history?: AccountHistory; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Unable to load account.");
        setHistory(null);
        return;
      }
      setHistory(payload.history ?? null);
    } catch {
      setError("Unable to load account.");
      setHistory(null);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function scanNow() {
    setNote(null);
    setError(null);
    const response = await fetch(`/api/accounts/${accountId}/scan`, { method: "POST" });
    const payload = (await response.json()) as { error?: string; message?: string };
    if (!response.ok) {
      setError(payload.error ?? "Unable to enqueue scan.");
      return;
    }
    setNote(payload.message ?? "Scan enqueued.");
    window.setTimeout(() => {
      void load();
    }, 1500);
  }

  if (loading) {
    return (
      <main>
        <p>
          <Link href="/accounts">← Accounts</Link>
        </p>
        <p>Loading…</p>
      </main>
    );
  }

  if (error && !history) {
    return (
      <main>
        <p>
          <Link href="/accounts">← Accounts</Link>
        </p>
        <p role="alert" style={{ color: "#a00" }}>
          {error}
        </p>
      </main>
    );
  }

  if (!history) {
    return null;
  }

  const { account, scans, failures, heldItems } = history;

  return (
    <main>
      <p>
        <Link href="/accounts">← Accounts</Link>
      </p>
      <h1>{account.mcUsername}</h1>
      <p>
        Status: {account.enabled ? "enabled" : "disabled"}
        {account.displayName ? ` · ${account.displayName}` : ""}
      </p>
      <p style={{ color: "#555" }}>
        Last success: {formatWhen(account.lastSuccessScanAt)} · Last failure:{" "}
        {formatWhen(account.lastFailureScanAt)}
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button type="button" onClick={() => void scanNow()} disabled={!account.enabled}>
          Scan now
        </button>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {note ? <p>{note}</p> : null}
      {error ? (
        <p role="alert" style={{ color: "#a00" }}>
          {error}
        </p>
      ) : null}

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Currently held (resolved)</h2>
        {heldItems.length === 0 ? (
          <p>No open presence periods for resolved items on this account.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {heldItems.map((item) => (
              <li
                key={item.itemId}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: "6px",
                  padding: "0.75rem",
                  marginBottom: "0.5rem",
                }}
              >
                <div>
                  <strong>{item.displayName ?? item.primaryNonce ?? item.itemId.slice(0, 8)}</strong>
                </div>
                <div>
                  Category: {item.category} · Confidence: {item.identityConfidence}
                </div>
                <div>Nonce: {item.primaryNonce ?? "—"}</div>
                <div>
                  Presence since {formatWhen(item.presenceStartedAt)} ({item.certainty})
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Failures ({failures.length})</h2>
        {failures.length === 0 ? (
          <p>No failed scans.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {failures.map((scan) => (
              <ScanRow key={scan.id} scan={scan} />
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Scan history ({scans.length})</h2>
        {scans.length === 0 ? (
          <p>No scans yet. Use Scan now with the worker running.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {scans.map((scan) => (
              <ScanRow key={scan.id} scan={scan} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
