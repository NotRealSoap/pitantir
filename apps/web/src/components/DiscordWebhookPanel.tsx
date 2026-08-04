"use client";

import { useCallback, useEffect, useState } from "react";

type DiscordPlayerRuleState = {
  accountId: string;
  mcUsername: string;
  notifyCameOnline: boolean;
  notifyWentOffline: boolean;
  notifyEveryOnlineScan: boolean;
  notifyItemGainedLost: boolean;
  notifyInventoryUpdated: boolean;
  notifyPitpalStatusChanges: boolean;
};

type DiscordWebhookPayload = {
  configured?: boolean;
  presenceWebhookUrlMasked?: string | null;
  presenceAlertsWebhookUrlMasked?: string | null;
  inventoryWebhookUrlMasked?: string | null;
  itemMovesWebhookUrlMasked?: string | null;
  pitpalStatusWebhookUrlMasked?: string | null;
  lobbyMatesWebhookUrlMasked?: string | null;
  non140erDashboardWebhookUrlMasked?: string | null;
  monitorWebhookUrlMasked?: string | null;
  monitorDashboardConfigured?: boolean;
  opsAlertDiscordUserId?: string | null;
  downwatchRoleId?: string | null;
  downwatchChannelId?: string | null;
  downwatchWebhookUrlMasked?: string | null;
  downwatchDashboardWebhookUrlMasked?: string | null;
  notifyCameOnline?: boolean;
  notifyWentOffline?: boolean;
  notifyEveryOnlineScan?: boolean;
  notifyItemGainedLost?: boolean;
  notifyInventoryUpdated?: boolean;
  notifyPitpalStatusChanges?: boolean;
  onlineDashboardEnabled?: boolean;
  onlineDashboardConfigured?: boolean;
  non140erDashboardConfigured?: boolean;
  downwatchDashboardConfigured?: boolean;
  playerRules?: DiscordPlayerRuleState[];
  watchlist?: Array<{ id: string; mcUsername: string }>;
  ok?: boolean;
  message?: string;
  error?: string;
};

const DEFAULT_PLAYER_FLAGS = {
  notifyCameOnline: true,
  notifyWentOffline: false,
  notifyEveryOnlineScan: true,
  notifyItemGainedLost: true,
  notifyInventoryUpdated: false,
  notifyPitpalStatusChanges: true,
};

