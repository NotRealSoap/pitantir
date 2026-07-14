"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type LiveStatusPayload = {
  used?: number | null;
  snapshot?: {
    limit: number;
    remaining: number;
    windowSeconds: number;
  } | null;
  secondsUntilReset?: number | null;
  stale?: boolean;
  refreshingCount?: number;
  recommendedIntervalSeconds?: number | null;
  currentIntervalSeconds?: number | null;
  onlineCount?: number;
  online?: Array<{ id: string; mcUsername: string; sessionGame?: string | null }>;
  events?: Array<{
    id: string;
    kind: string;
    mcUsername: string;
    at: string;
    detail?: string | null;
  }>;
  statusChecksEnabled?: boolean;
  error?: string;
};

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (minutes < 60) return rem ? `${minutes}m ${rem}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function eventLabel(kind: string): string {
  if (kind === "came_online") return "online";
  if (kind === "went_offline") return "offline";
  if (kind === "inventory_changed") return "inventory changed";
  return kind;
}

export function LiveStatusBar() {
  const [status, setStatus] = useState<LiveStatusPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/live-status");
        const payload = (await response.json()) as LiveStatusPayload;
        if (!cancelled && response.ok) setStatus(payload);
      } catch {
        // keep last good snapshot
      }
    }

    void load();
    const id = window.setInterval(() => void load(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const snapshot = status?.snapshot ?? null;
  const used = status?.used ?? null;
  const pct =
    snapshot && snapshot.limit > 0 && used != null
      ? Math.min(100, Math.round((used / snapshot.limit) * 100))
      : 0;
  const latestEvent = status?.events?.[0] ?? null;
  const onlineNames = (status?.online ?? [])
    .slice(0, 4)
    .map((row) => row.mcUsername)
    .join(", ");

  return (
    <aside className="live-status" aria-live="polite">
      <div className="live-status-main">
        <div className="live-status-title">
          <span className="live-dot" aria-hidden="true" />
          Live Hypixel
        </div>
        <div className="live-status-quota">
          <strong>
            {used ?? "—"}/{snapshot?.limit ?? "—"}
          </strong>{" "}
          <span className="muted">used</span>
          <span className="muted"> · </span>
          <span className="muted">resets {formatDuration(status?.secondsUntilReset)}</span>
          {status?.stale ? <span className="chip">stale</span> : null}
        </div>
        <div
          className="live-status-bar"
          aria-hidden="true"
          title={snapshot ? `${used}/${snapshot.limit} requests used this window` : "No quota sample"}
        >
          <div className="live-status-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="live-status-meta">
        <span className="chip">
          online <strong>{status?.onlineCount ?? 0}</strong>
          {onlineNames ? ` · ${onlineNames}` : ""}
          {(status?.onlineCount ?? 0) > 4 ? "…" : ""}
        </span>
        <span className="chip">
          refresh every{" "}
          <strong>{formatDuration(status?.currentIntervalSeconds)}</strong>
        </span>
        {latestEvent ? (
          <span className="chip">
            {latestEvent.mcUsername}: <strong>{eventLabel(latestEvent.kind)}</strong>
            {latestEvent.detail ? ` · ${latestEvent.detail}` : ""}
          </span>
        ) : (
          <span className="chip muted">waiting for scans…</span>
        )}
        <Link href="/settings" className="chip">
          settings
        </Link>
      </div>
    </aside>
  );
}
