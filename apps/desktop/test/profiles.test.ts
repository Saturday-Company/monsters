import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_CHOICE,
  parseConnectionsFile,
  parseProfileForm,
  profileAddress,
  ProfileStore,
  withSshAlias,
} from '../src/main/profiles.ts';
import { tempDir } from './helpers.ts';

function storePath(): string {
  const dir = tempDir();
  mkdirSync(dir, { recursive: true });
  return join(dir, 'connections.json');
}

let ids = 0;
const newId = () => `id-0000000${ids++}`;

describe('profile form', () => {
  it('turns the strings of the page into a profile, optional fields left out', () => {
    expect(
      parseProfileForm({
        name: '  PC di casa ',
        host: 'casa.tailnet.ts.net',
        user: '',
        sshPort: '',
        identityFile: '',
        remotePort: '4747',
        remoteHome: '',
        autoLogin: true,
      }),
    ).toEqual({
      ok: true,
      profile: {
        name: 'PC di casa',
        host: 'casa.tailnet.ts.net',
        remotePort: 4747,
        autoLogin: true,
      },
    });
  });

  it('splits utente@computer, the user field wins', () => {
    expect(parseProfileForm({ name: 'x', host: 'giulio@casa' })).toMatchObject({
      ok: true,
      profile: { host: 'casa', user: 'giulio' },
    });
    expect(parseProfileForm({ name: 'x', host: 'giulio@casa', user: 'admin' })).toMatchObject({
      ok: true,
      profile: { host: 'casa', user: 'admin' },
    });
    // Automatic login on unless turned off (decided 15/10/2026).
    expect(parseProfileForm({ name: 'x', host: 'casa' })).toMatchObject({
      profile: { autoLogin: true },
    });
    expect(parseProfileForm({ name: 'x', host: 'casa', autoLogin: false })).toMatchObject({
      profile: { autoLogin: false },
    });
  });

  it('says what is wrong, field by field', () => {
    const r = parseProfileForm({
      name: 'x'.repeat(81),
      host: '-oProxyCommand=evil',
      user: 'a b',
      sshPort: '99999',
      remotePort: '47a',
      remoteHome: "~/x'; rm -rf ~",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual([
      'host',
      'name',
      'remoteHome',
      'remotePort',
      'sshPort',
      'user',
    ]);
    expect(r.errors.sshPort).toMatch(/between 1 and 65535/);
    expect(r.errors.host).toMatch(/no spaces/);
    // Spaces: the name of the connection typed in the address field.
    expect(parseProfileForm({ name: 'x', host: 'casa con spazi' })).toMatchObject({
      ok: false,
      errors: { host: /looks like the connection’s name/ },
    });
    expect(parseProfileForm(null)).toMatchObject({ ok: false });
  });

  it('shows the address as user@computer:port', () => {
    expect(profileAddress({ name: 'x', host: 'casa' })).toBe('casa');
    expect(profileAddress({ name: 'x', host: 'casa', user: 'g', sshPort: 2222 })).toBe(
      'g@casa:2222',
    );
  });
});

describe('profile store', () => {
  it('adds, edits, removes and remembers the last choice, in a private file', () => {
    const path = storePath();
    const store = new ProfileStore(path, { newId });
    expect(store.list()).toEqual([]);
    expect(store.last).toBe(LOCAL_CHOICE);

    const added = store.save({ name: 'Casa', host: 'casa' });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const id = added.profile.id;
    store.setLast(id);

    const edited = store.save({ id, name: 'Casa', host: 'casa', sshPort: '2222' });
    expect(edited).toMatchObject({ ok: true, profile: { id, sshPort: 2222 } });
    // An unknown id is a new profile, never someone else's.
    const other = store.save({ id: 'id-zzzzzzzz', name: 'Ufficio', host: 'ufficio' });
    expect(other.ok && other.profile.id).not.toBe('id-zzzzzzzz');

    const reread = new ProfileStore(path);
    expect(reread.list().map((p) => p.name)).toEqual(['Casa', 'Ufficio']);
    expect(reread.last).toBe(id);
    expect(reread.get(id)).toMatchObject({ host: 'casa', sshPort: 2222, autoLogin: true });
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);

    // Removing the profile in use brings the choice back home.
    expect(reread.remove(id)).toBe(true);
    expect(reread.remove(id)).toBe(false);
    expect(reread.last).toBe(LOCAL_CHOICE);
    expect(new ProfileStore(path).list().map((p) => p.name)).toEqual(['Ufficio']);
    // An invalid form changes nothing.
    expect(reread.save({ name: '', host: '' }).ok).toBe(false);
    expect(new ProfileStore(path).list()).toHaveLength(1);
  });

  it('survives a broken or tampered file: bad entries are dropped', () => {
    const path = storePath();
    writeFileSync(path, '{ not json');
    expect(new ProfileStore(path).list()).toEqual([]);
    const file = parseConnectionsFile(
      JSON.stringify({
        version: 1,
        last: 'id-missing0',
        profiles: [
          { id: 'id-good0000', name: 'Buono', host: 'casa', autoLogin: true },
          { id: 'id-good0000', name: 'Doppio', host: 'casa' },
          { id: 'id-evil0000', name: 'Cattivo', host: '-oProxyCommand=x' },
          { id: '../../x', name: 'Id strano', host: 'casa' },
          'nonsense',
        ],
      }),
    );
    expect(file).toEqual({
      version: 1,
      last: LOCAL_CHOICE,
      profiles: [{ id: 'id-good0000', name: 'Buono', host: 'casa', autoLogin: true }],
    });
    writeFileSync(path, JSON.stringify(file));
    const store = new ProfileStore(path);
    store.setLast('not-a-profile');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ last: LOCAL_CHOICE });
  });
});

describe('withSshAlias', () => {
  const config = 'Host my-desktop\n  HostName 100.64.0.1\n  User alice\n';

  it('uses the alias of the SSH config for its address when the form has no user or key', () => {
    expect(withSshAlias({ host: '100.64.0.1', name: 'PC-casa' }, config)).toEqual({
      host: 'my-desktop',
      name: 'PC-casa',
    });
  });

  it('keeps the form when the user chose a user, a key or typed utente@computer', () => {
    for (const form of [
      { host: '100.64.0.1', user: 'altro' },
      { host: '100.64.0.1', identityFile: '~/.ssh/id' },
      { host: 'altro@100.64.0.1' },
      { host: '100.1.1.1' },
    ]) {
      expect(withSshAlias(form, config)).toBe(form);
    }
    expect(withSshAlias({ host: '100.64.0.1' }, null)).toEqual({ host: '100.64.0.1' });
  });
});
