"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import type { AccountHistoryRequest, AccountHistoryResponse } from "@pitantir/shared/account-history";
import { MysticItemCard } from "../../src/components/MysticItemCard";

const OwnershipGraph = dynamic(
  () => import("../../src/components/OwnershipGraph").then((mod) => mod.OwnershipGraph),
  {
    ssr: false,
    loading: () => <p className="muted">Loading graph…</p>,
  },
);

const IS_DEV = process.env.NODE_ENV === "development";

type GraphMode = "all" | "single";

const statusMessages: Record<AccountHistoryResponse["status"], string> = {
  ok: "",
  invalid_input: "Enter a valid Minecraft username or UUID.",
  account_not_found: "No Minecraft profile matched that input.",
  no_indexed_items: "PitPanda has no indexed items for this account as current owner.",
  configuration_error: "Account history is not configured. Add a PitPanda API key on Settings or Search.",
  rate_limited: "Rate limit reached. Try again shortly.",
  upstream_unavailable: "Upstream lookup is temporarily unavailable.",
  database_unavailable: "Local database is temporarily unavailable.",
};

export default function AccountPage() {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AccountHistoryResponse | null>(null);
  const [page, setPage] = useState(0);
  const [hideNoPriorOwners, setHideNoPriorOwners] = useState(false);
  const [itemType, setItemType] = useState("");
  const [enchantment, setEnchantment] = useState("");
  const [minCertainty, setMinCertainty] = useState<AccountHistoryRequest["minCertainty"]>("any");
  const [observedAfter, setObservedAfter] = useState("");
  const [observedBefore, setObservedBefore] = useState("");
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<GraphMode>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const runLookup = useCallback(
    async (nextPage = 0, focusKey: string | null = selectedItemKey) => {
      setLoading(true);
      try {
        const body: AccountHistoryRequest = {
          account: account.trim(),
          page: nextPage,
          pageSize: 25,
          hideNoPriorOwners,
          minCertainty,
          ...(itemType.trim() ? { itemType: itemType.trim() } : {}),
          ...(enchantment.trim() ? { enchantment: enchantment.trim() } : {}),
          ...(observedAfter
            ? { observedAfter: new Date(observedAfter).toISOString() }
            : {}),
          ...(observedBefore
            ? { observedBefore: new Date(observedBefore).toISOString() }
            : {}),
          ...(focusKey && graphMode === "single" ? { selectedItemKey: focusKey } : {}),
        };
        const response = await fetch("/api/account-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as AccountHistoryResponse;
        setResult(payload);
        setPage(nextPage);
      } catch {
        setResult({
          status: "upstream_unavailable",
          summary: null,
          items: [],
          page: nextPage,
          pageSize: 25,
          totalFilteredItems: 0,
          hasNextPage: false,
          graph: { nodes: [], links: [] },
          timeline: [],
          meta: {
            isComplete: false,
            itemsFetched: 0,
            pagesFetched: 0,
            hasMoreUpstreamPages: false,
            historySource: "none",
            missingHistoryCount: 0,
            warnings: [],
            upstreamCalls: 0,
            maxUpstreamPages: 5,
            itemHistoryLookups: 0,
            maxItemHistoryLookups: 40,
            skippedItemHistoryLookups: 0,
          },
          message: "Account history is temporarily unavailable.",
        });
      } finally {
        setLoading(false);
      }
    },
    [
      account,
      enchantment,
      graphMode,
      hideNoPriorOwners,
      itemType,
      minCertainty,
      observedAfter,
      observedBefore,
      selectedItemKey,
    ],
  );

  const summaryCards = useMemo(() => {
    if (!result?.summary) return null;
    const s = result.summary;
    return [
      { label: "Username", value: s.username ?? "—" },
      { label: "UUID", value: s.uuid ?? "—" },
      { label: "Indexed items", value: String(s.totalIndexedItems) },
      { label: "Prior owners", value: String(s.distinctPreviousOwners) },
      { label: "Earliest", value: s.earliestObservationAt ?? "—" },
      { label: "Latest", value: s.latestObservationAt ?? "—" },
    ];
  }, [result]);

  return (
    <>
      <h1 className="page-title">Account inventory history</h1>
      <p className="page-lede">
        Explore PitPanda-indexed items currently owned by a Minecraft account, enriched with local
        ownership periods when available. History is search-index based — never Hypixel-complete.
      </p>

      <form
        className="form-stack panel"
        style={{ maxWidth: "36rem" }}
        onSubmit={(event) => {
          event.preventDefault();
          setSelectedItemKey(null);
          void runLookup(0, null);
        }}
      >
        <label>
          Username or UUID
          <input
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            placeholder="Notch or 069a79f4-44e9-4726-a5be-fca90e38aaf5"
            required
            maxLength={64}
            autoComplete="off"
          />
        </label>
        <button type="submit" className="primary" disabled={loading || account.trim().length === 0}>
          {loading ? "Loading…" : "View Account"}
        </button>
      </form>

      {loading ? <p role="status">Loading account inventory history…</p> : null}

      {result && result.status !== "ok" && result.status !== "no_indexed_items" ? (
        <p role="alert" className="alert" style={{ marginTop: "1rem" }}>
          {result.message ?? statusMessages[result.status]}
        </p>
      ) : null}

      {result?.status === "no_indexed_items" ? (
        <p role="status" className="alert" style={{ marginTop: "1rem" }}>
          {result.message ?? statusMessages.no_indexed_items}
        </p>
      ) : null}

      {result?.status === "ok" && result.summary ? (
        <>
          <section className="filters" style={{ marginTop: "1.5rem" }}>
            {summaryCards?.map((card) => (
              <div key={card.label} className="panel" style={{ padding: "0.85rem 1rem" }}>
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  {card.label}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.92rem", wordBreak: "break-all" }}>
                  {card.value}
                </div>
              </div>
            ))}
          </section>

          {result.meta.warnings.length > 0 ? (
            <ul className="alert" style={{ marginTop: "1rem", listStyle: "disc", paddingLeft: "1.25rem" }}>
              {result.meta.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Source: <strong>{result.meta.historySource}</strong>
            {" · "}
            complete: <strong>{result.meta.isComplete ? "no gaps detected in this pass" : "incomplete"}</strong>
            {" · "}
            pages {result.meta.pagesFetched}/{result.meta.maxUpstreamPages}
            {" · "}
            detail lookups {result.meta.itemHistoryLookups}/{result.meta.maxItemHistoryLookups}
            {result.meta.skippedItemHistoryLookups > 0
              ? ` · skipped ${result.meta.skippedItemHistoryLookups}`
              : ""}
          </p>

          <section className="panel filters" style={{ marginTop: "1.25rem" }}>
            <label>
              Item type
              <input value={itemType} onChange={(e) => setItemType(e.target.value)} placeholder="bow, pants…" />
            </label>
            <label>
              Enchantment
              <input
                value={enchantment}
                onChange={(e) => setEnchantment(e.target.value)}
                placeholder="telebow"
              />
            </label>
            <label>
              Min certainty
              <select
                value={minCertainty}
                onChange={(e) => setMinCertainty(e.target.value as AccountHistoryRequest["minCertainty"])}
              >
                <option value="any">Any</option>
                <option value="uncertain">Uncertain+</option>
                <option value="confirmed">Confirmed only</option>
              </select>
            </label>
            <label>
              Observed after
              <input type="date" value={observedAfter} onChange={(e) => setObservedAfter(e.target.value)} />
            </label>
            <label>
              Observed before
              <input type="date" value={observedBefore} onChange={(e) => setObservedBefore(e.target.value)} />
            </label>
            <label style={{ display: "flex", alignItems: "flex-end", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={hideNoPriorOwners}
                onChange={(e) => setHideNoPriorOwners(e.target.checked)}
              />
              Hide no prior owners
            </label>
            <button type="button" className="primary" disabled={loading} onClick={() => void runLookup(0)}>
              Apply filters
            </button>
          </section>

          <section style={{ marginTop: "1.5rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
              <h2 className="section-title" style={{ margin: 0 }}>
                Ownership graph
              </h2>
              <button
                type="button"
                className={graphMode === "all" ? "primary" : undefined}
                onClick={() => {
                  setGraphMode("all");
                  setSelectedItemKey(null);
                  void runLookup(page, null);
                }}
              >
                All Items
              </button>
              <button
                type="button"
                className={graphMode === "single" ? "primary" : undefined}
                disabled={!selectedItemKey}
                onClick={() => {
                  setGraphMode("single");
                  if (selectedItemKey) void runLookup(page, selectedItemKey);
                }}
              >
                Single Item
              </button>
            </div>
            <div className="panel" style={{ marginTop: "0.75rem", overflow: "hidden" }}>
              <OwnershipGraph nodes={result.graph.nodes} links={result.graph.links} />
            </div>
          </section>

          {result.timeline && result.timeline.length > 0 ? (
            <section style={{ marginTop: "1.5rem" }}>
              <h2 className="section-title">Timeline</h2>
              <ul className="mystic-list">
                {result.timeline.map((event) => (
                  <li key={event.eventId} className="event-card">
                    <strong>{event.label}</strong>
                    <span className="muted">{event.eventTime}</span>
                    <span>
                      {(event.fromAccountUsername ?? "—") + " → " + (event.toAccountUsername ?? "—")}
                    </span>
                    <span className="chip">{event.certainty}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section style={{ marginTop: "1.5rem" }}>
            <h2 className="section-title">
              Items ({result.totalFilteredItems} filtered · page {page + 1})
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Item</th>
                    <th align="left">Nonce</th>
                    <th align="right">Priors</th>
                    <th align="left">History</th>
                    <th align="left">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.key}>
                      <td>{item.title ?? item.key}</td>
                      <td>
                        <code>{item.nonce ?? "—"}</code>
                      </td>
                      <td align="right">{item.priorOwnerCount}</td>
                      <td>
                        <span className="chip">{item.historySource}</span>
                      </td>
                      <td className="muted">{item.lastSeenAt ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mystic-list" style={{ marginTop: "1rem" }}>
              {result.items.map((item) => {
                const open = Boolean(expanded[item.key]);
                return (
                  <li key={`card-${item.key}`}>
                    <MysticItemCard
                      title={item.title}
                      nonce={item.nonce}
                      lives={item.lives}
                      maxLives={item.maxLives}
                      customEnchants={item.customEnchants}
                      lore={item.lore}
                      kind={item.kind}
                      resolutionStatus={item.resolutionStatus}
                      href={item.canonicalItemId ? `/items/${item.canonicalItemId}` : null}
                      footer={
                        <>
                          {item.historySource} · priors {item.priorOwnerCount}
                          {item.lastSeenAt ? ` · ${item.lastSeenAt}` : ""}
                        </>
                      }
                    />
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.45rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => ({ ...prev, [item.key]: !open }))}
                      >
                        {open ? "Hide ownership" : "Ownership history"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedItemKey(item.key);
                          setGraphMode("single");
                          void runLookup(page, item.key);
                        }}
                      >
                        Focus graph
                      </button>
                    </div>
                    {open ? (
                      <div className="panel" style={{ marginTop: "0.5rem" }}>
                        <h3 className="section-title" style={{ marginTop: 0, fontSize: "1rem" }}>
                          PitPanda owners
                        </h3>
                        {item.pitpandaOwners.length === 0 ? (
                          <p className="muted">No PitPanda owners timeline for this item.</p>
                        ) : (
                          <ol>
                            {item.pitpandaOwners.map((owner) => (
                              <li key={`${owner.uuid}-${owner.seenAt}`}>
                                {owner.username ?? owner.uuid.slice(0, 8)} · {owner.seenAt}
                              </li>
                            ))}
                          </ol>
                        )}
                        <h3 className="section-title" style={{ fontSize: "1rem" }}>
                          Local periods
                        </h3>
                        {item.ownershipPeriods.length === 0 ? (
                          <p className="muted">No local ownership periods.</p>
                        ) : (
                          <ul className="mystic-list">
                            {item.ownershipPeriods.map((period) => (
                              <li key={period.periodId} className="event-card">
                                {period.accountUsername ?? period.accountUuid ?? "unknown"} ·{" "}
                                {period.startedAt}
                                {period.endedAt ? ` → ${period.endedAt}` : " → open"} ·{" "}
                                <span className="chip">{period.certainty}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
              <button type="button" disabled={loading || page === 0} onClick={() => void runLookup(page - 1)}>
                Previous
              </button>
              <button
                type="button"
                disabled={loading || !result.hasNextPage}
                onClick={() => void runLookup(page + 1)}
              >
                Next page
              </button>
            </div>
          </section>

          {IS_DEV ? (
            <details style={{ marginTop: "1.5rem" }}>
              <summary className="muted">Dev JSON inspector</summary>
              <pre
                className="panel"
                style={{
                  overflowX: "auto",
                  fontSize: "0.85rem",
                  marginTop: "0.5rem",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          ) : null}
        </>
      ) : null}
    </>
  );
}
