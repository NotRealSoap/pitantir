import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { runMigrations } from "./client.js";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(packageRoot, "..", "..");

// Match the Next app: prefer apps/web/.env.local, then repo .env
loadEnv({ path: path.join(repoRoot, "apps", "web", ".env.local") });
loadEnv({ path: path.join(repoRoot, ".env") });

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://pitantir:pitantir@localhost:5432/pitantir";

const migrationsFolder = path.join(packageRoot, "..", "migrations");

console.log(`Migrating: ${connectionString.replace(/:[^:@/]+@/, ":***@")}`);
await runMigrations(connectionString, migrationsFolder);
console.log("Migrations applied successfully.");
