import type { Migration } from './migrations.ts';

/** Migrations of the "core" namespace. Never edit an applied migration: add a new one. */
export const coreMigrations: readonly Migration[] = [
  {
    version: 1,
    name: 'events',
    up: `
      CREATE TABLE events (
        id        TEXT    PRIMARY KEY,
        ts        INTEGER NOT NULL,
        agent     TEXT    NOT NULL,
        run_id    TEXT,
        parent_id TEXT,
        type      TEXT    NOT NULL,
        data      TEXT    NOT NULL
      ) STRICT;
      CREATE INDEX events_ts ON events (ts);
      CREATE INDEX events_agent_ts ON events (agent, ts);
      CREATE INDEX events_type_ts ON events (type, ts);
      CREATE INDEX events_run ON events (run_id, id);
      CREATE TRIGGER events_no_update BEFORE UPDATE ON events
        BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
      CREATE TRIGGER events_no_delete BEFORE DELETE ON events
        BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
    `,
  },
  {
    version: 2,
    name: 'auth',
    up: `
      CREATE TABLE users (
        id            TEXT    PRIMARY KEY,
        email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT    NOT NULL,
        created_at    INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE sessions (
        token_hash   TEXT    PRIMARY KEY,
        user_id      TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at   INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX sessions_expires ON sessions (expires_at);
      CREATE TABLE api_tokens (
        name         TEXT    PRIMARY KEY,
        token_hash   TEXT    NOT NULL UNIQUE,
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER
      ) STRICT;
    `,
  },
  {
    version: 3,
    name: 'state',
    up: `
      CREATE TABLE state (
        key        TEXT    PRIMARY KEY,
        value      TEXT    NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
    `,
  },
  {
    // One agent's events of one type in id order (the Consumi panel, D-079):
    // `events_agent_ts` alone walked every event of the agent.
    version: 4,
    name: 'events_agent_type',
    up: `CREATE INDEX events_agent_type_id ON events (agent, type, id);`,
  },
  {
    // A session opened with a login token the CLI token asked for (review of 18/10, M1): it
    // reads and works like any session but cannot approve, grant or pair (`AuthContext.owner`).
    version: 5,
    name: 'sessions_limited',
    up: `ALTER TABLE sessions ADD COLUMN limited INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    // S-B13 and the residual risk of M1 (review of 18/10): a browser's session is bound to a
    // secret the UI keeps in its tab (`secret_hash`, null for the desktop app's own cookie jar);
    // `confirmed_at` is when the password was last typed in it, `bridge` a session the desktop
    // app opened over its own channel. The sessions of before had no secret: they all end here
    // (the browser asks the password once, the app logs in again by itself).
    version: 6,
    name: 'sessions_secret',
    up: `
      ALTER TABLE sessions ADD COLUMN secret_hash TEXT;
      ALTER TABLE sessions ADD COLUMN confirmed_at INTEGER;
      ALTER TABLE sessions ADD COLUMN bridge INTEGER NOT NULL DEFAULT 0;
      DELETE FROM sessions;
    `,
  },
];
