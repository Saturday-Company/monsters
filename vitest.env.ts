/*
 * Environment of every test run, also when vitest starts from a package
 * folder (`pnpm --filter @monsters/core exec vitest run …`), where the root
 * config is not read: without it a test core asked the system keychain and
 * waited its 20 s timeout at each start (D-079), and could download the
 * embedding model.
 */

// Tests never download the embedding model: hubs and cores started by tests
// search full-text only, unless a test passes its own (fake) embedder.
process.env['MONSTERS_EMBEDDINGS'] ??= 'off';
// …and never start a Telegram bot from a token found in the environment.
process.env['MONSTERS_TELEGRAM'] ??= 'off';
// …and never touch the system keychain: secrets in plain files (D-042). Tests of
// the keychain backend pass a fake keychain explicitly.
process.env['MONSTERS_SECRETS'] ??= 'file';
