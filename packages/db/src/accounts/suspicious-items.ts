import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";

export const SUSPICIOUS_ITEMS_SETTINGS_KEY = "pitantir_suspicious_items";

export type SuspiciousNumeralStyle = "arabic" | "roman";

export type SuspiciousItem = {
  /** Pitantir-specific tracking id (not nonce). */
  id: string;
  nonce: string;
  title: string | null;
  numeralStyle: SuspiciousNumeralStyle;
  /** Display numeral: "1"/"2" or "I"/"II". */
  numeral: string;
  reason: string;
  markedAt: string;
  /** Optional operator notes / manual authority. */
  notes: string | null;
  /** Manual ownership nodes (absolute authority when present). */
  manualNodes: Array<{
    id: string;
    mcUsername: string;
    at: string;
    note: string | null;
  }>;
};

export type SuspiciousItemsState = {
  items: SuspiciousItem[];
};

const EMPTY: SuspiciousItemsState = { items: [] };

const ARABIC = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function nextNumeral(style: SuspiciousNumeralStyle, used: Set<string>): string {
  const pool = style === "roman" ? ROMAN : ARABIC;
  for (const value of pool) {
    if (!used.has(value)) return value;
  }
  return style === "roman" ? `N${used.size + 1}` : String(used.size + 1);
}

function normalizeState(value: unknown): SuspiciousItemsState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { items: [] };
  const row = value as Record<string, unknown>;
  const raw = Array.isArray(row.items) ? row.items : [];
  const items: SuspiciousItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const nonce = typeof item.nonce === "string" ? item.nonce.trim() : "";
    const id = typeof item.id === "string" ? item.id : "";
    if (!nonce || !id) continue;
    const numeralStyle: SuspiciousNumeralStyle =
      item.numeralStyle === "roman" ? "roman" : "arabic";
    items.push({
      id,
      nonce,
      title: typeof item.title === "string" ? item.title : null,
      numeralStyle,
      numeral: typeof item.numeral === "string" ? item.numeral : "?",
      reason: typeof item.reason === "string" ? item.reason : "6/17/26 Dupe",
      markedAt: typeof item.markedAt === "string" ? item.markedAt : now().toISOString(),
      notes: typeof item.notes === "string" ? item.notes : null,
      manualNodes: Array.isArray(item.manualNodes)
        ? item.manualNodes
            .filter((node): node is Record<string, unknown> => Boolean(node) && typeof node === "object")
            .map((node) => ({
              id: typeof node.id === "string" ? node.id : randomUUID(),
              mcUsername: typeof node.mcUsername === "string" ? node.mcUsername : "unknown",
              at: typeof node.at === "string" ? node.at : now().toISOString(),
              note: typeof node.note === "string" ? node.note : null,
            }))
        : [],
    });
  }
  return { items };
}

async function readState(db: Database): Promise<SuspiciousItemsState> {
  const rows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, SUSPICIOUS_ITEMS_SETTINGS_KEY))
    .limit(1);
  return normalizeState(rows[0]?.value);
}

async function writeState(db: Database, state: SuspiciousItemsState): Promise<void> {
  const updatedAt = now();
  await db
    .insert(adminSettings)
    .values({
      key: SUSPICIOUS_ITEMS_SETTINGS_KEY,
      value: state,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: adminSettings.key,
      set: { value: state, updatedAt },
    });
}

export async function listSuspiciousItems(db: Database): Promise<SuspiciousItem[]> {
  return (await readState(db)).items;
}

export async function markSuspiciousItem(
  db: Database,
  input: {
    nonce: string;
    title?: string | null;
    numeralStyle: SuspiciousNumeralStyle;
    reason?: string;
  },
): Promise<SuspiciousItem> {
  const nonce = input.nonce.trim();
  if (!nonce) throw new Error("nonce is required");
  const state = await readState(db);
  const existing = state.items.find(
    (item) => item.nonce === nonce && item.numeralStyle === input.numeralStyle,
  );
  if (existing) return existing;

  const used = new Set(
    state.items.filter((item) => item.numeralStyle === input.numeralStyle).map((item) => item.numeral),
  );
  const item: SuspiciousItem = {
    id: randomUUID(),
    nonce,
    title: input.title ?? null,
    numeralStyle: input.numeralStyle,
    numeral: nextNumeral(input.numeralStyle, used),
    reason: input.reason ?? "6/17/26 Dupe",
    markedAt: now().toISOString(),
    notes: null,
    manualNodes: [],
  };
  state.items.unshift(item);
  await writeState(db, state);
  return item;
}

export async function unmarkSuspiciousItem(db: Database, id: string): Promise<boolean> {
  const state = await readState(db);
  const next = state.items.filter((item) => item.id !== id);
  if (next.length === state.items.length) return false;
  await writeState(db, { items: next });
  return true;
}

export async function addSuspiciousManualNode(
  db: Database,
  input: { itemId: string; mcUsername: string; at?: string; note?: string | null },
): Promise<SuspiciousItem | null> {
  const state = await readState(db);
  const item = state.items.find((row) => row.id === input.itemId);
  if (!item) return null;
  item.manualNodes.push({
    id: randomUUID(),
    mcUsername: input.mcUsername.trim(),
    at: input.at ?? now().toISOString(),
    note: input.note ?? null,
  });
  item.manualNodes.sort((a, b) => b.at.localeCompare(a.at));
  await writeState(db, state);
  return item;
}

export async function removeSuspiciousManualNode(
  db: Database,
  input: { itemId: string; nodeId: string },
): Promise<SuspiciousItem | null> {
  const state = await readState(db);
  const item = state.items.find((row) => row.id === input.itemId);
  if (!item) return null;
  item.manualNodes = item.manualNodes.filter((node) => node.id !== input.nodeId);
  await writeState(db, state);
  return item;
}
