"use client";

import { useState } from "react";
import type { ItemSearchResponse } from "@pitantir/shared/item-data";

type SearchKind = "exact_nonce" | "current_owner" | "past_owner";

const kindLabels: Record<SearchKind, string> = {
  exact_nonce: "Exact nonce",
  current_owner: "Current owner",
  past_owner: "Past owner",
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
      <h1>Item search</h1>
      <p>Search upstream item evidence via Pitantir. Results are ingested as observations for identity review.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(0);
        }}
        style={{ display: "grid", gap: "0.75rem", maxWidth: "32rem", marginTop: "1rem" }}
      >
        <label>
          Search type
          <select value={kind} onChange={(event) => setKind(event.target.value as SearchKind)}>
            {Object.entries(kindLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label>
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
            <ul>
              {result.items.map((item) => (
                <li key={item.providerItemKey} style={{ marginBottom: "1rem" }}>
                  <div>
                    <strong>{item.source}</strong> · {item.providerItemKey}
                  </div>
                  <div>Resolution: {item.resolutionStatus}</div>
                  <div>
                    Canonical item: {item.canonicalItemId ?? "unassigned"}
                  </div>
                  <pre
                    style={{
                      background: "#f4f4f4",
                      padding: "0.75rem",
                      overflowX: "auto",
                      fontSize: "0.85rem",
                    }}
                  >
                    {JSON.stringify(item.rawPayload, null, 2)}
                  </pre>
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
    return <p>Page {result.page + 1}: {result.items.length} result(s).</p>;
  }

  const messages: Record<ItemSearchResponse["status"], string> = {
    ok: "",
    no_results: result.message ?? "No results found.",
    invalid_search: result.message ?? "Invalid search.",
    unsupported_search: result.message ?? "Unsupported search.",
    upstream_unavailable: result.message ?? "Search is temporarily unavailable.",
    rate_limited: result.message ?? "Rate limit reached.",
  };

  return <p role="alert">{messages[result.status]}</p>;
}
