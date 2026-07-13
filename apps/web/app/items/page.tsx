"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ItemListRow } from "@pitantir/db";

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
    <main>
      <h1>Items</h1>
      <p>
        Canonical mystic items (and books) created from scans. Nonces are the primary tracking key —
        filter by nonce, category, or location.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        style={{
          display: "grid",
          gap: "0.5rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
          maxWidth: "48rem",
          marginTop: "1rem",
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
        <button type="submit">Apply filters</button>
      </form>

      {error ? (
        <p role="alert" style={{ color: "#a00" }}>
          {error}
        </p>
      ) : null}
      {loading ? <p>Loading…</p> : <p>{items.length} item(s)</p>}

      <ul style={{ listStyle: "none", padding: 0, marginTop: "1rem" }}>
        {items.map((item) => (
          <li
            key={item.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: "6px",
              padding: "0.75rem",
              marginBottom: "0.5rem",
              maxWidth: "42rem",
            }}
          >
            <div>
              <Link href={`/items/${item.id}`}>
                <strong>{item.displayName ?? item.primaryNonce ?? item.id.slice(0, 8)}</strong>
              </Link>
            </div>
            <div>
              {item.category} · {item.identityConfidence} ·{" "}
              {item.locationKnown
                ? `on ${item.currentAccountUsername ?? item.currentAccountId}`
                : "location unknown"}
            </div>
            <div style={{ fontSize: "0.9rem", color: "#555" }}>
              Nonce: <code>{item.primaryNonce ?? "—"}</code>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
