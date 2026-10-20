/*
 * Demo of the second brain: creates a vault in a temporary folder, writes
 * linked notes, searches, renames with link updates, undoes, prints the log.
 * Run with `pnpm --filter @monsters/vault demo` (add `--keep` to keep the folder).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolError } from '@monsters/shared';
import { VaultService, type VaultActor } from '../src/index.ts';

const out = (line = '') => process.stdout.write(`${line}\n`);
const keep = process.argv.includes('--keep');
const dir = mkdtempSync(join(tmpdir(), 'monsters-demo-'));
const root = join(dir, 'Monsters Note');

const titan: VaultActor = {
  agentId: 'titan',
  emit: (e) => out(`  · evento ${e.type}: ${JSON.stringify(e.data)}`),
};
const rhea: VaultActor = { agentId: 'rhea' };

const vault = await VaultService.create({
  root,
  permissions: { orchestrator: 'titan', agents: { rhea: { name: 'Rhea' } } },
  orchestratorName: 'Titan',
  agentNames: ['Rhea'],
});
try {
  out(`Vault creato in ${root} (git: ${vault.gitBackend})`);

  out('\n1. Titan scrive tre note collegate');
  await vault.write(titan, {
    path: 'Persone/Marco Rossi',
    content: '# Marco Rossi\n\nSocio, si occupa del lancio a Città di Castello.\n',
    frontmatter: { type: 'person', tags: ['persona/socio'], aliases: ['Marco'] },
  });
  await vault.write(titan, {
    path: 'Progetti/Lancio Monsters',
    content:
      '# Lancio Monsters\n\nObiettivo: beta a novembre.\n\n## Collegamenti\n- con [[Marco Rossi]]\n',
    frontmatter: { type: 'project', tags: ['progetto/monsters'], status: 'active' },
  });
  await vault.write(titan, {
    path: 'Inbox/Riunione 14 ottobre',
    content:
      '# Riunione 14 ottobre\n\n[[Marco Rossi|Marco]] conferma la data del [[Lancio Monsters]].\n',
  });

  out('\n2. Ricerca "citta" (senza accento)');
  for (const hit of await vault.search(titan, { query: 'citta' }))
    out(`  ${hit.path}: ${hit.snippet}`);
  out('   Ricerca per tag "progetto"');
  for (const hit of await vault.search(titan, { tags: ['progetto'] })) out(`  ${hit.path}`);

  out('\n3. Rhea prova a modificare un progetto (fuori dalla sua area)');
  try {
    await vault.write(rhea, { path: 'Progetti/Altro', content: 'x' });
  } catch (err) {
    if (!(err instanceof ToolError)) throw err;
    out(`  ${err.code}: ${err.message}\n  suggerimento: ${err.hint}`);
  }

  out(
    '\n4. Titan rinomina "Marco Rossi" in "Marco Bianchi": i link si aggiornano in un solo commit',
  );
  const moved = await vault.move(titan, { from: 'Marco Rossi', to: 'Persone/Marco Bianchi' });
  out(`  file aggiornati: ${moved.updated_files.join(', ')}`);
  out(`  ${readFileSync(join(root, 'Inbox/Riunione 14 ottobre.md'), 'utf8').split('\n').at(-2)}`);

  out('\n5. Annulla la rinomina');
  const undone = await vault.undo(titan, { action_id: moved.action_id });
  out(`  ripristinati: ${undone.files.join(', ')}`);
  out(`  ${readFileSync(join(root, 'Inbox/Riunione 14 ottobre.md'), 'utf8').split('\n').at(-2)}`);

  out('\n6. git log');
  for (const c of await vault.history(titan, { limit: 20 })) {
    out(`  ${c.commit.slice(0, 7)} ${c.date} ${c.author.padEnd(8)} ${c.message}`);
  }
} finally {
  await vault.close();
  if (keep) out(`\nCartella conservata: ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
}
