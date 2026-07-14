"use client";

import { useEffect, useState } from "react";

type KeySectionProps = {
  title: string;
  description: string;
  configured: boolean | null;
  endpoint: string;
  savedMessage: string;
  onConfiguredChange: (value: boolean) => void;
};

function KeySection({
  title,
  description,
  configured,
  endpoint,
  savedMessage,
  onConfiguredChange,
}: KeySectionProps) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeyInput }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        configured?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        setMessage(payload.error ?? "Could not save API key.");
        onConfiguredChange(false);
        return;
      }
      onConfiguredChange(true);
      setApiKeyInput("");
      setMessage(savedMessage);
    } catch {
      setMessage("Could not save API key.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" style={{ marginTop: "1.5rem", maxWidth: "36rem" }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        {title}
      </h2>
      <p className="muted">{description}</p>
      <p>
        Status:{" "}
        <span className="chip">
          {configured === null ? "Checking…" : configured ? "configured" : "not configured"}
        </span>
      </p>
      <form
        className="form-stack"
        style={{ marginTop: "0.75rem", maxWidth: "100%" }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          API key
          <input
            type="password"
            autoComplete="off"
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
            placeholder="Paste key (never shown again)"
            required
          />
        </label>
        <button type="submit" className="primary" disabled={saving || apiKeyInput.trim().length < 8}>
          {saving ? "Saving…" : configured ? "Replace key" : "Save key"}
        </button>
      </form>
      {message ? <p style={{ marginBottom: 0 }}>{message}</p> : null}
    </section>
  );
}

export default function SettingsPage() {
  const [pitpandaConfigured, setPitpandaConfigured] = useState<boolean | null>(null);
  const [hypixelConfigured, setHypixelConfigured] = useState<boolean | null>(null);
  const [inventorySource, setInventorySource] = useState<string>("mock");

  useEffect(() => {
    void (async () => {
      try {
        const [pitpanda, hypixel] = await Promise.all([
          fetch("/api/settings/pitpanda").then((r) => r.json()),
          fetch("/api/settings/hypixel").then((r) => r.json()),
        ]);
        setPitpandaConfigured(Boolean(pitpanda.configured));
        setHypixelConfigured(Boolean(hypixel.configured));
        if (typeof hypixel.inventorySource === "string") {
          setInventorySource(hypixel.inventorySource);
        }
      } catch {
        setPitpandaConfigured(false);
        setHypixelConfigured(false);
      }
    })();
  }, []);

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-lede">
        Server-only API keys for local/dev. Keys are written to <code>.env.local</code> and never
        returned to the browser.
      </p>
      <p className="muted">
        Current inventory source for the worker: <code>{inventorySource}</code>
      </p>

      <KeySection
        title="PitPanda"
        description="Used by Item Search for upstream book lookups."
        configured={pitpandaConfigured}
        endpoint="/api/settings/pitpanda"
        savedMessage="PitPanda API key saved. You can use Item Search now."
        onConfiguredChange={setPitpandaConfigured}
      />

      <KeySection
        title="Hypixel"
        description="Used by the worker for Hypixel Pit inventory scans. After saving, restart the worker so it loads the new key."
        configured={hypixelConfigured}
        endpoint="/api/settings/hypixel"
        savedMessage="Hypixel API key saved. Restart the worker (INVENTORY_SOURCE=hypixel_pit)."
        onConfiguredChange={(value) => {
          setHypixelConfigured(value);
          if (value) setInventorySource("hypixel_pit");
        }}
      />

      <section className="panel" style={{ marginTop: "1.5rem", maxWidth: "36rem" }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Notes
        </h2>
        <ul className="muted">
          <li>Do not deploy this settings endpoint to a public host without auth.</li>
          <li>
            After saving the Hypixel key, restart the worker. Username-only accounts resolve UUID
            automatically via Mojang on first scan.
          </li>
        </ul>
      </section>
    </>
  );
}
