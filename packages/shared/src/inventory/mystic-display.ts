/**
 * Pit mystic display helpers (PitPal / PitBear-inspired).
 * Safe for Next.js — no NBT dependencies.
 */

/** PitPal: nonce % 5 → pants color needed for T3. */
export const PANT_COLORS = ["red", "yellow", "blue", "orange", "green"] as const;
export type PantColor = (typeof PANT_COLORS)[number];

export function pantColorFromNonce(nonce: string | number | null | undefined): PantColor | null {
  if (nonce === null || nonce === undefined || nonce === "") return null;
  const n = typeof nonce === "number" ? nonce : Number(String(nonce).trim());
  if (!Number.isFinite(n)) return null;
  return PANT_COLORS[((Math.trunc(n) % 5) + 5) % 5]!;
}

export function pantColorLabel(color: PantColor): string {
  return `${color[0]!.toUpperCase()}${color.slice(1)} pants`;
}

/** Humanize CustomEnchants keys into Pit-style names. */
const ENCHANT_ALIASES: Record<string, string> = {
  billionaire: "Billionaire",
  lifesteal: "Lifesteal",
  executioner: "Executioner",
  gamble: "Gamble",
  shark: "Shark",
  moctezuma: "Moctezuma",
  gold_boost: "Gold Boost",
  goldboost: "Gold Boost",
  diamond_stomp: "Diamond Stomp",
  diamondstomp: "Diamond Stomp",
  pain_focus: "Pain Focus",
  painfocus: "Pain Focus",
  beat_the_spammers: "Beat the Spammers",
  beatthespammers: "Beat the Spammers",
  combo_stun: "Combo: Stun",
  combostun: "Combo: Stun",
  combo_heal: "Combo: Heal",
  comboheal: "Combo: Heal",
  combo_damage: "Combo: Damage",
  combodamage: "Combo: Damage",
  combo_swift: "Combo: Swift",
  comboswift: "Combo: Swift",
  combo_perun: "Combo: Perun's Wrath",
  comboperun: "Combo: Perun's Wrath",
  perun: "Combo: Perun's Wrath",
  peruns_wrath: "Combo: Perun's Wrath",
  fancy_raider: "Fancy Raider",
  fancyraider: "Fancy Raider",
  king_buster: "King Buster",
  kingbuster: "King Buster",
  bullet_time: "Bullet Time",
  bullettime: "Bullet Time",
  sweaty: "Sweaty",
  crush: "Crush",
  sharp: "Sharp",
  hemorrhage: "Hemorrhage",
  sierra: "Sierra",
  revengeance: "Revengeance",
  pitpocket: "Pitpocket",
  gold_bump: "Gold Bump",
  goldbump: "Gold Bump",
  duelist: "Duelist",
  bruiser: "Bruiser",
  healer: "Healer",
  guts: "Guts",
  berserker: "Berserker",
  speedy_kill: "Speedy Kill",
  speedykill: "Speedy Kill",
  pants_radar: "Pants Radar",
  pantsradar: "Pants Radar",
  the_punch: "The Punch",
  thepunch: "The Punch",
  xp_boost: "XP Boost",
  xpboost: "XP Boost",
  gold_and_boosted: "Gold and Boosted",
};

export function humanizeEnchantKey(key: string): string {
  const normalized = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (ENCHANT_ALIASES[normalized]) return ENCHANT_ALIASES[normalized]!;
  if (ENCHANT_ALIASES[normalized.replace(/_/g, "")]) {
    return ENCHANT_ALIASES[normalized.replace(/_/g, "")]!;
  }
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatEnchantList(
  customEnchants: Record<string, number> | null | undefined,
): string[] {
  if (!customEnchants) return [];
  return Object.entries(customEnchants)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, level]) => `${humanizeEnchantKey(key)} ${level}`);
}

/** Prefer lore enchant lines when they look like "Name N"; else CustomEnchants. */
export function mysticEnchantLines(input: {
  lore?: string[] | null;
  customEnchants?: Record<string, number> | null;
}): string[] {
  const fromLore = (input.lore ?? [])
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || /^lives\b/i.test(line)) return false;
      if (/^nonce\b/i.test(line)) return false;
      // Typical Pit enchant lore ends with a level digit
      return /\s[1-3]$/.test(line) || /\bgemmed\b/i.test(line);
    });
  if (fromLore.length > 0) return fromLore;
  return formatEnchantList(input.customEnchants);
}

export function parseLivesFromLore(lore: string[] | null | undefined): {
  lives: number | null;
  maxLives: number | null;
} {
  for (const line of lore ?? []) {
    const match = line.match(/lives\s*[:=]?\s*(\d+)\s*\/\s*(\d+)/i);
    if (match) {
      return { lives: Number(match[1]), maxLives: Number(match[2]) };
    }
  }
  return { lives: null, maxLives: null };
}

export function coerceLives(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return null;
}

export function resolveMysticLives(rawItem: Record<string, unknown>): {
  lives: number | null;
  maxLives: number | null;
} {
  const extra =
    rawItem.hypixelExtraAttributes &&
    typeof rawItem.hypixelExtraAttributes === "object" &&
    !Array.isArray(rawItem.hypixelExtraAttributes)
      ? (rawItem.hypixelExtraAttributes as Record<string, unknown>)
      : {};

  const lives =
    coerceLives(rawItem.lives) ??
    coerceLives(extra.Lives) ??
    coerceLives(extra.lives);
  const maxLives =
    coerceLives(rawItem.maxLives) ??
    coerceLives(extra.MaxLives) ??
    coerceLives(extra.maxLives);

  if (lives !== null || maxLives !== null) {
    return { lives, maxLives };
  }

  const lore = Array.isArray(rawItem.lore) ? rawItem.lore.map(String) : null;
  return parseLivesFromLore(lore);
}

export function parseMysticTier(title: string | null | undefined): number | null {
  if (!title) return null;
  const match = title.match(/tier\s*(iii|ii|i|3|2|1)/i);
  if (!match) return null;
  const token = match[1]!.toLowerCase();
  if (token === "iii" || token === "3") return 3;
  if (token === "ii" || token === "2") return 2;
  return 1;
}

export function isGemmed(input: {
  lore?: string[] | null;
  customEnchants?: Record<string, number> | null;
  hypixelExtraAttributes?: Record<string, unknown> | null;
}): boolean {
  if ((input.lore ?? []).some((line) => /\bgemmed\b/i.test(line))) return true;
  const extra = input.hypixelExtraAttributes ?? {};
  if (extra.UpgradeTier !== undefined || extra.UpgradeGemsUses !== undefined) return true;
  return false;
}

/** PitBear-style one-liner: "11/18 Lifesteal 3 Gamble 2 Combo: Heal 3 Gemmed" */
export function formatPitBearLine(input: {
  lives?: number | null;
  maxLives?: number | null;
  lore?: string[] | null;
  customEnchants?: Record<string, number> | null;
  gemmed?: boolean;
}): string {
  const enchants = mysticEnchantLines(input);
  const gemmed = input.gemmed || enchants.some((line) => /\bgemmed\b/i.test(line));
  const enchantPart = enchants.filter((line) => !/\bgemmed\b/i.test(line)).join(" ");
  const livesPart =
    input.lives !== null &&
    input.lives !== undefined &&
    input.maxLives !== null &&
    input.maxLives !== undefined
      ? `${input.lives}/${input.maxLives}`
      : input.maxLives !== null && input.maxLives !== undefined
        ? `?/${input.maxLives}`
        : null;
  return [livesPart, enchantPart, gemmed ? "Gemmed" : null].filter(Boolean).join(" ");
}
