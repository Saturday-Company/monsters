import { setAppLang } from '@monsters/shared';
import { isValidElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { withSettingsLinks } from '../src/components/chat/ChatEvents.tsx';
import { chatStrings } from '../src/components/chat/chat.strings.ts';
import { shellStrings } from '../src/components/shell/shell.strings.ts';
import { terminalStrings } from '../src/components/terminal/terminal.strings.ts';

/* Plurals, agreements and the places named in a text, in both languages (D-153). */

afterEach(() => setAppLang('en'));

describe('plurals and agreements of the chat', () => {
  it('count in English', () => {
    const s = chatStrings();
    expect(s.list.squadSr(1)).toBe(', 1 monster: open the project');
    expect(s.list.squadSr(3)).toBe(', 3 monsters: open the project');
    expect(s.panel.attachments(1)).toBe('1 attachment');
    expect(s.panel.attachments(2)).toBe('2 attachments');
    expect(s.receipt.stuck(1)).toBe('One monster was going in circles: it changed course');
    expect(s.receipt.stuck(3)).toBe('A monster went in circles 3 times: it changed course');
    expect(s.receipt.injections(2)).toBe('2 texts with orders for the monsters removed');
    expect(s.panel.roleLead(1)).toBe('your lead · coordinates 1 monster');
    expect(shellStrings().review.count(2)).toBe('To review: 2 things');
    expect(shellStrings().sidebar.waitingMany(2)).toBe('2 jobs are waiting for an answer');
  });

  it('count in Italian', () => {
    setAppLang('it');
    const s = chatStrings();
    expect(s.list.squadSr(1)).toBe(', un mostro: apri il progetto');
    expect(s.list.squadSr(3)).toBe(', 3 mostri: apri il progetto');
    expect(s.panel.attachments(1)).toBe('Un allegato');
    expect(s.panel.attachments(2)).toBe('2 allegati');
    expect(s.receipt.stuck(1)).toBe('Un mostro girava a vuoto: ha cambiato strada');
    expect(s.receipt.stuck(3)).toBe('3 volte un mostro girava a vuoto: ha cambiato strada');
    expect(s.receipt.injections(1)).toBe('Un testo con ordini ai mostri tolto');
    expect(s.receipt.injections(2)).toBe('2 testi con ordini ai mostri tolti');
    expect(s.panel.roleLead(3)).toBe('il tuo capo · coordina 3 mostri');
    expect(s.events.handedSentence('Rhea', 'Atlas', '«x»')).toBe(
      'Rhea ha passato un incarico ad Atlas: «x»',
    );
    expect(s.events.handedSentence('Rhea', 'Dione', '«x»')).toBe(
      'Rhea ha passato un incarico a Dione: «x»',
    );
    expect(shellStrings().review.count(1)).toBe('Da rivedere: 1 cosa');
    expect(shellStrings().palette.youTo('Atlas')).toBe('Tu, ad Atlas');
  });

  it('say the lines of the terminal in both languages', () => {
    expect(terminalStrings().delegation('out', 'started', 'Rhea')).toBe('task to Rhea');
    expect(terminalStrings().usage('qwen', '1,200', 1200, '3 s')).toBe('qwen · 1,200 tokens · 3 s');
    expect(terminalStrings().noteDone(terminalStrings().vault['edit']!, 'Menu')).toBe(
      'Note edited: Menu',
    );
    setAppLang('it');
    expect(terminalStrings().delegation('in', 'completed', 'Rhea')).toBe('consegnato a Rhea');
    expect(terminalStrings().usage('qwen', '1.200', 1200, null)).toBe('qwen · 1.200 token');
    expect(terminalStrings().noteDone(terminalStrings().vault['edit']!, 'Menu')).toBe(
      'Nota modificata: Menu',
    );
  });
});

describe('the places named in a text', () => {
  const links = (text: string) =>
    withSettingsLinks(text).filter((n): n is ReactElement<{ href: string }> => isValidElement(n));

  it('become links to the tab, whatever the language of the text', () => {
    const it = links('Aggiungi una chiave in Impostazioni → Modelli.');
    expect(it).toHaveLength(1);
    expect(it[0]!.props.href).toContain('section=models');
    const en = links('Add a key in Settings → Models, or allow it in Settings → Permissions.');
    expect(en.map((l) => l.props.href.split('section=')[1])).toEqual(['models', 'permissions']);
  });
});
