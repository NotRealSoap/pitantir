import { describe, expect, it } from "vitest";
import {
  coerceFurryStashEntry,
  notesIndicate140er,
} from "./furry-stashes.js";

describe("notesIndicate140er", () => {
  it("detects 140er in notes", () => {
    expect(notesIndicate140er("140er")).toBe(true);
    expect(notesIndicate140er("big 140er stash")).toBe(true);
    expect(notesIndicate140er("140ers")).toBe(true);
    expect(notesIndicate140er("normal trader")).toBe(false);
    expect(notesIndicate140er(null)).toBe(false);
  });
});

describe("coerceFurryStashEntry", () => {
  it("parses username + notes", () => {
    expect(
      coerceFurryStashEntry({ username: "Crazy", notes: "140er", _id: "x" }),
    ).toEqual({
      username: "Crazy",
      notes: "140er",
      is140er: true,
    });
  });

  it("respects explicit is140er", () => {
    expect(
      coerceFurryStashEntry({ username: "Bob", notes: null, is140er: true }),
    ).toMatchObject({ is140er: true });
  });

  it("rejects bad usernames", () => {
    expect(coerceFurryStashEntry({ username: "ab" })).toBeNull();
    expect(coerceFurryStashEntry({ username: "not a name!!!" })).toBeNull();
  });
});
