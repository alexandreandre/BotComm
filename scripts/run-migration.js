#!/usr/bin/env node
/**
 * Applique db/migrations/001_init.sql sur DATABASE_URL.
 * Usage: DATABASE_URL=postgres://... npm run db:migrate
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL manquant");
    process.exit(1);
  }
  const sqlPath = path.join(__dirname, "..", "db", "migrations", "001_init.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Migration 001_init.sql appliquée.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
