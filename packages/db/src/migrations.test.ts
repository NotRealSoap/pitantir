import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { runMigrations } from "./client.js";

const defaultUrl = "postgresql://pitantir:pitantir@localhost:5432/pitantir_test";
const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

async function resetDatabase(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });
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

describe("database migrations", () => {
  it("migrates up on a fresh database", async () => {
    const connectionString = process.env.DATABASE_URL ?? defaultUrl;
    await resetDatabase(connectionString);
    await runMigrations(connectionString, migrationsFolder);

    const sql = postgres(connectionString, { max: 1 });
    try {
      const tables = await sql<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;

      expect(tables.map((row) => row.table_name)).toEqual([
        "accounts",
        "admin_settings",
        "canonical_items",
        "identity_decisions",
        "item_identifiers",
        "item_location_periods",
        "observation_candidates",
        "observations",
      ]);

      const enums = await sql<{ typname: string }[]>`
        SELECT typname
        FROM pg_type
        WHERE typtype = 'e'
        ORDER BY typname
      `;
      expect(enums.map((row) => row.typname)).toContain("resolution_status");
    } finally {
      await sql.end();
    }
  });
});
