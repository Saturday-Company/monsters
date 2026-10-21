import { setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryNote } from '../src/scaffold.ts';

/*
 * The text a new MEMORY.md starts with follows the app's language (D-153, wave 3). The core
 * writes the same text when it creates the file itself (`teamPrompts().memoryIndex`, tested in
 * the core's `team-prompts.test.ts` with the same literals).
 */

afterEach(() => setAppLang('en'));

describe('memoryNote', () => {
  it('English app: English heading and index line', () => {
    setAppLang('en');
    expect(memoryNote('Rhea')).toBe(
      '# Memory of Rhea\n\nShort index of Rhea’s memory: one line per item, with the link to the detail note.\n',
    );
  });

  it('Italian app: byte for byte what it was', () => {
    setAppLang('it');
    expect(memoryNote('Rhea')).toBe(
      '# Memoria di Rhea\n\nIndice corto della memoria di Rhea: una riga per voce, con il link alla nota di dettaglio.\n',
    );
  });
});
