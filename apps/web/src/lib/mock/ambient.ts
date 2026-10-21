import { tr } from './lang.ts';
import { notePath } from './paths.ts';

/** Small jobs of the mock's ambient life (`?vita=1`): something to do for every monster but the orchestrator. */

export interface AmbientJob {
  agent: string;
  goal: string;
  tools: { tool: string; input: Record<string, unknown>; writes?: string }[];
  /** What goes wrong when the job fails. */
  oops: string;
}

/** The jobs, in the mock's language (picked when the ambient life starts). */
export function ambientJobs(): readonly AmbientJob[] {
  return [
    {
      agent: 'rhea',
      goal: tr('Find three typical restaurants in Lisbon', 'Trova tre ristoranti tipici a Lisbona'),
      tools: [
        {
          tool: 'web_search',
          input: {
            query: tr('typical restaurants Lisbon Alfama', 'ristoranti tipici Lisbona Alfama'),
          },
        },
        {
          tool: 'web_fetch',
          input: {
            url: tr(
              'https://www.visitlisboa.com/en/eat',
              'https://www.visitlisboa.com/it/mangiare',
            ),
          },
        },
        {
          tool: 'vault_write',
          input: { path: notePath('lisbonRestaurants') },
          writes: notePath('lisbonRestaurants'),
        },
      ],
      oops: tr('The tourism site isn’t responding', 'Il sito del turismo non risponde'),
    },
    {
      agent: 'rhea',
      goal: tr('Check the weekend weather', 'Controlla il meteo del weekend'),
      tools: [
        {
          tool: 'web_search',
          input: {
            query: tr('Lisbon weather Saturday Sunday', 'meteo Lisbona sabato domenica'),
          },
        },
      ],
      oops: tr('No reliable forecast', 'Nessuna previsione affidabile'),
    },
    {
      agent: 'dione',
      goal: tr('Write the draft of the first post', 'Scrivi la bozza del primo post'),
      tools: [
        { tool: 'vault_read', input: { path: notePath('lisbonTips') } },
        {
          tool: 'vault_write',
          input: { path: notePath('ambientPost') },
          writes: notePath('ambientPost'),
        },
      ],
      oops: tr('I can’t find Rhea’s tips', 'Non trovo gli spunti di Rhea'),
    },
    {
      agent: 'tethys',
      goal: tr('Move Thursday’s meeting', 'Sposta la riunione di giovedì'),
      tools: [
        {
          tool: 'vault_search',
          input: { query: tr('Thursday meeting', 'riunione giovedì') },
        },
        {
          tool: 'vault_edit',
          input: { path: notePath('ambientWeek') },
          writes: notePath('ambientWeek'),
        },
      ],
      oops: tr('Thursday is already full', 'Giovedì è già pieno'),
    },
    {
      agent: 'enceladus',
      goal: tr('Tidy up the October notes', 'Riordina le note di ottobre'),
      tools: [
        { tool: 'vault_list', input: {} },
        {
          tool: 'vault_edit',
          input: { path: notePath('ambientIndex') },
          writes: notePath('ambientIndex'),
        },
      ],
      oops: tr('Two notes have the same name', 'Due note hanno lo stesso nome'),
    },
    {
      agent: 'hyperion',
      goal: tr('Reread Dione’s draft', 'Rileggi la bozza di Dione'),
      tools: [
        { tool: 'vault_read', input: { path: notePath('ambientPost') } },
        { tool: 'vault_links', input: {} },
      ],
      oops: tr('The draft isn’t there yet', 'La bozza non c’è ancora'),
    },
    {
      agent: 'mimas',
      goal: tr('Add up the trip expenses', 'Somma le spese del viaggio'),
      tools: [
        { tool: 'vault_read', input: { path: notePath('ambientExpenses') } },
        {
          tool: 'vault_edit',
          input: { path: notePath('ambientExpenses') },
          writes: notePath('ambientExpenses'),
        },
      ],
      oops: tr(
        'The expenses sheet is open in another program',
        'Il foglio delle spese è aperto da un altro programma',
      ),
    },
  ];
}
