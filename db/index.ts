import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function connectionString() {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL não configurada. Conecte um banco Neon ao projeto na Vercel.");
  }
  return value;
}

export function getDb() {
  return drizzle(neon(connectionString()), { schema });
}

let initialization: Promise<void> | undefined;

export function ensureDatabase() {
  initialization ??= initializeDatabase();
  return initialization;
}

async function initializeDatabase() {
  const sql = neon(connectionString());
  await sql`CREATE TABLE IF NOT EXISTS works (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
  await sql`CREATE TABLE IF NOT EXISTS rncs (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    number TEXT NOT NULL,
    year INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT 'Descrição não identificada',
    type TEXT NOT NULL DEFAULT 'A classificar',
    received_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    sent_at TEXT,
    returned_at TEXT,
    status TEXT NOT NULL DEFAULT 'Recebida',
    notes TEXT NOT NULL DEFAULT '',
    response_owner TEXT NOT NULL DEFAULT '',
    analysis_owner TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT rncs_work_number_year_unique UNIQUE(work_id, number, year)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS rncs_status_idx ON rncs(status)`;
  await sql`CREATE INDEX IF NOT EXISTS rncs_due_at_idx ON rncs(due_at)`;
  await sql`CREATE TABLE IF NOT EXISTS email_events (
    id SERIAL PRIMARY KEY,
    rnc_id INTEGER NOT NULL REFERENCES rncs(id),
    outlook_message_id TEXT UNIQUE,
    event_type TEXT NOT NULL,
    sender TEXT,
    recipients TEXT,
    subject TEXT,
    summary TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    attachment_metadata TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
  await sql`CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    rnc_id INTEGER NOT NULL REFERENCES rncs(id),
    user_name TEXT NOT NULL DEFAULT 'Acesso direto',
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
  await sql`CREATE INDEX IF NOT EXISTS audit_rnc_idx ON audit_log(rnc_id)`;
}
