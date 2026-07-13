"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ItemDetail } from "@pitantir/db";

function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/items/${params.id}`);
        const payload = (await response.json()) as { item?: ItemDetail; error?: string };
        if (!response.ok) {
          setError(payload.error ?? "Unable to load item.");
          setDetail(null);
          return;
        }
        setDetail(payload.item ?? null);
      } catch {
        setError("Unable to load item.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [params.id]);

  if (loading) {
    return (
      <main>
        <p>
          <Link href="/items">← Items</Link>
        </p>
        <p>Loading…</p>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main>
        <p>
          <Link href="/items">← Items</Link>
        </p>
        <p role="alert" style={{ color: "#a00" }}>
          {error ?? "Not found"}
        </p>
      </main>
    );
  }

  const { item, identifiers, periods, observations, currentLocation } = detail;

  return (
    <main>
      <p>
        <Link href="/items">← Items</Link>
      </p>
      <h1>{item.displayName ?? item.primaryNonce ?? item.id.slice(0, 8)}</h1>
      <p>
        {item.category} · confidence {item.identityConfidence} · status {item.status}
      </p>
      <p>Nonce: <code>{item.primaryNonce ?? "—"}</code></p>
      <p style={{ fontSize: "0.9rem", color: "#555", wordBreak: "break-all" }}>
        Strict FP: {item.strictFingerprint ?? "—"}
      </p>

      <section style={{ marginTop: "1.25rem" }}>
        <h2>Current location</h2>
        {currentLocation ? (
          <p>
            On{" "}
            <Link href={`/accounts/${currentLocation.accountId}`}>
              {currentLocation.mcUsername ?? currentLocation.accountId}
            </Link>{" "}
            since {formatWhen(currentLocation.startedAt)} ({currentLocation.certainty})
          </p>
        ) : (
          <p>Unknown / no open confirmed presence period.</p>
        )}
      </section>

      <section style={{ marginTop: "1.25rem" }}>
        <h2>Identifiers</h2>
        {identifiers.length === 0 ? (
          <p>None</p>
        ) : (
          <ul>
            {identifiers.map((id) => (
              <li key={id.id}>
                {id.kind}: {id.value}
                {id.source ? ` (${id.source})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: "1.25rem" }}>
        <h2>Location timeline</h2>
        {periods.length === 0 ? (
          <p>No periods yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {periods.map((period) => (
              <li
                key={period.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: "6px",
                  padding: "0.6rem",
                  marginBottom: "0.4rem",
                  background: period.isUnknownGap ? "#f7f7f0" : "#fff",
                }}
              >
                <div>
                  {period.isUnknownGap ? (
                    <strong>Unknown gap</strong>
                  ) : period.accountId ? (
                    <Link href={`/accounts/${period.accountId}`}>Account {period.accountId.slice(0, 8)}</Link>
                  ) : (
                    "No account"
                  )}
                  {" · "}
                  {period.certainty}
                </div>
                <div>
                  {formatWhen(period.startedAt)} → {formatWhen(period.endedAt)}
                </div>
                <div style={{ fontSize: "0.85rem", color: "#555" }}>
                  start: {period.startReason}
                  {period.endReason ? ` · end: ${period.endReason}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: "1.25rem" }}>
        <h2>Observations</h2>
        {observations.length === 0 ? (
          <p>None linked.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {observations.map((obs) => (
              <li
                key={obs.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: "6px",
                  padding: "0.6rem",
                  marginBottom: "0.4rem",
                }}
              >
                <div>
                  {obs.resolutionStatus} · slot {obs.slotKey} ·{" "}
                  <Link href={`/accounts/${obs.accountId}`}>account</Link>
                </div>
                <div>{formatWhen(obs.observedAt)}</div>
                <div style={{ fontSize: "0.9rem", color: "#555" }}>
                  {(obs.normalizedMetadata.title as string | null | undefined) ?? "Untitled"}
                  {obs.observedNonce ? ` · nonce ${obs.observedNonce}` : ""}
                </div>
                <div style={{ fontSize: "0.8rem", color: "#777" }}>Scan {obs.scanId}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
