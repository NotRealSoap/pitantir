"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MysticItemCard } from "../../src/components/MysticItemCard";

type LookupItem = {
  slot: number;
  id: string | null;
  count: number;
  title: string | null;
  nonce: string | null;
  lore: string[] | null;
  customEnchants: Record<string, number> | null;
  lives: number | null;
  maxLives: number | null;
};

type LookupPayload = {
  ok?: boolean;
  error?: string;
  player?: {
    mcUsername: string;
    mcUuid: string | null;
    online: boolean | null;
    lastSave: number | null;
    levelLabel: string | null;
    totalXp: number | null;
    joins: number | null;
    gold: number | null;
    playtimeSeconds: number | null;
    bounty: number | null;
    deltas7d: {
      totalXp: number | null;
      gold: number | null;
      joins: number | null;
    };
  };
  storage?: {
    enderChest: LookupItem[];
    inventory: LookupItem[];
    stash: LookupItem[];
  };
};

function Delta({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  const sign = value > 0 ? "+" : "";
  const className = value > 0 ? "delta-up" : value < 0 ? "delta-down" : "muted";
  return (
    <span className={className}>
      {sign}
      {value.toLocaleString()}
    </span>
  );
}

function formatPlaytime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatLastSave(ts: number | null | undefined): string {
  if (!ts) return "unknown";
  const date = new Date(ts > 1e12 ? ts : ts * 1000);
  if (Number.isNaN(date.getTime())) return "unknown";
  const delta = Date.now() - date.getTime();
  const days = Math.floor(delta / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function BagSection({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: LookupItem[];
  onSelect: (item: LookupItem) => void;
}) {
  return (
    <section className="lookup-bag">
      <h3 className="section-title">{title}</h3>
      {items.length === 0 ? <p className="muted">Empty.</p> : null}
      <div className="lookup-grid">
        {items.map((item, index) => (
          <button
            key={`${title}-${item.slot}-${item.nonce ?? index}`}
            type="button"
            className="lookup-slot"
            onClick={() => onSelect(item)}
            title={item.title ?? "Item"}
          >
            <span className="lookup-slot-title">{item.title ?? item.id ?? "Item"}</span>
            {item.count > 1 ? <span className="lookup-slot-count">{item.count}</span> : null}
            {item.nonce ? <span className="lookup-slot-nonce">{item.nonce}</span> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function ItemModal({
  item,
  onClose,
}: {
  item: LookupItem;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const isPants = /pants|leggings|rage|dark/i.test(item.title ?? "");

  async function markSuspicious() {
    if (!item.nonce) {
      setError("This item has no nonce.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/suspicious-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark",
          nonce: item.nonce,
          title: item.title,
          numeralStyle: isPants ? "roman" : "arabic",
          reason: "6/17/26 Dupe",
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        item?: { numeral: string; numeralStyle: string };
      };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Could not mark suspicious.");
        return;
      }
      setChecked(true);
      setMessage(
        `Tracked as ${payload.item?.numeralStyle === "roman" ? "Roman" : "Arabic"} ${payload.item?.numeral}.`,
      );
    } catch {
      setError("Could not mark suspicious.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lookup-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="lookup-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Item details"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="lookup-modal-head">
          <h2 className="lookup-modal-title">{item.title ?? "Item"}</h2>
          <button type="button" className="events-filter" onClick={onClose}>
            Close
          </button>
        </header>
        <p>
          Nonce: <code>{item.nonce ?? "none"}</code>
        </p>
        <MysticItemCard
          title={item.title}
          nonce={item.nonce}
          lore={item.lore}
          customEnchants={item.customEnchants}
          lives={item.lives}
          maxLives={item.maxLives}
        />
        <p className="muted">
          Owner history opens on Duped after tagging, or via item search / local catalog when the
          nonce is already known to Pitantir.
        </p>
        <label className="suspicious-check">
          <input
            type="checkbox"
            checked={checked}
            disabled={busy || !item.nonce}
            onChange={(event) => {
              if (event.target.checked) void markSuspicious();
            }}
          />
          <span>
            Suspicious for 6/17/26 Dupe
            {isPants ? " (Roman id for Rage/Dark-style pants)" : " (Arabic id)"}
          </span>
        </label>
        {message ? <p role="status">{message}</p> : null}
        {error ? (
          <p role="alert" className="alert">
            {error}
          </p>
        ) : null}
        {item.nonce ? (
          <p>
            <a href={`/duped?nonce=${encodeURIComponent(item.nonce)}`}>Open on Duped tracker →</a>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LookupPageInner() {
  const searchParams = useSearchParams();
  const initialIgn = searchParams.get("ign") ?? "";
  const [ign, setIgn] = useState(initialIgn);
  const [query, setQuery] = useState(initialIgn);
  const [data, setData] = useState<LookupPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<LookupItem | null>(null);

  const search = useCallback(async (username: string) => {
    const trimmed = username.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const response = await fetch(`/api/player-lookup?ign=${encodeURIComponent(trimmed)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as LookupPayload;
      if (!response.ok) {
        setData(null);
        setError(payload.error ?? "Lookup failed.");
        return;
      }
      setData(payload);
    } catch {
      setError("Lookup failed.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialIgn) void search(initialIgn);
  }, [initialIgn, search]);

  const player = data?.player;

  return (
    <>
      <h1 className="page-title">Player Lookup</h1>
      <p className="page-lede">
        PitPal-shaped inspect. Storage order: Ender Chest → Inventory → Stash. Left-click an item for
        details and the 6/17/26 Dupe checkbox.
      </p>

      <form
        className="lookup-search"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(ign);
          void search(ign);
        }}
      >
        <input
          value={ign}
          onChange={(event) => setIgn(event.target.value)}
          placeholder="Enter player username..."
          aria-label="Minecraft username"
          maxLength={16}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}

      {player ? (
        <div className="lookup-layout">
          <aside className="lookup-profile panel">
            <div className="lookup-profile-head">
              {/* mc-heads avatar — external pixel art */}
              <img
                className="lookup-avatar"
                src={`https://mc-heads.net/avatar/${encodeURIComponent(player.mcUsername)}/64`}
                alt=""
                width={64}
                height={64}
              />
              <div>
                <div className="lookup-ign">{player.mcUsername}</div>
                <div className="muted">{query}</div>
              </div>
            </div>
            <dl className="lookup-stats">
              <div>
                <dt>Level</dt>
                <dd>
                  {player.levelLabel ?? "—"}{" "}
                  <Delta value={null} />
                </dd>
              </div>
              <div>
                <dt>Total XP</dt>
                <dd>
                  {player.totalXp?.toLocaleString() ?? "—"} <Delta value={player.deltas7d.totalXp} />
                </dd>
              </div>
              <div>
                <dt>Gold</dt>
                <dd>
                  {player.gold !== null ? `${player.gold.toLocaleString()}g` : "—"}{" "}
                  <Delta value={player.deltas7d.gold} />
                </dd>
              </div>
              <div>
                <dt>Playtime</dt>
                <dd>{formatPlaytime(player.playtimeSeconds)}</dd>
              </div>
              <div>
                <dt>Joins</dt>
                <dd>
                  {player.joins?.toLocaleString() ?? "—"} <Delta value={player.deltas7d.joins} />
                </dd>
              </div>
            </dl>
            <div className="lookup-status">
              <strong>{player.online ? "Online" : player.online === false ? "Offline" : "Status unknown"}</strong>
              <div className="muted">Last save {formatLastSave(player.lastSave)}</div>
              {player.bounty !== null ? (
                <div>
                  Bounty <span className="lookup-gold">{player.bounty.toLocaleString()}g</span>
                </div>
              ) : null}
            </div>
          </aside>

          <div className="lookup-storage panel">
            <h2 className="section-title" style={{ marginTop: 0 }}>
              Storage
            </h2>
            <BagSection
              title="Ender Chest"
              items={data?.storage?.enderChest ?? []}
              onSelect={setSelected}
            />
            <BagSection
              title="Inventory"
              items={data?.storage?.inventory ?? []}
              onSelect={setSelected}
            />
            <BagSection title="Stash" items={data?.storage?.stash ?? []} onSelect={setSelected} />
          </div>
        </div>
      ) : null}

      {selected ? <ItemModal item={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

export default function LookupPage() {
  return (
    <Suspense fallback={<p role="status">Loading lookup…</p>}>
      <LookupPageInner />
    </Suspense>
  );
}
