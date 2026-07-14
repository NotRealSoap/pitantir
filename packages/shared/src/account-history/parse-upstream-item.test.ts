import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  hasEmbeddedOwners,
  parsePitPandaOwners,
  parseUpstreamItemFields,
} from "./parse-upstream-item.js";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../item-data/providers/pitpanda/__fixtures__",
);

describe("parseUpstreamItemFields / PitPanda owners", () => {
  it("parses real fixture owners chronologically with dashed uuids", () => {
    const raw = JSON.parse(
      readFileSync(join(fixtureDir, "item-651d6219e3a43b157d21b2fe.json"), "utf8"),
    ) as { item: Record<string, unknown> };

    const fields = parseUpstreamItemFields(raw.item);
    expect(fields.pitpandaItemId).toBe("651d6219e3a43b157d21b2fe");
    expect(fields.nonce).toBe("2035964664");
    expect(fields.title).toBe("Extraordinary Tier III Bow");
    expect(fields.kind).toBe("bow");
    expect(fields.lives).toBe(20);
    expect(fields.maxLives).toBe(26);
    expect(fields.customEnchants).toMatchObject({ telebow: 3 });
    expect(fields.owners).toHaveLength(9);
    expect(fields.owners[0]).toMatchObject({
      uuid: "610fb968-20e7-40f4-b222-399a82779e41",
      seenAt: "2023-10-04T13:01:13.152Z",
    });
    expect(fields.owners.at(-1)?.uuid).toBe("0dee7969-1224-44ae-a463-fdb0fc72d568");
    expect(fields.ownerUuid).toBe("0dee7969-1224-44ae-a463-fdb0fc72d568");
    expect(hasEmbeddedOwners(raw.item)).toBe(true);
  });

  it("does not invent owners when the array is absent", () => {
    expect(parsePitPandaOwners(undefined)).toEqual([]);
    expect(hasEmbeddedOwners({ _id: "abc" })).toBe(false);
    const fields = parseUpstreamItemFields({
      _id: "651d6219e3a43b157d21b2fe",
      owner: "0dee7969122444aea463fdb0fc72d568",
      nonce: 1,
    });
    expect(fields.owners).toEqual([]);
    expect(fields.ownerUuid).toBe("0dee7969-1224-44ae-a463-fdb0fc72d568");
  });

  it("skips malformed owner rows", () => {
    expect(
      parsePitPandaOwners([
        { uuid: "not-a-uuid", time: "2024-01-01T00:00:00.000Z" },
        { uuid: "0dee7969122444aea463fdb0fc72d568" },
        {
          _id: "rec1",
          uuid: "0dee7969122444aea463fdb0fc72d568",
          time: "2024-01-01T00:00:00.000Z",
        },
      ]),
    ).toEqual([
      {
        uuid: "0dee7969-1224-44ae-a463-fdb0fc72d568",
        seenAt: "2024-01-01T00:00:00.000Z",
        pitpandaEventId: "rec1",
      },
    ]);
  });
});
