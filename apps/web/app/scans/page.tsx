"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicScanSummary } from "@pitantir/db";

type ScanRow = PublicScanSummary & { mcUsername: string | null };

function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function ScansPage() {
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/scans");
        const payload = (await response.json()) as { scans?: ScanRow[]; error?: string };
        if (!response.ok) {
          setError(payload.error ?? "Unable to load scans.");
          setScans([]);
          return;
        }
        setScans(payload.scans ?? []);
      } catch {
        setError("Unable to load scans.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <main>
      <h1>Scan history</h1>
      <p>All account inventory scans. Failures show an error — never as empty inventory.</p>

      {error ? (
        <p role="alert" style={{ color: "#a00" }}>
          {error}
        </p>
      ) : null}
      {loading ? <p>Loading…</p> : <p>{scans.length} scan(s)</p>}

      <ul style={{ listStyle: "none", padding: 0, marginTop: "1rem" }}>
        {scans.map((scan) => {
          const isFailure = scan.status === "failure";
          return (
            <li
              key={scan.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: "6px",
                padding: "0.75rem",
                marginBottom: "0.5rem",
                maxWidth: "42rem",
                background: isFailure ? "#fff5f5" : "#fff",
              }}
            >
              <div>
                <strong>{scan.status}</strong>
                {" · "}
                <Link href={`/accounts/${scan.accountId}`}>
                  {scan.mcUsername ?? scan.accountId.slice(0, 8)}
                </Link>
                {" · "}
                {scan.triggeredBy}
              </div>
              <div>Created {formatWhen(scan.createdAt)}</div>
              {scan.status === "success" ? (
                <div>
                  Items: {scan.itemCount ?? 0} · processing: {scan.processingStatus}
                </div>
              ) : null}
              {isFailure ? (
                <div style={{ color: "#a00", marginTop: "0.35rem" }}>
                  {scan.errorCode ?? "error"}
                  {scan.errorMessage ? ` — ${scan.errorMessage}` : ""}
                  <div style={{ fontSize: "0.9rem", color: "#666" }}>
                    No inventory stored for failures.
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
