"use client";

import type { CSSProperties } from "react";
import { normalizeItemMeta, resolveLegacyItemId } from "@pitantir/shared/inventory";

const LEATHER_COLOR_METAS = new Set([
  "FFAA00",
  "55FF55",
  "5555FF",
  "FFFF55",
  "FF5555",
  "55FFFF",
  "7DC383",
  "000000",
]);

export type MinecraftItemIconProps = {
  id?: string | number | null;
  title?: string | null;
  meta?: string | number | null;
  count?: number;
  className?: string;
  style?: CSSProperties;
};

/**
 * PitPanda/PitPal-style item sprite (legacy numeric id → blocks_items.png).
 */
export function MinecraftItemIcon(props: MinecraftItemIconProps) {
  const numericId = resolveLegacyItemId({ id: props.id ?? null, title: props.title ?? null });
  const meta = normalizeItemMeta(props.meta);
  const count = props.count ?? 1;
  const style: CSSProperties = { ...(props.style ?? {}) };

  const isLeather = numericId >= 298 && numericId <= 301;
  const metaKey = typeof meta === "string" ? meta : String(meta);
  const leatherTint =
    isLeather && !(numericId === 300 && LEATHER_COLOR_METAS.has(metaKey)) && /^[0-9A-F]{6}$/i.test(metaKey);

  if (leatherTint) {
    style.backgroundColor = `#${metaKey}`;
  }

  const classes = [
    "item_",
    `item_${numericId}`,
    leatherTint ? "" : `item_${numericId}_${metaKey}`,
    count === 0 ? "grey" : "",
    props.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} style={style} aria-hidden={true}>
      {count > 1 ? <span className="mc-item-count">{count}</span> : null}
    </span>
  );
}
