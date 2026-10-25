import { defineStrings } from '../../lib/i18n.ts';

/* Settings → Apps and Telegram → Web search: one group, free search (Brave key) and paid search (D-153). */

const en = {
  web: {
    keyInvalid: 'Paste the full key, with no spaces.',
    saved: 'Brave key saved: searches now start with Brave.',
    braveLabel: 'Brave Search',
    freeLabel: 'Free search',
    behindPaid: (isSet: boolean) =>
      `${isSet ? 'Brave Search' : 'DuckDuckGo and Wikipedia'} take over when paid search is off or out of credit.`,
    braveText: 'Your Brave Search key searches the whole web.',
    freeText:
      'DuckDuckGo, with Wikipedia as a fallback. A Brave Search key (free plan) searches the whole web.',
    changeKey: 'Change key',
    addKey: 'Add the Brave key',
    newKeyLabel: 'New Brave Search key',
    keyLabel: 'Brave Search key',
    keyHint: 'It stays on this computer and isn’t shown again after saving.',
    saveKey: 'Save the Brave key',
    createKey: 'Create the key',
  },
  paid: {
    cost: (price: string) => `about ${price} per 1,000 searches`,
    active: (cost: string) =>
      `On: more reliable results, ${cost} from your OpenRouter credit. Free search takes over if it runs out.`,
    noKey: 'Needs an OpenRouter account with credit. Free search until then.',
    spendCap: 'Spending cap reached: free search until you raise it or the period ends.',
    noCredit: 'The OpenRouter account has no credit: free search for now.',
    keyRejected: 'OpenRouter rejected the account’s key. Free search for now.',
    paused:
      'Paused because it returned no results: free search for now, it tries again on its own.',
    freeOnly: (cost: string) =>
      `Off, because paid models are off. On it costs ${cost}; free search can stall after a few dozen searches.`,
    off: (cost: string) => `Off: free search. On it costs ${cost}.`,
    modelsBefore: 'The OpenRouter account and paid models are set in ',
    modelsAfter: '.',
    turnedOn: 'Paid search on, right away.',
    turnedOff: 'Free search again, right away.',
    title: 'Paid search',
    engine: 'Paid search engine',
    cheap: (price: string) => `Cheap · ${price}`,
    precise: (price: string) => `Precise · ${price}`,
    per1000: 'per 1,000 searches',
  },
};

const it: typeof en = {
  web: {
    keyInvalid: 'Incolla la chiave completa, senza spazi.',
    saved: 'Chiave di Brave salvata: le ricerche partono da lì.',
    braveLabel: 'Brave Search',
    freeLabel: 'Ricerca gratuita',
    behindPaid: (isSet) =>
      `${isSet ? 'Brave Search' : 'DuckDuckGo e Wikipedia'} subentrano quando la ricerca a pagamento è spenta o senza credito.`,
    braveText: 'La tua chiave di Brave Search cerca su tutto il web.',
    freeText:
      'DuckDuckGo, con Wikipedia di riserva. Con una chiave di Brave Search (ha un piano gratuito) si cerca su tutto il web.',
    changeKey: 'Cambia chiave',
    addKey: 'Aggiungi la chiave di Brave',
    newKeyLabel: 'Nuova chiave di Brave Search',
    keyLabel: 'Chiave di Brave Search',
    keyHint: 'Resta su questo computer e non la mostriamo più dopo il salvataggio.',
    saveKey: 'Salva la chiave di Brave',
    createKey: 'Crea la chiave',
  },
  paid: {
    cost: (price) => `circa ${price} ogni 1.000 ricerche`,
    active: (cost) =>
      `Accesa: risultati più affidabili, ${cost} dal tuo credito OpenRouter. Se finisce, torna la ricerca gratuita.`,
    noKey: 'Serve un account OpenRouter con credito. Intanto, ricerca gratuita.',
    spendCap: 'Tetto di spesa raggiunto: ricerca gratuita finché non lo alzi o finisce il periodo.',
    noCredit: 'L’account OpenRouter non ha credito: per ora ricerca gratuita.',
    keyRejected: 'OpenRouter ha rifiutato la chiave dell’account. Per ora ricerca gratuita.',
    paused: 'In pausa perché non ha dato risultati: per ora ricerca gratuita, poi riprova da sola.',
    freeOnly: (cost) =>
      `Spenta, perché i modelli a pagamento sono spenti. Accesa costa ${cost}; la ricerca gratuita può bloccarsi dopo qualche decina di ricerche.`,
    off: (cost) => `Spenta: ricerca gratuita. Accesa costa ${cost}.`,
    modelsBefore: 'L’account OpenRouter e i modelli a pagamento si gestiscono in ',
    modelsAfter: '.',
    turnedOn: 'Ricerca a pagamento accesa, da subito.',
    turnedOff: 'Di nuovo ricerca gratuita, da subito.',
    title: 'Ricerca a pagamento',
    engine: 'Motore della ricerca a pagamento',
    cheap: (price) => `Economica · ${price}`,
    precise: (price) => `Precisa · ${price}`,
    per1000: 'ogni 1.000 ricerche',
  },
};

export const searchStrings = defineStrings({ en, it });
