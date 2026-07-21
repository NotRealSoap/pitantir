import {
  pitPandaItemSearch,
  buildPitPandaSearchQuery,
} from "@pitantir/shared/item-data";
import { PITPANDA_LASTSEEN_FRESH_MS } from "./presence.js";

export type PitpandaPresenceHint = {
  ok: boolean;
  hintOnline: boolean;
  lastSeenAt: string | null;
  nonce: string | null;
  detail: string | null;
};

function readLastSeen(item: Record<string, unknown>): string | null {
  const raw =
    item.lastseen ??
    item.lastSeen ??
    item.lastseenOffline ??
    item.lastSeenOffline ??
    null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    // PitPanda often uses seconds; treat small values as seconds.
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    const at = Date.parse(raw);
    if (Number.isFinite(at)) return new Date(at).toISOString();
  }
  return null;
}

/**
 * Weak online hint: search a known mystic nonce on PitPanda and check lastseen freshness.
 * Never sole truth — API-off accounts can lag badly.
 */
export async function probePitpandaNoncePresence(input: {
  apiKey: string;
  nonce: string;
  nowMs?: number;
  freshMs?: number;
}): Promise<PitpandaPresenceHint> {
  const nonce = input.nonce.trim();
  if (!nonce) {
    return { ok: false, hintOnline: false, lastSeenAt: null, nonce: null, detail: "missing nonce" };
  }
  try {
    const query = buildPitPandaSearchQuery({ kind: "exact_nonce", value: nonce });
    const result = await pitPandaItemSearch({ apiKey: input.apiKey }, query, 0);
    const first = result.items[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) {
      return {
        ok: true,
        hintOnline: false,
        lastSeenAt: null,
        nonce,
        detail: "nonce not found on PitPanda",
      };
    }
    const lastSeenAt = readLastSeen(first as Record<string, unknown>);
    if (!lastSeenAt) {
      return {
        ok: true,
        hintOnline: false,
        lastSeenAt: null,
        nonce,
        detail: "no lastseen on item",
      };
    }
    const freshMs = input.freshMs ?? PITPANDA_LASTSEEN_FRESH_MS;
    const nowMs = input.nowMs ?? Date.now();
    const age = nowMs - Date.parse(lastSeenAt);
    const hintOnline = Number.isFinite(age) && age >= 0 && age <= freshMs;
    return {
      ok: true,
      hintOnline,
      lastSeenAt,
      nonce,
      detail: hintOnline ? "PitPanda lastseen fresh" : "PitPanda lastseen stale",
    };
  } catch (error) {
    return {
      ok: false,
      hintOnline: false,
      lastSeenAt: null,
      nonce,
      detail: error instanceof Error ? error.message : "PitPanda probe failed",
    };
  }
}
