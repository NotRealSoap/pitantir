import { describe, expect, it, vi } from "vitest";
import type { PublicAccount } from "@pitantir/db";
import { MojangLookupError, type MinecraftProfile } from "@pitantir/shared/inventory";
import {
  fixAccountUsernames,
  resolveCanonicalMinecraftIdentity,
} from "./fix-account-usernames";

function fakeAccount(overrides: Partial<PublicAccount> = {}): PublicAccount {
  return {
    id: "acct-1",
    mcUuid: null,
    mcUsername: "3amcatnoises9",
    displayName: null,
    enabled: true,
    watchlisted: true,
    priority: 100,
    scanIntervalSeconds: 3600,
    nextScanAt: new Date(),
    lastSuccessScanAt: null,
    lastFailureScanAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("resolveCanonicalMinecraftIdentity", () => {
  it("prefers UUID lookup for correct casing", async () => {
    const resolveByUuid = vi.fn(async (): Promise<MinecraftProfile> => ({
      username: "3AMCatNoises9",
      uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    }));
    const resolveByUsername = vi.fn();

    const profile = await resolveCanonicalMinecraftIdentity(
      {
        mcUsername: "3amcatnoises9",
        mcUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      {
        resolveProfileByUsername: resolveByUsername,
        resolveProfileByUuid: resolveByUuid,
      },
    );

    expect(profile.username).toBe("3AMCatNoises9");
    expect(resolveByUsername).not.toHaveBeenCalled();
  });

  it("falls back to username lookup when UUID is missing", async () => {
    const resolveByUsername = vi.fn(async (): Promise<MinecraftProfile> => ({
      username: "BarrelOfAlmonds",
      uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    }));

    const profile = await resolveCanonicalMinecraftIdentity(
      { mcUsername: "barrelofalmonds", mcUuid: null },
      {
        resolveProfileByUsername: resolveByUsername,
        resolveProfileByUuid: async () => {
          throw new Error("should not be called");
        },
      },
    );

    expect(profile).toEqual({
      username: "BarrelOfAlmonds",
      uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    });
  });
});

describe("fixAccountUsernames", () => {
  it("updates lowercase watch-list IGNs from Mojang", async () => {
    const accounts = [
      fakeAccount({ id: "a1", mcUsername: "3amcatnoises9" }),
      fakeAccount({
        id: "a2",
        mcUsername: "barrelofalmonds",
        mcUuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      }),
      fakeAccount({
        id: "a3",
        mcUsername: "AlreadyCased",
        mcUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      }),
    ];

    const updateAccount = vi.fn(async (id: string, patch: { mcUsername?: string; mcUuid?: string | null }) => {
      const existing = accounts.find((row) => row.id === id)!;
      return fakeAccount({
        ...existing,
        mcUsername: patch.mcUsername ?? existing.mcUsername,
        mcUuid: patch.mcUuid === undefined ? existing.mcUuid : patch.mcUuid,
      });
    });

    const result = await fixAccountUsernames(
      {
        listAccounts: async () => accounts,
        updateAccount,
        delayMs: 0,
        resolveProfileByUsername: async (username) => {
          if (username.toLowerCase() === "3amcatnoises9") {
            return {
              username: "3AMCatNoises9",
              uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            };
          }
          throw new MojangLookupError("not_found", username);
        },
        resolveProfileByUuid: async (uuid) => {
          if (uuid.startsWith("cccc")) {
            return {
              username: "BarrelOfAlmonds",
              uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            };
          }
          if (uuid.startsWith("dddd")) {
            return {
              username: "AlreadyCased",
              uuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
            };
          }
          throw new MojangLookupError("not_found", uuid);
        },
      },
      {},
    );

    expect(result.checked).toBe(3);
    expect(result.updated).toBe(2);
    expect(result.unchanged).toBe(1);
    expect(result.failed).toBe(0);
    expect(updateAccount).toHaveBeenCalledWith("a1", {
      mcUsername: "3AMCatNoises9",
      mcUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
    expect(updateAccount).toHaveBeenCalledWith("a2", {
      mcUsername: "BarrelOfAlmonds",
      mcUuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    });
  });
});
