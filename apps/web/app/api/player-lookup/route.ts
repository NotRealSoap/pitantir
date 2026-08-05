import { NextResponse } from "next/server";
import { getPitPandaApiKey, isPitPandaConfigured } from "../../../src/server/pitpanda-key-store";
import { stripMcFormatting } from "@pitantir/shared/inventory";
import { coerceInventoryNonce } from "@pitantir/shared/inventory";

type PitPandaPlayersResponse = {
  success?: boolean;
  error?: string;
  data?: {
    uuid?: string;
    name?: string;
    online?: boolean | null;
    lastSave?: number | null;
    lastLogout?: number | null;
    level?: number | null;
    prestige?: number | null;
    xp?: number | null;
    totalXp?: number | null;
    gold?: number | null;
    playtime?: number | null;
    joins?: number | null;
    loginCount?: number | null;
    bounty?: number | null;
    xpDelta7d?: number | null;
    goldDelta7d?: number | null;
    joinsDelta7d?: number | null;
    inventories?: Record<string, unknown[]>;
    [key: string]: unknown;
  };
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function normalizeSlot(raw: unknown, index: number) {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;

  // PitPanda decoded bags use `name` / `desc` / numeric `id` / `meta` / `nonce`.
  const titleFromName =
    typeof row.name === "string" ? stripMcFormatting(row.name) ?? row.name : null;
  const titleFromDisplay =
    typeof row.title === "string" ? stripMcFormatting(row.title) ?? row.title : null;
  const title = titleFromName ?? titleFromDisplay;

  const loreSource = Array.isArray(row.desc)
    ? row.desc
    : Array.isArray(row.lore)
      ? row.lore
      : null;
  const lore = loreSource
    ? loreSource
        .filter((line): line is string => typeof line === "string")
        .map((line) => stripMcFormatting(line) ?? line)
    : null;

  const extras =
    row.ExtraAttributes && typeof row.ExtraAttributes === "object"
      ? (row.ExtraAttributes as Record<string, unknown>)
      : row;

  const nonce = coerceInventoryNonce(
    row.nonce ?? row.Nonce ?? extras.Nonce ?? extras.nonce,
  );
  const count = asNumber(row.count ?? row.Count) ?? 1;

  let id: string | null = null;
  if (typeof row.id === "number" && Number.isFinite(row.id)) id = String(Math.trunc(row.id));
  else if (typeof row.id === "string") id = row.id;
  else if (typeof row.itemId === "string") id = row.itemId;
  else if (typeof row.type === "string") id = row.type;

  const metaRaw = row.meta ?? row.damage ?? row.Damage ?? extras.color ?? extras.Color ?? null;
  let meta: string | number | null = null;
  if (typeof metaRaw === "number" && Number.isFinite(metaRaw)) meta = Math.trunc(metaRaw);
  else if (typeof metaRaw === "string" && metaRaw.trim()) meta = metaRaw.trim();

  const customFromMystic = Array.isArray(row.mysticEnchants)
    ? Object.fromEntries(
        row.mysticEnchants
          .filter(
            (ench): ench is { key?: unknown; tier?: unknown } =>
              Boolean(ench && typeof ench === "object" && !Array.isArray(ench)),
          )
          .map((ench) => {
            const key = String(ench.key ?? "").trim();
            const tier = Number.isFinite(Number(ench.tier)) ? Math.trunc(Number(ench.tier)) : 0;
            return [key, tier] as const;
          })
          .filter((entry) => entry[0].length > 0 && entry[1] > 0),
      )
    : null;

  return {
    slot: asNumber(row.slot) ?? index,
    id,
    meta,
    count,
    title,
    nonce,
    lore,
    customEnchants:
      customFromMystic && Object.keys(customFromMystic).length > 0
        ? customFromMystic
        : extras.CustomEnchants && typeof extras.CustomEnchants === "object"
          ? (extras.CustomEnchants as Record<string, number>)
          : null,
    lives: asNumber(extras.Lives ?? extras.lives ?? row.lives),
    maxLives: asNumber(extras.MaxLives ?? extras.maxLives ?? row.maxLives),
  };
}

function normalizeBag(raw: unknown[] | undefined) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, index) => normalizeSlot(entry, index))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

/**
 * Pitantir 2.0 Player Lookup — PitPanda keyed player payload shaped for PitPal-like UI.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ign = (url.searchParams.get("ign") ?? url.searchParams.get("username") ?? "").trim();
  if (!ign || ign.length < 3 || ign.length > 16) {
    return NextResponse.json({ error: "Enter a Minecraft username (3–16 chars)." }, { status: 400 });
  }
  if (!isPitPandaConfigured()) {
    return NextResponse.json(
      { error: "PitPanda API key required for Player Lookup. Save it under legacy Settings or Extras keys." },
      { status: 503 },
    );
  }

  const apiKey = getPitPandaApiKey()!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`https://pitpanda.rocks/api/players/${encodeURIComponent(ign)}`, {
      headers: { Accept: "application/json", "X-API-Key": apiKey },
      signal: controller.signal,
      cache: "no-store",
    });
    if (response.status === 401) {
      return NextResponse.json({ error: "PitPanda rejected the API key." }, { status: 401 });
    }
    if (response.status === 429) {
      return NextResponse.json({ error: "PitPanda rate limited this lookup." }, { status: 429 });
    }
    if (!response.ok) {
      return NextResponse.json({ error: `PitPanda HTTP ${response.status}` }, { status: 502 });
    }
    const body = (await response.json()) as PitPandaPlayersResponse;
    if (!body.success || !body.data) {
      return NextResponse.json(
        { error: typeof body.error === "string" ? body.error : "Player not found." },
        { status: 404 },
      );
    }

    const data = body.data;
    const inventories = data.inventories && typeof data.inventories === "object" ? data.inventories : {};
    const enderChest = normalizeBag(inventories.enderchest);
    const inventory = normalizeBag(inventories.main);
    const stash = normalizeBag(inventories.stash);

    const level = asNumber(data.level);
    const prestige = asNumber(data.prestige);
    const totalXp = asNumber(data.totalXp ?? data.xp);
    const joins = asNumber(data.joins ?? data.loginCount);
    const gold = asNumber(data.gold);
    const playtime = asNumber(data.playtime);
    const bounty = asNumber(data.bounty);

    return NextResponse.json({
      ok: true,
      player: {
        mcUsername: data.name ?? ign,
        mcUuid: data.uuid ?? null,
        online: typeof data.online === "boolean" ? data.online : null,
        lastSave: typeof data.lastSave === "number" ? data.lastSave : null,
        lastLogout: typeof data.lastLogout === "number" ? data.lastLogout : null,
        level,
        prestige,
        levelLabel:
          prestige !== null && level !== null
            ? `[${toRoman(prestige)}-${level}]`
            : level !== null
              ? `[${level}]`
              : null,
        totalXp,
        joins,
        gold,
        playtimeSeconds: playtime,
        bounty,
        deltas7d: {
          totalXp: asNumber(data.xpDelta7d),
          gold: asNumber(data.goldDelta7d),
          joins: asNumber(data.joinsDelta7d),
        },
      },
      storage: {
        enderChest,
        inventory,
        stash,
      },
      source: "pitpanda_player",
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lookup failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

function toRoman(value: number): string {
  const n = Math.trunc(value);
  if (n <= 0) return "0";
  const table: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let remaining = n;
  let out = "";
  for (const [amount, glyph] of table) {
    while (remaining >= amount) {
      out += glyph;
      remaining -= amount;
    }
  }
  return out;
}
