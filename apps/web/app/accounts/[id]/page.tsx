"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { AccountHistory, PublicScanSummary } from "@pitantir/db";
import { MysticItemCard } from "../../../src/components/MysticItemCard";

function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function ScanRow({ scan }: { scan: PublicScanSummary }) {
  const isFailure = scan.status === "failure";
  return (
    <li className={`scan-card${isFailure ? " is-failure" : ""}`}>
      <div>
        <strong>{scan.status}</strong>
        {" · "}
        {scan.triggeredBy}
        {" · processing: "}
        {scan.processingStatus}
      </div>
      <div className="muted">Created: {formatWhen(scan.createdAt)}</div>
      <div className="muted">Observed: {formatWhen(scan.observedAt)}</div>
      {scan.status === "success" ? <div>Items extracted: {scan.itemCount ?? 0}</div> : null}
      {isFailure ? (
        <div role="status" className="alert" style={{ marginTop: "0.35rem" }}>
          Failure: {scan.errorCode ?? "unknown"}
          {scan.errorMessage ? ` — ${scan.errorMessage}` : ""}
          <div className="muted">No inventory stored (failed scan ≠ empty inventory).</div>
        </div>
      ) : null}
      <div className="muted" style={{ fontSize: "0.85rem" }}>
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
      <>
        <p>
          <Link href="/accounts">← Accounts</Link>
        </p>
        <p className="muted">Loading…</p>
      </>
    );
  }

  if (error && !history) {
    return (
      <>
        <p>
          <Link href="/accounts">← Accounts</Link>
        </p>
        <p role="alert" className="alert">
          {error}
        </p>
      </>
    );
  }

  if (!history) {
    return null;
  }

  const { account, scans, failures, heldItems, latestObservedItems } = history;

  return (
    <>
      <p>
        <Link href="/accounts">← Accounts</Link>
      </p>
      <h1 className="page-title">{account.mcUsername}</h1>
      <p className="page-lede">
        Status: {account.enabled ? "enabled" : "disabled"}
        {account.displayName ? ` · ${account.displayName}` : ""}
        <br />
        Last success: {formatWhen(account.lastSuccessScanAt)} · Last failure:{" "}
        {formatWhen(account.lastFailureScanAt)}
      </p>

      <div className="row-actions">
        <button type="button" className="primary" onClick={() => void scanNow()} disabled={!account.enabled}>
          Scan now
        </button>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {note ? <p role="status">{note}</p> : null}
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}

      <h2 className="section-title">Latest scan items ({latestObservedItems.length})</h2>
      <p className="muted">
        PitBear-style mystic lines from the newest successful scan. Refresh after processing
        completes.
      </p>
      {latestObservedItems.length === 0 ? (
        <p className="muted">
          No observations yet for the latest success scan (still processing, or no prior success).
        </p>
      ) : (
        <ul className="mystic-list">
          {latestObservedItems.map((item) => (
            <li key={item.observationId}>
              <MysticItemCard
                title={item.title ?? item.slotKey}
                nonce={item.nonce}
                itemUuid={item.itemUuid}
                lives={item.lives}
                maxLives={item.maxLives}
                lore={item.lore}
                customEnchants={item.customEnchants}
                kind={item.kind}
                resolutionStatus={item.resolutionStatus}
                slotKey={item.slotKey}
                href={item.canonicalItemId ? `/items/${item.canonicalItemId}` : null}
              />
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-title">Currently held (resolved)</h2>
      {heldItems.length === 0 ? (
        <p className="muted">No open presence periods for resolved items on this account.</p>
      ) : (
        <ul className="mystic-list">
          {heldItems.map((item) => (
            <li key={item.periodId}>
              <MysticItemCard
                title={item.displayName ?? item.primaryNonce ?? item.itemId.slice(0, 8)}
                nonce={item.primaryNonce}
                kind={item.category}
                href={`/items/${item.itemId}`}
                footer={
                  <>
                    Confidence {item.identityConfidence} · presence since{" "}
                    {formatWhen(item.presenceStartedAt)} ({item.certainty})
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-title">Failures ({failures.length})</h2>
      {failures.length === 0 ? (
        <p className="muted">No failed scans.</p>
      ) : (
        <ul className="mystic-list">
          {failures.map((scan) => (
            <ScanRow key={scan.id} scan={scan} />
          ))}
        </ul>
      )}

      <h2 className="section-title">Scan history ({scans.length})</h2>
      {scans.length === 0 ? (
        <p className="muted">No scans yet. Use Scan now with the worker running.</p>
      ) : (
        <ul className="mystic-list">
          {scans.map((scan) => (
            <ScanRow key={scan.id} scan={scan} />
          ))}
        </ul>
      )}
    </>
  );
}
