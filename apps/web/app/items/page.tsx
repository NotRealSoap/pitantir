"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ItemListRow } from "@pitantir/db";
import { pantColorFromNonce, pantColorLabel } from "@pitantir/shared/inventory";

export default function ItemsPage() {
  const [items, setItems] = useState<ItemListRow[]>([]);
  const [q, setQ] = useState("");
  const [nonce, setNonce] = useState("");
  const [category, setCategory] = useState("");
  const [confidence, setConfidence] = useState("");
  const [location, setLocation] = useState("any");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(overrides?: {
    q?: string;
    nonce?: string;
    category?: string;
    confidence?: string;
    location?: string;
  }) {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    const nextQ = overrides?.q ?? q;
    const nextNonce = overrides?.nonce ?? nonce;
    const nextCategory = overrides?.category ?? category;
    const nextConfidence = overrides?.confidence ?? confidence;
    const nextLocation = overrides?.location ?? location;
    if (nextQ) params.set("q", nextQ);
    if (nextNonce) params.set("nonce", nextNonce);
    if (nextCategory) params.set("category", nextCategory);
    if (nextConfidence) params.set("confidence", nextConfidence);
    if (nextLocation && nextLocation !== "any") params.set("location", nextLocation);

    try {
      const response = await fetch(`/api/items?${params.toString()}`);
      const payload = (await response.json()) as { items?: ItemListRow[]; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Unable to load items.");
        setItems([]);
        return;
      }
      setItems(payload.items ?? []);
    } catch {
      setError("Unable to load items.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <h1 className="page-title">Items</h1>
      <p className="page-lede">
        Canonical mystic items tracked by nonce. Filter the catalog, then open an item for
        ownership history.
      </p>

      <form
        className="filters filters-wide"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / nonce / fingerprint"
        />
        <input
          value={nonce}
          onChange={(e) => setNonce(e.target.value)}
          placeholder="Nonce contains"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Any category</option>
          <option value="unique_nonce_candidate">unique_nonce_candidate</option>
          <option value="duplicate_nonce">duplicate_nonce</option>
          <option value="nonce_less">nonce_less</option>
          <option value="unknown">unknown</option>
        </select>
        <select value={confidence} onChange={(e) => setConfidence(e.target.value)}>
          <option value="">Any confidence</option>
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
          <option value="contested">contested</option>
        </select>
        <select value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="any">Any location</option>
          <option value="known">Location known</option>
          <option value="unknown">Location unknown</option>
        </select>
        <button type="submit" className="primary">
          Apply filters
        </button>
      </form>

      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="muted">Loading…</p> : <p className="muted">{items.length} item(s)</p>}

      <ul className="mystic-list">
        {items.map((item) => {
          const pant = pantColorFromNonce(item.primaryNonce);
          return (
            <li key={item.id} className="mystic-card">
              <div className="mystic-card-top">
                <Link href={`/items/${item.id}`} className="mystic-title">
                  {item.displayName ?? item.primaryNonce ?? item.id.slice(0, 8)}
                </Link>
                <div className="meta-row">
                  {pant ? <span className={`chip pants-${pant}`}>{pantColorLabel(pant)}</span> : null}
                  <span className="chip">{item.identityConfidence}</span>
                </div>
              </div>
              <div className="meta-row">
                <span className="chip">
                  Nonce <strong>{item.primaryNonce ?? "—"}</strong>
                </span>
                <span className="chip">{item.category}</span>
                <span className="chip">
                  {item.locationKnown
                    ? `on ${item.currentAccountUsername ?? item.currentAccountId}`
                    : "location unknown"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
