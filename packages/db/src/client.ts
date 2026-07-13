import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export function createDb(connectionString: string, options?: { max?: number }) {
  const client = postgres(connectionString, { max: options?.max ?? 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

export async function runMigrations(
  connectionString: string,
  migrationsFolder: string,
): Promise<void> {
  const { db, client } = createDb(connectionString, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await client.end();
  }
}

export type Database = ReturnType<typeof createDb>["db"];
