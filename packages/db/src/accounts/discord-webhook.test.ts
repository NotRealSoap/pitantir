import { describe, expect, it } from "vitest";
import {
  buildDiscordWebhookPayload,
  buildOnlineDashboardPayload,
  DISCORD_PITPAL_STATUS_WEBHOOK_KEY,
  expandDiscordNotifyEvents,
  isDiscordWebhookUrl,
  maskDiscordWebhookUrl,
  normalizeDiscordWebhookSettings,
  resolvePlayerFlags,
  rosterKeyFor,
  webhookUrlForEvent,
} from "./discord-webhook.js";

describe("isDiscordWebhookUrl", () => {
  it("accepts discord webhook URLs", () => {
    expect(
      isDiscordWebhookUrl(
        "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEF",
      ),
    ).toBe(true);
  });

  it("accepts tokens with dots", () => {
    expect(
      isDiscordWebhookUrl(
        "https://discord.com/api/webhooks/1529239917258080296/abc.def-ghi_jkl",
      ),
    ).toBe(true);
  });

  it("rejects non-discord URLs", () => {
    expect(isDiscordWebhookUrl("https://example.com/hooks/1")).toBe(false);
  });
});

describe("pitpal side storage key", () => {
  it("uses a dedicated admin_settings key", () => {
    expect(DISCORD_PITPAL_STATUS_WEBHOOK_KEY).toBe("discord_pitpal_status_webhook_url");
  });
});

describe("maskDiscordWebhookUrl", () => {
  it("masks the token", () => {
    const masked = maskDiscordWebhookUrl(
      "https://discord.com/api/webhooks/123/abcdefghijklmnop",
    );
    expect(masked).toContain("abcd…mnop");
  });
});

describe("normalizeDiscordWebhookSettings", () => {
  it("migrates legacy webhookUrl into presence and splits inventory flags", () => {
    const settings = normalizeDiscordWebhookSettings({
      webhookUrl: "https://discord.com/api/webhooks/1/abcdefghijklmnopqrstuv",
      notifyInventoryChanged: true,
    });
    expect(settings.presenceWebhookUrl).toContain("/webhooks/1/");
    expect(settings.notifyItemGainedLost).toBe(true);
    expect(settings.notifyInventoryUpdated).toBe(true);
    expect(settings.playerRules).toEqual([]);
  });

  it("defaults item updates off and gained/lost on", () => {
    const settings = normalizeDiscordWebhookSettings({});
    expect(settings.notifyItemGainedLost).toBe(true);
    expect(settings.notifyInventoryUpdated).toBe(false);
    expect(settings.notifyEveryOnlineScan).toBe(true);
    expect(settings.notifyPitpalStatusChanges).toBe(true);
    expect(settings.pitpalStatusWebhookUrl).toBeNull();
  });

  it("repairs legacy player rules that stored notifyPitpalStatusChanges as false", () => {
    const settings = normalizeDiscordWebhookSettings({
      notifyPitpalStatusChanges: true,
      playerRules: [
        {
          accountId: "a1",
          mcUsername: "Alice",
          notifyCameOnline: true,
          notifyWentOffline: false,
          notifyEveryOnlineScan: true,
          notifyItemGainedLost: true,
          notifyInventoryUpdated: false,
          notifyPitpalStatusChanges: false,
        },
        {
          accountId: "a2",
          mcUsername: "Bob",
          notifyCameOnline: true,
          notifyWentOffline: false,
          notifyEveryOnlineScan: true,
          notifyItemGainedLost: true,
          notifyInventoryUpdated: false,
          notifyPitpalStatusChanges: false,
        },
      ],
    });
    expect(settings.playerRules.every((rule) => rule.notifyPitpalStatusChanges)).toBe(true);
  });

  it("defaults missing notifyPitpalStatusChanges on a rule to true", () => {
    const settings = normalizeDiscordWebhookSettings({
      playerRules: [
        {
          accountId: "a1",
          mcUsername: "Alice",
          notifyCameOnline: true,
          notifyWentOffline: false,
          notifyEveryOnlineScan: true,
          notifyItemGainedLost: true,
          notifyInventoryUpdated: false,
        },
      ],
    });
    expect(settings.playerRules[0]?.notifyPitpalStatusChanges).toBe(true);
  });
});

