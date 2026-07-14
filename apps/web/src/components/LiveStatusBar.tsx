"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { describeLiveSignal } from "@pitantir/shared";

type ApiCall = {
  id: string;
  at: string;
  endpoint: string;
  mcUsername?: string | null;
  ok: boolean;
  statusCode?: number | null;
  detail?: string | null;
};

type LiveEvent = {
  id: string;
  kind: string;
  mcUsername: string;
  at?: string;
  detail?: string | null;
};

type LiveStatusPayload = {
  used?: number | null;
  snapshot?: {
    limit: number;
    remaining: number;
  } | null;
  secondsUntilReset?: number | null;
  stale?: boolean;
  currentIntervalSeconds?: number | null;
  onlineCount?: number;
  online?: Array<{ mcUsername: string }>;
  events?: LiveEvent[];
  recentCalls?: ApiCall[];
  latestCall?: ApiCall | null;
  dueNowCount?: number;
};

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  const rem = safe % 60;
  if (minutes < 60) return rem ? `${minutes}m ${rem}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatAge(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "no calls yet";
  const ms = nowMs - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const seconds = Math.round(ms / 1000);
  if (seconds < 3) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function formatSignal(event: LiveEvent): string {
  return describeLiveSignal({
    kind: event.kind,
    mcUsername: event.mcUsername,
    detail: event.detail,
  });
}

export function LiveStatusBar() {
  const [status, setStatus] = useState<LiveStatusPayload | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [flashId, setFlashId] = useState<string | null>(null);
  const [localReset, setLocalReset] = useState<number | null>(null);
  const inFlight = useRef(false);
  const lastSignalId = useRef<string | null>(null);
  const lastCallId = useRef<string | null>(null);
  const resetAnchor = useRef<{ at: number; seconds: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const response = await fetch("/api/live-status", { cache: "no-store" });
        const payload = (await response.json()) as LiveStatusPayload;
        if (!cancelled && response.ok) {
          const signalId = payload.events?.[0]?.id ?? null;
          const callId = payload.latestCall?.id ?? null;
          if (signalId && signalId !== lastSignalId.current) {
            lastSignalId.current = signalId;
            setFlashId(signalId);
          } else if (callId && callId !== lastCallId.current) {
            lastCallId.current = callId;
            setFlashId(callId);
          }
          if (callId) lastCallId.current = callId;
          setStatus(payload);
        }
      } catch {
        // keep last good snapshot
      } finally {
        inFlight.current = false;
      }
    }

    void load();
    // 2s is enough for the strip; local reset countdown still ticks every 1s.
    const pollId = window.setInterval(() => void load(), 2_000);
    const tickId = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.clearInterval(tickId);
    };
  }, []);

  useEffect(() => {
    if (!flashId) return;
    const id = window.setTimeout(() => setFlashId(null), 850);
    return () => window.clearTimeout(id);
  }, [flashId]);

  useEffect(() => {
    if (status?.secondsUntilReset == null) {
      resetAnchor.current = null;
      setLocalReset(null);
      return;
    }
    resetAnchor.current = { at: Date.now(), seconds: status.secondsUntilReset };
    setLocalReset(status.secondsUntilReset);
  }, [status?.secondsUntilReset, status?.latestCall?.id]);

  useEffect(() => {
    if (!resetAnchor.current) return;
    const elapsed = Math.floor((nowMs - resetAnchor.current.at) / 1000);
    setLocalReset(Math.max(0, resetAnchor.current.seconds - elapsed));
  }, [nowMs]);

  const snapshot = status?.snapshot ?? null;
  const used = status?.used ?? null;
  const remaining = snapshot?.remaining ?? null;
  const limit = snapshot?.limit ?? null;
  const pct =
    snapshot && snapshot.limit > 0 && used != null
      ? Math.min(100, Math.round((used / snapshot.limit) * 100))
      : 0;
  const latestEvent = status?.events?.[0] ?? null;
  const latestCall = status?.latestCall ?? null;
  const online = status?.online ?? [];
  const recentCalls = status?.recentCalls ?? [];
  const fillTone = pct >= 90 ? "hot" : pct >= 70 ? "warm" : "cool";

  return (
    <aside className="live-status" aria-live="polite">
      <div className="live-status-grid">
        <section className="live-quota-panel">
          <header className="live-status-head">
            <span className="live-dot" aria-hidden="true" />
            <div className="live-status-titles">
              <div className="live-kicker">Live Hypixel</div>
              <div className="live-subhead">
                {status?.stale
                  ? "Window reset — waiting for next sample"
                  : localReset != null
                    ? `Resets in ${formatDuration(localReset)}`
                    : "Waiting for quota sample"}
              </div>
            </div>
            <Link href="/settings" className="live-settings-link">
              Settings
            </Link>
          </header>

          <div className="live-quota-readout">
            <div className="live-quota-numbers">
              <span className="live-quota-used">{used ?? "—"}</span>
              <span className="live-quota-sep">/</span>
              <span className="live-quota-limit">{limit ?? "—"}</span>
              <span className="live-quota-label">used</span>
            </div>
            <div className="live-quota-remaining">
              <strong>{remaining ?? "—"}</strong> left
            </div>
          </div>

          <div
            className={`live-status-bar is-${fillTone}`}
            aria-hidden="true"
            title={snapshot ? `${used}/${limit} requests used this window` : "No quota sample"}
          >
            <div className="live-status-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </section>

        <section className="live-stats-panel">
          <div className="live-stat">
            <span className="live-stat-label">Last call</span>
            <span
              className={`live-stat-value${flashId && latestCall?.id === flashId ? " is-flash" : ""}`}
            >
              {latestCall ? (
                <>
                  <span className="live-mono">{latestCall.mcUsername ?? "probe"}</span>
                  <span className="live-dim">/{latestCall.endpoint}</span>
                  {!latestCall.ok ? <span className="live-fail"> failed</span> : null}
                </>
              ) : (
                <span className="live-dim">—</span>
              )}
            </span>
            <span className="live-stat-note">{formatAge(latestCall?.at ?? null, nowMs)}</span>
          </div>

          <div className="live-stat">
            <span className="live-stat-label">Due now</span>
            <span className="live-stat-value">{status?.dueNowCount ?? 0}</span>
            <span className="live-stat-note">
              every {formatDuration(status?.currentIntervalSeconds)}
            </span>
          </div>

          <div className="live-stat">
            <span className="live-stat-label">Online</span>
            <span className="live-stat-value">{status?.onlineCount ?? 0}</span>
            <span className="live-stat-note live-online-names">
              {online.length > 0
                ? `${online
                    .slice(0, 3)
                    .map((row) => row.mcUsername)
                    .join(", ")}${online.length > 3 ? "…" : ""}`
                : "none seen"}
            </span>
          </div>

          <div className="live-stat live-stat-signal">
            <span className="live-stat-label">Signal</span>
            <span
              className={`live-stat-value live-stat-value-wrap${
                flashId && latestEvent?.id === flashId ? " is-flash" : ""
              }`}
            >
              {latestEvent ? formatSignal(latestEvent) : <span className="live-dim">quiet</span>}
            </span>
            <span className="live-stat-note">
              {latestEvent ? formatAge(latestEvent.at, nowMs) : "no new events"}
            </span>
          </div>
        </section>
      </div>

      {(status?.events?.length ?? 0) > 0 ? (
        <div className="live-signal-rail" aria-label="Recent watch signals">
          {(status?.events ?? []).slice(0, 6).map((event) => (
            <span
              key={event.id}
              className={`live-signal-pill is-${event.kind}${
                flashId === event.id ? " is-flash" : ""
              }`}
              title={formatAge(event.at, nowMs)}
            >
              {formatSignal(event)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="live-call-rail" aria-label="Recent Hypixel calls">
        {recentCalls.length > 0 ? (
          recentCalls.slice(0, 8).map((call) => (
            <span
              key={call.id}
              className={`live-call-pill${call.ok ? "" : " is-fail"}${
                flashId === call.id ? " is-flash" : ""
              }`}
            >
              <span className="live-mono">{call.mcUsername ?? "probe"}</span>
              <span className="live-dim">/{call.endpoint}</span>
            </span>
          ))
        ) : (
          <span className="live-call-empty">Calls appear here as the worker hits Hypixel.</span>
        )}
      </div>
    </aside>
  );
}
