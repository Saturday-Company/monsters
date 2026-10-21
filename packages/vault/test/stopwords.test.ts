import { describe, expect, it } from 'vitest';
import { ftsAnyQuery } from '../src/index.ts';

/* The words of a question that would match almost any note are dropped, in Italian and in English (D-153). */

describe('ftsAnyQuery: question words are not searched', () => {
  it('Italian: the stopwords stay out (they always did)', () => {
    expect(ftsAnyQuery('quando dove devo consegnare il preventivo')).toBe(
      '"consegn"* OR "prevent"*',
    );
  });

  it('English: the same for a question in English', () => {
    expect(ftsAnyQuery('when should I deliver the quotation to them')).toBe('"deli"* OR "quotat"*');
    expect(ftsAnyQuery('what do you have about the invoice')).toBe('"invo"*');
  });

  it('a note in any language still finds its own words', () => {
    expect(ftsAnyQuery('contratto fornitore Rossi')).toBe('"contra"* OR "fornit"* OR "ross"*');
    expect(ftsAnyQuery('supplier contract')).toBe('"suppl"* OR "contr"*');
  });
});
