import { defineStrings } from '../../lib/i18n.ts';

/* Settings → Connections → web search: the free chain with Brave, and the paid search (D-153). */

const en = {
  web: {
    keyInvalid: 'Paste the full key, with no spaces.',
    saved: 'Brave key saved: searches start from there.',
    paidLabel: 'Paid search',
    braveLabel: 'Brave Search',
    freeLabel: 'Free search',
    paidText: (isSet: boolean) =>
      `Now the monsters search with OpenRouter (the paid search, below); ${isSet ? 'Brave Search' : 'DuckDuckGo and Wikipedia'} stay as a fallback.`,
    braveText: 'With your Brave Search key the monsters search the whole web.',
    freeText:
      'The monsters search with DuckDuckGo and, when it doesn’t answer, on Wikipedia. With a Brave Search key (it has a free plan) or the paid search (below) they search the whole web.',
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
      `The monsters search with OpenRouter: more reliable results, ${cost} from your key’s credit. If the credit runs out, they go back to free search on their own.`,
    noKey:
      'You need an OpenRouter key with credit. Meanwhile the monsters search for free with DuckDuckGo and Wikipedia, which block after a few dozen searches.',
    spendCap:
      'The spending cap is reached: until you raise it, or the period ends, the monsters search for free with DuckDuckGo and Wikipedia.',
    noCredit:
      'The OpenRouter key has no credit: for now the monsters search for free with DuckDuckGo and Wikipedia.',
    keyRejected:
      'OpenRouter rejected the key: check it in the settings. Meanwhile the monsters search for free with DuckDuckGo and Wikipedia.',
    paused:
      'Paid search is paused because it returned no results: for now the monsters search for free with DuckDuckGo and Wikipedia, then it tries again on its own.',
    freeOnly: (cost: string) =>
      `Off, like paid models: the monsters search for free with DuckDuckGo and Wikipedia, which block after a few dozen searches. On it costs ${cost}.`,
    off: (cost: string) =>
      `Off: the monsters search for free with DuckDuckGo and Wikipedia. On it costs ${cost}.`,
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
    paidLabel: 'Ricerca a pagamento',
    braveLabel: 'Brave Search',
    freeLabel: 'Ricerca gratuita',
    paidText: (isSet) =>
      `Ora i mostri cercano con OpenRouter (la ricerca a pagamento, qui sotto); ${isSet ? 'Brave Search' : 'DuckDuckGo e Wikipedia'} restano di riserva.`,
    braveText: 'Con la tua chiave di Brave Search i mostri cercano su tutto il web.',
    freeText:
      'I mostri cercano con DuckDuckGo e, quando non risponde, su Wikipedia. Con una chiave di Brave Search (ha un piano gratuito) o la ricerca a pagamento (qui sotto) cercano su tutto il web.',
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
      `I mostri cercano con OpenRouter: risultati più affidabili, ${cost} dal credito della tua chiave. Se il credito finisce, tornano alla ricerca gratuita da soli.`,
    noKey:
      'Serve una chiave OpenRouter con credito. Intanto i mostri cercano gratis con DuckDuckGo e Wikipedia, che dopo qualche decina di ricerche si bloccano.',
    spendCap:
      'Il tetto di spesa è raggiunto: fino a quando non lo alzi, o finisce il periodo, i mostri cercano gratis con DuckDuckGo e Wikipedia.',
    noCredit:
      'La chiave OpenRouter non ha credito: per ora i mostri cercano gratis con DuckDuckGo e Wikipedia.',
    keyRejected:
      'OpenRouter ha rifiutato la chiave: controllala nelle impostazioni. Intanto i mostri cercano gratis con DuckDuckGo e Wikipedia.',
    paused:
      'La ricerca a pagamento è in pausa perché non ha dato risultati: per ora i mostri cercano gratis con DuckDuckGo e Wikipedia, poi riprova da sola.',
    freeOnly: (cost) =>
      `Spenta come i modelli a pagamento: i mostri cercano gratis con DuckDuckGo e Wikipedia, che dopo qualche decina di ricerche si bloccano. Accesa costa ${cost}.`,
    off: (cost) =>
      `Spenta: i mostri cercano gratis con DuckDuckGo e Wikipedia. Accesa costa ${cost}.`,
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
