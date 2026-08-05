import { describe, expect, it } from "vitest";
import {
  eventIndicatesWentDown,
  parseDownwatchCommand,
} from "./downwatch.js";

describe("parseDownwatchCommand", () => {
  it("parses add/remove/list aliases", () => {
    expect(parseDownwatchCommand("!downwatch add Crazy")).toEqual({
      action: "add",
      mcUsername: "Crazy",
    });
    expect(parseDownwatchCommand("!dw rm Bob")).toEqual({
      action: "remove",
      mcUsername: "Bob",
    });
    expect(parseDownwatchCommand("!downwatch list")).toEqual({ action: "list" });
    expect(parseDownwatchCommand("!dw help")).toEqual({ action: "help" });
  });

  it("parses quiet / soft / silent add and remove", () => {
    expect(parseDownwatchCommand("!dw quiet add Alice")).toEqual({
      action: "quiet_add",
      mcUsername: "Alice",
    });
    expect(parseDownwatchCommand("!downwatch soft remove Bob")).toEqual({
      action: "quiet_remove",
      mcUsername: "Bob",
    });
    expect(parseDownwatchCommand("!dw silent Steve")).toEqual({
      action: "quiet_add",
      mcUsername: "Steve",
    });
  });

  it("treats bare !downwatch Name as add", () => {
    expect(parseDownwatchCommand("!downwatch Steve")).toEqual({
      action: "add",
      mcUsername: "Steve",
    });
  });

  it("ignores unrelated messages", () => {
    expect(parseDownwatchCommand("hello")).toBeNull();
    expect(parseDownwatchCommand("!other add x")).toBeNull();
  });
});

describe("eventIndicatesWentDown", () => {
  it("detects enter-at-DOWN and SPAWN→DOWN", () => {
    expect(
      eventIndicatesWentDown({
        kind: "pitpal_entered",
        detail: "M23A · DOWN · Diamond",
      }),
    ).toBe(true);
    expect(
      eventIndicatesWentDown({
        kind: "pitpal_location",
        detail: "SPAWN → DOWN · M23A",
      }),
    ).toBe(true);
    expect(
      eventIndicatesWentDown({
        kind: "pitpal_location",
        detail: "DOWN → SPAWN · M23A",
      }),
    ).toBe(false);
    expect(
      eventIndicatesWentDown({
        kind: "pitpal_entered",
        detail: "M23A · SPAWN",
      }),
    ).toBe(false);
  });
});
