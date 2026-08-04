"use client";

import { useCallback, useEffect, useState } from "react";

type RosterRow = {
  id: string;
  mcUsername: string;
  online: boolean;
  recentlyOnline: boolean;
  highActivity: boolean;
  outline: "green" | "yellow" | "none";
  lastPingAge: string;
  nextScanAt: string;
  intendedIntervalSeconds: number;
  lobby: string | null;
  apiOff: boolean;
};

type RosterPayload = {
  online?: RosterRow[];
  offline?: RosterRow[];
  onlineCount?: number;
  offlineCount?: number;
  intendedCadence?: {
    onlineSeconds: number;
    highActivitySeconds: number;
    offlineSeconds: number;
    recentlyOnlineMinutes: number;
  };
  configured?: boolean;
  error?: string;
  polledAt?: string;
};

function RowCard({ row }: { row: RosterRow }) {
  return (
    <article className={`api-row outline-${row.outline}`}>
      <div className="api-row-main">
        <strong className="api-row-name">{row.mcUsername}</strong>
        <div className="api-row-meta muted">
          {row.highActivity ? <span className="chip">High Activity</span> : null}
          {row.apiOff ? <span className="chip">API Off</span> : null}
          {row.recentlyOnline && !row.online ? <span className="chip">Recently Online</span> : null}
          {row.lobby ? <span>lobby {row.lobby}</span> : null}
          <span>target every {formatInterval(row.intendedIntervalSeconds)}</span>
        </div>
      </div>
      <div className="api-row-ping" title="Time since last successful ping">
        {row.lastPingAge}
      </div>
    </article>
  );
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${Math.round(seconds / 60)}m`;
}

export default function ApiBoardPage() {
  const [data, setData] = useState<RosterPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/roster", { cache: "no-store" });
      const payload = (await response.json()) as RosterPayload;
      if (!response.ok) {
        setError(payload.error ?? "Unable to load API roster.");
        return;
      }
      setError(null);
      setData(payload);
    } catch {
      setError("Unable to load API roster.");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(id);
  }, [load]);

  const cadence = data?.intendedCadence;

  return (
    <>
      <h1 className="page-title">API</h1>
      <p className="page-lede">
        Accounts on the Hypixel production watchlist. Online (green) sort alphabetically; offline
        queue is next-ping order. Yellow = online within the last{" "}
        {cadence?.recentlyOnlineMinutes ?? 10} minutes.
      </p>
      {cadence ? (
        <p className="muted">
          Intended cadence: online {cadence.onlineSeconds}s · high activity{" "}
          {cadence.highActivitySeconds / 60}m · offline {cadence.offlineSeconds / 60}m (worker may
          throttle to protect quota).
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}

      <section className="api-section">
        <header className="api-section-head">
          <h2 className="section-title">Online</h2>
          <span className="chip">{data?.onlineCount ?? 0}</span>
        </header>
        <div className="api-list">
          {(data?.online ?? []).map((row) => (
            <RowCard key={row.id} row={row} />
          ))}
          {data && (data.online?.length ?? 0) === 0 ? (
            <p className="muted">No accounts currently online.</p>
          ) : null}
        </div>
      </section>

      <section className="api-section">
        <header className="api-section-head">
          <h2 className="section-title">Offline queue</h2>
          <span className="chip">{data?.offlineCount ?? 0}</span>
        </header>
        <p className="muted" style={{ marginTop: 0 }}>
          Next to be pinged appears first (directly under Online).
        </p>
        <div className="api-list">
          {(data?.offline ?? []).map((row) => (
            <RowCard key={row.id} row={row} />
          ))}
        </div>
      </section>
    </>
  );
}
