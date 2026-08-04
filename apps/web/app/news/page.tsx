"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  describeLiveSignal,
  formatInventoryChangeLabel,
  type InventoryChangeItem,
} from "@pitantir/shared/live-signal-copy";

type LiveEvent = {
  id: string;
  kind: string;
  accountId: string;
  mcUsername: string;
  at: string;
  detail?: string | null;
  changes?: InventoryChangeItem[] | null;
};

type FilterKind = "all" | "presence" | "items";

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "inventory_changed":
      return "Item ±";
    case "came_online":
      return "Online";
    case "went_offline":
      return "Offline";
    default:
      return kind;
  }
}

export default function NewsPage() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKind>("all");

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/live-events?limit=200", { cache: "no-store" });
      const payload = (await response.json()) as { events?: LiveEvent[]; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Unable to load news.");
        return;
      }
      setEvents(payload.events ?? []);
    } catch {
      setError("Unable to load news.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 4_000);
    return () => window.clearInterval(id);
  }, [load]);

  const visible = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "presence") {
      return events.filter((event) =>
        ["came_online", "went_offline", "pitpal_entered", "pitpal_left"].includes(event.kind),
      );
    }
    return events.filter(
      (event) => event.kind === "inventory_changed" || event.kind === "item_moved",
    );
  }, [events, filter]);

  return (
    <>
      <h1 className="page-title">News</h1>
      <p className="page-lede">
        Chronological activity across watched accounts — presence and item gains/transfers.
      </p>

      <div className="events-toolbar">
        {(
          [
            ["all", "All"],
            ["presence", "Online / Offline"],
            ["items", "Item gains / transfers"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`events-filter${filter === value ? " is-active" : ""}`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="events-filter" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p role="status">Loading…</p> : null}

      <ul className="events-list">
        {visible.map((event) => {
          const copy = describeLiveSignal({
            kind: event.kind,
            mcUsername: event.mcUsername,
            detail: event.detail,
            changes: event.changes,
          });
          return (
            <li key={event.id} id={event.id} className="events-row">
              <div className="events-row-top">
                <span className={`events-kind is-${event.kind}`}>{kindLabel(event.kind)}</span>
                <Link href={`/lookup?ign=${encodeURIComponent(event.mcUsername)}`}>
                  {event.mcUsername}
                </Link>
                <time className="muted" dateTime={event.at}>
                  {formatWhen(event.at)}
                </time>
              </div>
              <div>{copy}</div>
              {event.changes?.length ? (
                <ul className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                  {event.changes.map((change, index) => (
                    <li key={`${event.id}-${index}`}>{formatInventoryChangeLabel(change)}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!loading && visible.length === 0 ? <p className="muted">No news for this filter.</p> : null}
    </>
  );
}
