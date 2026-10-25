import { formatList } from '@monsters/shared';
import { defineStrings } from '../../lib/i18n.ts';

/* Settings → Models → Spending cap (D-153). */

type Link = 'monster' | 'project' | 'team';

const en = {
  noCap: 'No cap.',
  noCapShort: 'no cap',
  period: { oggi: 'today', mese: 'this month' },
  higherThan: (label: string, outer: Link) =>
    `${label}: higher than ${{ monster: 'the monster’s cap', project: 'the project’s cap', team: 'the cap for all monsters' }[outer]}, which kicks in first.`,
  chainLabel: (labels: readonly string[], closest: string | null) =>
    `How the caps apply: ${labels.join(', then ')}${closest ? `. Closest to the limit: ${closest}` : ''}`,
  unpriced: (names: readonly string[], whose?: string) =>
    `${whose ?? 'The cap'} doesn’t count what you spend with ${formatList(names)}: Monsters doesn’t know the price of those models, so it stops nothing there. Check your spending on the provider’s site.`,
  estimated: (names: readonly string[], whose?: string) =>
    `With ${formatList(names)} the cost is estimated: Monsters counts tokens at the price of OpenRouter’s public list. ${whose ?? 'The cap'} counts it and stops jobs when you reach it; the real figure is on the provider’s site.`,
  form: {
    invalid:
      'Type an amount in euros (at least €0.50), like 1000 or 12.50, or leave empty for no cap.',
    day: 'Spend at most per day (€)',
    month: 'Spend at most per month (€)',
  },
  what: 'the spending cap',
  freeRequests: (n: string, count: number) =>
    count === 1 ? `${n} request to free models` : `${n} requests to free models`,
  subscriptionRequests: (label: string, n: string, count: number) =>
    count === 1 ? `${label}: ${n} request` : `${label}: ${n} requests`,
  description:
    'How much the monsters can spend with paid models. At the cap those jobs stop until you raise it; plans and free models don’t count.',
  notCounted: (list: string) => `This month, not counted: ${list}. `,
  rate: (rate: string) => `Providers bill in dollars: counted at a fixed rate, $1 = €${rate}.`,
  links: { monster: 'Monster', project: 'Project', team: 'All monsters' },
  reached:
    'You’ve reached the cap: jobs with paid models are stopped. Raise it below to restart them.',
  warned: (pct: number) => `You’ve spent more than ${pct}% of the cap.`,
  raised: (eur: string, day: boolean) =>
    `Cap raised to ${eur} ${day ? 'per day' : 'per month'}: jobs restart.`,
  raise: 'Raise the cap',
  today: 'Today',
  thisMonth: 'This month',
  emptyHint: 'Empty: no cap.',
  saved: 'Spending cap saved.',
  perMonster: 'Per monster',
  perMonsterText: 'An extra cap for one monster only, on top of the cap for all monsters.',
  agentLine: (day: string, month: string, paid: boolean, unpriced: string | null) =>
    `Today ${day} · this month ${month}${paid ? '' : ' · now uses free models'}${unpriced ? ` · ${unpriced} not counted` : ''}`,
  agentEmptyHint: 'Empty: only the cap for all monsters applies.',
  agentSaved: (name: string) => `${name}’s cap saved.`,
  save: 'Save',
};

const it: typeof en = {
  noCap: 'Senza tetto.',
  noCapShort: 'senza tetto',
  period: { oggi: 'oggi', mese: 'mese' },
  higherThan: (label, outer) =>
    `${label}: più alto del tetto ${{ monster: 'del mostro', project: 'del progetto', team: 'di tutti i mostri' }[outer]}: scatta prima quello.`,
  chainLabel: (labels, closest) =>
    `Come valgono i tetti: ${labels.join(', poi ')}${closest ? `. Il più vicino al limite: ${closest}` : ''}`,
  unpriced: (names, whose) =>
    `${whose ?? 'Il tetto'} non conta quello che spendi con ${formatList(names)}: Monsters non conosce il prezzo di quei modelli, quindi lì non ferma niente. Controlla la spesa sul sito del fornitore.`,
  estimated: (names, whose) =>
    `Con ${formatList(names)} il costo è stimato: Monsters conta i token al prezzo del listino pubblico di OpenRouter. ${whose ?? 'Il tetto'} lo conta e ferma i lavori quando lo raggiungi; la cifra vera è sul sito del fornitore.`,
  form: {
    invalid:
      'Scrivi una cifra in euro (almeno 0,50), come 1000 o 12,50, o lascia vuoto per nessun tetto.',
    day: 'Spendi al massimo al giorno (€)',
    month: 'Spendi al massimo al mese (€)',
  },
  what: 'il tetto di spesa',
  freeRequests: (n, count) =>
    count === 1 ? `${n} richiesta a modelli gratuiti` : `${n} richieste a modelli gratuiti`,
  subscriptionRequests: (label, n, count) =>
    count === 1 ? `${label}: ${n} richiesta` : `${label}: ${n} richieste`,
  description:
    'Quanto possono spendere i mostri con i modelli a pagamento. Al tetto quei lavori si fermano finché non lo alzi; piani e modelli gratuiti non contano.',
  notCounted: (list) => `Questo mese, fuori dal conto: ${list}. `,
  rate: (rate) => `I fornitori fatturano in dollari: conto a un cambio fisso, 1 $ = ${rate} €.`,
  links: { monster: 'Mostro', project: 'Progetto', team: 'Tutti i mostri' },
  reached:
    'Hai raggiunto il tetto: i lavori con modelli a pagamento sono fermi. Alzalo qui sotto per farli ripartire.',
  warned: (pct) => `Hai speso più dell’${pct}% del tetto.`,
  raised: (eur, day) =>
    `Tetto alzato a ${eur} ${day ? 'al giorno' : 'al mese'}: i lavori ripartono.`,
  raise: 'Alza il tetto',
  today: 'Oggi',
  thisMonth: 'Questo mese',
  emptyHint: 'Vuoto: nessun tetto.',
  saved: 'Tetto di spesa salvato.',
  perMonster: 'Per mostro',
  perMonsterText: 'Un tetto in più solo per un mostro, oltre a quello di tutti i mostri.',
  agentLine: (day, month, paid, unpriced) =>
    `Oggi ${day} · questo mese ${month}${paid ? '' : ' · ora usa modelli gratuiti'}${unpriced ? ` · ${unpriced} fuori dal conto` : ''}`,
  agentEmptyHint: 'Vuoto: vale solo il tetto di tutti i mostri.',
  agentSaved: (name) => `Tetto di ${name} salvato.`,
  save: 'Salva',
};

export const spendStrings = defineStrings({ en, it });
