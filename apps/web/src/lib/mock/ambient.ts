/** Small jobs of the mock's ambient life (`?vita=1`): something to do for every monster but the orchestrator. */

export interface AmbientJob {
  agent: string;
  goal: string;
  tools: { tool: string; input: Record<string, unknown>; writes?: string }[];
  /** What goes wrong when the job fails. */
  oops: string;
}

export const AMBIENT_JOBS: readonly AmbientJob[] = [
  {
    agent: 'rhea',
    goal: 'Trova tre ristoranti tipici a Lisbona',
    tools: [
      { tool: 'web_search', input: { query: 'ristoranti tipici Lisbona Alfama' } },
      { tool: 'web_fetch', input: { url: 'https://www.visitlisboa.com/it/mangiare' } },
      {
        tool: 'vault_write',
        input: { path: 'Risorse/Ristoranti a Lisbona.md' },
        writes: 'Risorse/Ristoranti a Lisbona.md',
      },
    ],
    oops: 'Il sito del turismo non risponde',
  },
  {
    agent: 'rhea',
    goal: 'Controlla il meteo del weekend',
    tools: [{ tool: 'web_search', input: { query: 'meteo Lisbona sabato domenica' } }],
    oops: 'Nessuna previsione affidabile',
  },
  {
    agent: 'dione',
    goal: 'Scrivi la bozza del primo post',
    tools: [
      { tool: 'vault_read', input: { path: 'Risorse/Lisbona, spunti per il weekend.md' } },
      {
        tool: 'vault_write',
        input: { path: 'Bozze/Post Lisbona 1.md' },
        writes: 'Bozze/Post Lisbona 1.md',
      },
    ],
    oops: 'Non trovo gli spunti di Rhea',
  },
  {
    agent: 'tethys',
    goal: 'Sposta la riunione di giovedì',
    tools: [
      { tool: 'vault_search', input: { query: 'riunione giovedì' } },
      {
        tool: 'vault_edit',
        input: { path: 'Calendario/Settimana 42.md' },
        writes: 'Calendario/Settimana 42.md',
      },
    ],
    oops: 'Giovedì è già pieno',
  },
  {
    agent: 'enceladus',
    goal: 'Riordina le note di ottobre',
    tools: [
      { tool: 'vault_list', input: {} },
      {
        tool: 'vault_edit',
        input: { path: 'Indice di ottobre.md' },
        writes: 'Indice di ottobre.md',
      },
    ],
    oops: 'Due note hanno lo stesso nome',
  },
  {
    agent: 'hyperion',
    goal: 'Rileggi la bozza di Dione',
    tools: [
      { tool: 'vault_read', input: { path: 'Bozze/Post Lisbona 1.md' } },
      { tool: 'vault_links', input: {} },
    ],
    oops: 'La bozza non c’è ancora',
  },
  {
    agent: 'mimas',
    goal: 'Somma le spese del viaggio',
    tools: [
      { tool: 'vault_read', input: { path: 'Spese/Ottobre.md' } },
      { tool: 'vault_edit', input: { path: 'Spese/Ottobre.md' }, writes: 'Spese/Ottobre.md' },
    ],
    oops: 'Il foglio delle spese è aperto da un altro programma',
  },
];
