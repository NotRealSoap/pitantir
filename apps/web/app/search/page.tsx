"use client";

import { useEffect, useState } from "react";
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
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);

  useEffect(() => {
    void refreshConfigured();
  }, []);

  async function refreshConfigured() {
    try {
      const response = await fetch("/api/settings/pitpanda");
      const payload = (await response.json()) as { configured?: boolean };
      setConfigured(Boolean(payload.configured));
    } catch {
      setConfigured(false);
    }
  }

  async function saveApiKey() {
    setSavingKey(true);
    setKeyMessage(null);
    try {
      const response = await fetch("/api/settings/pitpanda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeyInput }),
      });
      const payload = (await response.json()) as { ok?: boolean; configured?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setKeyMessage(payload.error ?? "Could not save API key.");
        setConfigured(false);
        return;
      }
      setConfigured(true);
      setApiKeyInput("");
      setKeyMessage("PitPanda API key saved on the server. You can search now.");
      setResult(null);
    } catch {
      setKeyMessage("Could not save API key.");
    } finally {
      setSavingKey(false);
    }
  }

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
      if (payload.status === "configuration_error") {
        setConfigured(false);
      } else if (payload.status === "ok" || payload.status === "no_results") {
        setConfigured(true);
      }
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

  const needsKey = configured === false;

  return (
    <main>
      <h1>Item Search</h1>
      <p>
        Search upstream item evidence through Pitantir. The browser calls our server only; the
        PitPanda API key never leaves the server.
      </p>

      {needsKey ? (
        <section
          style={{
            marginTop: "1rem",
            marginBottom: "1.5rem",
            padding: "1rem",
            border: "1px solid #ccc",
            borderRadius: "6px",
            maxWidth: "32rem",
            background: "#fafafa",
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Connect PitPanda</h2>
          <p style={{ marginTop: 0 }}>
            Paste your PitPanda API key. It is sent to this app’s server route and stored only on
            the server (local <code>.env.local</code>). It is never shown again in the UI.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveApiKey();
            }}
            style={{ display: "grid", gap: "0.75rem" }}
          >
            <label style={{ display: "grid", gap: "0.25rem" }}>
              PitPanda API key
              <input
                type="password"
                autoComplete="off"
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
                placeholder="Paste key here"
                required
                minLength={8}
              />
            </label>
            <button type="submit" disabled={savingKey || apiKeyInput.trim().length < 8}>
              {savingKey ? "Saving…" : "Save key"}
            </button>
          </form>
          {keyMessage ? <p role="status">{keyMessage}</p> : null}
        </section>
      ) : (
        <p style={{ color: "#255", marginTop: "0.5rem" }}>
          PitPanda: <strong>{configured === null ? "checking…" : "configured"}</strong>
          {" · "}
          <button
            type="button"
            onClick={() => {
              setConfigured(false);
              setKeyMessage(null);
            }}
            style={{ background: "none", border: "none", color: "#06c", cursor: "pointer", padding: 0 }}
          >
            Replace key
          </button>
        </p>
      )}

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
      result.message ?? "Search is not configured. Paste your PitPanda API key above.",
    upstream_unavailable: result.message ?? "Search is temporarily unavailable.",
    rate_limited: result.message ?? "Rate limit reached. Try again shortly.",
  };

  return <p role="alert">{messages[result.status]}</p>;
}
