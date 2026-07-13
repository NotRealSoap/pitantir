import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import nbt from "prismarine-nbt";
import { formatUndashedUuid, resolveMinecraftUuid } from "./mojang.js";
import { bookFieldsFromNbtItem, decodePitInventoryPayload } from "./pit-nbt.js";
import { HypixelPitInventorySource } from "./hypixel-pit.js";

function signedBytes(buffer: Buffer): number[] {
  return [...buffer].map((b) => (b > 127 ? b - 256 : b));
}

function makePitInventoryBytes(
  title: string,
  author: string,
  pages: string[],
  nonce?: string | number,
  options?: { numericBookId?: boolean; nonceKey?: "nonce" | "Nonce"; nonceType?: "string" | "int" },
) {
  const tagValue: Record<string, unknown> = {
    title: { type: "string", value: title },
    author: { type: "string", value: author },
    pages: { type: "list", value: { type: "string", value: pages } },
  };
  if (nonce !== undefined) {
    const key = options?.nonceKey ?? "nonce";
    const asInt = options?.nonceType === "int" || typeof nonce === "number";
    tagValue.ExtraAttributes = {
      type: "compound",
      value: {
        [key]: asInt
          ? { type: "int", value: typeof nonce === "number" ? nonce : Number(nonce) }
          : { type: "string", value: String(nonce) },
      },
    };
  }

  const compound = {
    type: "compound" as const,
    name: "",
    value: {
      i: {
        type: "list" as const,
        value: {
          type: "compound" as const,
          value: [
            {
              id: options?.numericBookId
                ? { type: "short", value: 387 }
                : { type: "string", value: "minecraft:written_book" },
              Slot: { type: "byte", value: 2 },
              Count: { type: "byte", value: 1 },
              tag: { type: "compound", value: tagValue },
            },
          ],
        },
      },
    },
  };

  // @ts-expect-error prismarine write accepts compiler compound shape
  const uncompressed = nbt.writeUncompressed(compound);
  return signedBytes(gzipSync(uncompressed));
}

describe("mojang uuid resolve", () => {
  it("formats undashed uuids", () => {
    expect(formatUndashedUuid("ec1811e6822b4843bcd4fef82f75deb7")).toBe(
      "ec1811e6-822b-4843-bcd4-fef82f75deb7",
    );
  });

  it("resolves username via Mojang profile API", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "ec1811e6822b4843bcd4fef82f75deb7", name: "Notch" }), {
        status: 200,
      }),
    );
    const uuid = await resolveMinecraftUuid("Notch", fetchImpl as unknown as typeof fetch);
    expect(uuid).toBe("ec1811e6-822b-4843-bcd4-fef82f75deb7");
  });
});

describe("pit nbt decode", () => {
  it("decodes written books from pit inventory bytes", async () => {
    const data = makePitInventoryBytes("§6Mystic Book", "Author", ["hello"], "nonce-123");
    const items = await decodePitInventoryPayload({ type: 0, data });
    expect(items).toHaveLength(1);
    const book = bookFieldsFromNbtItem(items[0]!);
    expect(book).toMatchObject({
      title: "Mystic Book",
      author: "Author",
      pages: "hello",
      nonce: "nonce-123",
    });
  });

  it("coerces integer ExtraAttributes.Nonce to string", async () => {
    const data = makePitInventoryBytes("Mystic Book", "Author", ["hello"], 421337, {
      nonceKey: "Nonce",
      nonceType: "int",
      numericBookId: true,
    });
    const items = await decodePitInventoryPayload({ type: 0, data });
    const book = bookFieldsFromNbtItem(items[0]!);
    expect(book).toMatchObject({
      title: "Mystic Book",
      nonce: "421337",
      id: "387",
    });
  });

  it("does not treat named mystic swords as books", async () => {
    const compound = {
      type: "compound" as const,
      name: "",
      value: {
        i: {
          type: "list" as const,
          value: {
            type: "compound" as const,
            value: [
              {
                id: { type: "short", value: 276 },
                Slot: { type: "byte", value: 0 },
                Count: { type: "byte", value: 1 },
                tag: {
                  type: "compound",
                  value: {
                    display: {
                      type: "compound",
                      value: {
                        Name: { type: "string", value: "§dTier III Mystic Sword" },
                        Lore: {
                          type: "list",
                          value: {
                            type: "string",
                            value: ["§7Billionaire III", "§7Lifesteal III"],
                          },
                        },
                      },
                    },
                    ExtraAttributes: {
                      type: "compound",
                      value: {
                        Nonce: { type: "int", value: 998877 },
                        CustomEnchants: {
                          type: "compound",
                          value: {
                            billionaire: { type: "int", value: 3 },
                            lifesteal: { type: "int", value: 3 },
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    };
    // @ts-expect-error prismarine write accepts compiler compound shape
    const data = signedBytes(gzipSync(nbt.writeUncompressed(compound)));
    const items = await decodePitInventoryPayload({ type: 0, data });
    expect(items).toHaveLength(1);
    expect(bookFieldsFromNbtItem(items[0]!)).toBeNull();
  });
});

describe("HypixelPitInventorySource", () => {
  it("fetches player, resolves uuid when missing, extracts books", async () => {
    const data = makePitInventoryBytes("Alpha", "A", ["p"], "live-nonce");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("mojang.com") || url.includes("minecraftservices.com")) {
        return new Response(JSON.stringify({ id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "Demo" }), {
          status: 200,
        });
      }
      if (url.includes("api.hypixel.net")) {
        return new Response(
          JSON.stringify({
            success: true,
            player: {
              uuid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              displayname: "Demo",
              stats: {
                Pit: {
                  profile: {
                    inv_contents: { type: 0, data },
                    inv_enderchest: { type: 0, data: [] },
                  },
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const onUuidResolved = vi.fn(async () => undefined);
    const source = new HypixelPitInventorySource({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onUuidResolved,
    });

    const result = await source.fetchInventory({
      id: "acct-1",
      mcUsername: "Demo",
      mcUuid: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rawInventory.source).toBe("hypixel_pit");
      expect(result.rawInventory.inventory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: "Alpha", nonce: "live-nonce", slot: 2 }),
        ]),
      );
    }
    expect(onUuidResolved).toHaveBeenCalledWith(
      "acct-1",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
  });

  it("maps unauthorized key failures", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
    const source = new HypixelPitInventorySource({
      apiKey: "bad",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveUuid: async () => "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
    const result = await source.fetchInventory({
      id: "a",
      mcUsername: "Demo",
      mcUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("upstream_unauthorized");
    }
  });
});
