import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPostgresPool(): pg.Pool {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for direct repository chunk persistence.");
  }
  pool ??= new Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: Math.min(env.DATABASE_REQUEST_TIMEOUT_MS, 10_000),
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

export async function closePostgresConnections(): Promise<void> {
  const current = pool;
  pool = null;
  await current?.end();
}
