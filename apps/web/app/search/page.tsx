"use client";

import { useState } from "react";
import type { ItemSearchResponse } from "@pitantir/shared/item-data";

type SearchKind = "exact_nonce" | "current_owner" | "past_owner";

const kindLabels: Record<SearchKind, string> = {
  exact_nonce: "Nonce",
  current_owner: "Current owner",
  past_owner: "Past owner",
};

const dataSourceLabels: Record<NonNullable<ItemSearchResponse["dataSource"]>, string> = {
  pitpanda: "PitPanda",
  local_database: "Local database",
};

export default function SearchPage() {
  const [kind, setKind] = useState<SearchKind>("exact_nonce");
  const [value, setValue] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ItemSearchResponse | null>(null);

  async function runSearch(nextPage = 0) {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/item-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, value, page: nextPage }),
      });
      const payload = (await response.json()) as ItemSearchResponse;
      setResult(payload);
      setPage(nextPage);
    } catch {
      setResult({
        status: "upstream_unavailable",
        dataSource: "pitpanda",
        page: nextPage,
        hasNextPage: false,
        items: [],
        message: "Item search is temporarily unavailable.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Item Search</h1>
      <p>
        Search upstream item evidence through Pitantir. The browser calls our server only; the
        PitPanda API key never leaves the server.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(0);
        }}
        style={{ display: "grid", gap: "0.75rem", maxWidth: "32rem", marginTop: "1rem" }}
      >
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Search type
          <select value={kind} onChange={(event) => setKind(event.target.value as SearchKind)}>
            {Object.entries(kindLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: "0.25rem" }}>
          Value
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={kind === "exact_nonce" ? "Book nonce" : "Minecraft username"}
            required
            maxLength={128}
          />
        </label>

        <button type="submit" disabled={loading || value.trim().length === 0}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {loading ? <p role="status">Loading results…</p> : null}

      {result ? (
        <section style={{ marginTop: "1.5rem" }}>
          <StatusBanner result={result} />
          {result.status === "ok" ? (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {result.items.map((item) => (
                <li
                  key={item.providerItemKey}
                  style={{
                    marginBottom: "1.25rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                    padding: "1rem",
                  }}
                >
                  <div style={{ marginBottom: "0.5rem" }}>
                    <strong>Source:</strong>{" "}
                    {result.dataSource ? dataSourceLabels[result.dataSource] : item.source}
                  </div>
                  <div>
                    <strong>Provider key:</strong> {item.providerItemKey}
                  </div>
                  <div>
                    <strong>Resolution:</strong> {item.resolutionStatus}
                  </div>
                  <div>
                    <strong>Canonical item:</strong> {item.canonicalItemId ?? "unassigned"}
                  </div>
                  {item.observedAt ? (
                    <div>
                      <strong>Observed at:</strong> {item.observedAt}
                    </div>
                  ) : null}
                  <details style={{ marginTop: "0.75rem" }}>
                    <summary>Raw upstream JSON (development)</summary>
                    <pre
                      style={{
                        background: "#f4f4f4",
                        padding: "0.75rem",
                        overflowX: "auto",
                        fontSize: "0.85rem",
                        marginTop: "0.5rem",
                      }}
                    >
                      {JSON.stringify(item.rawPayload, null, 2)}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          ) : null}

          {result.status === "ok" && result.hasNextPage ? (
            <button type="button" disabled={loading} onClick={() => void runSearch(page + 1)}>
              Next page
            </button>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function StatusBanner({ result }: { result: ItemSearchResponse }) {
  if (result.status === "ok") {
    const sourceLabel = result.dataSource ? dataSourceLabels[result.dataSource] : "Unknown";
    return (
      <p>
        Page {result.page + 1}: {result.items.length} result(s) from <strong>{sourceLabel}</strong>.
      </p>
    );
  }

  const messages: Record<ItemSearchResponse["status"], string> = {
    ok: "",
    no_results: result.message ?? "No results found.",
    invalid_search: result.message ?? "Invalid search input.",
    unsupported_search: result.message ?? "Unsupported search type.",
    configuration_error:
      result.message ??
      "Search is not configured on the server. Add PITPANDA_API_KEY to apps/web/.env.local and restart the dev server.",
    upstream_unavailable: result.message ?? "Search is temporarily unavailable.",
    rate_limited: result.message ?? "Rate limit reached. Try again shortly.",
  };

  return <p role="alert">{messages[result.status]}</p>;
}
