import type { Question } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECISION_RULES,
  earlierChoice,
  matchRule,
  unicodeWords,
  withUnicodeBoundaries,
  wordRegex,
} from '../src/index.ts';

/* AG-02: `\b` in JavaScript is ASCII, so "lunedì" never ended a word for the rules. */

const facts = DEFAULT_DECISION_RULES.find((r) => r.id === 'facts')!;

describe('Unicode word boundaries', () => {
  it('the plain `\\b` misses accented endings, the rules do not', () => {
    expect(/\b(luned[iì])\b/iu.test('La facciamo lunedì o martedì?')).toBe(false);
    expect(wordRegex('\\b(luned[iì])\\b').test('La facciamo lunedì o martedì?')).toBe(true);
    for (const text of [
      'La facciamo lunedì o martedì?',
      'Venerdì sera va bene?',
      'Ci vediamo giovedì',
      'mercoledì',
    ]) {
      expect(matchRule(facts, { text }), text).toBe(true);
    }
    // Still whole words: "lunedìmattina" is not a day for the rule.
    expect(wordRegex('\\blunedì\\b').test('lunedìmattina')).toBe(false);
  });

  it('`\\w` is Unicode too, and character classes keep their meaning', () => {
    expect(wordRegex('\\bpag\\w*\\b').test('Pagherò io?')).toBe(true);
    expect(withUnicodeBoundaries('[\\b\\w]')).toBe('[\\b\\p{L}\\p{N}_]');
    expect(withUnicodeBoundaries('a\\\\b')).toBe('a\\\\b');
    expect(unicodeWords(/\bcaffè\b/i).flags).toBe('iu');
    expect(unicodeWords(/\bcaffè\b/i).test('un caffè?')).toBe(true);
  });

  it('compiles each pattern once', () => {
    expect(wordRegex('\\bciao\\b')).toBe(wordRegex('\\bciao\\b'));
  });
});

describe('consequential words of a second question (closed roots)', () => {
  const asked: Question[] = [
    {
      id: 'q1',
      from: 'titan',
      runId: 'r1',
      question: 'Quale variante del post?',
      options: [
        { id: '1', label: 'Ironica' },
        { id: '2', label: 'Seria' },
      ],
      blocking: true,
      status: 'answered',
      createdAt: 0,
    },
  ];
  const second = (question: string, labels = ['Prima', 'Seconda']) =>
    earlierChoice(asked, 'titan', {
      question,
      options: labels.map((label, i) => ({ id: String(i + 1), label })),
    });

  it('"pagina", "invito", "compreso" are not money or mail: the one-question limit holds', () => {
    expect(second('Quale titolo per la pagina?')).toBeDefined();
    expect(second('Che testo metto nell’invito?')).toBeDefined();
    expect(second('Il prezzo è compreso nel menu?')).toBeDefined();
  });

  it('paying, sending, buying still reach the user', () => {
    expect(second('Invio la mail ai clienti?')).toBeUndefined();
    expect(second('Pago io il dominio?')).toBeUndefined();
    expect(second('Pagherò con la carta?')).toBeUndefined();
    expect(second('Compriamo il dominio?')).toBeUndefined();
    expect(second('Lo pubblichiamo oggi?')).toBeUndefined();
  });
});
