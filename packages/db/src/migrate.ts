import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./client.js";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://pitantir:pitantir@localhost:5432/pitantir";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(packageRoot, "..", "migrations");

await runMigrations(connectionString, migrationsFolder);
console.log("Migrations applied successfully.");
