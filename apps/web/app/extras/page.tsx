"use client";

import { DiscordWebhookPanel } from "../../src/components/DiscordWebhookPanel";
import { DownwatchPanel } from "../../src/components/DownwatchPanel";

/**
 * Pitantir 2.0 Extras — Downwatch + Discord webhooks stay behaviorally unchanged.
 * API keys remain on legacy /settings for now.
 */
export default function ExtrasPage() {
  return (
    <>
      <h1 className="page-title">Extras</h1>
      <p className="page-lede">
        Operator utilities that stay constant in Pitantir 2.0: Downwatch membership and Discord
        webhook setup. Behavior matches the previous Settings panels.
      </p>

      <DownwatchPanel />
      <DiscordWebhookPanel />

      <section className="panel" style={{ marginTop: "1.5rem" }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          API keys &amp; legacy screens
        </h2>
        <p className="muted">
          Hypixel / PitPanda keys and PitPal bridge still live on{" "}
          <a href="/settings">Settings</a>. Watchlist editing remains on{" "}
          <a href="/accounts">Accounts</a> until it is folded into API/Extras.
        </p>
      </section>
    </>
  );
}
