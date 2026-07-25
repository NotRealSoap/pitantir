import { describe, expect, it } from "vitest";
import {
  buildDiscordWebhookPayload,
  buildOnlineDashboardPayload,
  buildPitpalMonitorDashboardPayload,
  DISCORD_PITPAL_STATUS_WEBHOOK_KEY,
  expandDiscordNotifyEvents,
  formatLobbyMatesBlock,
  isDiscordWebhookUrl,
  isForcedDiscordDashboardOnlyUsername,
  maskDiscordWebhookUrl,
  normalizeDiscordWebhookSettings,
  resolveNotifyFlagsForEvent,
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
    expect(settings.non140erDashboardWebhookUrl).toBeNull();
    expect(settings.monitorWebhookUrl).toBeNull();
  });

  it("reads non-140er dashboard webhook settings", () => {
    const settings = normalizeDiscordWebhookSettings({
      non140erDashboardWebhookUrl:
        "https://discord.com/api/webhooks/9/abcdefghijklmnopqrstuv",
      non140erDashboardMessageId: "msg-1",
      non140erDashboardRosterKey: "Amy\t\t\t\t",
    });
    expect(settings.non140erDashboardWebhookUrl).toContain("/webhooks/9/");
    expect(settings.non140erDashboardMessageId).toBe("msg-1");
    expect(settings.non140erDashboardRosterKey).toBe("Amy\t\t\t\t");
  });

  it("reads downwatch dashboard webhook settings", () => {
    const settings = normalizeDiscordWebhookSettings({
      downwatchDashboardWebhookUrl:
        "https://discord.com/api/webhooks/8/abcdefghijklmnopqrstuv",
      downwatchDashboardMessageId: "msg-dw",
      downwatchDashboardRosterKey: "Steve\t\t\t\t",
    });
    expect(settings.downwatchDashboardWebhookUrl).toContain("/webhooks/8/");
    expect(settings.downwatchDashboardMessageId).toBe("msg-dw");
    expect(settings.downwatchDashboardRosterKey).toBe("Steve\t\t\t\t");
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

  it("mutes online/offline alerts on 140er dashboard-only player rules", () => {
    const settings = normalizeDiscordWebhookSettings({
      notifyPitpalStatusChanges: true,
      playerRules: [
        {
          accountId: "acc-140",
          mcUsername: "Fourteen",
          notifyCameOnline: true,
          notifyWentOffline: true,
          notifyEveryOnlineScan: true,
          notifyItemGainedLost: false,
          notifyInventoryUpdated: false,
          notifyPitpalStatusChanges: false,
        },
      ],
    });
    expect(settings.playerRules[0]?.notifyCameOnline).toBe(false);
    expect(settings.playerRules[0]?.notifyWentOffline).toBe(false);
    expect(settings.playerRules[0]?.notifyEveryOnlineScan).toBe(false);
    expect(settings.playerRules[0]?.notifyPitpalStatusChanges).toBe(false);
  });

  it("force-mutes configured dashboard-only usernames", () => {
    expect(isForcedDiscordDashboardOnlyUsername("zain12219")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("BuMingXiaLuo")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("SIS")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("L3nnY2B4k3D")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("TuffTuffTuffTuff")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("mhm")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("inoriginal2")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("Crazy")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("whytf")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("volleydrain")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("Kadeacon")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("YMXCE")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("CURLSFORGIRLSS")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("DynamicStopper04")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("HarryPotterJr")).toBe(true);
    expect(isForcedDiscordDashboardOnlyUsername("someoneelse")).toBe(false);
    const flags = resolveNotifyFlagsForEvent(
      normalizeDiscordWebhookSettings({
        notifyCameOnline: true,
        notifyEveryOnlineScan: true,
        notifyPitpalStatusChanges: true,
      }),
      { accountId: "x", mcUsername: "Kadeacon" },
    );
    expect(flags.notifyCameOnline).toBe(false);
    expect(flags.notifyEveryOnlineScan).toBe(false);
    expect(flags.notifyPitpalStatusChanges).toBe(false);
  });

  it("does not flip 140er pitpal mute when repairing legacy all-false pitpal flags", () => {
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
          mcUsername: "Fourteen",
          notifyCameOnline: true,
          notifyWentOffline: true,
          notifyEveryOnlineScan: true,
          notifyItemGainedLost: false,
          notifyInventoryUpdated: false,
          notifyPitpalStatusChanges: false,
        },
      ],
    });
    expect(settings.playerRules[0]?.notifyPitpalStatusChanges).toBe(true);
    expect(settings.playerRules[1]?.notifyPitpalStatusChanges).toBe(false);
    expect(settings.playerRules[1]?.notifyCameOnline).toBe(false);
    expect(settings.playerRules[1]?.notifyEveryOnlineScan).toBe(false);
  });
});

