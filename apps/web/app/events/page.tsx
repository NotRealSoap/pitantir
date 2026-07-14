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

type FilterKind = "all" | "inventory_changed" | "came_online" | "went_offline";

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "inventory_changed":
      return "Inventory";
    case "came_online":
      return "Online";
    case "went_offline":
      return "Offline";
    case "scanned":
      return "Scan";
    default:
      return kind;
  }
}

export default function EventsPage() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/live-events?limit=200", { cache: "no-store" });
      const payload = (await response.json()) as { events?: LiveEvent[]; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Unable to load events.");
        return;
      }
      setEvents(payload.events ?? []);
    } catch {
      setError("Unable to load events.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 4_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    setHighlightId(hash);
    const node = document.getElementById(hash);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [events]);

  const visible = useMemo(() => {
    if (filter === "all") return events;
    return events.filter((event) => event.kind === filter);
  }, [events, filter]);

  return (
    <>
      <h1 className="page-title">Events</h1>
      <p className="page-lede">
        Newsworthy watch signals — inventory moves name the exact mystic, nonce, and lives/enchants
        when available.
      </p>

      <div className="events-toolbar">
        {(
          [
            ["all", "All"],
            ["inventory_changed", "Inventory"],
            ["came_online", "Came online"],
            ["went_offline", "Went offline"],
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
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <p className="muted">
          {visible.length} event{visible.length === 1 ? "" : "s"}
          {filter !== "all" ? ` · filtered` : ""}
        </p>
      )}

      <ul className="events-list">
        {visible.map((event) => {
          const headline = describeLiveSignal({
            kind: event.kind,
            mcUsername: event.mcUsername,
            detail: event.detail,
            changes: event.changes,
          });
          return (
            <li
              key={event.id}
              id={event.id}
              className={`events-card is-${event.kind}${
                highlightId === event.id ? " is-highlight" : ""
              }`}
            >
              <div className="events-card-head">
                <span className={`events-kind is-${event.kind}`}>{kindLabel(event.kind)}</span>
                <Link href={`/accounts/${event.accountId}`} className="events-user">
                  {event.mcUsername}
                </Link>
                <time className="events-when" dateTime={event.at}>
                  {formatWhen(event.at)}
                </time>
              </div>
              <p className="events-headline">{headline}</p>
              {event.changes && event.changes.length > 0 ? (
                <ul className="events-changes">
                  {event.changes.map((change, index) => (
                    <li
                      key={`${event.id}-${change.nonce ?? "x"}-${change.direction}-${index}`}
                      className={`events-change is-${change.direction}`}
                    >
                      <span className="events-change-dir">{change.direction}</span>
                      <span className="events-change-label">
                        {formatInventoryChangeLabel(change)}
                      </span>
                      {change.slotKey ? (
                        <span className="events-change-slot muted">{change.slotKey}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : event.detail ? (
                <p className="events-detail muted">{event.detail}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!loading && visible.length === 0 ? (
        <p className="muted">No events yet — keep the worker scanning the watchlist.</p>
      ) : null}
    </>
  );
}
