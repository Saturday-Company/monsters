import { lstatSync, mkdirSync, readlinkSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
// …and speak English with US dates and numbers whatever the machine's locale (D-153): a core
// started on a fresh home takes the system's language.
process.env['MONSTERS_LANG'] ??= 'en';
process.env['MONSTERS_LOCALE'] ??= 'en-US';

/*
 * The temporary folder of the tests is reached through a link, as on macOS
 * (`/var/folders/…` is `/private/var/folders/…`) and, with another spelling,
 * on Windows (`C:\Users\RUNNER~1\…` is `C:\Users\runneradmin\…`). So a test
 * that compares a path it built with one the code resolved (realpath, a
 * child's cwd, `require.resolve`) fails here on Linux too, not only on the
 * runners of the other systems. The link and the folder have names of
 * different length, so slicing one spelling with the length of the other
 * shows as well. `MONSTERS_TEST_TMPDIR=plain` keeps the system's folder.
 */
function linkedTmpdir(): string | null {
  if (process.platform === 'win32' || process.env['MONSTERS_TEST_TMPDIR'] === 'plain') return null;
  const base = resolve(tmpdir());
  let real: string;
  try {
    real = realpathSync(base);
  } catch {
    return null;
  }
  // Already behind a link (macOS): nothing to add.
  if (real !== base) return null;
  const uid = process.getuid?.() ?? 0;
  const dir = join(real, `monsters-tests-${uid}`);
  const link = join(real, `mt-${uid}`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = lstatSync(dir);
    if (!st.isDirectory() || st.uid !== uid) return null;
    try {
      symlinkSync(dir, link);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return null;
    }
    // A shared /tmp: only our own link to our own folder.
    const ls = lstatSync(link);
    if (!ls.isSymbolicLink() || ls.uid !== uid || readlinkSync(link) !== dir) return null;
    return link;
  } catch {
    return null;
  }
}

const linked = linkedTmpdir();
if (linked) process.env['TMPDIR'] = linked;