function buildPlayerRows(
  watchlist: Array<{ id: string; mcUsername: string }>,
  rules: DiscordPlayerRuleState[],
  defaults: typeof DEFAULT_PLAYER_FLAGS,
): DiscordPlayerRuleState[] {
  const byId = new Map(rules.map((rule) => [rule.accountId, rule]));
  return watchlist
    .slice()
    .sort((a, b) => a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" }))
    .map((account) => {
      const rule = byId.get(account.id);
      return {
        accountId: account.id,
        mcUsername: account.mcUsername,
        notifyCameOnline: rule?.notifyCameOnline ?? defaults.notifyCameOnline,
        notifyWentOffline: rule?.notifyWentOffline ?? defaults.notifyWentOffline,
        notifyEveryOnlineScan: rule?.notifyEveryOnlineScan ?? defaults.notifyEveryOnlineScan,
        notifyItemGainedLost: rule?.notifyItemGainedLost ?? defaults.notifyItemGainedLost,
        notifyInventoryUpdated: rule?.notifyInventoryUpdated ?? defaults.notifyInventoryUpdated,
        notifyPitpalStatusChanges:
          rule?.notifyPitpalStatusChanges ?? defaults.notifyPitpalStatusChanges,
      };
    });
}

function flagsEqual(a: DiscordPlayerRuleState, defaults: typeof DEFAULT_PLAYER_FLAGS): boolean {
  return (
    a.notifyCameOnline === defaults.notifyCameOnline &&
    a.notifyWentOffline === defaults.notifyWentOffline &&
    a.notifyEveryOnlineScan === defaults.notifyEveryOnlineScan &&
    a.notifyItemGainedLost === defaults.notifyItemGainedLost &&
    a.notifyInventoryUpdated === defaults.notifyInventoryUpdated &&
    a.notifyPitpalStatusChanges === defaults.notifyPitpalStatusChanges
  );
}

export function DiscordWebhookPanel() {
  const [status, setStatus] = useState<DiscordWebhookPayload | null>(null);
  const [presenceWebhookUrl, setPresenceWebhookUrl] = useState("");
  const [presenceAlertsWebhookUrl, setPresenceAlertsWebhookUrl] = useState("");
  const [inventoryWebhookUrl, setInventoryWebhookUrl] = useState("");
  const [itemMovesWebhookUrl, setItemMovesWebhookUrl] = useState("");
  const [pitpalStatusWebhookUrl, setPitpalStatusWebhookUrl] = useState("");
  const [lobbyMatesWebhookUrl, setLobbyMatesWebhookUrl] = useState("");
  const [non140erDashboardWebhookUrl, setNon140erDashboardWebhookUrl] = useState("");
  const [monitorWebhookUrl, setMonitorWebhookUrl] = useState("");
  const [opsAlertDiscordUserId, setOpsAlertDiscordUserId] = useState("");
  const [downwatchRoleId, setDownwatchRoleId] = useState("");
  const [downwatchChannelId, setDownwatchChannelId] = useState("");
  const [downwatchWebhookUrl, setDownwatchWebhookUrl] = useState("");
  const [downwatchDashboardWebhookUrl, setDownwatchDashboardWebhookUrl] = useState("");
  const [notifyCameOnline, setNotifyCameOnline] = useState(true);
  const [notifyWentOffline, setNotifyWentOffline] = useState(false);
  const [notifyEveryOnlineScan, setNotifyEveryOnlineScan] = useState(true);
  const [notifyItemGainedLost, setNotifyItemGainedLost] = useState(true);
  const [notifyInventoryUpdated, setNotifyInventoryUpdated] = useState(false);
  const [notifyPitpalStatusChanges, setNotifyPitpalStatusChanges] = useState(true);
  const [onlineDashboardEnabled, setOnlineDashboardEnabled] = useState(true);
  const [playerRows, setPlayerRows] = useState<DiscordPlayerRuleState[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyPayload(payload: DiscordWebhookPayload) {
    setStatus(payload);
    const defaults = {
      notifyCameOnline: payload.notifyCameOnline ?? DEFAULT_PLAYER_FLAGS.notifyCameOnline,
      notifyWentOffline: payload.notifyWentOffline ?? DEFAULT_PLAYER_FLAGS.notifyWentOffline,
      notifyEveryOnlineScan:
        payload.notifyEveryOnlineScan ?? DEFAULT_PLAYER_FLAGS.notifyEveryOnlineScan,
      notifyItemGainedLost:
        payload.notifyItemGainedLost ?? DEFAULT_PLAYER_FLAGS.notifyItemGainedLost,
      notifyInventoryUpdated:
        payload.notifyInventoryUpdated ?? DEFAULT_PLAYER_FLAGS.notifyInventoryUpdated,
      notifyPitpalStatusChanges:
        payload.notifyPitpalStatusChanges ?? DEFAULT_PLAYER_FLAGS.notifyPitpalStatusChanges,
    };
    setNotifyCameOnline(defaults.notifyCameOnline);
    setNotifyWentOffline(defaults.notifyWentOffline);
    setNotifyEveryOnlineScan(defaults.notifyEveryOnlineScan);
    setNotifyItemGainedLost(defaults.notifyItemGainedLost);
    setNotifyInventoryUpdated(defaults.notifyInventoryUpdated);
    setNotifyPitpalStatusChanges(defaults.notifyPitpalStatusChanges);
    setOnlineDashboardEnabled(payload.onlineDashboardEnabled ?? true);
    setOpsAlertDiscordUserId(payload.opsAlertDiscordUserId ?? "");
    setDownwatchRoleId(payload.downwatchRoleId ?? "");
    setDownwatchChannelId(payload.downwatchChannelId ?? "");
    setPlayerRows(
      buildPlayerRows(payload.watchlist ?? [], payload.playerRules ?? [], defaults),
    );
  }

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/discord-webhook");
      const payload = (await response.json()) as DiscordWebhookPayload;
      if (!response.ok) {
        setStatus(null);
        return;
      }
      applyPayload(payload);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/discord-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as DiscordWebhookPayload;
      if (!response.ok || payload.ok === false) {
        setError(payload.error ?? "Request failed.");
        return;
      }
      applyPayload(payload);
      setMessage(payload.message ?? "Saved.");
      if (body.action === "save" || body.action === "test") {
        setPresenceWebhookUrl("");
        setPresenceAlertsWebhookUrl("");
        setInventoryWebhookUrl("");
        setItemMovesWebhookUrl("");
        setPitpalStatusWebhookUrl("");
        setNon140erDashboardWebhookUrl("");
        setDownwatchWebhookUrl("");
        setDownwatchDashboardWebhookUrl("");
      }
    } catch {
      setError("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function updatePlayer(
    accountId: string,
    key: keyof DiscordPlayerRuleState,
    value: boolean,
  ) {
    setPlayerRows((rows) =>
      rows.map((row) => {
        if (row.accountId !== accountId) return row;
        // "Online scan" in the table means any online alerts — keep came-online in sync.
        // Unchecking only every-scan previously left came-online on, so login pings continued.
        if (key === "notifyEveryOnlineScan") {
          return {
            ...row,
            notifyEveryOnlineScan: value,
            notifyCameOnline: value,
          };
        }
        return { ...row, [key]: value };
      }),
    );
  }

  const defaults = {
    notifyCameOnline,
    notifyWentOffline,
    notifyEveryOnlineScan,
    notifyItemGainedLost,
    notifyInventoryUpdated,
    notifyPitpalStatusChanges,
  };

  return (
    <section className="panel" style={{ marginTop: "1.5rem", maxWidth: "52rem" }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Discord webhooks
      </h2>
      <p className="muted">
        Use <strong>dedicated channels</strong>. Online dashboard = roster only (edited in place).
        Non-140er dashboard = same roster minus players whose notes contain <code>140er</code>.
        Downwatch dashboard = effectively-online accounts on the downwatch list. Online/offline
        alerts = Hypixel came-online / went-offline / still-online index pings (also used for
        Hypixel outage alerts that ping ops). PitPal status = lobbies changes (append-only). Leave a
        URL blank to keep the saved value.
      </p>
      <p>
        Status:{" "}
        <span className="chip">
          {status == null ? "Checking…" : status.configured ? "configured" : "not configured"}
        </span>
        {status?.presenceWebhookUrlMasked ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            dashboard saved
          </span>
        ) : null}
        {status?.presenceAlertsWebhookUrlMasked ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            alerts saved
          </span>
        ) : null}
        {status?.pitpalStatusWebhookUrlMasked ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            pitpal saved
          </span>
        ) : null}
        {status?.onlineDashboardConfigured ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            dashboard live
          </span>
        ) : null}
        {status?.non140erDashboardWebhookUrlMasked ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            non-140er saved
          </span>
        ) : null}
        {status?.non140erDashboardConfigured ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            non-140er live
          </span>
        ) : null}
        {status?.downwatchDashboardWebhookUrlMasked ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            downwatch dash saved
          </span>
        ) : null}
        {status?.downwatchDashboardConfigured ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            downwatch dash live
          </span>
        ) : null}
        {status?.monitorDashboardConfigured ? (
          <span className="chip" style={{ marginLeft: "0.35rem" }}>
            lobby monitor live
          </span>
        ) : null}
      </p>

      <form
        className="form-stack"
        style={{ marginTop: "0.75rem", maxWidth: "100%" }}
        onSubmit={(event) => {
          event.preventDefault();
          const playerRules = playerRows.filter((row) => !flagsEqual(row, defaults));
          void run({
            action: "save",
            presenceWebhookUrl: presenceWebhookUrl.trim() || undefined,
            presenceAlertsWebhookUrl: presenceAlertsWebhookUrl.trim() || undefined,
            inventoryWebhookUrl: inventoryWebhookUrl.trim() || undefined,
            itemMovesWebhookUrl: itemMovesWebhookUrl.trim() || undefined,
            pitpalStatusWebhookUrl: pitpalStatusWebhookUrl.trim() || undefined,
            lobbyMatesWebhookUrl: lobbyMatesWebhookUrl.trim() || undefined,
            non140erDashboardWebhookUrl: non140erDashboardWebhookUrl.trim() || undefined,
            monitorWebhookUrl: monitorWebhookUrl.trim() || undefined,
            downwatchWebhookUrl: downwatchWebhookUrl.trim() || undefined,
            downwatchDashboardWebhookUrl: downwatchDashboardWebhookUrl.trim() || undefined,
            opsAlertDiscordUserId: opsAlertDiscordUserId.trim(),
            downwatchRoleId: downwatchRoleId.trim(),
            downwatchChannelId: downwatchChannelId.trim(),
            notifyCameOnline,
            notifyWentOffline,
            notifyEveryOnlineScan,
            notifyItemGainedLost,
            notifyInventoryUpdated,
            notifyPitpalStatusChanges,
            onlineDashboardEnabled,
            playerRules,
          });
        }}
      >
        <label>
          Online roster dashboard webhook (lone channel · edited in place)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={presenceWebhookUrl}
            onChange={(event) => setPresenceWebhookUrl(event.target.value)}
            placeholder={
              status?.presenceWebhookUrlMasked
                ? `Saved: ${status.presenceWebhookUrlMasked}`
                : "https://discord.com/api/webhooks/…"
            }
          />
        </label>
        <label>
          Non-140er roster dashboard webhook (excludes notes with 140er · edited in place)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={non140erDashboardWebhookUrl}
            onChange={(event) => setNon140erDashboardWebhookUrl(event.target.value)}
            placeholder={
              status?.non140erDashboardWebhookUrlMasked
                ? `Saved: ${status.non140erDashboardWebhookUrlMasked}`
                : "Optional — separate channel for non-140er online roster"
            }
          />
        </label>
        <label>
          Ops alert Discord user ID (pings on Hypixel outage + lobby monitor down)
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={opsAlertDiscordUserId}
            onChange={(event) => setOpsAlertDiscordUserId(event.target.value)}
            placeholder={
              status?.opsAlertDiscordUserId
                ? `Saved: ${status.opsAlertDiscordUserId}`
                : "Discord Developer Mode → Copy User ID (17–20 digits)"
            }
          />
        </label>
        <label>
          Downwatch role ID (pinged when listed players go PitPal DOWN)
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={downwatchRoleId}
            onChange={(event) => setDownwatchRoleId(event.target.value)}
            placeholder={
              status?.downwatchRoleId
                ? `Saved: ${status.downwatchRoleId}`
                : "Discord Developer Mode → Copy Role ID"
            }
          />
        </label>
        <label>
          Downwatch command channel ID (`!downwatch add IGN` · needs DISCORD_BOT_TOKEN)
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={downwatchChannelId}
            onChange={(event) => setDownwatchChannelId(event.target.value)}
            placeholder={
              status?.downwatchChannelId
                ? `Saved: ${status.downwatchChannelId}`
                : "Channel the worker polls for commands"
            }
          />
        </label>
        <label>
          Downwatch webhook (DOWN role pings · optional)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={downwatchWebhookUrl}
            onChange={(event) => setDownwatchWebhookUrl(event.target.value)}
            placeholder={
              status?.downwatchWebhookUrlMasked
                ? `Saved: ${status.downwatchWebhookUrlMasked}`
                : "Optional — falls back to PitPal status / alerts"
            }
          />
        </label>
        <label>
          Downwatch roster dashboard webhook (online downwatch IGNs · edited in place)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={downwatchDashboardWebhookUrl}
            onChange={(event) => setDownwatchDashboardWebhookUrl(event.target.value)}
            placeholder={
              status?.downwatchDashboardWebhookUrlMasked
                ? `Saved: ${status.downwatchDashboardWebhookUrlMasked}`
                : "Optional — separate channel for downwatch online roster"
            }
          />
        </label>
        <label>
          Online/offline alerts webhook (came online · went offline · still-online index)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={presenceAlertsWebhookUrl}
            onChange={(event) => setPresenceAlertsWebhookUrl(event.target.value)}
            placeholder={
              status?.presenceAlertsWebhookUrlMasked
                ? `Saved: ${status.presenceAlertsWebhookUrlMasked}`
                : "Optional — falls back to dashboard channel until set"
            }
          />
        </label>
        <label>
          Inventory updates webhook (lives / enchants / slot)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={inventoryWebhookUrl}
            onChange={(event) => setInventoryWebhookUrl(event.target.value)}
            placeholder={
              status?.inventoryWebhookUrlMasked
                ? `Saved: ${status.inventoryWebhookUrlMasked}`
                : "Optional — falls back to alerts/dashboard"
            }
          />
        </label>
        <label>
          Item additions / subtractions webhook
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={itemMovesWebhookUrl}
            onChange={(event) => setItemMovesWebhookUrl(event.target.value)}
            placeholder={
              status?.itemMovesWebhookUrlMasked
                ? `Saved: ${status.itemMovesWebhookUrlMasked}`
                : "Optional — falls back to alerts/dashboard"
            }
          />
        </label>
        <label>
          PitPal status webhook (all pitpal.rocks/admin/lobbies changes · append-only)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={pitpalStatusWebhookUrl}
            onChange={(event) => setPitpalStatusWebhookUrl(event.target.value)}
            placeholder={
              status?.pitpalStatusWebhookUrlMasked
                ? `Saved: ${status.pitpalStatusWebhookUrlMasked}`
                : "https://discord.com/api/webhooks/… (required for PitPal)"
            }
          />
        </label>
        <label>
          Lobby mates webhook (furry-stash Pit sessions · everyone who shared a lobby · edited in place)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={lobbyMatesWebhookUrl}
            onChange={(event) => setLobbyMatesWebhookUrl(event.target.value)}
            placeholder={
              status?.lobbyMatesWebhookUrlMasked
                ? `Saved: ${status.lobbyMatesWebhookUrlMasked}`
                : "Optional — falls back to PitPal status webhook"
            }
          />
        </label>
        <label>
          Lobby monitor dashboard webhook (edited in place · ONLINE/OFFLINE + time since last ingest)
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={monitorWebhookUrl}
            onChange={(event) => setMonitorWebhookUrl(event.target.value)}
            placeholder={
              status?.monitorWebhookUrlMasked
                ? `Saved: ${status.monitorWebhookUrlMasked}`
                : "Optional — falls back to alerts channel · sticky message updated ~every 30s"
            }
          />
        </label>

        <h3 className="section-title" style={{ fontSize: "1rem", marginBottom: 0 }}>
          Default notify flags
        </h3>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyEveryOnlineScan}
            onChange={(event) => setNotifyEveryOnlineScan(event.target.checked)}
          />
          Every online scan
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyCameOnline}
            onChange={(event) => setNotifyCameOnline(event.target.checked)}
            disabled={notifyEveryOnlineScan}
          />
          Came online only {notifyEveryOnlineScan ? "(covered by every-scan)" : ""}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyWentOffline}
            onChange={(event) => setNotifyWentOffline(event.target.checked)}
          />
          Went offline
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyItemGainedLost}
            onChange={(event) => setNotifyItemGainedLost(event.target.checked)}
          />
          Item additions / subtractions
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyInventoryUpdated}
            onChange={(event) => setNotifyInventoryUpdated(event.target.checked)}
          />
          Inventory field updates (no gain/loss)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={notifyPitpalStatusChanges}
            onChange={(event) => setNotifyPitpalStatusChanges(event.target.checked)}
          />
          PitPal lobby status changes (SPAWN/DOWN/OTHER)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={onlineDashboardEnabled}
            onChange={(event) => setOnlineDashboardEnabled(event.target.checked)}
          />
          Presence channel: keep latest message as online roster
        </label>

        <h3 className="section-title" style={{ fontSize: "1rem", marginBottom: 0 }}>
          Per-player overrides
        </h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Only rows that differ from the defaults above are saved. Uncheck <strong>Online</strong> to
          mute both still-online and came-online alerts for that player. Leave someone matching
          defaults to inherit. Forced mute (like 140ers) in code:{" "}
          <code>zain12219</code>, <code>BuMingXiaLuo</code>, <code>sis</code>,{" "}
          <code>L3nnY2B4k3D</code>, <code>TuffTuffTuffTuff</code>, <code>mhm</code>,{" "}
          <code>inoriginal2</code>, <code>crazy</code>, <code>whytf</code>,{" "}
          <code>volleydrain</code>, <code>Kadeacon</code>, <code>YMXCE</code>,{" "}
          <code>CURLSFORGIRLSS</code>, <code>DynamicStopper04</code>,{" "}
          <code>HarryPotterJr</code>.
        </p>
        {playerRows.length === 0 ? (
          <p className="muted">No watchlist accounts yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="discord-player-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Online</th>
                  <th>Offline</th>
                  <th>+/− items</th>
                  <th>Inv update</th>
                  <th>PitPal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {playerRows.map((row) => {
                  const custom = !flagsEqual(row, defaults);
                  return (
                    <tr key={row.accountId} className={custom ? "is-custom" : undefined}>
                      <td>
                        <strong>{row.mcUsername}</strong>
                        {custom ? <div className="muted">custom</div> : null}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.notifyEveryOnlineScan}
                          onChange={(event) =>
                            updatePlayer(row.accountId, "notifyEveryOnlineScan", event.target.checked)
                          }
                          aria-label={`${row.mcUsername} every online scan`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.notifyWentOffline}
                          onChange={(event) =>
                            updatePlayer(row.accountId, "notifyWentOffline", event.target.checked)
                          }
                          aria-label={`${row.mcUsername} offline`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.notifyItemGainedLost}
                          onChange={(event) =>
                            updatePlayer(row.accountId, "notifyItemGainedLost", event.target.checked)
                          }
                          aria-label={`${row.mcUsername} item moves`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.notifyInventoryUpdated}
                          onChange={(event) =>
                            updatePlayer(
                              row.accountId,
                              "notifyInventoryUpdated",
                              event.target.checked,
                            )
                          }
                          aria-label={`${row.mcUsername} inventory updates`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.notifyPitpalStatusChanges}
                          onChange={(event) =>
                            updatePlayer(
                              row.accountId,
                              "notifyPitpalStatusChanges",
                              event.target.checked,
                            )
                          }
                          aria-label={`${row.mcUsername} PitPal status`}
                        />
                      </td>
                      <td>
                        {custom ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPlayerRows((rows) =>
                                rows.map((entry) =>
                                  entry.accountId === row.accountId
                                    ? {
                                        ...entry,
                                        ...defaults,
                                        accountId: entry.accountId,
                                        mcUsername: entry.mcUsername,
                                      }
                                    : entry,
                                ),
                              )
                            }
                          >
                            Reset
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="row-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save Discord settings"}
          </button>
          <button
            type="button"
            disabled={
              busy ||
              (!status?.presenceAlertsWebhookUrlMasked &&
                !status?.presenceWebhookUrlMasked &&
                !presenceAlertsWebhookUrl.trim() &&
                !presenceWebhookUrl.trim())
            }
            onClick={() =>
              void run({
                action: "test",
                channel: "presenceAlerts",
                webhookUrl: presenceAlertsWebhookUrl.trim() || undefined,
              })
            }
          >
            Test online/offline alerts
          </button>
          <button
            type="button"
            disabled={busy || (!status?.presenceWebhookUrlMasked && !presenceWebhookUrl.trim())}
            onClick={() =>
              void run({
                action: "test",
                channel: "presence",
                webhookUrl: presenceWebhookUrl.trim() || undefined,
              })
            }
          >
            Test dashboard channel
          </button>
          <button
            type="button"
            disabled={
              busy ||
              (!status?.non140erDashboardWebhookUrlMasked && !non140erDashboardWebhookUrl.trim())
            }
            onClick={() =>
              void run({
                action: "test",
                channel: "non140erDashboard",
                webhookUrl: non140erDashboardWebhookUrl.trim() || undefined,
              })
            }
          >
            Test non-140er dashboard
          </button>
          <button
            type="button"
            disabled={
              busy ||
              (!status?.downwatchDashboardWebhookUrlMasked &&
                !downwatchDashboardWebhookUrl.trim())
            }
            onClick={() =>
              void run({
                action: "test",
                channel: "downwatchDashboard",
                webhookUrl: downwatchDashboardWebhookUrl.trim() || undefined,
              })
            }
          >
            Test downwatch dashboard
          </button>
          <button
            type="button"
            disabled={busy || (!status?.configured && !itemMovesWebhookUrl.trim())}
            onClick={() =>
              void run({
                action: "test",
                channel: "itemMoves",
                webhookUrl: itemMovesWebhookUrl.trim() || undefined,
              })
            }
          >
            Test item moves
          </button>
          <button
            type="button"
            disabled={busy || (!status?.configured && !inventoryWebhookUrl.trim())}
            onClick={() =>
              void run({
                action: "test",
                channel: "inventory",
                webhookUrl: inventoryWebhookUrl.trim() || undefined,
              })
            }
          >
            Test inventory
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !pitpalStatusWebhookUrl.trim()}
            onClick={() =>
              void run({
                action: "save",
                pitpalStatusWebhookUrl: pitpalStatusWebhookUrl.trim(),
              })
            }
          >
            Save PitPal webhook only
          </button>
          <button
            type="button"
            disabled={
              busy ||
              (!status?.pitpalStatusWebhookUrlMasked && !pitpalStatusWebhookUrl.trim())
            }
            onClick={() =>
              void run({
                action: "test",
                channel: "pitpalStatus",
                webhookUrl: pitpalStatusWebhookUrl.trim() || undefined,
              })
            }
          >
            Test PitPal status
          </button>
          <button
            type="button"
            disabled={
              busy ||
              (!status?.lobbyMatesWebhookUrlMasked &&
                !lobbyMatesWebhookUrl.trim() &&
                !status?.pitpalStatusWebhookUrlMasked &&
                !pitpalStatusWebhookUrl.trim())
            }
            onClick={() =>
              void run({
                action: "test",
                channel: "lobbyMates",
                webhookUrl: lobbyMatesWebhookUrl.trim() || undefined,
              })
            }
          >
            Test lobby mates
          </button>
          <button
            type="button"
            disabled={
              busy ||
              (!status?.monitorWebhookUrlMasked &&
                !monitorWebhookUrl.trim() &&
                !status?.presenceAlertsWebhookUrlMasked &&
                !status?.presenceWebhookUrlMasked &&
                !presenceAlertsWebhookUrl.trim() &&
                !presenceWebhookUrl.trim())
            }
            onClick={() =>
              void run({
                action: "test",
                channel: "monitor",
                webhookUrl: monitorWebhookUrl.trim() || undefined,
              })
            }
          >
            Test lobby monitor
          </button>
          <button
            type="button"
            disabled={
              busy ||
              !onlineDashboardEnabled ||
              (!status?.presenceWebhookUrlMasked &&
                !status?.non140erDashboardWebhookUrlMasked &&
                !status?.downwatchDashboardWebhookUrlMasked &&
                !status?.configured)
            }
            onClick={() => void run({ action: "refresh_dashboard" })}
          >
            Refresh dashboard(s)
          </button>
          <button
            type="button"
            disabled={busy || !status?.configured}
            onClick={() => void run({ action: "clear" })}
          >
            Clear all
          </button>
        </div>
      </form>

      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
