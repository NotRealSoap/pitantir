import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteFile = vi.fn(async () => undefined);
const mockAccess = vi.fn(async () => {
  throw Object.assign(new Error("missing"), { code: "ENOENT" });
});
const mockReadFile = vi.fn(async () => "");

vi.mock("node:fs/promises", () => ({
  access: mockAccess,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));

describe("PitPanda key settings route", () => {
  beforeEach(() => {
    vi.resetModules();
    mockWriteFile.mockClear();
    delete process.env.PITPANDA_API_KEY;
  });

  it("reports configured=false when no key is set", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    const payload = await response.json();
    expect(payload).toEqual({ configured: false, provider: "pitpanda" });
    expect(JSON.stringify(payload)).not.toMatch(/api[_-]?key/i);
  });

  it("saves a key without returning the secret", async () => {
    const { POST, GET } = await import("./route");
    const secret = "super-secret-pitpanda-key-value";
    const response = await POST(
      new Request("http://localhost/api/settings/pitpanda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: secret }),
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, configured: true });
    expect(JSON.stringify(payload)).not.toContain(secret);

    const status = await (await GET()).json();
    expect(status.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain(secret);
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it("rejects empty keys", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/settings/pitpanda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "short" }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
