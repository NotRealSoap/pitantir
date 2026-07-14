"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ItemDetail } from "@pitantir/db";
import {
  pantColorFromNonce,
  pantColorLabel,
  resolveMysticLives,
} from "@pitantir/shared/inventory";
import { MysticItemCard } from "../../../src/components/MysticItemCard";

function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function asNumberRecord(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  async function load(forcePitPandaSync = false) {
    setLoading(true);
    setError(null);
    try {
      const qs = forcePitPandaSync ? "?syncPitPanda=1" : "";
      const response = await fetch(`/api/items/${params.id}${qs}`);
      const payload = (await response.json()) as {
        item?: ItemDetail;
        error?: string;
        ownershipSync?: {
          attempted: boolean;
          eventsCreated: number;
          periodsCreated: number;
          message?: string;
        } | null;
      };
      if (!response.ok) {
        setError(payload.error ?? "Unable to load item.");
        setDetail(null);
        return;
      }
      setDetail(payload.item ?? null);
      if (payload.ownershipSync?.attempted) {
        if ((payload.ownershipSync.eventsCreated ?? 0) > 0) {
          setSyncNote(
            `Imported ${payload.ownershipSync.eventsCreated} PitPanda owner sighting(s) into local history.`,
          );
        } else if (payload.ownershipSync.message) {
          setSyncNote(payload.ownershipSync.message);
        } else {
          setSyncNote(null);
        }
      }
    } catch {
      setError("Unable to load item.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, [params.id]);

  if (loading) {
    return (
      <>
        <p>
          <Link href="/items">← Items</Link>
        </p>
        <p className="muted">Loading…</p>
      </>
    );
  }

  if (error || !detail) {
    return (
      <>
        <p>
          <Link href="/items">← Items</Link>
        </p>
        <p role="alert" className="alert">
          {error ?? "Not found"}
        </p>
      </>
    );
  }

  const { item, identifiers, periods, events, observations, currentLocation } = detail;
  const pant = pantColorFromNonce(item.primaryNonce);
  const latestObs = observations[0];
  const meta = (latestObs?.rawItem ?? {}) as Record<string, unknown>;
  const lore = Array.isArray(meta.lore) ? meta.lore.map(String) : null;
  const customEnchants = asNumberRecord(meta.customEnchants);
  const lives = resolveMysticLives(meta);
  const itemUuid =
    typeof meta.itemUuid === "string"
      ? meta.itemUuid
      : typeof meta.uuid === "string"
        ? meta.uuid
        : null;

  return (
    <>
      <p>
        <Link href="/items">← Items</Link>
      </p>
      <h1 className="page-title">{item.displayName ?? item.primaryNonce ?? item.id.slice(0, 8)}</h1>
      <p className="page-lede">
        {item.category} · confidence {item.identityConfidence} · status {item.status}
      </p>
      <div className="row-actions">
        <button type="button" onClick={() => void load(true)}>
          Refresh ownership from PitPanda
        </button>
      </div>
      {syncNote ? <p className="muted">{syncNote}</p> : null}

      <MysticItemCard
        title={item.displayName ?? item.primaryNonce}
        nonce={item.primaryNonce}
        itemUuid={itemUuid}
        lives={lives.lives}
        maxLives={lives.maxLives}
        lore={lore}
        customEnchants={customEnchants}
        kind={typeof meta.kind === "string" ? meta.kind : item.category}
        footer={
          <>
            Strict FP: <code style={{ wordBreak: "break-all" }}>{item.strictFingerprint ?? "—"}</code>
            {pant ? (
              <>
                {" · "}
                <span className={`chip pants-${pant}`}>{pantColorLabel(pant)}</span>
              </>
            ) : null}
          </>
        }
      />

      <h2 className="section-title">Current location</h2>
      {currentLocation ? (
        <p>
          On{" "}
          <Link href={`/accounts/${currentLocation.accountId}`}>
            {currentLocation.mcUsername ?? currentLocation.accountId}
          </Link>{" "}
          since {formatWhen(currentLocation.startedAt)} ({currentLocation.certainty})
        </p>
      ) : (
        <p className="muted">Unknown / no open confirmed presence period.</p>
      )}

      <h2 className="section-title">Identifiers</h2>
      {identifiers.length === 0 ? (
        <p className="muted">None</p>
      ) : (
        <ul className="mystic-list">
          {identifiers.map((id) => (
            <li key={id.id} className="meta-row">
              <span className="chip">
                {id.kind} <strong>{id.value}</strong>
              </span>
              {id.source ? <span className="muted">({id.source})</span> : null}
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-title">Ownership events</h2>
      {events.length === 0 ? (
        <p className="muted">No location events yet.</p>
      ) : (
        <ul className="mystic-list">
          {events.map((event) => {
            const danger =
              event.eventType === "contradiction" || event.certainty === "contradicted";
            const warn =
              event.eventType === "move_uncertain" || event.certainty === "uncertain";
            return (
              <li
                key={event.id}
                className={`event-card${danger ? " is-danger" : warn ? " is-warn" : ""}`}
              >
                <div>
                  <strong>{event.label}</strong>
                  {" · "}
                  {event.certainty}
                </div>
                <div className="muted">{formatWhen(event.eventTime)}</div>
                <div className="muted">
                  {event.fromAccountId || event.toAccountId ? (
                    <>
                      {event.fromAccountUsername ?? event.fromAccountId?.slice(0, 8) ?? "—"}
                      {" → "}
                      {event.toAccountUsername ?? event.toAccountId?.slice(0, 8) ?? "—"}
                    </>
                  ) : (
                    "—"
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="section-title">Location timeline</h2>
      {periods.length === 0 ? (
        <p className="muted">No periods yet.</p>
      ) : (
        <ul className="mystic-list">
          {periods.map((period) => (
            <li key={period.id} className="event-card">
              <div>
                {period.isUnknownGap ? (
                  <strong>Unknown gap</strong>
                ) : period.accountId ? (
                  <Link href={`/accounts/${period.accountId}`}>
                    {period.accountUsername ?? period.accountId.slice(0, 8)}
                  </Link>
                ) : (
                  "No account"
                )}
                {" · "}
                {period.certainty}
              </div>
              <div>
                {formatWhen(period.startedAt)} → {formatWhen(period.endedAt)}
              </div>
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                start: {period.startReason}
                {period.endReason ? ` · end: ${period.endReason}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-title">Observations</h2>
      {observations.length === 0 ? (
        <p className="muted">None linked.</p>
      ) : (
        <ul className="mystic-list">
          {observations.map((obs) => {
            const raw = (obs.rawItem ?? {}) as Record<string, unknown>;
            const obsLives = resolveMysticLives(raw);
            const obsLore = Array.isArray(raw.lore) ? raw.lore.map(String) : null;
            const obsEnchants = asNumberRecord(raw.customEnchants);
            const obsUuid =
              typeof raw.itemUuid === "string"
                ? raw.itemUuid
                : typeof raw.uuid === "string"
                  ? raw.uuid
                  : null;
            return (
              <li key={obs.id}>
                <MysticItemCard
                  title={
                    (typeof raw.title === "string" ? raw.title : null) ??
                    obs.normalizedMetadata.title ??
                    item.displayName ??
                    "Observation"
                  }
                  nonce={obs.observedNonce}
                  itemUuid={obsUuid}
                  lives={obsLives.lives}
                  maxLives={obsLives.maxLives}
                  lore={obsLore}
                  customEnchants={obsEnchants}
                  resolutionStatus={obs.resolutionStatus}
                  slotKey={obs.slotKey}
                  href={`/accounts/${obs.accountId}`}
                  footer={
                    <>
                      {formatWhen(obs.observedAt)} · scan {obs.scanId}
                    </>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
