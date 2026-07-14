import type { ReactNode } from "react";
import Link from "next/link";
import {
  formatPitBearLine,
  isGemmed,
  mysticEnchantLines,
  pantColorFromNonce,
  pantColorLabel,
  parseMysticTier,
  type PantColor,
} from "@pitantir/shared/inventory";

export interface MysticCardProps {
  title?: string | null;
  nonce?: string | null;
  itemUuid?: string | null;
  lives?: number | null;
  maxLives?: number | null;
  lore?: string[] | null;
  customEnchants?: Record<string, number> | null;
  kind?: string | null;
  resolutionStatus?: string | null;
  slotKey?: string | null;
  href?: string | null;
  footer?: ReactNode;
}

function TierDots({ tier }: { tier: number | null }) {
  if (tier === null || tier <= 0) {
    return (
      <span className="tier-dots" title="Fresh / unknown tier" aria-label="Fresh mystic">
        <span className="tier-dot fresh" />
      </span>
    );
  }
  return (
    <span className="tier-dots" title={`Tier ${tier}`} aria-label={`Tier ${tier}`}>
      {Array.from({ length: Math.min(tier, 3) }, (_, index) => (
        <span key={index} className={`tier-dot t${Math.min(tier, 3)}`} />
      ))}
    </span>
  );
}

function PantsChip({ color }: { color: PantColor }) {
  return (
    <span className={`chip pants-${color}`} title="PitPal T3 pants color from nonce % 5">
      {pantColorLabel(color)}
    </span>
  );
}

export function MysticItemCard(props: MysticCardProps) {
  const tier = parseMysticTier(props.title);
  const pant = pantColorFromNonce(props.nonce);
  const enchants = mysticEnchantLines({
    lore: props.lore,
    customEnchants: props.customEnchants,
  });
  const gemmed = isGemmed({
    lore: props.lore,
    customEnchants: props.customEnchants,
  });
  const line = formatPitBearLine({
    lives: props.lives,
    maxLives: props.maxLives,
    lore: props.lore,
    customEnchants: props.customEnchants,
    gemmed,
  });
  const enchantText = enchants.filter((e) => !/\bgemmed\b/i.test(e)).join(" ");

  const titleNode = props.href ? (
    <Link href={props.href} className="mystic-title">
      {props.title ?? "Mystic item"}
    </Link>
  ) : (
    <span className="mystic-title">{props.title ?? "Mystic item"}</span>
  );

  return (
    <article className="mystic-card">
      <div className="mystic-card-top">
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
          <TierDots tier={tier} />
          {titleNode}
          {props.kind ? <span className="chip">{props.kind}</span> : null}
        </div>
        <div className="meta-row">
          {pant ? <PantsChip color={pant} /> : null}
          {props.resolutionStatus ? <span className="chip">{props.resolutionStatus}</span> : null}
        </div>
      </div>

      <div className="pitbear-line">
        {props.lives != null && props.maxLives != null ? (
          <span className="lives">
            {props.lives}/{props.maxLives}
          </span>
        ) : null}
        {enchantText}
        {gemmed ? <span className="gemmed"> Gemmed</span> : null}
        {!line ? <span className="muted">No enchant summary</span> : null}
      </div>

      <div className="meta-row">
        <span className="chip">
          Nonce <strong>{props.nonce ?? "—"}</strong>
        </span>
        <span className="chip">
          UUID <strong>{props.itemUuid ? props.itemUuid.slice(0, 8) : "—"}</strong>
        </span>
        {props.slotKey ? <span className="chip">{props.slotKey}</span> : null}
      </div>

      {props.footer ? <div className="muted">{props.footer}</div> : null}
    </article>
  );
}
