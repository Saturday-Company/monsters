import { setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { composerPlaceholder } from '../src/components/chat/Composer.tsx';
import { greetingWords } from '../src/components/chat/Greeting.tsx';
import { keypadAccepts, keypadPick, lettersText } from '../src/components/chat/QuestionCard.tsx';
import { fitDots } from '../src/components/monster/MonsterScreen.tsx';
import { chatPath } from '../src/lib/router.ts';
import { formatListTime } from '../src/lib/utils.ts';
import { initBaseline, markSeen, seenOf, useReads } from '../src/store/reads.ts';

/* The pieces of the chat list that are not React: times, addresses, read marks. */

// The words are English by default; the tests of the Italian copy say so.
afterEach(() => setAppLang('en'));

describe('chat list helpers', () => {
  it('shows the time of the latest message as a messaging app does', () => {
    setAppLang('it');
    const now = new Date(2026, 9, 15, 18, 0).getTime();
    expect(formatListTime(new Date(2026, 9, 15, 9, 5).getTime(), now)).toBe('09:05');
    expect(formatListTime(new Date(2026, 9, 14, 23, 50).getTime(), now)).toBe('Ieri');
    expect(formatListTime(new Date(2026, 9, 12, 10, 0).getTime(), now)).toBe('lun');
    expect(formatListTime(new Date(2026, 8, 30, 10, 0).getTime(), now)).toBe('30 set');
  });

  it('puts the chat in the address', () => {
    expect(chatPath('rhea')).toBe('#/?chat=rhea');
    expect(chatPath(null)).toBe('#/');
  });

  it('keeps what was seen, never going back, with a baseline for chats never opened', () => {
    useReads.setState({ seen: {}, baseline: null });
    initBaseline('01B');
    initBaseline('01Z'); // only the first time
    expect(seenOf(useReads.getState(), 'rhea')).toBe('01B');
    markSeen('rhea', '01D');
    markSeen('rhea', '01C');
    expect(seenOf(useReads.getState(), 'rhea')).toBe('01D');
    expect(seenOf(useReads.getState(), 'dione')).toBe('01B');
  });
});

describe('composer', () => {
  const base = { name: 'Titan', halted: false, noModel: false, question: null, wide: true };

  it('says what the field does now', () => {
    expect(composerPlaceholder(base)).toBe('Message Titan… (@ for another monster)');
    expect(composerPlaceholder({ ...base, name: 'Atlas', wide: false })).toBe('Message Atlas…');
    // A keypad: with a keyboard a letter and Enter answer; on a phone, the keys.
    expect(composerPlaceholder({ ...base, question: { id: 'q', from: 'Rhea', options: 3 } })).toBe(
      'Message Rhea, or type A, B or C and press Enter',
    );
    expect(
      composerPlaceholder({
        ...base,
        wide: false,
        question: { id: 'q', from: 'Rhea', options: 2 },
      }),
    ).toBe('Answer Rhea or pick an option');
    expect(composerPlaceholder({ ...base, question: { id: 'q', from: 'Rhea', options: 0 } })).toBe(
      'Answer Rhea',
    );
    expect(composerPlaceholder({ ...base, halted: true })).toBe(
      'Go ahead and write: the message goes out when you press Resume',
    );
    expect(composerPlaceholder({ ...base, halted: true, noModel: true })).toBe(
      'Connect a model first',
    );
  });

  it('agrees with the name in Italian ("a" / "ad")', () => {
    setAppLang('it');
    expect(composerPlaceholder(base)).toBe('Scrivi a Titan… (@ per un altro mostro)');
    expect(composerPlaceholder({ ...base, name: 'Atlas', wide: false })).toBe('Scrivi ad Atlas…');
    expect(composerPlaceholder({ ...base, question: { id: 'q', from: 'Rhea', options: 3 } })).toBe(
      'Scrivi a Rhea, oppure digita A, B o C e premi Invio',
    );
    expect(
      composerPlaceholder({
        ...base,
        wide: false,
        question: { id: 'q', from: 'Rhea', options: 2 },
      }),
    ).toBe('Rispondi a Rhea o scegli un’opzione');
    expect(composerPlaceholder({ ...base, question: { id: 'q', from: 'Rhea', options: 0 } })).toBe(
      'Rispondi a Rhea',
    );
    expect(composerPlaceholder({ ...base, halted: true })).toBe(
      'Scrivi: il messaggio parte quando premi Riprendi',
    );
    expect(composerPlaceholder({ ...base, halted: true, noModel: true })).toBe(
      'Prima collega un modello',
    );
  });
});

describe('keypad', () => {
  const key = {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    defaultPrevented: false,
  };

  it('names its letters', () => {
    expect(lettersText(2)).toBe('A or B');
    expect(lettersText(3)).toBe('A, B or C');
    expect(lettersText(4)).toBe('A, B, C or D');
    setAppLang('it');
    expect(lettersText(2)).toBe('A o B');
    expect(lettersText(3)).toBe('A, B o C');
    expect(lettersText(4)).toBe('A, B, C o D');
  });

  it('takes the letters only with the focus outside every text field, the empty composer too (V-1)', () => {
    expect(keypadAccepts(key, null)).toBe(true);
    expect(keypadAccepts(key, { tagName: 'BODY' })).toBe(true);
    expect(keypadAccepts(key, { tagName: 'BUTTON' })).toBe(true);
    // The composer has the focus by default: "Can you…" is a sentence, not the option C.
    const composer = { tagName: 'TEXTAREA', id: 'composer-input', value: '' };
    const typed = { ...composer, value: 'b' };
    expect(keypadAccepts(key, composer)).toBe(false);
    expect(keypadAccepts(key, typed)).toBe(false);
    expect(keypadAccepts(key, { tagName: 'INPUT' })).toBe(false);
    expect(keypadAccepts(key, { tagName: 'SELECT' })).toBe(false);
    expect(keypadAccepts(key, { tagName: 'DIV', isContentEditable: true })).toBe(false);
    expect(keypadAccepts({ ...key, metaKey: true }, null)).toBe(false);
    expect(keypadAccepts({ ...key, repeat: true }, null)).toBe(false);
  });

  it('in the composer, a letter alone picks its option; anything else is words', () => {
    expect(keypadPick('c', 3)).toBe(2);
    expect(keypadPick(' B ', 3)).toBe(1);
    expect(keypadPick('d', 3)).toBeNull();
    expect(keypadPick('d', 4)).toBe(3);
    expect(keypadPick('Can you also', 3)).toBeNull();
    expect(keypadPick('A.', 3)).toBeNull();
    expect(keypadPick('', 3)).toBeNull();
    expect(keypadPick('a', 0)).toBeNull();
  });
});

describe('monster screens', () => {
  it('fit the dot grid as large as the screen allows, crisp', () => {
    expect(fitDots(60, 52)).toBe(51); // 3 px of pitch in the strips
    expect(fitDots(200, 60, 0)).toBe(68); // 4 px on the monitor, 60 tall
    expect(fitDots(34, 30, 2)).toBeCloseTo(29.47, 2); // under 2 px of pitch: as large as it fits
  });
});

describe('greeting', () => {
  const agent = (bounce: number, isOrchestrator = false) => ({
    name: 'Rhea',
    role: 'Fa ricerche sul web.',
    isOrchestrator,
    genome: { personality: { bounce } },
  });

  it('greets in the monster’s own words', () => {
    expect(greetingWords(agent(0.8), false).hello).toBe('Here I am! I’m Rhea.');
    expect(greetingWords(agent(0.2), false)).toEqual({
      hello: 'Hi, I’m Rhea.',
      words:
        'What I do: Fa ricerche sul web. Message me here: I’ll answer you myself, without going through the others.',
    });
    expect(greetingWords(agent(0.2, true), false).words).toMatch(/^Tell me what you need/);
    // The lead of a project hands work to its monsters (collaudo of 17/10).
    const lead = { ...agent(0.2), role: 'capo del progetto Social Saturday', isLead: true };
    expect(greetingWords(lead, false).words).toBe(
      'My role: Capo del progetto Social Saturday. Tell me what the project needs: I’ll take care of it and, if needed, pass it to the project’s monsters.',
    );
    expect(greetingWords(lead, false).words).not.toContain('without going through the others');
    expect(greetingWords({ ...agent(0.2), role: '  ' }, false).words).toMatch(/^Message me here/);
    expect(greetingWords(agent(0.8), true).words).toBe(
      'I just need a model to get to work: connect one and we’ll start.',
    );
  });

  it('greets in Italian, word for word', () => {
    setAppLang('it');
    expect(greetingWords(agent(0.8), false).hello).toBe('Eccomi! Sono Rhea.');
    expect(greetingWords(agent(0.2), false)).toEqual({
      hello: 'Ciao, sono Rhea.',
      words:
        'Mi occupo di questo: Fa ricerche sul web. Scrivimi qui: ti rispondo io, senza passare dagli altri.',
    });
    expect(greetingWords(agent(0.2, true), false).words).toMatch(/^Dimmi cosa ti serve/);
    // The lead of a project hands work to its monsters (collaudo of 17/10).
    const lead = { ...agent(0.2), role: 'capo del progetto Social Saturday', isLead: true };
    expect(greetingWords(lead, false).words).toBe(
      'Il mio ruolo: Capo del progetto Social Saturday. Dimmi cosa serve al progetto: ci penso io e, se serve, lo passo ai mostri del progetto.',
    );
    expect(greetingWords(lead, false).words).not.toContain('senza passare dagli altri');
    // A role in lowercase third person (as proposals write it) gets a capital and a lead-in.
    const lower = { ...agent(0.2), role: 'trova idee e dati per i post dei ristoranti' };
    expect(greetingWords(lower, false).words).toMatch(
      /^Mi occupo di questo: Trova idee e dati per i post dei ristoranti\. Scrivimi/,
    );
    expect(greetingWords({ ...agent(0.2), role: '  ' }, false).words).toMatch(/^Scrivimi qui/);
    expect(greetingWords(agent(0.8), true).words).toBe(
      'Per lavorare mi manca solo un modello: collegane uno e partiamo.',
    );
  });
});
