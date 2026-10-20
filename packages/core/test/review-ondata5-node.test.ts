import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { monsterWritableFolders } from '../src/hub.ts';
import { defaultProjectsDir, loadHubSettings } from '../src/team/settings.ts';

/*
 * Review of wave 5, n. 9: inside the app the `node` of the JavaScript children is pinned at
 * the start of the core, never from a folder a monster can write. These are those folders.
 */
describe("folders left out of the search for the children's node", () => {
  it('the data directory, the vault, the projects folder and the folders granted for writing', () => {
    const home = join('/', 'tmp', 'monsters-n9', 'home');
    const settings = loadHubSettings(
      home,
      {
        vault: '/tmp/monsters-n9/vault',
        permissions: {
          folders: [
            { path: '/work/shared', write: true },
            { path: '/work/read-only', write: false },
          ],
          agents: { scout: { folders: [{ path: '/work/scout', write: true }] } },
        },
      },
      {},
    );
    expect(monsterWritableFolders(home, settings)).toEqual([
      home,
      '/tmp/monsters-n9/vault',
      defaultProjectsDir(home),
      '/work/shared',
      '/work/scout',
    ]);
  });
});
