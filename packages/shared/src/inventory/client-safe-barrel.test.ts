import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripMcFormatting } from "./mc-text.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("client-safe inventory barrel", () => {
  it("does not re-export Node-only sources that pull node:zlib into Next.js", () => {
    const indexSource = readFileSync(path.join(here, "index.ts"), "utf8");
    const exportLines = indexSource
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("export "));

    for (const forbidden of ["pit-nbt", "hypixel-pit", "pitpanda-player", "failover", "node.js"]) {
      expect(exportLines.some((line) => line.includes(forbidden))).toBe(false);
    }
  });

  it("stripMcFormatting lives outside pit-nbt so UI can use § cleanup without zlib", () => {
    expect(stripMcFormatting("§cRed §lBold")).toBe("Red Bold");
    expect(stripMcFormatting(null)).toBeNull();
  });
});
