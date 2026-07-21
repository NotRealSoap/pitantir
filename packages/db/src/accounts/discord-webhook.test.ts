import { describe, expect, it } from "vitest";
import {
  buildDiscordWebhookPayload,
  isDiscordWebhookUrl,
  maskDiscordWebhookUrl,
  normalizeDiscordWebhookSettings,
} from "./discord-webhook.js";

describe("isDiscordWebhookUrl", () => {
  it("accepts discord webhook URLs", () => {
    expect(
      isDiscordWebhookUrl(
        "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEF",
      ),
    ).toBe(true);
    expect(
      isDiscordWebhookUrl(
        "https://canary.discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEF",
      ),
    ).toBe(true);
  });

  it("rejects non-discord URLs", () => {
    expect(isDiscordWebhookUrl("https://example.com/hooks/1")).toBe(false);
    expect(isDiscordWebhookUrl("not-a-url")).toBe(false);
  });
});

describe("maskDiscordWebhookUrl", () => {
  it("masks the token", () => {
    const masked = maskDiscordWebhookUrl(
      "https://discord.com/api/webhooks/123/abcdefghijklmnop",
    );
    expect(masked).toContain("abcd…mnop");
    expect(masked).not.toContain("abcdefghijklmnop");
  });
});

describe("normalizeDiscordWebhookSettings", () => {
  it("defaults notify flags", () => {
    expect(normalizeDiscordWebhookSettings({})).toEqual({
      webhookUrl: null,
      notifyCameOnline: true,
      notifyWentOffline: false,
      notifyInventoryChanged: true,
    });
  });
});

describe("buildDiscordWebhookPayload", () => {
  it("names the player for came_online", () => {
    const payload = buildDiscordWebhookPayload({
      kind: "came_online",
      mcUsername: "Crazy",
      detail: "PIT/pit",
      at: "2026-07-21T12:00:00.000Z",
    });
    expect(payload.content).toBe("Crazy came online · PIT/pit");
    expect(payload.embeds[0]?.title).toBe("Crazy came online · PIT/pit");
  });
});
