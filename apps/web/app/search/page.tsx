"use client";

import { useEffect, useState } from "react";
import type { ItemSearchResponse } from "@pitantir/shared/item-data";
import {
  pantColorFromNonce,
  pantColorLabel,
  resolveMysticLives,
} from "@pitantir/shared/inventory";
import { MysticItemCard } from "../../src/components/MysticItemCard";

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

function asNumberRecord(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function SearchResultCard({
  item,
  dataSource,
}: {
  item: ItemSearchResponse["items"][number];
  dataSource: ItemSearchResponse["dataSource"];
}) {
  const raw = item.rawPayload ?? {};
  const title =
    typeof raw.name === "string"
      ? raw.name
      : typeof raw.title === "string"
        ? raw.title
        : typeof raw.itemName === "string"
          ? raw.itemName
          : item.providerItemKey;
  const nonce =
    typeof raw.nonce === "string" || typeof raw.nonce === "number"
      ? String(raw.nonce)
      : typeof raw.Nonce === "string" || typeof raw.Nonce === "number"
        ? String(raw.Nonce)
        : null;
  const lore = Array.isArray(raw.lore)
    ? raw.lore.map(String)
    : Array.isArray(raw.description)
      ? raw.description.map(String)
      : null;
  const customEnchants = asNumberRecord(raw.customEnchants ?? raw.enchants);
  const lives = resolveMysticLives(raw as Record<string, unknown>);
  const pant = pantColorFromNonce(nonce);

  return (
    <li>
      <MysticItemCard
        title={title}
        nonce={nonce}
        lives={lives.lives}
        maxLives={lives.maxLives}
        lore={lore}
        customEnchants={customEnchants}
        resolutionStatus={item.resolutionStatus}
        href={item.canonicalItemId ? `/items/${item.canonicalItemId}` : null}
        footer={
          <>
            {dataSource ? dataSourceLabels[dataSource] : item.source}
            {" · "}
            {item.canonicalItemId ?? "unassigned"}
            {pant ? (
              <>
                {" · "}
                <span className={`chip pants-${pant}`}>{pantColorLabel(pant)}</span>
              </>
            ) : null}
            {item.observedAt ? ` · ${item.observedAt}` : ""}
          </>
        }
      />
      <details style={{ marginTop: "0.45rem" }}>
        <summary className="muted">Raw upstream JSON</summary>
        <pre
          className="panel"
          style={{
            overflowX: "auto",
            fontSize: "0.85rem",
            marginTop: "0.5rem",
            fontFamily: "var(--font-mono)",
          }}
        >
          {JSON.stringify(item.rawPayload, null, 2)}
        </pre>
      </details>
    </li>
  );
}

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
      const payload = (await response.json()) as {
        ok?: boolean;
        configured?: boolean;
        error?: string;
      };
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
    <>
      <h1 className="page-title">Item Search</h1>
      <p className="page-lede">
        Search upstream mystic evidence through Pitantir. The browser calls our server only; the
        PitPanda API key never leaves the server.
      </p>

      {needsKey ? (
        <section className="panel" style={{ marginBottom: "1.5rem", maxWidth: "32rem" }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>
            Connect PitPanda
          </h2>
          <p className="muted">
            Paste your PitPanda API key. It is stored only on the server and never shown again in the
            UI.
          </p>
          <form
            className="form-stack"
            style={{ maxWidth: "100%" }}
            onSubmit={(event) => {
              event.preventDefault();
              void saveApiKey();
            }}
          >
            <label>
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
            <button type="submit" className="primary" disabled={savingKey || apiKeyInput.trim().length < 8}>
              {savingKey ? "Saving…" : "Save key"}
            </button>
          </form>
          {keyMessage ? <p role="status">{keyMessage}</p> : null}
        </section>
      ) : (
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          PitPanda: <strong>{configured === null ? "checking…" : "configured"}</strong>
          {" · "}
          <button
            type="button"
            onClick={() => {
              setConfigured(false);
              setKeyMessage(null);
            }}
            style={{ background: "none", border: "none", color: "var(--pit-aqua)", cursor: "pointer", padding: 0 }}
          >
            Replace key
          </button>
        </p>
      )}

      <form
        className="form-stack panel"
        style={{ maxWidth: "32rem" }}
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(0);
        }}
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
            placeholder={kind === "exact_nonce" ? "Mystic nonce" : "Minecraft username"}
            required
            maxLength={128}
          />
        </label>

        <button type="submit" className="primary" disabled={loading || value.trim().length === 0}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {loading ? <p role="status">Loading results…</p> : null}

      {result ? (
        <section style={{ marginTop: "1.5rem" }}>
          <StatusBanner result={result} />
          {result.status === "ok" ? (
            <ul className="mystic-list">
              {result.items.map((item) => (
                <SearchResultCard key={item.providerItemKey} item={item} dataSource={result.dataSource} />
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
    </>
  );
}

function StatusBanner({ result }: { result: ItemSearchResponse }) {
  if (result.status === "ok") {
    const sourceLabel = result.dataSource ? dataSourceLabels[result.dataSource] : "Unknown";
    return (
      <p className="muted">
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

  return (
    <p role="alert" className="alert">
      {messages[result.status]}
    </p>
  );
}
