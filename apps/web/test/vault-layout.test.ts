import { setVaultLayout, type VaultNoteSummary } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { filterNotes } from '../src/components/vault/NoteList.tsx';
import { isAgentNote } from '../src/components/vault/shared.tsx';
import { newFolderIn, newFolderPath } from '../src/lib/projects.ts';
import { agentFileOf } from '../src/store/derive.ts';
import { receiptMemories, receiptNotes } from '../src/store/instinct.ts';

/*
 * The UI names the paths of the vault the core says (D-154, `vaultLayout` of
 * `/api/setup-status`): `Agents/`, `state.md`, `~/Monsters Projects` in an English vault, the
 * Italian names in every vault made before.
 */

afterEach(() => setVaultLayout('it'));

const note = (path: string): VaultNoteSummary =>
  ({ path, title: path, tags: [] }) as unknown as VaultNoteSummary;

describe('an English vault in the UI', () => {
  it('hides the monsters’ own notes of Agents/, not those of a folder named Agenti/', () => {
    setVaultLayout('en');
    expect(isAgentNote('Agents/Rhea/MEMORY.md')).toBe(true);
    expect(isAgentNote('Agents')).toBe(true);
    expect(isAgentNote('Agenti/Rhea/MEMORY.md')).toBe(false);
    const notes = [note('Agents/Rhea/MEMORY.md'), note('Inbox/Idea.md')];
    expect(filterNotes(notes, { tags: [], folder: '' }).map((n) => n.path)).toEqual([
      'Inbox/Idea.md',
    ]);
    // Inside the folder of the monsters they show.
    expect(filterNotes(notes, { tags: [], folder: 'Agents/Rhea' }).map((n) => n.path)).toEqual([
      'Agents/Rhea/MEMORY.md',
    ]);
  });

  it('reads the monsters’ memory and state files, and the receipts', () => {
    setVaultLayout('en');
    expect(agentFileOf('Agents/Rhea/MEMORY.md')).toEqual({ owner: 'Rhea', kind: 'memory' });
    expect(agentFileOf('Agents/Rhea/state.md')).toEqual({ owner: 'Rhea', kind: 'state' });
    expect(agentFileOf('Agents/Rhea/Notes/x.md')).toEqual({ owner: 'Rhea', kind: 'other' });
    expect(agentFileOf('Agenti/Rhea/stato.md')).toBeNull();
    const receipt = {
      notes: [
        { path: 'Agents/Rhea/MEMORY.md', action: 'edit' },
        { path: 'Inbox/Idea.md', action: 'create' },
      ],
    } as unknown as Parameters<typeof receiptMemories>[0];
    expect(receiptMemories(receipt)).toEqual(['Rhea']);
    expect(receiptNotes(receipt).map((n) => n.path)).toEqual(['Inbox/Idea.md']);
  });

  it('puts a new project folder in ~/Monsters Projects', () => {
    setVaultLayout('en');
    expect(newFolderPath('Site: new')).toBe('~/Monsters Projects/Site new');
    expect(newFolderPath('  ')).toBe('~/Monsters Projects/Project');
    expect(newFolderIn('/home/g/work', '  ')).toBe('/home/g/work/Project');
  });
});

describe('an Italian vault in the UI', () => {
  it('keeps the names of every vault made before', () => {
    setVaultLayout('it');
    expect(isAgentNote('Agenti/Rhea/MEMORY.md')).toBe(true);
    expect(isAgentNote('Agents/Rhea/MEMORY.md')).toBe(false);
    expect(agentFileOf('Agenti/Rhea/stato.md')).toEqual({ owner: 'Rhea', kind: 'state' });
    expect(newFolderPath('  ')).toBe('~/Monsters Progetti/Progetto');
  });
});
