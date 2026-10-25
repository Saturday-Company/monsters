import { setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { draftStrings } from '../src/components/projects/draft.strings.ts';
import { shellStrings } from '../src/components/shell/shell.strings.ts';
import { telegramStrings } from '../src/components/settings/telegram.strings.ts';
import { deriveStrings } from '../src/store/derive.strings.ts';
import { toNameIt } from '../src/lib/utils.strings.ts';

/*
 * Copy of the English UI (D-153): agreement by count, the quotes of each language, the commands
 * of the Telegram bots and the Italian preposition, which never depends on the app's language.
 */

afterEach(() => setAppLang('en'));

describe('agreement by count', () => {
  it('the halt band says "is sent" for one message and "are sent" for many', () => {
    const s = shellStrings().halt;
    expect(s.again('the message for Titan', 1)).toBe(
      'With “Resume and continue”, the message for Titan is sent again.',
    );
    expect(s.again('the messages for Titan and Rhea', 2)).toBe(
      'With “Resume and continue”, the messages for Titan and Rhea are sent again.',
    );
  });

  it('agrees the verb of the Italian band with one message or more (W-39)', () => {
    setAppLang('it');
    const s = shellStrings().halt;
    expect(s.again('il messaggio per Titan', 1)).toBe(
      'Con «Riprendi e continua» riparte il messaggio per Titan.',
    );
    expect(s.again('i messaggi per Titan e Rhea', 2)).toBe(
      'Con «Riprendi e continua» ripartono i messaggi per Titan e Rhea.',
    );
  });

  it('groups of events and tasks read right with one item', () => {
    const g = deriveStrings().group;
    expect(g.events(1)).toBe('1 event among the monsters');
    expect(g.done(1)).toBe('1 task completed');
    expect(g.done(3)).toBe('3 tasks completed');
    setAppLang('it');
    const gi = deriveStrings().group;
    expect(gi.events(1)).toBe('1 evento tra i mostri');
    expect(gi.events(4)).toBe('4 eventi tra i mostri');
    expect(gi.done(1)).toBe('1 compito completato');
    expect(gi.done(4)).toBe('4 compiti completati');
    expect(gi.open(1)).toBe('1 compito passato alla squadra');
    expect(gi.open(2)).toBe('2 compiti passati alla squadra');
  });
});

describe('quotes and commands of each language', () => {
  it('quotes an automation with curly quotes in English and guillemets in Italian', () => {
    expect(draftStrings().plan.quoted('Weekly posts')).toBe('“Weekly posts”');
    setAppLang('it');
    expect(draftStrings().plan.quoted('Post')).toBe('«Post»');
  });

  it('shows the Telegram commands of the language of the app', () => {
    expect(telegramStrings().commands.phone[0]).toBe('/stop');
    expect(telegramStrings().commands.group).toEqual(['/status', '/join', '/help']);
    setAppLang('it');
    expect(telegramStrings().commands.phone[0]).toBe('/ferma');
    expect(telegramStrings().commands.group).toEqual(['/stato', '/join', '/aiuto']);
  });
});

describe('the Italian preposition before a name', () => {
  it('is written by the Italian dictionaries whatever the language in use', () => {
    // English is on: an Italian sentence picked on its own still reads "a Titan", never "to Titan".
    expect(toNameIt('Titan')).toBe('a Titan');
    expect(toNameIt('Atlas')).toBe('ad Atlas');
    expect(toNameIt('Anteiku')).toBe('ad Anteiku');
  });
});