describe("channel routing + player rules", () => {
  const base = normalizeDiscordWebhookSettings({
    presenceWebhookUrl: "https://discord.com/api/webhooks/1/abcdefghijklmnopqrstuv",
    presenceAlertsWebhookUrl: "https://discord.com/api/webhooks/5/abcdefghijklmnopqrstuv",
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
    expect(webhookUrlForEvent(base, "online_indexed")).toContain("/webhooks/5/");
    expect(webhookUrlForEvent(base, "came_online")).toContain("/webhooks/5/");
    expect(webhookUrlForEvent(base, "inventory_updated")).toContain("/webhooks/2/");
    expect(webhookUrlForEvent(base, "item_moved")).toContain("/webhooks/3/");
    expect(webhookUrlForEvent(base, "pitpal_location")).toContain("/webhooks/4/");
  });

  it("falls online/offline alerts back to the dashboard webhook when unset", () => {
    const withoutAlerts = normalizeDiscordWebhookSettings({
      presenceWebhookUrl: "https://discord.com/api/webhooks/1/abcdefghijklmnopqrstuv",
    });
    expect(webhookUrlForEvent(withoutAlerts, "online_indexed")).toContain("/webhooks/1/");
    expect(webhookUrlForEvent(withoutAlerts, "came_online")).toContain("/webhooks/1/");
  });

  it("never falls PitPal events back to the presence webhook", () => {
    const withoutPitpal = normalizeDiscordWebhookSettings({
      presenceWebhookUrl: "https://discord.com/api/webhooks/1/abcdefghijklmnopqrstuv",
      presenceAlertsWebhookUrl: "https://discord.com/api/webhooks/5/abcdefghijklmnopqrstuv",
    });
    expect(webhookUrlForEvent(withoutPitpal, "pitpal_entered")).toBeNull();
    expect(webhookUrlForEvent(withoutPitpal, "pitpal_left")).toBeNull();
    expect(webhookUrlForEvent(withoutPitpal, "came_online")).toContain("/webhooks/5/");
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

  it("appends same-lobby IGNs on pitpal_entered", () => {
    const payload = buildDiscordWebhookPayload({
      kind: "pitpal_entered",
      mcUsername: "jc_treepuncher",
      detail: "M1B · SPAWN",
      lobbyName: "M1B",
      lobbyMates: ["alpha", "jc_treepuncher", "zeta"],
      at: "2026-07-24T12:00:00.000Z",
    });
    expect(payload.content).toContain("jc_treepuncher entered Pit · M1B · SPAWN");
    expect(payload.content).toContain("**M1B (3)**");
    expect(payload.content).toContain("• alpha");
    expect(payload.content).toContain("• jc_treepuncher");
    expect(payload.content).toContain("• zeta");
    expect(JSON.stringify(payload.embeds)).toContain("Lobby M1B (3)");
  });
});

describe("formatLobbyMatesBlock", () => {
  it("includes count header and bullets", () => {
    expect(formatLobbyMatesBlock("M1B", ["a", "b"])).toBe("**M1B (2)**\n• a\n• b");
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

  it("marks API Off accounts on the roster", () => {
    const payload = buildOnlineDashboardPayload(
      [
        {
          mcUsername: "NEYREGLA",
          lobby: "M23A",
          location: "SPAWN",
          apiOff: true,
        },
      ],
      "2026-07-21T12:00:00.000Z",
    );
    expect(payload.content).toContain("NEYREGLA");
    expect(payload.content).toContain("API Off");
  });

  it("marks nicked accounts on the roster and in event payloads", () => {
    const roster = buildOnlineDashboardPayload(
      [
        {
          mcUsername: "NickGuy",
          lobby: "M1A",
          location: "DOWN",
          isNicked: true,
        },
      ],
      "2026-07-21T12:00:00.000Z",
    );
    expect(roster.content).toContain("Nicked");
    const event = buildDiscordWebhookPayload({
      kind: "pitpal_entered",
      mcUsername: "NickGuy",
      detail: "M1A · DOWN",
      isNicked: true,
      at: "2026-07-21T12:00:00.000Z",
    });
    expect(event.content).toBe("NickGuy entered Pit · M1A · DOWN · Nicked");
    expect(JSON.stringify(event.embeds)).toContain('"name":"Nick"');
    expect(JSON.stringify(event.embeds)).toContain('"value":"Nicked"');
  });

  it("does not double-append Nicked when detail already says it", () => {
    const event = buildDiscordWebhookPayload({
      kind: "came_online",
      mcUsername: "NickGuy",
      detail: "M1A · SPAWN · Nicked",
      isNicked: true,
      at: "2026-07-21T12:00:00.000Z",
    });
    expect(event.content).toBe("NickGuy came online · M1A · SPAWN · Nicked");
    expect(event.content.match(/Nicked/g)?.length).toBe(1);
  });

  it("supports non-140er dashboard labeling", () => {
    const payload = buildOnlineDashboardPayload(
      [{ mcUsername: "Trader" }],
      "2026-07-21T12:00:00.000Z",
      {
        headline: "Non-140er online",
        title: "Non-140er online",
        emptyMessage: "_No non-140er watchlist accounts are online._",
        footer: "Pitantir non-140er dashboard · edited in place",
      },
    );
    expect(payload.content).toContain("Non-140er online (1)");
    expect(payload.embeds[0]?.title).toBe("Non-140er online · 1");
    expect((payload.embeds[0]?.footer as { text: string }).text).toContain("non-140er");
  });
});

describe("buildPitpalMonitorDashboardPayload", () => {
  it("renders an online sticky status", () => {
    const payload = buildPitpalMonitorDashboardPayload({
      status: "online",
      ageMs: 12_000,
      staleMs: 180_000,
      lastIngestAt: "2026-07-23T17:00:00.000Z",
      playerCount: 40,
      lobbyCount: 8,
      at: "2026-07-23T17:00:12.000Z",
    });
    expect(payload.content).toContain("ONLINE");
    expect(payload.embeds[0]?.title).toContain("ONLINE");
    expect(payload.embeds[0]?.color).toBe(0x57f287);
    expect(JSON.stringify(payload.embeds[0]?.fields)).toContain("12s ago");
  });

  it("mentions ops on offline transition", () => {
    const payload = buildPitpalMonitorDashboardPayload({
      status: "offline",
      ageMs: 200_000,
      staleMs: 180_000,
      offlineSince: "2026-07-23T16:57:00.000Z",
      transition: "went_offline",
      opsMention: "<@123456789012345678>",
      at: "2026-07-23T17:00:00.000Z",
    });
    expect(payload.content).toContain("<@123456789012345678>");
    expect(payload.content).toContain("stopped");
    expect(payload.embeds[0]?.color).toBe(0xed4245);
  });
});
