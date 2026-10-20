/*
 * The guard of the public repo (D-143): it finds the classes of private data, the hashed private
 * terms and the terms of the local list, lets the examples and the fake fixtures through, and
 * fails the command on a real checkout with a finding. Every value here is fake (alice, bob,
 * example hosts), and the secret-shaped ones are built at runtime so this file passes the guard.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashTerm, normalizeTerm, parseLocalTerms, scan, termSet } from './check-public.ts';

const j = (...p: string[]): string => p.join('');
const file = (path: string, content: string | null) => ({ path, content });
const rules = (findings: ReturnType<typeof scan>) =>
  findings.map((f) => `${f.file}:${f.line}:${f.rule}`);

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('check-public: classes', () => {
  it('finds addresses, paths, mailboxes, sessions, drafts and real-looking secrets', () => {
    const text = [
      `HostName ${j('100.', '91.', '20.', '7')}`,
      `cd ${j('/srv', '/acme-corp')}/progetti`,
      `log in ${j('/home', '/zoe-real')}/x and ${j('/Users', '/zoe-real')}`,
      j('Claude', '-Session: https://claude.ai/code/', 'session_01ABC'),
      `mail ${j('someone.real', '@gmail.com')} and ${j('zoe', '@saturdaycompany.it')}`,
      `key ${j('sk-or-', 'v1-', '9f3c1b7e2d4a6c8e0b5d7f9a1c3e5b7d')}`,
      `token ${j('81234', '5678:', 'AAH7kQx2LmN9pRt4VwY6zB8cD0eF1gJ3hKs')}`,
      `scratch ${j('/tmp', '/claude-', '1000')}/x`,
    ].join('\n');
    expect(rules(scan([file('docs/x.md', text), file('bozze/ref.png', null)]))).toEqual([
      'docs/x.md:1:cgnat-address',
      'docs/x.md:2:private-path',
      'docs/x.md:3:private-path',
      'docs/x.md:3:private-path',
      'docs/x.md:8:private-path',
      'docs/x.md:5:personal-email',
      'docs/x.md:5:company-email',
      'docs/x.md:4:agent-session',
      'docs/x.md:4:agent-session',
      'docs/x.md:6:secret',
      'docs/x.md:7:secret',
      'bozze/ref.png:0:third-party-draft',
    ]);
  });

  it('lets examples and fake fixtures through', () => {
    const text = [
      'HostName 100.64.0.1',
      "'http://100.127.1.1:4747/'",
      'Host my-desktop\n  User alice',
      '/home/alice/.monsters, /home/u/x.deb, /Users/monsters-sign and /srv/progetti',
      '"$h/home/logs/desktop.log" and ~/home/whatever',
      'write to opensource@saturdaycompany.it, or a@b.it',
      j('sk-or-', 'v1-0123456789abcdef0123456789abcdef'),
      j('sk-ant-', 'api03-testkey000000000000'),
      j('AKIA', 'IOSFODNN7EXAMPLE'),
      j('mario.rossi', '@gmail.com'),
      '-----BEGIN OPENSSH PRIVATE KEY-----\nabc',
      'Copyright 2026 Giulio Banchini and Saturday Company',
      'version 1.100.64.1 and 2100.70.1.1',
    ].join('\n');
    expect(scan([file('packages/x/test/a.test.ts', text)])).toEqual([]);
  });
});

describe('check-public: private terms', () => {
  it('normalises case and gaps, keeping a single . _ -', () => {
    expect(normalizeTerm('  Alice  HOST ')).toBe('alice host');
    expect(normalizeTerm('Alice, host')).toBe('alice host');
    expect(normalizeTerm('Alice-Secret.Host')).toBe('alice-secret.host');
    expect(normalizeTerm('a -- b')).toBe('a b');
  });

  it('hashes a term with SHA-256 of its normalised key', () => {
    expect(hashTerm('Alice-Secret-Host')?.[3]).toBe(
      '824e11d65da3ad6d3276d0d0b102b7e568f2eec972167620a1bf1fb77552342d',
    );
    expect(hashTerm(' -- ')).toBeNull();
  });

  it('matches hashed terms in any case, inside longer names and across punctuation', () => {
    const terms = termSet([hashTerm('alice-secret-host')!, hashTerm('bob project')!]);
    const text = [
      'ssh ALICE-Secret-Host', // 1: case
      'url https://alice-secret-host.example.org/x', // 2: inside a longer host
      'the Bob   Project page', // 3: two atoms, spaces
      'Bob, project', // 4: across punctuation
      'alice secret host', // 5: other gaps: no match
      'alice-secret-hostname and bobproject', // 6: other atoms: no match
    ].join('\n');
    expect(scan([file('docs/a.md', text)], terms).map((f) => [f.line, f.match])).toEqual([
      [1, 'ALICE-Secret-Host'],
      [2, 'alice-secret-host'],
      [3, 'Bob   Project'],
      [4, 'Bob, project'],
    ]);
  });

  it('checks file names and adds the plain-text terms of the local list', () => {
    const local = parseLocalTerms('# private\n\n  carol-box \nDave Lab\n');
    expect(local).toEqual(['carol-box', 'Dave Lab']);
    const terms = termSet([], local);
    expect(
      rules(scan([file('docs/carol-box.png', null), file('a.md', 'see dave lab\n')], terms)),
    ).toEqual(['docs/carol-box.png:0:private-term', 'a.md:1:private-term']);
  });

  it('keeps the shipped list free of everyday words', () => {
    const text = 'Monsters CI on a Mac, the vault, alice, example.com, MONSTERS_MAC_HOST, pnpm';
    expect(scan([file('README.md', text)])).toEqual([]);
  });
});

describe('check-public: command', () => {
  function repoWith(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'monsters-check-public-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'scripts'));
    cpSync(join(import.meta.dirname, 'check-public.ts'), join(dir, 'scripts', 'check-public.ts'));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    return dir;
  }
  const run = (dir: string) =>
    spawnSync(process.execPath, [join(dir, 'scripts', 'check-public.ts')], {
      cwd: dir,
      encoding: 'utf8',
    });

  it('passes on a clean tree and fails on one private value, untracked files included', () => {
    const dir = repoWith({ 'README.md': '# Example\nssh alice@100.64.0.1\n' });
    expect(run(dir).status).toBe(0);
    writeFileSync(join(dir, 'notes.md'), `server ${j('100.', '67.', '1.', '2')}\n`);
    const bad = run(dir);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('notes.md:1 cgnat-address');
  });

  it('ignores what git ignores', () => {
    const dir = repoWith({
      '.gitignore': 'ci.local.env\n',
      'ci.local.env': `MONSTERS_MAC_HOST=${j('100.', '91.', '1.', '2')}\n`,
    });
    expect(run(dir).status).toBe(0);
  });

  it('reads the local list when gitignored, and refuses to run when it would be published', () => {
    const dir = repoWith({
      '.gitignore': 'scripts/check-public.local.txt\n',
      'README.md': '# Example\nThe Erin-Lab host.\n',
    });
    writeFileSync(join(dir, 'scripts', 'check-public.local.txt'), '# terms\nerin-lab\n');
    const bad = run(dir);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('README.md:2 private-term: Erin-Lab');
    writeFileSync(join(dir, '.gitignore'), '');
    const exposed = run(dir);
    expect(exposed.status).toBe(2);
    expect(exposed.stderr).toContain('would be published');
  });
});
