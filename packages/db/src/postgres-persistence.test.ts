import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  AccountsRepository,
  IdentityService,
  PostgresIdentityStore,
  createDb,
  runMigrations,
  seedAdminSettings,
} from "./index.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://pitantir:pitantir@localhost:5432/pitantir_test";
const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

async function resetDatabase(): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await sql.unsafe("DROP SCHEMA public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO pitantir");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO public");
  } finally {
    await sql.end();
  }
}

describe("Postgres identity + accounts persistence", () => {
  let client: ReturnType<typeof postgres> | null = null;

  beforeAll(async () => {
    await resetDatabase();
    await runMigrations(databaseUrl, migrationsFolder);
    const created = createDb(databaseUrl, { max: 5 });
    client = created.client;
    await seedAdminSettings(created.db);

    const store = new PostgresIdentityStore(created.db);
    const service = new IdentityService(store);

    const observation = await service.createObservationFromRaw({
      scanId: "00000000-0000-4000-8000-000000000099",
      accountId: "00000000-0000-4000-8000-000000000001",
      observedAt: new Date(),
      slotKey: "inv:0",
      rawItem: { title: "Persist Book", author: "A", pages: "x", nonce: "persist-nonce" },
    });
    expect(observation.observedNonce).toBe("persist-nonce");

    const result = await service.resolveObservationAuto(observation.id);
    expect(result.observation.resolutionStatus).toBe("resolved");
    expect(result.observation.canonicalItemId).toBeTruthy();
    expect(result.createdItem?.id).toBe(result.observation.canonicalItemId);

    const store2 = new PostgresIdentityStore(created.db);
    const reloaded = await store2.getCanonicalItem(result.observation.canonicalItemId!);
    expect(reloaded?.primaryNonce).toBe("persist-nonce");
    const obs = await store2.getObservation(observation.id);
    expect(obs?.canonicalItemId).toBe(result.observation.canonicalItemId);
    expect(obs?.rawItem).toMatchObject({ title: "Persist Book" });

    const accounts = new AccountsRepository(created.db);
    const createdAccount = await accounts.create({ mcUsername: "TestPlayer" });
    await accounts.update(createdAccount.id, { enabled: false });
    const disabled = await accounts.get(createdAccount.id);
    expect(disabled?.enabled).toBe(false);
    await accounts.softDelete(createdAccount.id);
    const listed = await accounts.list();
    expect(listed.find((row) => row.id === createdAccount.id)).toBeUndefined();

    const recreated = await accounts.create({ mcUsername: "TestPlayer" });
    expect(recreated.mcUsername).toBe("TestPlayer");
    expect(recreated.enabled).toBe(true);
  }, 60_000);

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  it("migrates and persists identity and accounts", () => {
    expect(true).toBe(true);
  });
});