describe("channel routing + player rules", () => {
  const base = normalizeDiscordWebhookSettings({
    presenceWebhookUrl: "https://discord.com/api/webhooks/1/abcdefghijklmnopqrstuv",
    inventoryWebhookUrl: "https://discord.com/api/webhooks/2/abcdefghijklmnopqrstuv",
    itemMovesWebhookUrl: "https://discord.com/api/webhooks/3/abcdefghijklmnopqrstuv",
    pitpalStatusWebhookUrl: "https://discord.com/api/webhooks/4/abcdefghijklmnopqrstuv",
    notifyItemGainedLost: true,
    notifyInventoryUpdated: true,
    notifyEveryOnlineScan: true,
    playerRules: [
      {
        accountId: "acc-whytf",
        mcUsername: "whytf",
        notifyCameOnline: true,
        notifyWentOffline: false,
        notifyEveryOnlineScan: true,
        notifyItemGainedLost: true,
        notifyInventoryUpdated: false,
        notifyPitpalStatusChanges: true,
      },
    ],
  });

  it("routes kinds to the right webhook", () => {
    expect(webhookUrlForEvent(base, "online_indexed")).toContain("/webhooks/1/");
    expect(webhookUrlForEvent(base, "inventory_updated")).toContain("/webhooks/2/");
    expect(webhookUrlForEvent(base, "item_moved")).toContain("/webhooks/3/");
    expect(webhookUrlForEvent(base, "pitpal_location")).toContain("/webhooks/4/");
  });

  it("never falls PitPal events back to the presence webhook", () => {
    const withoutPitpal = normalizeDiscordWebhookSettings({
      presenceWebhookUrl: "https://discord.com/api/webhooks/1/abcdefghijklmnopqrstuv",
    });
    expect(webhookUrlForEvent(withoutPitpal, "pitpal_entered")).toBeNull();
    expect(webhookUrlForEvent(withoutPitpal, "pitpal_left")).toBeNull();
    expect(webhookUrlForEvent(withoutPitpal, "came_online")).toContain("/webhooks/1/");
  });

  it("resolves per-player overrides", () => {
    expect(resolvePlayerFlags(base, "acc-whytf").notifyInventoryUpdated).toBe(false);
    expect(resolvePlayerFlags(base, "acc-whytf").notifyItemGainedLost).toBe(true);
    expect(resolvePlayerFlags(base, "someone-else").notifyInventoryUpdated).toBe(true);
  });
});

describe("expandDiscordNotifyEvents", () => {
  it("splits gained/lost from updates", () => {
    const expanded = expandDiscordNotifyEvents([
      {
        kind: "inventory_changed",
        accountId: "a1",
        mcUsername: "Crazy",
        changes: [
          {
            direction: "gained",
            nonce: "1",
            title: "Sword",
            summary: null,
            slotKey: "inv:0",
          },
          {
            direction: "updated",
            nonce: "2",
            title: "Pants",
            summary: "10/18",
            slotKey: "inv:1",
            previousSummary: "11/18",
          },
        ],
      },
    ]);
    expect(expanded.map((row) => row.kind)).toEqual(["item_moved", "inventory_updated"]);
    expect(expanded[0]?.changes).toHaveLength(1);
    expect(expanded[1]?.changes).toHaveLength(1);
  });
});

describe("buildDiscordWebhookPayload", () => {
  it("formats still-online index pings", () => {
    const payload = buildDiscordWebhookPayload({
      kind: "online_indexed",
      mcUsername: "Crazy",
      detail: "PIT/pit",
    });
    expect(payload.content).toBe("Crazy still online · PIT/pit");
  });
});

describe("online dashboard", () => {
  it("builds a roster list and stable key", () => {
    const entries = [
      { mcUsername: "Bob", sessionGame: "BEDWARS" },
      { mcUsername: "Amy", sessionGame: null },
    ];
    const payload = buildOnlineDashboardPayload(entries, "2026-07-21T12:00:00.000Z");
    expect(payload.content).toContain("Online now (2)");
    expect(rosterKeyFor(entries)).toBe(rosterKeyFor([...entries].reverse()));
  });
});
