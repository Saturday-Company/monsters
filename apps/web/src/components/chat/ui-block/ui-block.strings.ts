import { defineStrings } from '../../../lib/i18n.ts';

/* Words of the drawn blocks in a reply (D-162): fallbacks, "+N more", marks, chart summaries. */

const en = {
  drawing: 'Drawing the block…',
  cantDraw: 'Couldn’t draw this block',
  moreRows: (n: number) => `+${n} more ${n === 1 ? 'row' : 'rows'}`,
  moreSeries: (n: number) => `+${n} more series`,
  moreSlices: (n: number) => `+${n} more ${n === 1 ? 'slice' : 'slices'}`,
  moreItems: (n: number) => `+${n} more`,
  best: 'Recommended',
  trendUp: 'up',
  trendDown: 'down',
  trendFlat: 'unchanged',
  /** The accessible name of a change: "+8%, up". */
  change: (value: string, trend: string) => (trend ? `${value}, ${trend}` : value),
  status: { done: 'Done', doing: 'In progress', todo: 'To do' },
  checked: 'Done',
  unchecked: 'Not done',
  tone: { info: 'Note', success: 'Good news', warning: 'Warning' },
  total: 'Total',
  barChart: (title: string, categories: number, detail: string) =>
    `Bar chart${title ? `: ${title}` : ''}. ${categories} ${categories === 1 ? 'category' : 'categories'}. ${detail}`,
  lineChart: (title: string, points: number, detail: string) =>
    `Line chart${title ? `: ${title}` : ''}. ${points} ${points === 1 ? 'point' : 'points'}. ${detail}`,
  donut: (title: string, slices: number, detail: string) =>
    `Donut chart${title ? `: ${title}` : ''}. ${slices} ${slices === 1 ? 'slice' : 'slices'}: ${detail}`,
  /** "2025, 2026, from 10 to 140" in a chart's summary. */
  seriesRange: (names: string, min: string, max: string) =>
    names ? `${names}, from ${min} to ${max}` : `From ${min} to ${max}`,
  chartData: 'Chart data',
  category: 'Category',
};

const it: typeof en = {
  drawing: 'Disegno il blocco…',
  cantDraw: 'Non sono riuscito a disegnare questo blocco',
  moreRows: (n) => `altre ${n} ${n === 1 ? 'riga' : 'righe'}`,
  moreSeries: (n) => `${n === 1 ? 'un’altra serie' : `altre ${n} serie`}`,
  moreSlices: (n) => `${n === 1 ? 'un’altra fetta' : `altre ${n} fette`}`,
  moreItems: (n) => `altri ${n}`,
  best: 'Consigliata',
  trendUp: 'in aumento',
  trendDown: 'in calo',
  trendFlat: 'stabile',
  change: (value, trend) => (trend ? `${value}, ${trend}` : value),
  status: { done: 'Fatto', doing: 'In corso', todo: 'Da fare' },
  checked: 'Fatto',
  unchecked: 'Da fare',
  tone: { info: 'Nota', success: 'Buone notizie', warning: 'Attenzione' },
  total: 'Totale',
  barChart: (title, categories, detail) =>
    `Grafico a barre${title ? `: ${title}` : ''}. ${categories} ${categories === 1 ? 'categoria' : 'categorie'}. ${detail}`,
  lineChart: (title, points, detail) =>
    `Grafico a linee${title ? `: ${title}` : ''}. ${points} ${points === 1 ? 'punto' : 'punti'}. ${detail}`,
  donut: (title, slices, detail) =>
    `Grafico a ciambella${title ? `: ${title}` : ''}. ${slices} ${slices === 1 ? 'fetta' : 'fette'}: ${detail}`,
  seriesRange: (names, min, max) => (names ? `${names}, da ${min} a ${max}` : `Da ${min} a ${max}`),
  chartData: 'Dati del grafico',
  category: 'Categoria',
};

export const uiBlockViewStrings = defineStrings({ en, it });
