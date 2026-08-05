import { describe, expect, it } from "vitest";
import { notesIndicateHighActivity } from "./notes-labels.js";

describe("notesIndicateHighActivity", () => {
  it("matches operator high-activity tags", () => {
    expect(notesIndicateHighActivity("High Activity")).toBe(true);
    expect(notesIndicateHighActivity("high-activity trader")).toBe(true);
    expect(notesIndicateHighActivity("high_activity")).toBe(true);
    expect(notesIndicateHighActivity("normal")).toBe(false);
    expect(notesIndicateHighActivity(null)).toBe(false);
  });
});
