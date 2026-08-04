"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  describeLiveSignal,
  type InventoryChangeItem,
} from "@pitantir/shared/live-signal-copy";

type SuspiciousItem = {
  id: string;
  nonce: string;
  title: string | null;
  numeralStyle: "arabic" | "roman";
  numeral: string;
  reason: string;
  markedAt: string;
  manualNodes: Array<{ id: string; mcUsername: string; at: string; note: string | null }>;
};

type LiveEvent = {
  id: string;
  kind: string;
  accountId: string;
  mcUsername: string;
  at: string;
  detail?: string | null;
  changes?: InventoryChangeItem[] | null;
};

type GraphNode = {
  id: string;
  mcUsername: string;
  at: string;
  source: "manual" | "news";
};

const EPOCH = new Date("2026-06-05T00:00:00.000Z");

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function DupedInner() {
  const searchParams = useSearchParams();
  const initialNonce = searchParams.get("nonce") ?? "";
  const [items, setItems] = useState<SuspiciousItem[]>([]);
  const [nonceQuery, setNonceQuery] = useState(initialNonce);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [showDotted, setShowDotted] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string>(dayKey(new Date().toISOString()));
  const [manualUser, setManualUser] = useState("");
  const [manualAt, setManualAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    const response = await fetch("/api/suspicious-items", { cache: "no-store" });
    const payload = (await response.json()) as { items?: SuspiciousItem[]; error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Unable to load Duped tracker.");
      return;
    }
    setItems(payload.items ?? []);
    if (!selectedId && payload.items?.[0]) setSelectedId(payload.items[0].id);
  }, [selectedId]);

  const loadNews = useCallback(async () => {
    const response = await fetch("/api/live-events?limit=200", { cache: "no-store" });
    const payload = (await response.json()) as { events?: LiveEvent[] };
    if (response.ok) setEvents(payload.events ?? []);
  }, []);

  useEffect(() => {
    void loadItems();
    void loadNews();
  }, [loadItems, loadNews]);

  useEffect(() => {
    if (!initialNonce) return;
    const match = items.find((item) => item.nonce === initialNonce);
    if (match) setSelectedId(match.id);
  }, [initialNonce, items]);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  const family = useMemo(() => {
    const nonce = nonceQuery.trim() || selected?.nonce;
    if (!nonce) return items;
    return items.filter((item) => item.nonce === nonce);
  }, [items, nonceQuery, selected?.nonce]);

  const nodes: GraphNode[] = useMemo(() => {
    if (!selected) return [];
    const manual = selected.manualNodes.map((node) => ({
      id: node.id,
      mcUsername: node.mcUsername,
      at: node.at,
      source: "manual" as const,
    }));
    const fromNews = events
      .filter(
        (event) =>
          event.kind === "inventory_changed" &&
          (event.detail?.includes(selected.nonce) ||
            event.changes?.some((change) => change.nonce === selected.nonce)),
      )
      .map((event) => ({
        id: event.id,
        mcUsername: event.mcUsername,
        at: event.at,
        source: "news" as const,
      }));
    return [...manual, ...fromNews].sort((a, b) => b.at.localeCompare(a.at));
  }, [selected, events]);

  const days = useMemo(() => {
    const out: string[] = [];
    const end = new Date();
    for (let cursor = new Date(EPOCH); cursor <= end; cursor = addDays(cursor, 1)) {
      out.push(dayKey(cursor.toISOString()));
    }
    return out.reverse();
  }, []);

  const dayNews = useMemo(() => {
    return events.filter((event) => dayKey(event.at) === selectedDay);
  }, [events, selectedDay]);

  async function run(action: string, body: Record<string, unknown>) {
    setError(null);
    setMessage(null);
    const response = await fetch("/api/suspicious-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      items?: SuspiciousItem[];
      item?: SuspiciousItem;
    };
    if (!response.ok || payload.ok === false) {
      setError(payload.error ?? "Request failed.");
      return;
    }
    if (payload.items) setItems(payload.items);
    if (payload.item) setSelectedId(payload.item.id);
    setMessage("Updated (manual authority).");
  }

  return (
    <>
      <h1 className="page-title">Duped Item Tracker</h1>
      <p className="page-lede">
        Pitantir-specific ids (Arabic / Roman) for Suspicious items. Black grid = ownership nodes.
        Click a day since 6/5/26 to scrub News on the left. Dotted lines = unverified continuity.
      </p>

      <form
        className="lookup-search"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <input
          value={nonceQuery}
          onChange={(event) => setNonceQuery(event.target.value)}
          placeholder="Filter / search by nonce"
          aria-label="Nonce"
        />
        <label className="suspicious-check" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={showDotted}
            onChange={(event) => setShowDotted(event.target.checked)}
          />
          Show dotted continuity
        </label>
      </form>

      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}

      <div className="duped-layout">
        <aside className="duped-news panel">
          <h2 className="section-title" style={{ marginTop: 0 }}>
            News · {selectedDay}
          </h2>
          <ul className="events-list">
            {dayNews.map((event) => (
              <li key={event.id} className="events-row">
                <div className="events-row-top">
                  <Link href={`/lookup?ign=${encodeURIComponent(event.mcUsername)}`}>
                    {event.mcUsername}
                  </Link>
                  <time className="muted">{new Date(event.at).toLocaleTimeString()}</time>
                </div>
                <div>
                  {describeLiveSignal({
                    kind: event.kind,
                    mcUsername: event.mcUsername,
                    detail: event.detail,
                    changes: event.changes,
                  })}
                </div>
              </li>
            ))}
          </ul>
          {dayNews.length === 0 ? <p className="muted">No news that day.</p> : null}
        </aside>

        <section className="duped-main">
          <div className="duped-family">
            {family.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`duped-chip${item.id === selectedId ? " is-active" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                {item.numeralStyle === "roman" ? "Roman" : "#"} {item.numeral}
                <span className="muted"> · {item.nonce}</span>
              </button>
            ))}
            {family.length === 0 ? <p className="muted">No tracked items yet — tag from Lookup.</p> : null}
          </div>

          {selected ? (
            <>
              <div className="duped-item-head panel">
                <div>
                  <strong>
                    {selected.title ?? "Tracked item"} · {selected.numeralStyle === "roman" ? "Roman" : "Arabic"}{" "}
                    {selected.numeral}
                  </strong>
                  <div className="muted">
                    Nonce {selected.nonce} · {selected.reason}
                  </div>
                </div>
                <button
                  type="button"
                  className="events-filter"
                  onClick={() => void run("unmark", { id: selected.id })}
                >
                  Remove (manual)
                </button>
              </div>

              <div className="duped-grid panel">
                <div className="duped-axis muted">← past · present → click day</div>
                <div className="duped-days">
                  {days.slice(0, 120).map((day) => {
                    const dayNodes = nodes.filter((node) => dayKey(node.at) === day);
                    const active = day === selectedDay;
                    return (
                      <button
                        key={day}
                        type="button"
                        className={`duped-day${active ? " is-active" : ""}`}
                        onClick={() => setSelectedDay(day)}
                      >
                        <span className="duped-day-label">{day.slice(5)}</span>
                        <span className="duped-day-track">
                          {dayNodes.map((node, index) => (
                            <span
                              key={node.id}
                              className={`duped-node${node.source === "manual" ? " is-manual" : ""}`}
                              title={`${node.mcUsername} @ ${node.at}`}
                              style={{ left: `${12 + index * 18}px` }}
                            />
                          ))}
                          {showDotted && dayNodes.length === 0 ? (
                            <span className="duped-dot-gap" aria-hidden="true" />
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <form
                className="panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!manualUser.trim()) return;
                  void run("add_node", {
                    itemId: selected.id,
                    mcUsername: manualUser.trim(),
                    at: manualAt || undefined,
                  }).then(() => {
                    setManualUser("");
                    setManualAt("");
                  });
                }}
              >
                <h3 className="section-title" style={{ marginTop: 0 }}>
                  Manual node (absolute authority)
                </h3>
                <div className="lookup-search">
                  <input
                    value={manualUser}
                    onChange={(event) => setManualUser(event.target.value)}
                    placeholder="IGN"
                    required
                  />
                  <input
                    type="datetime-local"
                    value={manualAt}
                    onChange={(event) => setManualAt(event.target.value)}
                  />
                  <button type="submit">Add</button>
                </div>
                <ul className="muted">
                  {selected.manualNodes.map((node) => (
                    <li key={node.id}>
                      {node.mcUsername} · {new Date(node.at).toLocaleString()}{" "}
                      <button
                        type="button"
                        className="linkish"
                        onClick={() =>
                          void run("remove_node", { itemId: selected.id, nodeId: node.id })
                        }
                      >
                        delete
                      </button>
                    </li>
                  ))}
                </ul>
              </form>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}

export default function DupedPage() {
  return (
    <Suspense fallback={<p role="status">Loading Duped tracker…</p>}>
      <DupedInner />
    </Suspense>
  );
}
