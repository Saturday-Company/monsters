/*
 * First start (ARCHITECTURE §7, research 03 §5): the fixed questions of the
 * starting agent. They are plain data shared by the core (validation, profile)
 * and the UI (rendering), so nothing here needs a model.
 */

export interface OnboardingOption {
  id: string;
  label: string;
}

/**
 * One group of answers inside a question:
 * - `single` / `multi`: clickable options;
 * - `name`: a short free value, with optional suggestion chips.
 */
export interface OnboardingGroup {
  id: string;
  kind: 'single' | 'multi' | 'name';
  /** Shown above the group when a question has more than one. */
  label?: string;
  placeholder?: string;
  options: OnboardingOption[];
  /** Preselected option ids (or the default value of a `name` group). */
  defaults: string[];
  /** The group must have a value before going on. */
  required: boolean;
}

export interface OnboardingQuestion {
  id: string;
  /** What the starting agent asks. */
  title: string;
  /** One short line under the question. */
  hint?: string;
  groups: OnboardingGroup[];
  /** Placeholder of the free text field; absent when the question has none. */
  freeText?: string;
  /**
   * Friendly comment of the starting agent once answered. `{orchestrator}` and
   * `{user}` are replaced with the names given in the first question.
   */
  reply: string;
}

export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = [
  {
    id: 'nomi',
    title: 'Piacere! Come ti chiami? E come chiamiamo il tuo capo?',
    hint: 'Il tuo capo coordina gli altri mostri: di solito scrivi a lui.',
    groups: [
      {
        id: 'user',
        kind: 'name',
        label: 'Il tuo nome',
        placeholder: 'Come vuoi che ti chiamino',
        options: [],
        defaults: [],
        required: true,
      },
      {
        id: 'orchestrator',
        kind: 'name',
        label: 'Il nome del tuo capo',
        placeholder: 'Un altro nome',
        options: [
          { id: 'Titan', label: 'Titan' },
          { id: 'Atlas', label: 'Atlas' },
          { id: 'Iapetus', label: 'Iapetus' },
          { id: 'Pan', label: 'Pan' },
        ],
        defaults: ['Titan'],
        required: true,
      },
    ],
    reply: 'Bel nome! Da adesso {orchestrator} coordina la tua squadra, {user}.',
  },
  {
    id: 'lavoro',
    title: 'Di cosa ti occupi?',
    hint: 'Scegli anche più di una cosa.',
    groups: [
      {
        id: 'cosa',
        kind: 'multi',
        options: [
          { id: 'social', label: 'Social e contenuti' },
          { id: 'sviluppo', label: 'Sviluppo software' },
          { id: 'marketing', label: 'Marketing e vendite' },
          { id: 'consulenza', label: 'Consulenza o freelance' },
          { id: 'impresa', label: 'Gestisco un’attività' },
          { id: 'studio', label: 'Studio e ricerca' },
          { id: 'scrittura', label: 'Scrittura e comunicazione' },
        ],
        defaults: [],
        required: false,
      },
    ],
    freeText: 'Altro, o due parole in più',
    reply: 'Bello! Così capisco quali mostri ti servono.',
  },
  {
    id: 'obiettivi',
    title: 'Cosa vuoi ottenere nelle prossime settimane?',
    groups: [
      {
        id: 'cosa',
        kind: 'multi',
        options: [
          { id: 'costanza', label: 'Pubblicare con costanza' },
          { id: 'clienti', label: 'Trovare nuovi clienti' },
          { id: 'lancio', label: 'Lanciare un progetto' },
          { id: 'ordine', label: 'Mettere ordine nelle idee' },
          { id: 'imparare', label: 'Imparare un argomento' },
          { id: 'tempo', label: 'Liberare tempo' },
        ],
        defaults: [],
        required: false,
      },
    ],
    freeText: 'Un obiettivo preciso, se ce l’hai',
    reply: 'Segnato. Lavoriamo su questo.',
  },
  {
    id: 'deleghe',
    title: 'Quali attività ti rubano più tempo e vorresti delegare?',
    groups: [
      {
        id: 'cosa',
        kind: 'multi',
        options: [
          { id: 'ricerche', label: 'Ricerche online' },
          { id: 'bozze', label: 'Bozze di post e mail' },
          { id: 'riassunti', label: 'Riassumere documenti' },
          { id: 'note', label: 'Organizzare note e idee' },
          { id: 'piano', label: 'Pianificare i contenuti' },
          { id: 'numeri', label: 'Analizzare numeri e dati' },
          // For who writes software (the UI shows them when the work is "Sviluppo software").
          { id: 'bug', label: 'Correggere bug' },
          { id: 'test', label: 'Scrivere test' },
          { id: 'docs', label: 'Documentazione' },
          { id: 'review', label: 'Rivedere codice' },
          { id: 'capire', label: 'Capire codice nuovo' },
        ],
        defaults: [],
        required: false,
      },
    ],
    freeText: 'Altro che ti pesa',
    reply: 'Perfetto, queste le prendiamo noi.',
  },
  {
    id: 'strumenti',
    title: 'Quali strumenti e account usi?',
    hint: 'Per ora i mostri usano il web e le note; gli account arrivano presto.',
    groups: [
      {
        id: 'cosa',
        kind: 'multi',
        options: [
          { id: 'gmail', label: 'Gmail' },
          { id: 'calendar', label: 'Google Calendar' },
          { id: 'notion', label: 'Notion' },
          { id: 'obsidian', label: 'Obsidian' },
          { id: 'instagram', label: 'Instagram' },
          { id: 'linkedin', label: 'LinkedIn' },
          { id: 'github', label: 'GitHub' },
          { id: 'slack', label: 'Slack' },
        ],
        defaults: [],
        required: false,
      },
    ],
    freeText: 'Altri strumenti',
    reply: 'Me lo segno: quando arrivano gli account, partiamo da questi.',
  },
  {
    id: 'chiedi',
    title: 'Cosa non devono mai fare senza chiederti?',
    hint: 'Per tutto il resto lavorano da soli e ti avvisano alla fine.',
    groups: [
      {
        id: 'cosa',
        kind: 'multi',
        options: [
          { id: 'publish', label: 'Pubblicare' },
          { id: 'contact', label: 'Inviare messaggi o mail' },
          { id: 'spend', label: 'Pagare o comprare' },
          { id: 'delete', label: 'Cancellare' },
          { id: 'goal', label: 'Cambiare un obiettivo' },
        ],
        defaults: ['publish', 'contact', 'spend', 'delete'],
        required: false,
      },
    ],
    freeText: 'Altro da chiederti sempre',
    reply: 'Promesso: su queste cose chiediamo sempre prima.',
  },
  {
    id: 'tono',
    title: 'Che tono vuoi nei messaggi? E in che lingua?',
    groups: [
      {
        id: 'tono',
        kind: 'single',
        label: 'Tono',
        options: [
          { id: 'amichevole', label: 'Amichevole' },
          { id: 'diretto', label: 'Diretto' },
          { id: 'formale', label: 'Formale' },
          { id: 'scherzoso', label: 'Scherzoso' },
        ],
        defaults: ['amichevole'],
        required: true,
      },
      {
        id: 'lingua',
        kind: 'single',
        label: 'Lingua',
        options: [
          { id: 'it', label: 'Italiano' },
          { id: 'en', label: 'English' },
          { id: 'es', label: 'Español' },
          { id: 'fr', label: 'Français' },
          { id: 'de', label: 'Deutsch' },
        ],
        defaults: ['it'],
        required: true,
      },
    ],
    freeText: 'Qualche preferenza in più sullo stile',
    reply: 'Fatto! Ora vediamo cosa possono fare i mostri.',
  },
];

