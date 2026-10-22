import { appLang, isLang, type Lang } from './i18n.ts';
import { onboardingStrings, onboardingStringsOf } from './onboarding.strings.ts';

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

/** An option: an id whose label is in the dictionary, or an id with a label that is a name (never translated). */
type OptionShape = string | { id: string; label: string };

interface GroupShape {
  id: string;
  kind: OnboardingGroup['kind'];
  options: OptionShape[];
  /** Preselected ids; a function for defaults that follow the language of the words (D-153). */
  defaults: string[] | ((lang: Lang) => string[]);
  required: boolean;
  /** The group has a label / a placeholder in the dictionary. */
  label?: boolean;
  placeholder?: boolean;
}

interface QuestionShape {
  id: string;
  hint?: boolean;
  freeText?: boolean;
  groups: GroupShape[];
}

/** Adds to `target` properties that read their value from the dictionary each time. */
function words<T extends object>(target: T, getters: Record<string, () => unknown>): T {
  const descriptors: PropertyDescriptorMap = {};
  for (const [key, get] of Object.entries(getters)) {
    descriptors[key] = { enumerable: true, configurable: true, get };
  }
  return Object.defineProperties(target, descriptors);
}

/** `lang`: the words of that language whatever the app's; none: the app's, read each time. */
function buildQuestion(shape: QuestionShape, lang?: Lang): OnboardingQuestion {
  const texts = () => {
    const t = (lang ? onboardingStringsOf(lang) : onboardingStrings())[shape.id];
    if (!t) throw new Error(`onboarding: no words for ${shape.id}`);
    return t;
  };
  const groups = shape.groups.map((g): OnboardingGroup => {
    const options = g.options.map((o): OnboardingOption => {
      if (typeof o !== 'string') return { id: o.id, label: o.label };
      return words({ id: o } as OnboardingOption, { label: () => texts().options?.[o] ?? o });
    });
    return words(
      {
        id: g.id,
        kind: g.kind,
        options,
        ...(typeof g.defaults === 'function' ? {} : { defaults: g.defaults }),
        required: g.required,
      } as OnboardingGroup,
      {
        ...(typeof g.defaults === 'function'
          ? { defaults: () => (g.defaults as (l: Lang) => string[])(lang ?? appLang()) }
          : {}),
        ...(g.label ? { label: () => texts().groups?.[g.id]?.label ?? '' } : {}),
        ...(g.placeholder ? { placeholder: () => texts().groups?.[g.id]?.placeholder ?? '' } : {}),
      },
    );
  });
  return words({ id: shape.id, groups } as OnboardingQuestion, {
    title: () => texts().title,
    ...(shape.hint ? { hint: () => texts().hint ?? '' } : {}),
    ...(shape.freeText ? { freeText: () => texts().freeText ?? '' } : {}),
    reply: () => texts().reply,
  });
}

/**
 * The questions as data: ids, kinds, defaults. The words (titles, hints, labels, replies) are
 * read from `onboarding.strings.ts` each time, so they follow the app's language.
 */
const QUESTION_SHAPES: readonly QuestionShape[] = [
  {
    id: 'nomi',
    hint: true,
    groups: [
      {
        id: 'user',
        kind: 'name',
        label: true,
        placeholder: true,
        options: [],
        defaults: [],
        required: true,
      },
      {
        id: 'orchestrator',
        kind: 'name',
        label: true,
        placeholder: true,
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
  },
  {
    id: 'lavoro',
    hint: true,
    freeText: true,
    groups: [
      {
        id: 'cosa',
        kind: 'multi',
        options: [
          'social',
          'sviluppo',
          'marketing',
          'consulenza',
          'impresa',
          'studio',
          'scrittura',
        ],
        defaults: [],
        required: false,
      },
    ],
  },
  {
    id: 'obiettivi',
    freeText: true,
    groups: [
      {
        id: 'cosa',
        kind: 'multi',
        options: ['costanza', 'clienti', 'lancio', 'ordine', 'imparare', 'tempo'],
        defaults: [],
        required: false,
      },
    ],
  },
  {
    id: 'deleghe',
    freeText: true,
    groups: [
      {
        id: 'cosa',
        kind: 'multi',
        options: [
          'ricerche',
          'bozze',
          'riassunti',
          'note',
          'piano',
          'numeri',
          // For who writes software (the UI shows them when the work is "sviluppo").
          'bug',
          'test',
          'docs',
          'review',
          'capire',
        ],
        defaults: [],
        required: false,
      },
    ],
  },
  {
    id: 'strumenti',
    hint: true,
    freeText: true,
    groups: [
      {
        id: 'cosa',
        kind: 'multi',
        // Names of products: the same in every language.
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
  },
  {
    id: 'chiedi',
    hint: true,
    freeText: true,
    groups: [
      {
        id: 'cosa',
        kind: 'multi',
        options: ['publish', 'contact', 'spend', 'delete', 'goal'],
        defaults: ['publish', 'contact', 'spend', 'delete'],
        required: false,
      },
    ],
  },
  {
    id: 'tono',
    freeText: true,
    groups: [
      {
        id: 'tono',
        kind: 'single',
        label: true,
        options: ['amichevole', 'diretto', 'formale', 'scherzoso'],
        defaults: ['amichevole'],
        required: true,
      },
      {
        id: 'lingua',
        kind: 'single',
        label: true,
        // The languages by their own names, the same in every language.
        options: [
          { id: 'it', label: 'Italiano' },
          { id: 'en', label: 'English' },
          { id: 'es', label: 'Español' },
          { id: 'fr', label: 'Français' },
          { id: 'de', label: 'Deutsch' },
        ],
        // The monsters write in the app's language unless the user picks another (D-153).
        defaults: (lang) => [lang],
        required: true,
      },
    ],
  },
];

/** The fixed questions; their texts follow the app's language each time they are read. */
export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = QUESTION_SHAPES.map((q) =>
  buildQuestion(q),
);

/**
 * The questions with the words of one language, whatever the app's: for a text the core writes in
 * a language of its own (the profile in Italian, for the model and `profilo.md`), which reads the
 * labels of the options inside its sentences.
 */
export function onboardingQuestionsIn(lang: Lang): readonly OnboardingQuestion[] {
  return QUESTION_SHAPES.map((q) => buildQuestion(q, lang));
}

/**
 * The writing language the onboarding starts on (D-153): the app's language, which the user
 * picked or confirmed on the first screen. A system language the app has no words for (Spanish,
 * French, German: the app falls back to English) goes first instead (audit 2.12). `systemTag`:
 * the browser's or the system's language tag ("es-ES").
 */
export function defaultWritingLanguage(
  options: readonly string[],
  app: Lang = appLang(),
  systemTag = '',
): string | undefined {
  const code = systemTag.slice(0, 2).toLowerCase();
  if (app === 'en' && code !== '' && !isLang(code) && options.includes(code)) return code;
  return options.includes(app) ? app : undefined;
}

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

/**
 * Everything on by default (D-159): a monster without the terminal or the web is not an
 * agent, and the testers of alpha.20 found the terminal off and the monsters unable to work.
 * The user turns a permission off in Settings → Permissions; the brake, the lockout of the data
 * folder and the spending caps stay on.
 */
export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = {
  vault: true,
  web: true,
  shell: true,
  folders: [],
};

/**
 * Revision of the saved permissions: below 2 the terminal was off by default, and a core that
 * finds an older file turns it on once (`openSavedPermissions`).
 */
export const PERMISSIONS_REVISION = 2;
