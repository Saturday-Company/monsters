import type { Migration } from '@monsters/db';

/*
 * Index of the vault (research/04 §6.4). It lives outside the vault and can be
 * rebuilt from the files at any time. Tables are prefixed with `vault_` so the
 * namespace can share a database with other packages.
 * Never edit an applied migration: add a new one.
 */
export const vaultMigrations: readonly Migration[] = [
  {
    version: 1,
    name: 'index',
    // i18n-ignore: SQL (data), not copy
    up: `
      CREATE TABLE vault_notes (
        nid       INTEGER PRIMARY KEY,
        path      TEXT    NOT NULL UNIQUE,
        path_key  TEXT    NOT NULL,
        name_key  TEXT    NOT NULL,
        folder    TEXT    NOT NULL,
        uid       TEXT,
        title     TEXT    NOT NULL,
        type      TEXT,
        author    TEXT,
        created   TEXT,
        updated   TEXT    NOT NULL,
        hash      TEXT    NOT NULL,
        mtime     INTEGER NOT NULL,
        size      INTEGER NOT NULL,
        private   INTEGER NOT NULL DEFAULT 0,
        is_md     INTEGER NOT NULL,
        summary   TEXT    NOT NULL DEFAULT ''
      ) STRICT;
      CREATE INDEX vault_notes_path_key ON vault_notes (path_key);
      CREATE INDEX vault_notes_name_key ON vault_notes (name_key);
      CREATE INDEX vault_notes_uid ON vault_notes (uid);
      CREATE INDEX vault_notes_updated ON vault_notes (updated);

      CREATE TABLE vault_props (
        nid        INTEGER NOT NULL REFERENCES vault_notes (nid) ON DELETE CASCADE,
        key        TEXT    NOT NULL,
        value_json TEXT    NOT NULL,
        PRIMARY KEY (nid, key)
      ) STRICT;
      CREATE INDEX vault_props_key ON vault_props (key);

      -- Frontmatter and inline tags; hierarchical prefixes are expanded (explicit = 0).
      CREATE TABLE vault_tags (
        nid      INTEGER NOT NULL REFERENCES vault_notes (nid) ON DELETE CASCADE,
        tag      TEXT    NOT NULL,
        explicit INTEGER NOT NULL,
        PRIMARY KEY (nid, tag)
      ) STRICT;
      CREATE INDEX vault_tags_tag ON vault_tags (tag);

      CREATE TABLE vault_aliases (
        nid   INTEGER NOT NULL REFERENCES vault_notes (nid) ON DELETE CASCADE,
        alias TEXT    NOT NULL,
        akey  TEXT    NOT NULL
      ) STRICT;
      CREATE INDEX vault_aliases_akey ON vault_aliases (akey);

      -- target_nid NULL = unresolved link.
      CREATE TABLE vault_links (
        src_nid     INTEGER NOT NULL REFERENCES vault_notes (nid) ON DELETE CASCADE,
        ord         INTEGER NOT NULL,
        kind        TEXT    NOT NULL,
        target_raw  TEXT    NOT NULL,
        target_key  TEXT    NOT NULL,
        target_nid  INTEGER REFERENCES vault_notes (nid) ON DELETE SET NULL,
        heading     TEXT,
        block       TEXT,
        alias       TEXT,
        is_embed    INTEGER NOT NULL,
        in_property INTEGER NOT NULL,
        start_pos   INTEGER NOT NULL,
        end_pos     INTEGER NOT NULL,
        PRIMARY KEY (src_nid, ord)
      ) STRICT;
      CREATE INDEX vault_links_target ON vault_links (target_nid);
      CREATE INDEX vault_links_key ON vault_links (target_key);

      -- Semantic search (phase 2): chunks by heading and their embeddings.
      CREATE TABLE vault_chunks (
        id           INTEGER PRIMARY KEY,
        nid          INTEGER NOT NULL REFERENCES vault_notes (nid) ON DELETE CASCADE,
        ord          INTEGER NOT NULL,
        heading_path TEXT    NOT NULL,
        text         TEXT    NOT NULL,
        token_count  INTEGER NOT NULL,
        hash         TEXT    NOT NULL
      ) STRICT;
      CREATE INDEX vault_chunks_nid ON vault_chunks (nid, ord);
      CREATE TABLE vault_embeddings (
        chunk_id INTEGER PRIMARY KEY REFERENCES vault_chunks (id) ON DELETE CASCADE,
        model    TEXT    NOT NULL,
        dim      INTEGER NOT NULL,
        vec      BLOB    NOT NULL
      ) STRICT;

      -- One row per note (rowid = nid). "citta" finds "città".
      CREATE VIRTUAL TABLE vault_fts USING fts5 (
        title, aliases, tags, headings, body,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      -- Bridge to the action log: every write action and its commit.
      CREATE TABLE vault_actions (
        id          TEXT    PRIMARY KEY,
        ts          INTEGER NOT NULL,
        agent       TEXT    NOT NULL,
        tool        TEXT    NOT NULL,
        params_json TEXT    NOT NULL,
        paths_json  TEXT    NOT NULL,
        commit_oid  TEXT,
        status      TEXT    NOT NULL
      ) STRICT;
      CREATE INDEX vault_actions_ts ON vault_actions (ts);
    `,
  },
  {
    version: 2,
    name: 'proposals',
    up: `
      -- Archive of the proposals made with vault_propose, outside the vault:
      -- agents can edit the proposal note in Inbox/, never this record. Like
      -- vault_actions it is not rebuilt from the files (reindex keeps it).
      CREATE TABLE vault_proposals (
        id          TEXT    PRIMARY KEY,
        ts          INTEGER NOT NULL,
        path        TEXT    NOT NULL,
        author      TEXT    NOT NULL,
        target_path TEXT    NOT NULL,
        base_hash   TEXT    NOT NULL,
        ops_json    TEXT    NOT NULL,
        ops_hash    TEXT    NOT NULL,
        body_hash   TEXT    NOT NULL,
        status      TEXT    NOT NULL
      ) STRICT;
      CREATE INDEX vault_proposals_path ON vault_proposals (path);
    `,
  },
  {
    version: 3,
    name: 'semantic',
    up: `
      -- Vectors by chunk hash and model, not by note: a reindex, a rename or
      -- an undo that brings back the same text needs no new embedding.
      -- Replaces vault_embeddings (never filled).
      DROP TABLE vault_embeddings;
      CREATE TABLE vault_vectors (
        hash  TEXT    NOT NULL,
        model TEXT    NOT NULL,
        dim   INTEGER NOT NULL,
        vec   BLOB    NOT NULL,
        PRIMARY KEY (hash, model)
      ) STRICT;
      CREATE INDEX vault_chunks_hash ON vault_chunks (hash);

      -- Full-text with Italian stems: *_stem hold the Snowball stems of the
      -- words ("ricette" and "ricetta" → "ricett"). The table is rebuilt:
      -- the service reindexes the vault after this migration.
      DROP TABLE vault_fts;
      CREATE VIRTUAL TABLE vault_fts USING fts5 (
        title, aliases, tags, headings, body, title_stem, body_stem,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `,
  },
  {
    version: 4,
    name: 'reindex_pending',
    up: `
      -- State of the index. reindex_pending = '1' while a rebuild from the
      -- files is due or running: set in the same transaction as a migration
      -- that needs it, cleared only when the rebuild is complete, so a core
      -- stopped half-way resumes it at the next start. Set here because
      -- migration 3 was recorded before its rebuild (an index left with an
      -- empty full-text table heals itself).
      CREATE TABLE vault_meta (
        key   TEXT NOT NULL PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      INSERT INTO vault_meta (key, value) VALUES ('reindex_pending', '1');
    `,
  },
];
