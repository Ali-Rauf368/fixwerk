import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('organizer', 'fixer')),
  skills        TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY,
  title     TEXT NOT NULL,
  location  TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'live', 'closed'))
);
CREATE TABLE IF NOT EXISTS tickets (
  id            INTEGER PRIMARY KEY,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code          TEXT NOT NULL UNIQUE,
  visitor_name  TEXT NOT NULL,
  visitor_email TEXT,
  item          TEXT NOT NULL,
  category      TEXT NOT NULL,
  brand         TEXT,
  problem       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_repair', 'done')),
  outcome       TEXT CHECK (outcome IN ('fixed', 'partial', 'advice', 'not_fixable')),
  fixer_id      INTEGER REFERENCES users(id),
  weight_kg     REAL,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets (event_id, status);
CREATE TABLE IF NOT EXISTS event_fixers (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (event_id, user_id)
);
CREATE TABLE IF NOT EXISTS parts (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  category  TEXT NOT NULL,
  stock     INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  unit_cost REAL NOT NULL DEFAULT 0 CHECK (unit_cost >= 0)
);
CREATE TABLE IF NOT EXISTS ticket_parts (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  part_id   INTEGER NOT NULL REFERENCES parts(id),
  qty       INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (ticket_id, part_id)
);
CREATE TABLE IF NOT EXISTS ticket_log (
  id        INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  action    TEXT NOT NULL,
  actor_id  INTEGER REFERENCES users(id),
  detail    TEXT,
  at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_ticket ON ticket_log (ticket_id, at);
CREATE TABLE IF NOT EXISTS outbox (
  id         INTEGER PRIMARY KEY,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  ticket_id  INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_fixer ON tickets (fixer_id, category);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Additive migrations so databases created by older versions keep working.
const COLUMNS = [
  ['tickets', 'rating', 'INTEGER CHECK (rating BETWEEN 1 AND 5)'],
  ['tickets', 'feedback', 'TEXT'],
  ['users', 'active', 'INTEGER NOT NULL DEFAULT 1'],
];

function migrate(db) {
  for (const [table, column, def] of COLUMNS) {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

/** Run fn inside a transaction. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
