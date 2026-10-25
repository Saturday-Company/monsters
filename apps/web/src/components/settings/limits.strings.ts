import { defineStrings } from '../../lib/i18n.ts';

/* Settings → Models → Spending cap → Limits of each job (D-064, D-153). */

const en = {
  rowHint: 'A safety net against a job that runs away.',
  intro:
    'A job is a request of yours and every monster it delegates to. These limits stop a job that runs away: when one is reached, the monsters report what they did so far. On a subscription they also protect your plan’s quota.',
  what: 'the limits',
  groups: {
    api: 'Models paid per use',
    apiHint: 'OpenRouter and direct keys.',
    plan: 'Subscriptions',
    planHint:
      'Claude Code, Codex and the ChatGPT plan. Every request counts as a step, and the first read of a context counts as tokens.',
  },
  fields: {
    steps: 'Steps per job',
    tokens: 'Tokens per job',
    subagentTokens: 'Tokens per delegated monster',
    cost: 'Cost per job ($)',
    delegations: 'Delegations per job',
  },
  defaultIs: (value: string) => `Default: ${value}`,
  invalid: (label: string, min: string, max: string) =>
    `${label}: type a number between ${min} and ${max}.`,
  save: 'Save',
  restore: 'Restore the defaults',
  saved: 'Limits saved. New jobs use them.',
  restored: 'Limits back to the defaults.',
};

const it: typeof en = {
  rowHint: 'Una rete di sicurezza contro un lavoro che sfugge di mano.',
  intro:
    'Un lavoro è una tua richiesta e tutti i mostri a cui passa il compito. Questi limiti fermano un lavoro che sfugge di mano: quando ne scatta uno, i mostri riferiscono quello che hanno fatto fin lì. Con un abbonamento proteggono anche la quota del tuo piano.',
  what: 'i limiti',
  groups: {
    api: 'Modelli a consumo',
    apiHint: 'OpenRouter e chiavi dirette.',
    plan: 'Abbonamenti',
    planHint:
      'Claude Code, Codex e il piano ChatGPT. Ogni richiesta conta come un passo, e la prima lettura di un contesto conta come token.',
  },
  fields: {
    steps: 'Passi per lavoro',
    tokens: 'Token per lavoro',
    subagentTokens: 'Token per mostro delegato',
    cost: 'Costo per lavoro ($)',
    delegations: 'Deleghe per lavoro',
  },
  defaultIs: (value) => `Predefinito: ${value}`,
  invalid: (label, min, max) => `${label}: scrivi un numero tra ${min} e ${max}.`,
  save: 'Salva',
  restore: 'Ripristina i valori predefiniti',
  saved: 'Limiti salvati. I nuovi lavori li usano.',
  restored: 'Limiti tornati ai valori predefiniti.',
};

export const limitsStrings = defineStrings({ en, it });
