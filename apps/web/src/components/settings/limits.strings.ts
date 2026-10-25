import { defineStrings } from '../../lib/i18n.ts';

/* Settings → Models → Spending cap → Safety net, the limits of each job (D-064, D-153, C2). */

const en = {
  rowHint: 'A safety net against a job that runs away.',
  intro:
    'A job is a request of yours and every monster it delegates to. When it reaches its limit, the monsters report what they did so far.',
  what: 'the safety net',
  presetsLabel: 'How much a job may do before it stops',
  presets: { careful: 'Careful', normal: 'Normal', generous: 'Generous' },
  /** The sentence under the keys; `eur` is the cost limit of one job, already as money. */
  presetHint: {
    careful: (eur: string) => `Stops a job early: about ${eur} of paid models, fewer delegations.`,
    normal: (eur: string) => `The usual net: about ${eur} of paid models in one job.`,
    generous: (eur: string) => `Room for big jobs: about ${eur} of paid models in one job.`,
    custom: 'Your own values, set in Exact limits.',
  },
  plansKeep: 'Claude and ChatGPT plans keep their own limits.',
  custom: 'Custom',
  exact: 'Exact limits',
  exactHint: 'Every limit, one by one.',
  groups: {
    api: 'Models paid per use',
    apiHint: 'OpenRouter and direct keys. The cost is in euros, counted as the spending cap does.',
    plan: 'Plans',
    planHint:
      'Claude Code, Codex and the ChatGPT plan. Every request counts as a step, and the first read of a context counts as tokens.',
  },
  fields: {
    steps: 'Steps per job',
    tokens: 'Tokens per job',
    subagentTokens: 'Tokens per delegated monster',
    cost: 'Cost per job (€)',
    delegations: 'Delegations per job',
  },
  defaultIs: (value: string) => `Default: ${value}`,
  invalid: (label: string, min: string, max: string) =>
    `${label}: type a number between ${min} and ${max}.`,
  save: 'Save',
  restore: 'Restore the defaults',
  saved: 'Limits saved. New jobs use them.',
  presetSaved: (name: string) => `${name} safety net. New jobs use it.`,
  restored: 'Limits back to the defaults.',
};

const it: typeof en = {
  rowHint: 'Una rete di sicurezza contro un lavoro che sfugge di mano.',
  intro:
    'Un lavoro è una tua richiesta e tutti i mostri a cui passa il compito. Quando raggiunge il limite, i mostri riferiscono quello che hanno fatto fin lì.',
  what: 'la rete di sicurezza',
  presetsLabel: 'Quanto può fare un lavoro prima di fermarsi',
  presets: { careful: 'Prudente', normal: 'Normale', generous: 'Largo' },
  presetHint: {
    careful: (eur) => `Ferma un lavoro presto: circa ${eur} di modelli a pagamento, meno deleghe.`,
    normal: (eur) => `La rete di sempre: circa ${eur} di modelli a pagamento in un lavoro.`,
    generous: (eur) =>
      `Spazio per i lavori grossi: circa ${eur} di modelli a pagamento in un lavoro.`,
    custom: 'Valori tuoi, scelti in Limiti esatti.',
  },
  plansKeep: 'I piani Claude e ChatGPT tengono i loro limiti.',
  custom: 'Personalizzato',
  exact: 'Limiti esatti',
  exactHint: 'Ogni limite, uno per uno.',
  groups: {
    api: 'Modelli a consumo',
    apiHint: 'OpenRouter e chiavi dirette. Il costo è in euro, contato come fa il tetto di spesa.',
    plan: 'Piani',
    planHint:
      'Claude Code, Codex e il piano ChatGPT. Ogni richiesta conta come un passo, e la prima lettura di un contesto conta come token.',
  },
  fields: {
    steps: 'Passi per lavoro',
    tokens: 'Token per lavoro',
    subagentTokens: 'Token per mostro delegato',
    cost: 'Costo per lavoro (€)',
    delegations: 'Deleghe per lavoro',
  },
  defaultIs: (value) => `Predefinito: ${value}`,
  invalid: (label, min, max) => `${label}: scrivi un numero tra ${min} e ${max}.`,
  save: 'Salva',
  restore: 'Ripristina i valori predefiniti',
  saved: 'Limiti salvati. I nuovi lavori li usano.',
  presetSaved: (name) => `Rete di sicurezza «${name}». I nuovi lavori la usano.`,
  restored: 'Limiti tornati ai valori predefiniti.',
};

export const limitsStrings = defineStrings({ en, it });
