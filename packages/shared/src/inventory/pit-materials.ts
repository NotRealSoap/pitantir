/**
 * Pit trade materials that change by stack quantity (not mystic nonce).
 * Textures map to vanilla Minecraft items used as Pit currencies/tools.
 */

export type PitMaterialKey = "vile" | "gem" | "feather" | "shears";

export type PitMaterialDef = {
  key: PitMaterialKey;
  /** Canonical display name for Discord / UI. */
  title: string;
  /** Vanilla / numeric item ids (Hypixel often uses legacy shorts). */
  ids: string[];
  /** Optional display-name needles (case-insensitive). */
  nameNeedles: string[];
};

export const PIT_TRACKED_MATERIALS: PitMaterialDef[] = [
  {
    key: "vile",
    title: "Chunk of Vile",
    ids: ["263", "minecraft:coal", "coal"],
    nameNeedles: ["chunk of vile", "vile"],
  },
  {
    key: "gem",
    title: "Totally Legit Gem",
    ids: ["388", "minecraft:emerald", "emerald"],
    nameNeedles: ["totally legit", "legit gem"],
  },
  {
    key: "feather",
    title: "Funky Feather",
    ids: ["288", "minecraft:feather", "feather"],
    nameNeedles: ["funky feather"],
  },
  {
    key: "shears",
    title: "Mystic Repair Kit",
    ids: ["359", "minecraft:shears", "shears"],
    nameNeedles: ["repair kit", "mystic repair"],
  },
];

const ID_TO_KEY = new Map<string, PitMaterialKey>();
for (const def of PIT_TRACKED_MATERIALS) {
  for (const id of def.ids) {
    ID_TO_KEY.set(id.toLowerCase(), def.key);
  }
}

export function pitMaterialDef(key: PitMaterialKey): PitMaterialDef {
  return PIT_TRACKED_MATERIALS.find((row) => row.key === key)!;
}

function stripMcFormatting(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/§./g, "").trim() || null;
}

/**
 * Resolve a Pit trade-material key from item id and/or display title.
 * Prefer id match; fall back to title needles for renamed/custom lore items.
 */
export function resolvePitMaterialKey(input: {
  id?: string | null;
  title?: string | null;
}): PitMaterialKey | null {
  const id = (input.id ?? "").trim().toLowerCase();
  if (id && ID_TO_KEY.has(id)) return ID_TO_KEY.get(id)!;

  const title = stripMcFormatting(input.title)?.toLowerCase() ?? "";
  if (!title) return null;
  for (const def of PIT_TRACKED_MATERIALS) {
    if (def.nameNeedles.some((needle) => title.includes(needle))) {
      return def.key;
    }
  }
  return null;
}