/** Answer to one question: values per group (option ids, or the typed name) plus free text. */
export interface OnboardingAnswer {
  values: Record<string, string[]>;
  text?: string | undefined;
}

/** Display names: letters (also accented), spaces, apostrophes and hyphens; starts with a letter. */
/**
 * A monster's name: letters, spaces, apostrophes, dashes and the middle dot of
 * a copy in a project ("Rhea · Saturday", D-097), at most 24 characters.
 */
export const AGENT_NAME_PATTERN = /^\p{L}[\p{L}\p{M}' ·-]{0,23}$/u;

/** Checks one answer against its question. Returns the problems found (empty = valid). */
export function checkOnboardingAnswer(q: OnboardingQuestion, a: OnboardingAnswer): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(a.values)) {
    if (!q.groups.some((g) => g.id === key)) problems.push(`${q.id}.${key}: unknown group`);
  }
  for (const g of q.groups) {
    const values = (a.values[g.id] ?? []).map((v) => v.trim()).filter(Boolean);
    if (g.required && values.length === 0) problems.push(`${q.id}.${g.id}: required`);
    if (g.kind !== 'multi' && values.length > 1) problems.push(`${q.id}.${g.id}: one value only`);
    if (g.kind === 'name') {
      for (const v of values) {
        if (!AGENT_NAME_PATTERN.test(v)) problems.push(`${q.id}.${g.id}: invalid name "${v}"`);
      }
    } else {
      for (const v of values) {
        if (!g.options.some((o) => o.id === v)) problems.push(`${q.id}.${g.id}: unknown option`);
      }
    }
  }
  if (a.text !== undefined && q.freeText === undefined && a.text.trim() !== '') {
    problems.push(`${q.id}: no free text here`);
  }
  return problems;
}

/** Names of the agents the team can use, in order (moons of Saturn). Rhea and Dione are the archetypes. */
export const MOON_NAMES: readonly string[] = [
  'Tethys',
  'Enceladus',
  'Hyperion',
  'Mimas',
  'Iapetus',
  'Phoebe',
  'Janus',
  'Pandora',
  'Prometheus',
  'Calypso',
  'Telesto',
  'Helene',
  'Epimetheus',
  'Daphnis',
  'Atlas',
  'Pan',
];

/** A folder of the computer, outside the vault, that agents may use with the `fs_*` tools. */
export interface FolderGrant {
  /** Absolute path (`~` allowed). */
  path: string;
  /** Also create, change, move and delete files (otherwise read only). */
  write: boolean;
}

/** Permissions of an agent: granted at the onboarding, editable in the settings. */
export interface AgentPermissions {
  /** Write in the vault (reading is always allowed). */
  vault: boolean;
  /** Search and read web pages. */
  web: boolean;
  /**
   * Run commands in a terminal (`shell`) and install CLIs in the agent's
   * folder. It reaches the whole user account, beyond the granted folders.
   * Missing means false (teams created before Phase 2).
   */
  shell?: boolean;
  /** Folders outside the vault for the `fs_*` tools. Missing means none. */
  folders?: FolderGrant[];
}

/** The terminal is off by default: it reaches the whole account, the user turns it on. */
export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = {
  vault: true,
  web: true,
  shell: false,
  folders: [],
};
