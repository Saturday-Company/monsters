import {
  BROWSER_SERVER,
  trimUrlEnd,
  URL_IN_TEXT,
  URL_STOP_CHARS,
  type MonstersTool,
} from '@monsters/shared';
import { splitAgentToolName } from '../../mcp/convert.ts';
import { unicodeWords } from '../word-boundary.ts';
import { NOTE_LEAK_CHARS, type RunTaint } from './taint.ts';

/*
 * Actions that leave the computer (research 07 §5.1, killer feature 1): the
 * rules that recognise them, before any model. `certain` means the rules
 * know what the action does (`git push`, `send_email`, a click on "Invia");
 * the others are candidates the instinct looks at ("does it publish, write to
 * third parties, spend or delete for good?"). Reading, searching and the
 * vault (history and undo) are never an action that asks, but what the
 * arguments of a tool of another program carry is checked, reads included
 * (review of 18/10, A1).
 *
 * Once the run read third-party text (`RunTaint`, D-070), the exits that carry
 * data are checked too: a URL, a search query or a browser page that repeats
 * a private note (anywhere), or the notes and the profile towards a site the
 * run does not know. A link followed as it is, a search, a page read are
 * never asked. A page a monster saves (`artifact_create`) is an exit too: its
 * scripts could send what it holds (review of 16/10, D-085).
 */

export type OutboundCategory = 'publish' | 'contact' | 'spend' | 'delete';

export const CATEGORY_WORDS: Record<OutboundCategory, string> = {
  publish: 'pubblicare',
  contact: 'scrivere a terzi',
  spend: 'spendere',
  delete: 'cancellare per sempre',
};

export interface OutboundCall {
  category: OutboundCategory | undefined;
  certain: boolean;
  /** What the action does, in Italian, for the card ("eseguire «git push»"). */
  summary: string;
  /** A candidate that goes on the receipt even when the instinct says no. */
  markAlways?: boolean;
  /** What the action means, for the card ("cioè …"), when the category's words would mislead. */
  meaning?: string;
  /** Short arguments for the instinct and the receipt. */
  args: string;
  /**
   * Only a mark on the receipt, with this reason, never a card nor the
   * instinct (a little data towards a site the run does not know).
   */
  markOnly?: string;
  /** Something more the instinct is told about the tool (the server's destructive hint). */
  hint?: string;
}

export interface ClassifyOptions {
  /** A registered secret in a text (a key in an URL). */
  containsSecret?: (text: string) => boolean;
  /** What the run has read and knows (D-070). */
  taint?: RunTaint;
  /**
   * A tool that writes a file (`writesPath`): its real path is inside the
   * folders the agent may change (the guard resolves it, D-092).
   */
  writeInside?: boolean;
  /**
   * The element of the browser's last page snapshot behind a ref (`e42` → `button "Condividi"`),
   * as the page names it (D-131): the label the model writes in `element` is optional and its
   * own words, the snapshot is what it clicks.
   */
  browserLabel?: (ref: string) => string | undefined;
}

const clipText = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function argsText(input: unknown, max = 400): string {
  try {
    return clipText(typeof input === 'string' ? input : (JSON.stringify(input) ?? ''), max);
  } catch {
    return '';
  }
}

// --- terminal --------------------------------------------------------------------------

/*
 * No rule spans a separator (`;`, `&`, `|`, a new line): each piece of a
 * command is checked on its own, so the time grows with the pieces, not with
 * the square of the command (review of 16/10: `rm -r ` 1,700 times took 10 s).
 */
const SEGMENT_BREAK = /[|;&\n]/;
/** Longest command the rules read (the hooks of Claude Code too): past it, the instinct. */
export const MAX_CLASSIFIED_CHARS = 100_000;
/** Longest piece between separators the rules read. */
const MAX_SEGMENT_CHARS = 8_000;

type ShellRule =
  | { category: OutboundCategory; re: RegExp }
  /** Parts found one after the other in the same piece (linear, unlike `a[^;]*b[^;]*c`). */
  | { category: OutboundCategory; seq: RegExp[] };

// `git` may come with global options first (`git -C <folder> push`, seen on Claude Code).
const GIT = String.raw`\bgit(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S+)?)){0,12}\s+`;

const SHELL_RULES: ShellRule[] = [
  {
    category: 'publish',
    re: new RegExp(
      String.raw`\b(?:(?:npm|pnpm|yarn|bun)\s+publish|gh\s+(?:release|pr|issue|gist|repo)\s+create|(?:twine|cargo|gem)\s+(?:upload|publish|push)|docker\s+push|wrangler\s+(?:deploy|publish)|netlify\s+deploy|firebase\s+deploy|fly\s+deploy)\b|${GIT}push\b`,
      'i',
    ),
  },
  { category: 'publish', seq: [/\bvercel\b/gi, /--prod\b/gi] },
  {
    category: 'contact',
    re: /\bSend-MailMessage\b|\b(?:nc|ncat|netcat)\s+(?:-\w+\s+)*[\w.-]+\s+\d{2,5}\b|\b(?:sendmail|mailx?|mutt|msmtp)\b|\bssh\s+[\w.-]*@[\w.-]+/i,
  },
  // PowerShell (the terminal on Windows) too: Invoke-WebRequest/RestMethod with a body.
  {
    category: 'contact',
    seq: [
      /\b(?:Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/gi,
      /-(?:Method\s+['"]?(?:Post|Put|Patch|Delete)\b|Body\b|InFile\b)/gi,
    ],
  },
  {
    category: 'contact',
    seq: [
      /\bcurl\b/gi,
      /-X\s*(?:POST|PUT|PATCH|DELETE)\b|--data\b|--data-\w+|\s-d\s|\s-F\s|--form\b|--upload-file\b|\s-T\s/gi,
    ],
  },
  { category: 'contact', seq: [/\bwget\b/gi, /--post/gi] },
  // scp, sftp, rsync towards another computer (`user@host:` or `host:`).
  { category: 'contact', seq: [/\b(?:scp|sftp|rsync)\b/gi, /\s[\w.-]+(?:@[\w.-]+)?:/g] },
  {
    category: 'spend',
    re: /\b(?:stripe\s+(?:charges|payment_intents|checkout)|paypal)\b/i,
  },
  // PowerShell and cmd: Remove-Item -Recurse / rd /s on a drive or the home, Format-Volume.
  {
    category: 'delete',
    seq: [
      /\b(?:Remove-Item|rm|ri|del|erase)\b/gi,
      /-(?:Recurse|r)\b/gi,
      /[A-Za-z]:[\\/]|~|\$HOME|\$env:USERPROFILE/gi,
    ],
  },
  { category: 'delete', seq: [/\b(?:rd|rmdir)\s+\/s\b/gi, /[A-Za-z]:[\\/]|%USERPROFILE%/gi] },
  // A force-push deletes history.
  { category: 'delete', seq: [new RegExp(`${GIT}push\\s`, 'gi'), /--force\b|(?<=\s)-f\b/gi] },
  {
    category: 'delete',
    re: new RegExp(
      String.raw`\bFormat-Volume\b|\b(?:shred|mkfs(?:\.\w+)?|(?:terraform|tofu)\s+destroy|kubectl\s+delete)\b|${GIT}(?:reset\s+--hard|clean\s+-\w*f)\b|\bdd\s+if=|\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b|\brm\s+(?:-\w*\s+)*-(?=\w*[rf])\w+\s+(?:\/|~|\.\.|\$HOME)`,
      'i',
    ),
  },
];

/** The parts of a sequence rule, each after the previous one. */
function inSequence(text: string, parts: readonly RegExp[]): boolean {
  let at = 0;
  for (const re of parts) {
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m) return false;
    at = m.index + m[0].length;
  }
  return true;
}

const ruleMatches = (rule: ShellRule, piece: string) =>
  're' in rule ? rule.re.test(piece) : inSequence(piece, rule.seq);

/** `rm -r` on a relative path: maybe the agent's own files, the instinct decides. */
const SHELL_CANDIDATE = /\brm\s+(?:-\w*\s+)*-(?=\w*[rf])\w+\s/i;

/**
 * Folders a build or a tool makes again by itself (D-073: Jev gave `rm -r
 * build/cache` 0.76, as sure as a client folder): `rm -r` on these alone is
 * local work, never a question.
 */
const REGENERABLE = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'tmp',
  'temp',
  '.cache',
  'cache',
  '__pycache__',
  '.pytest_cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '.venv',
  'venv',
]);
const PLAIN_SEGMENT = /^[\w.-]+$/;

/**
 * A path inside a folder that is made again (D-074, review of 16/10): plain
 * names only, never `..` (`build/../../clienti`, `node_modules/..`), an
 * absolute path, a glob other than a last `*` (`.*` may match `..`), or a
 * quote or escape inside the path. One pair of quotes around it is fine.
 */
export function regenerablePath(target: string): boolean {
  let t = target;
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0]) t = t.slice(1, -1);
  if (t.length === 0 || t.length > 500) return false;
  const parts = t.split('/');
  if (parts[0] === '.') parts.shift();
  if (parts.at(-1) === '') parts.pop();
  let inside = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === '*' && inside && i === parts.length - 1) return true;
    if (!PLAIN_SEGMENT.test(part) || part === '..' || part === '.') return false;
    if (REGENERABLE.has(part)) inside = true;
  }
  return inside;
}

function onlyRegenerable(command: string): boolean {
  const m = /^\s*rm\s+((?:-\w+\s+)*)(.+)$/i.exec(command);
  if (!m || /[;&|`$(){}<>\\]/.test(m[2]!)) return false;
  const targets = m[2]!.trim().split(/\s+/);
  return targets.every(regenerablePath);
}

function shellCall(command: string, options: ClassifyOptions): OutboundCall | null {
  const cmd = command.trim();
  const args = clipText(cmd, 300);
  if (cmd.length > MAX_CLASSIFIED_CHARS) {
    // Too long to read rule by rule in time: the instinct looks at it, the receipt shows it.
    return {
      category: undefined,
      certain: false,
      summary: `eseguire un comando molto lungo («${clipText(cmd, 120)}»)`,
      args,
      markAlways: true,
    };
  }
  const pieces = cmd.split(SEGMENT_BREAK);
  const readable = pieces.filter((p) => p.length <= MAX_SEGMENT_CHARS);
  // Force-push and friends first: a `git push --force` deletes history.
  const ordered = [...SHELL_RULES].sort((a) => (a.category === 'delete' ? -1 : 0));
  for (const r of ordered) {
    if (readable.some((p) => ruleMatches(r, p))) {
      return { category: r.category, certain: true, summary: `eseguire «${args}»`, args };
    }
  }
  if (readable.length < pieces.length) {
    return {
      category: undefined,
      certain: false,
      summary: `eseguire un comando molto lungo («${clipText(cmd, 120)}»)`,
      args,
      markAlways: true,
    };
  }
  if (SHELL_CANDIDATE.test(cmd) && !onlyRegenerable(cmd)) {
    return { category: 'delete', certain: false, summary: `eseguire «${args}»`, args };
  }
  // A plain download (curl, wget, Invoke-WebRequest): the address may carry data.
  return mostSevere(
    [...cmd.matchAll(SHELL_URL)].map((m) => urlCall(m[0], 'aprire dal terminale', options)),
  );
}

/** An address in a command: shell delimiters and brackets of other scripts end it. */
const SHELL_URL = new RegExp(`https?:\\/\\/[^\\s'"\`<>|;&)${URL_STOP_CHARS}]+`, 'giu');

// --- tools of other programs (MCP) -------------------------------------------------------

// English, and the Italian of Saturday's own servers (Anteiku: `anteiku_task_elimina`,
// `anteiku_documenti_cestina`, `anteiku_preventivi_togli_voce`, D-075). Not `ordina`: in
// Italian it also means "sort" (`preventivi_ordina`).
const VERBS: { category: OutboundCategory; re: RegExp }[] = [
  {
    category: 'spend',
    re: /^(pay|payment|purchase|buy|order|checkout|charge|transfer|subscribe|book|refund|donate|paga|acquista|compra|rimborsa|addebita)$/,
  },
  // Also what overwrites or empties (review of 16/10): what was there is gone all the same.
  {
    category: 'delete',
    re: /^(delete|remove|trash|destroy|purge|erase|drop|wipe|unlink|clear|reset|overwrite|truncate|elimina|cancella|cestina|rimuovi|togli|distruggi|svuota|azzera|sovrascrivi|resetta)$/,
  },
  {
    category: 'publish',
    re: /^(post|publish|tweet|share|unshare|grant|deploy|release|broadcast|announce|pubblica|condividi|annuncia)$/,
  },
  {
    category: 'contact',
    re: /^(send|reply|forward|email|mail|message|invite|comment|notify|dm|sms|call|text|respond|submit|invia|manda|rispondi|inoltra|invita|commenta|notifica|telefona)$/,
  },
];

/**
 * Tools that take something away without deleting it for good (`archive`,
 * `anteiku_clienti_archivia`) or that record money (`anteiku_pagamenti_segna_pagato`,
 * `mark_as_paid`): certain, with their own words on the card (D-075).
 */
const ARCHIVE = /^(archive|archivia)$/;
const MARK = /^(mark|segna)$/;
const PAID = /^(paid|pagato|pagata|pagati|incassato|incassata)$/;

/*
 * Who can see or change something (D-073, Claude Design `update_sharing`,
 * `add_member`, `update_member_role`, `remove_member`): sharing is
 * publishing, adding a person writes to a third party, and taking a person
 * out changes what someone else can do, but deletes nothing. These names
 * often have no verb the list above knows ("update_sharing"), or one that
 * would mean the wrong thing ("remove_member" is not "cancellare per sempre").
 */
const PERSON_NOUN =
  /^(member|members|collaborator|collaborators|guest|guests|user|users|people|person|invitee|invitees|teammate|teammates|seat|seats|editor|editors|viewer|viewers|owner|owners)$/;
const ACCESS_NOUN =
  /^(sharing|shares|visibility|public|permission|permissions|acl|acls|access|role|roles|ownership)$/;
const ADD_PERSON = /^(add|invite|create|grant|assign)$/;
/** Taking a person out: their access ends, nothing of the user's is lost. */
const REMOVE_PERSON = /^(remove|kick|revoke|ban|unassign|deactivate|suspend)$/;
const CHANGE_VERB = /^(update|set|change|edit|modify|promote|demote|transfer)$/;
/** A verb that changes who can see something ("website_repo_access" has none: the instinct). */
const ACCESS_VERB =
  /^(update|set|change|edit|modify|make|create|add|grant|enable|disable|toggle|remove|revoke|delete|transfer|open|close|restrict)$/;
/** Merging into a branch others use publishes; merging two designs does not. */
const MERGED = /^(pull|pr|request|branch|branches)$/;

interface AccessCall {
  category: OutboundCategory;
  /** What it means, in the card ("cioè …"), in place of the category's words. */
  meaning: string;
}

/** Words after the person that keep them the object: "add_member_to_team", "set_user_role". */
const AFTER_PERSON = /^(to|from|in|into|on|for|of|at|with)$/;

/**
 * The person is what the tool acts on: the last word, or followed by a word
 * of access ("update_member_role") or a preposition ("invite_user_to_team").
 * "set_user_preferences" and "update_user_profile" change a thing of a user,
 * not who can do what (D-074).
 */
function personIsObject(w: readonly string[], at: number): boolean {
  const next = w[at + 1];
  return next === undefined || ACCESS_NOUN.test(next) || AFTER_PERSON.test(next);
}

/** Any verb the rules know: the first one decides, the service's name may come first. */
const KNOWN_VERB = (x: string) =>
  ADD_PERSON.test(x) ||
  REMOVE_PERSON.test(x) ||
  CHANGE_VERB.test(x) ||
  ACCESS_VERB.test(x) ||
  VERBS.some((v) => v.re.test(x));

function accessCall(w: readonly string[]): AccessCall | null {
  // The first word that is a verb ("github_add_collaborator": add, "drive_update_sharing": update).
  const verb = w.find(KNOWN_VERB) ?? '';
  const person = w.findIndex((x) => PERSON_NOUN.test(x));
  if (person !== -1 && personIsObject(w, person)) {
    if (ADD_PERSON.test(verb)) {
      return { category: 'contact', meaning: 'dare accesso a un’altra persona (scrivere a terzi)' };
    }
    if (REMOVE_PERSON.test(verb)) {
      return { category: 'contact', meaning: 'togliere l’accesso a un’altra persona' };
    }
    // delete_user, purge_members: an account may go for good, the verbs decide.
    if (VERBS.some((v) => v.category === 'delete' && v.re.test(verb))) return null;
    if (w.some((x) => ACCESS_NOUN.test(x)) || CHANGE_VERB.test(verb)) {
      return {
        category: 'publish',
        meaning: 'cambiare cosa può fare un’altra persona (pubblicare)',
      };
    }
    return null;
  }
  if (w.some((x) => ACCESS_NOUN.test(x)) && ACCESS_VERB.test(verb)) {
    return { category: 'publish', meaning: 'cambiare chi può vedere o modificare (pubblicare)' };
  }
  if (w[0] === 'merge' && w.some((x) => MERGED.test(x))) {
    return {
      category: 'publish',
      meaning: 'unire le modifiche dove le vedono gli altri (pubblicare)',
    };
  }
  return null;
}

/*
 * A tool that writes without a known verb (a candidate) still tells what it
 * does in its arguments (people to invite or notify) and in the server's own
 * description ("emails the invitation", "a folder shared with the client").
 * A server can lie only to look harmless, and then the verbs and the instinct
 * stay: these words only make the brake more careful.
 */
// Fields that name who receives or joins. Not `email`: in "create_contact" or
// "update_customer" it is a field of the record, not someone to write to (D-074).
const PEOPLE_ARGS =
  /"(?:attendees|invitees|participants|guests|recipients|to|cc|bcc|members?|collaborators?)"\s*:\s*(?:\[[^\]]*)?"[^"]*@[^"]+"/i;
const NOTIFY_ARGS =
  /"(?:send_?(?:updates|notifications?|invit\w*|emails?)|notify(?:_\w+)?)"\s*:\s*(?:true|"(?:all|externalOnly|yes)")/i;
const DESCRIPTION_RULES: { category: OutboundCategory; re: RegExp }[] = [
  {
    category: 'contact',
    re: /\b(e-?mails?\s+(?:the|an?|to)\b|sends?\b|notif(?:y|ies)\b|invit(?:es|ation|ations)\b|invi(?:a|are|amo)\b|invierà|mand(?:a|are)\b|manderà|notific(?:a|are)\b|notificherà)/i,
  },
  {
    category: 'publish',
    re: /\b(publish(?:es|ed)?|publicly|public\b|shared\s+(?:with|team|workspace)|visible\s+to|anyone\s+with\s+the\s+link|pubblic\w*|condivis[aeio]\b)/i,
  },
  {
    // Not "budget" or "billing": a project's budget or a billing address spends nothing (D-074).
    category: 'spend',
    re: /\b(charges?\b|pays?\b|payments?\b|purchases?\b|spend\w*|addebit\w*|pagament\w*)/i,
  },
];

/** A word that takes back what follows in its sentence ("Does not notify anyone"). */
const NEGATION =
  /\b(?:not|no|never|without|none|nobody|doesn['’]t|don['’]t|won['’]t|isn['’]t|aren['’]t|cannot|can['’]t|non|senza|mai|nessun[oa]?|niente)\b/i;

/**
 * What the server's description says the tool does, clause by clause: a
 * word denied just before it ("Does not notify anyone", "non invia nulla")
 * does not count.
 */
function describedCategory(description: string): OutboundCategory | undefined {
  for (const clause of description.slice(0, 4_000).split(/[.,:;!?\n]+/)) {
    for (const r of DESCRIPTION_RULES) {
      const m = r.re.exec(clause);
      // The negation just before the word: "No login needed, sends…" still sends.
      if (m && !NEGATION.test(clause.slice(Math.max(0, m.index - 40), m.index))) {
        return r.category;
      }
    }
  }
  return undefined;
}
/**
 * A budget in the tool's own name is money (D-074): "update_budget" spends,
 * while "budget" in a description ("the name, budget or status of a
 * project") is only a field.
 */
const SPEND_NOUN = /^(budget|budgets|bid|bids|spend|spending)$/;
const SPEND_CHANGE = /^(update|set|change|edit|modify|increase|raise|adjust|create|add)$/;

/** Words that make an action a draft, not a sending ("create_draft", "save_draft"). */
const DRAFT = /^(draft|drafts|preview|bozza|bozze)$/;
/**
 * Words of a tool that only reads ("notion-get-comments", "gmail_read_message").
 * Not `apri`/`open`: WitDesk's `ticket_apri` opens a ticket, a write (review of 16/10).
 */
const READ =
  /^(get|list|search|fetch|query|read|find|retrieve|describe|view|show|lookup|count|download|browse|inspect|leggi|elenca|cerca|trova|mostra|conta|scarica|visualizza)$/;
/** "get_and_reset_counter", "fetch_then_delete": the verb after the conjunction decides. */
const AND = /^(and|then|e|poi)$/;

/**
 * Taking back something done (review of 16/10): an invoice, an order, a
 * subscription or a booking cancelled rarely comes back, and who was waiting
 * for it sees it. Certain, with its own words on the card. Not `cancel` of
 * something that only stops on this side (a draft, an upload, a job).
 */
const ANNUL = /^(cancel|annulla|void|revoke|revoca)$/;
const ANNUL_HARMLESS =
  /^(draft|drafts|bozza|bozze|upload|uploads|download|downloads|job|jobs|run|runs|build|builds|operation|operations|request|requests|search|query|import|export|edit|edits|change|changes|modifica|modifiche|caricamento|ricerca)$/;
/** An emptied cache, a cleared selection or filter: made again by itself, the instinct decides. */
const REGENERABLE_NOUN =
  /^(cache|caches|tmp|temp|selection|selections|filter|filters|highlight|highlights|selezione|filtri|filtro)$/;

function words(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Labels of buttons that send, publish, pay or delete (browser clicks). Instagram's last step
 * is «Condividi» / «Share» (D-131), as Facebook's and LinkedIn's «Pubblica».
 */
const BUTTON = unicodeWords(
  /\b(invia|inviare|manda|pubblica|pubblicare|posta|condividi|condividere|ricondividi|acquista|compra|paga|pagare|ordina|procedi\s+al\s+pagamento|conferma\s+(?:l['’]ordine|il\s+pagamento|l['’]acquisto)|elimina|cancella|send|post|publish|share|reshare|repost|tweet|buy|purchase|pay|place\s+order|checkout|delete|remove|iscriviti|subscribe|submit)\b/iu,
);
const BUTTON_CATEGORY: [RegExp, OutboundCategory][] = [
  [
    /\b(acquista|compra|paga|pagare|ordina|pagamento|acquisto|ordine|buy|purchase|pay|order|checkout|subscribe|iscriviti)/i,
    'spend',
  ],
  [/\b(elimina|cancella|delete|remove)/i, 'delete'],
  [/\b(pubblica|posta|post|publish|tweet|condivid|ricondivid|share|reshare|repost)/i, 'publish'],
];

/** A ref of Playwright MCP's snapshot (`e42`, `f1e3` in a frame). */
const SNAPSHOT_REF = /^[a-z]?\d*e\d+$/i;

/**
 * What a click or a typing in the browser hits, in words: the model's `element` (optional, its
 * own description), the element of the last snapshot behind the ref, and the target itself
 * when it is a selector (`text=Condividi`, `button:has-text("Share")`). Playwright MCP 0.0.83
 * names the ref `target`, older versions `ref`.
 */
function browserTarget(
  input: Record<string, unknown>,
  options: ClassifyOptions,
): { text: string; known: boolean } {
  const element = typeof input['element'] === 'string' ? input['element'].trim() : '';
  const raw =
    typeof input['target'] === 'string'
      ? input['target'].trim()
      : typeof input['ref'] === 'string'
        ? input['ref'].trim()
        : '';
  const isRef = SNAPSHOT_REF.test(raw);
  const label = isRef ? options.browserLabel?.(raw) : undefined;
  const parts = [element, label ?? '', isRef ? '' : raw].filter(Boolean);
  return { text: parts.join(' · '), known: label !== undefined || (!isRef && raw !== '') };
}

/** Code run in a page that sends something out (fetch, a beacon, a form, another page). */
const PAGE_NETWORK =
  /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|window\.open)\b|\blocation(?:\.href)?\s*=|\.submit\s*\(/;

function browserCall(
  tool: string,
  input: Record<string, unknown>,
  options: ClassifyOptions,
): OutboundCall | null {
  const target = browserTarget(input, options);
  const element = target.text;
  if (tool === 'browser_click' && BUTTON.test(element)) {
    const category = BUTTON_CATEGORY.find(([re]) => re.test(element))?.[1] ?? 'contact';
    return {
      category,
      certain: true,
      summary: `premere «${clipText(element, 80)}» nel browser`,
      args: argsText(input),
    };
  }
  // A click whose element nobody can name (no description, a ref of no snapshot seen): the
  // instinct looks at it instead of letting it pass as harmless (D-131).
  if (tool === 'browser_click' && !target.known && !BUTTON.test(element)) {
    if (element !== '') return null;
    return {
      category: undefined,
      certain: false,
      summary: 'premere nel browser un elemento che non so nominare',
      args: argsText(input),
    };
  }
  if (tool === 'browser_type' && input['submit'] === true) {
    return {
      category: 'contact',
      certain: false,
      summary: `inviare un modulo nel browser${element ? ` («${clipText(element, 60)}»)` : ''}`,
      args: argsText(input),
    };
  }
  if (tool === 'browser_file_upload' || tool === 'browser_fill_form') {
    return {
      category: 'contact',
      certain: false,
      summary:
        tool === 'browser_file_upload'
          ? 'caricare un file nel browser'
          : 'compilare un modulo nel browser',
      args: argsText(input),
    };
  }
  if (tool === 'browser_navigate' && typeof input['url'] === 'string') {
    return urlCall(input['url'], 'aprire nel browser', options);
  }
  if (tool === 'browser_evaluate' && typeof input['function'] === 'string') {
    if (PAGE_NETWORK.test(input['function'])) {
      return {
        category: 'contact',
        certain: true,
        summary: 'eseguire nel browser del codice che manda dati fuori',
        args: argsText(input),
      };
    }
  }
  return null;
}

/*
 * What the arguments of a tool of another program carry (review of 18/10, A1):
 * a search, a fetch or a crawl of a server is an exit like `web_search` and
 * `web_fetch`, whatever its name says it does. Every call, reads included,
 * goes through the same data checks: a key or a private note in its text
 * (the server is the user's own, like the search engine: only a private note
 * stops, D-070), and every address in it through the rules of a page opened
 * (`urlCall`: keys, mails, IBAN, notes towards a site the run does not know).
 * Being a read only decides that the action itself asks nothing.
 */
/** Strings of the arguments looked at, at most (a page of a few MB costs no more). */
const MAX_ARG_STRINGS = 500;
/** Addresses in the arguments checked one by one, at most. */
const MAX_ARG_URLS = 50;

/** The string values of a call's arguments, depth-first, within the limits above. */
function argStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (out.length >= MAX_ARG_STRINGS || depth > 8) return out;
  if (typeof value === 'string') {
    out.push(value.slice(0, MAX_CLASSIFIED_CHARS));
  } else if (Array.isArray(value)) {
    for (const v of value) argStrings(v, out, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) argStrings(v, out, depth + 1);
  }
  return out;
}

function dataCall(
  server: string,
  tool: string,
  input: unknown,
  options: ClassifyOptions,
): OutboundCall | null {
  const strings = argStrings(input);
  if (strings.length === 0) return null;
  const text = strings.join('\n');
  const shown = clipText(argsText(input), 160);
  const verb = `usare «${tool}» di ${server}`;
  const found: (OutboundCall | null)[] = [];
  if (options.containsSecret?.(text)) {
    found.push({
      category: 'contact',
      certain: true,
      summary: `mandare a ${server} un testo che contiene una delle tue chiavi (${verb}: ${shown})`,
      args: shown,
    });
  }
  found.push(leakCall(text, null, verb, shown, options.taint, `mandare a ${server}`));
  let urls = 0;
  for (const s of strings) {
    for (const m of s.matchAll(URL_IN_TEXT)) {
      if (urls++ >= MAX_ARG_URLS) break;
      found.push(urlCall(trimUrlEnd(m[0]), `aprire con «${tool}» di ${server}`, options));
    }
  }
  return mostSevere(found);
}

function mcpCall(
  t: MonstersTool,
  server: string,
  tool: string,
  input: unknown,
  options: ClassifyOptions,
): OutboundCall | null {
  const action =
    server === BROWSER_SERVER
      ? input && typeof input === 'object'
        ? browserCall(tool, input as Record<string, unknown>, options)
        : null
      : actionCall(t, server, tool, input, options);
  // The data first: on the same severity its card says what leaves (a key, a private note).
  return mostSevere([dataCall(server, tool, input, options), action]);
}

/** What the action of a tool of another program does, from its name, hints and description. */
function actionCall(
  t: MonstersTool,
  server: string,
  tool: string,
  input: unknown,
  options: ClassifyOptions,
): OutboundCall | null {
  const args = argsText(input);
  const fullArgs = argsText(input, 4_000);
  const summary = `usare «${tool}» di ${server}`;
  const w = words(tool);
  if (t.writesPath !== undefined) return fileWriteCall(t.writesPath, server, tool, input, options);
  if (runsCode(w)) return codeCall(t, server, tool, input, options);
  // The server itself says it takes away or overwrites (MCP `destructiveHint: true`, D-075):
  // the brake asks like for a delete, in the server's own terms, whatever word the name
  // starts with (review of 16/10: "list_items" with the hint went through as a read).
  // Contradictory hints (read-only too) are read-only, as the MCP spec says.
  const destructive: OutboundCall | null =
    t.destructive === true && t.readOnly !== true
      ? {
          category: 'delete',
          certain: true,
          summary,
          args,
          meaning: `fare un’azione che ${server} segna come distruttiva (toglie o sovrascrive dati)`,
        }
      : null;
  const leads = (x: string) =>
    VERBS.some((v) => v.re.test(x)) || ANNUL.test(x) || DRAFT.test(x) || READ.test(x);
  // The first word that says what the tool does decides ("send_draft" sends,
  // "create_draft" does not, "get_comments" reads). A verb that sends counts
  // even when the server calls the tool read-only: it is the server's word.
  let at = w.findIndex(leads);
  // "get_and_reset_counter": a verb after "and" is what the tool also does.
  if (at !== -1 && READ.test(w[at]!)) {
    const and = w.findIndex((x, i) => i > at && AND.test(x));
    const next = and === -1 ? -1 : w.findIndex((x, i) => i > and && leads(x) && !READ.test(x));
    if (next !== -1) at = next;
  }
  const lead = at === -1 ? undefined : w[at];
  if (lead && (DRAFT.test(lead) || READ.test(lead))) return destructive;
  // Who can see or change it: before the verbs ("remove_member" deletes nothing).
  const access = accessCall(w);
  if (access) {
    return { category: access.category, certain: true, summary, args, meaning: access.meaning };
  }
  if (lead && ANNUL.test(lead)) {
    // A draft, an upload or a job stopped: a write like the others.
    if (w.some((x) => ANNUL_HARMLESS.test(x))) {
      return destructive ?? { category: undefined, certain: false, summary, args };
    }
    return {
      category: 'delete',
      certain: true,
      summary,
      args,
      meaning: /^(revoke|revoca)$/.test(lead)
        ? 'revocare (una chiave o un permesso revocato non torna)'
        : 'annullare (di solito non si torna indietro, e chi aspettava lo vede)',
    };
  }
  // Money recorded as paid ("segna_pagato"): the user's books change, nothing is spent here.
  const mark = w.findIndex((x) => MARK.test(x));
  if (mark !== -1 && w.slice(mark + 1).some((x) => PAID.test(x))) {
    return {
      category: 'spend',
      certain: true,
      summary,
      args,
      meaning: 'segnare un pagamento come pagato (soldi)',
    };
  }
  const verb = lead ? VERBS.find((v) => v.re.test(lead)) : undefined;
  // "cache_clear", "clear_filters": what is taken away comes back by itself, the instinct decides.
  if (verb?.category === 'delete' && w.some((x) => REGENERABLE_NOUN.test(x))) {
    return destructive ?? { category: undefined, certain: false, summary, args };
  }
  if (verb) return { category: verb.category, certain: true, summary, args };
  if (w.some((x) => ARCHIVE.test(x))) {
    return {
      category: 'delete',
      certain: true,
      summary,
      args,
      meaning: 'archiviare (sparisce dagli elenchi; di solito si può riprendere)',
    };
  }
  // A budget or a bid in the name, changed: money that will be spent ("ads update_budget").
  if (w.some((x) => SPEND_NOUN.test(x)) && w.some((x) => SPEND_CHANGE.test(x))) {
    return { category: 'spend', certain: true, summary, args };
  }
  if (t.readOnly === true) return null;
  // People to invite or notify in the arguments, the server's own words in the description.
  if (PEOPLE_ARGS.test(fullArgs) || NOTIFY_ARGS.test(fullArgs)) {
    return { category: 'contact', certain: true, summary, args };
  }
  const said = describedCategory(t.description);
  if (said) return { category: said, certain: true, summary, args };
  if (destructive) return destructive;
  // A tool that writes somewhere else without saying how: the instinct looks at it.
  return { category: undefined, certain: false, summary, args };
}

// --- code run by other programs (MCP) -------------------------------------------------------

/*
 * A tool that runs the code it is given (Blender's `execute_blender_code`,
 * D-092): code with the user's rights, as much as the terminal, and as for
 * the terminal the code itself decides, not the server's hints. It goes
 * through the rules of the terminal (a `git push`, a `curl -d`, an `rm -rf ~`
 * or an address with a key inside a string count the same) and through rules
 * of its own: what sends out, deletes files or starts other programs is a
 * card; what writes files or hides what it does (`exec`, `base64`, imports
 * by name) is a candidate for the instinct, told the server's destructive
 * hint; the rest passes, like a plain command (the receipt lists it with the
 * tools of other programs). Not "destructive" on its own: Blender marks every
 * run of code so, and a card on each one would make it unusable (D-070).
 */
const RUN_VERB = /^(execute|exec|run|eval|evaluate|esegui)$/;
const CODE_NOUN =
  /^(code|python|py|script|scripts|snippet|javascript|js|shell|bash|command|commands|codice|comando|comandi)$/;

/** "execute_blender_code", "run_python_script": the first verb runs, and the name says code. */
function runsCode(w: readonly string[]): boolean {
  const lead = w.find(
    (x) => RUN_VERB.test(x) || VERBS.some((v) => v.re.test(x)) || READ.test(x) || DRAFT.test(x),
  );
  return lead !== undefined && RUN_VERB.test(lead) && w.some((x) => CODE_NOUN.test(x));
}

interface CodeRule {
  category: OutboundCategory | undefined;
  certain: boolean;
  re: RegExp;
  /** What the code does, for the card ("del codice che …"). */
  what: string;
  meaning?: string;
}

/*
 * Python and JavaScript. Not `.unlink(obj)` nor `.remove(obj)`: in Blender
 * they take an object out of a collection or a scene (`objects.unlink(o)`,
 * `bpy.data.objects.remove(o)`), and Blender's undo brings it back; a file
 * goes with `os.remove`, `shutil.rmtree` or `Path.unlink()` without an object.
 */
const CODE_RULES: CodeRule[] = [
  {
    category: 'contact',
    certain: true,
    re: /\b(?:requests|httpx|aiohttp|urllib3|session)\.(?:post|put|patch|delete)\s*\(|\b(?:smtplib|ftplib|paramiko|http\.client)\b|\bsocket\.(?:socket|create_connection)\s*\(|\b(?:XMLHttpRequest|sendBeacon|WebSocket)\b/,
    what: 'manda dati fuori dal computer',
  },
  {
    category: 'delete',
    certain: true,
    re: /\b(?:shutil\.rmtree|os\.(?:remove|unlink|rmdir|removedirs)|send2trash)\s*\(|\.(?:unlink|rmdir)\(\s*(?:\)|missing_ok)|\bfs\.(?:rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\s*\(/,
    what: 'cancella file',
  },
  {
    category: 'delete',
    certain: true,
    re: /\bsubprocess\.\w+\s*\(|\bos\.(?:system|popen|exec\w*|spawn\w*|startfile|kill)\s*\(|\bpty\.spawn\b|\bchild_process\b/,
    what: 'avvia altri programmi',
    meaning: 'avviare altri programmi dal codice: possono fare tutto quello che fa il terminale',
  },
  {
    category: undefined,
    certain: false,
    re: /\b(?:exec|eval|compile|__import__)\s*\(|\b(?:importlib|base64|marshal|ctypes|pickle)\b|\bfrom\s+(?:os|shutil|subprocess|socket|urllib|http|requests)\s+import\s+(?!path\b)|\bgetattr\s*\(\s*(?:os|shutil|subprocess|socket)\b/,
    what: 'nasconde cosa fa',
  },
  {
    category: 'delete',
    certain: false,
    re: /\bopen\s*\([^)\n]*,\s*(?:mode\s*=\s*)?['"][rwax]?b?[wax+]b?['"]|\.write_(?:text|bytes)\s*\(|\bshutil\.(?:copy\w*|move)\s*\(|\bos\.(?:rename|replace)\s*\(|\bbpy\.ops\.wm\.save_(?:as_)?mainfile\b|\.save_render\s*\(|\bwrite_still\s*=\s*True\b|\bfs\.(?:writeFile|writeFileSync|appendFile)\b/,
    what: 'scrive file',
  },
];

/** The code of a call: its strings (`code`, `script`, `command`), one after the other. */
function codeOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  return Object.values(input as Record<string, unknown>)
    .flatMap((v) => stringsOf(v))
    .join('\n');
}

function codeCall(
  t: MonstersTool,
  server: string,
  tool: string,
  input: unknown,
  options: ClassifyOptions,
): OutboundCall | null {
  const args = argsText(input);
  const code = codeOf(input);
  const hits: OutboundCall[] = [];
  const shell = shellCall(code, options);
  if (shell) hits.push({ ...shell, args });
  const rules =
    code.length <= MAX_CLASSIFIED_CHARS ? CODE_RULES.filter((r) => r.re.test(code)) : [];
  for (const r of rules) {
    hits.push({ category: r.category, certain: r.certain, summary: r.what, args });
  }
  const best = mostSevere(hits);
  if (!best) return null;
  const rule = rules.find((r) => r.what === best.summary);
  const summary = `eseguire con «${tool}» di ${server} del codice${rule ? ` che ${rule.what}` : ''}`;
  if (best.markOnly) return { ...best, summary };
  if (best.certain) {
    return {
      category: best.category,
      certain: true,
      summary,
      args,
      ...(rule?.meaning ? { meaning: rule.meaning } : {}),
    };
  }
  return {
    category: best.category,
    certain: false,
    summary,
    args,
    markAlways: true,
    // The server's word goes to the instinct, which weighs it with the code.
    ...(t.destructive === true && t.readOnly !== true
      ? { hint: `${server} segna questo strumento come distruttivo (destructiveHint).` }
      : {}),
  };
}

/**
 * A tool that writes a file at a path of its arguments (a render of Blender,
 * from the gallery's hints, D-092): like a file write of the monsters, it
 * passes inside the folders the agent may change (`writeInside`, checked by
 * the guard on the real path) and is a card anywhere else.
 */
function fileWriteCall(
  arg: string,
  server: string,
  tool: string,
  input: unknown,
  options: ClassifyOptions,
): OutboundCall | null {
  if (options.writeInside === true) return null;
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>)[arg] : '';
  const path = typeof raw === 'string' && raw ? clipText(raw, 160) : 'un file';
  return {
    category: 'delete',
    certain: true,
    summary: `scrivere con «${tool}» di ${server} il file ${path}`,
    args: argsText(input),
    meaning:
      'scrivere un file fuori dalle cartelle che gli hai dato (può sostituirne uno che c’è già)',
  };
}

// --- web pages ----------------------------------------------------------------------------

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
/** An e-mail address in a text, looked for only around each `@` (linear in the text). */
function hasEmail(text: string): boolean {
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (EMAIL.test(text.slice(Math.max(0, at - 64), at + 256))) return true;
  }
  return false;
}
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/;
/** A long run of letters and digits in a query: encoded data rather than a search. */
const BLOB = /[A-Za-z0-9+/=_-]{48,}/;

function decoded(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text.replace(/\+/g, ' ');
  }
}

/** Notes or the profile in a payload, after a third-party text was read (D-070). */
function leakCall(
  payload: string,
  host: string | null,
  verb: string,
  shown: string,
  taint: RunTaint | undefined,
  /** Where it goes, when it is not a host nor a search engine ("mandare a notion"). */
  toWords?: string,
): OutboundCall | null {
  const leak = taint?.leak(payload, host);
  if (!leak) return null;
  // "Rhea vuole mandare a evil.example un pezzo di una tua nota privata (…)".
  const to =
    toWords ?? `mandare ${host ? `a ${host.replace(/^www\./, '')}` : 'a un motore di ricerca'}`;
  const how = `${verb}: ${shown}`;
  if (leak.kind === 'private') {
    return {
      category: 'contact',
      certain: true,
      summary: `${to} un pezzo di una tua nota privata (${how})`,
      args: shown,
    };
  }
  if (leak.chars >= NOTE_LEAK_CHARS) {
    return {
      category: 'contact',
      certain: true,
      summary: `${to} pezzi delle tue note (${how})`,
      args: shown,
    };
  }
  return {
    category: 'contact',
    certain: true,
    summary: `${to} qualche parola delle tue note (${how})`,
    args: shown,
    markOnly: 'sito mai visto in questo lavoro',
  };
}

function urlCall(raw: string, verb: string, options: ClassifyOptions = {}): OutboundCall | null {
  const { containsSecret, taint } = options;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const query = decoded(`${url.pathname}${url.search}`);
  const shown = clipText(raw, 160);
  if (containsSecret?.(raw) || hasEmail(query) || IBAN.test(query)) {
    return {
      category: 'contact',
      certain: true,
      summary: `${verb} un indirizzo che contiene dati privati (${shown})`,
      args: shown,
    };
  }
  // A link the run has seen (a search result, a link in a page) carries nothing of ours.
  if (taint?.knownUrl(raw)) return null;
  const leaked = leakCall(query, url.hostname, verb, shown, taint);
  if (leaked) return leaked;
  // Data towards a site of the user's own words that gave no third-party text: theirs.
  if (taint?.tainted && taint.knownHost(url.hostname)) return null;
  if (url.search.length > 200 || BLOB.test(url.search)) {
    return {
      category: 'contact',
      certain: false,
      summary: `${verb} un indirizzo con molti dati (${shown})`,
      args: shown,
      // Jev reads encoded data literally (eval:instinct, o11 at 0.02): always on the receipt.
      markAlways: true,
    };
  }
  return null;
}

/**
 * How severe a result is: a certain rule (a card, or the user's own rule)
 * over a candidate (the instinct may still make it a card) over a mark only
 * (never a card). A candidate that wins over a mark keeps it on the receipt.
 */
function severity(c: OutboundCall): number {
  if (c.markOnly) return 1;
  return c.certain ? 3 : 2;
}

/** The most severe of the exits of one call (`urls`, `queries`, addresses in a command). */
function mostSevere(found: readonly (OutboundCall | null)[]): OutboundCall | null {
  let best: OutboundCall | null = null;
  let marked = false;
  for (const f of found) {
    if (!f) continue;
    if (f.markOnly) marked = true;
    if (!best || severity(f) > severity(best)) best = f;
  }
  if (best && marked && !best.certain && !best.markOnly) return { ...best, markAlways: true };
  return best;
}

/** The strings of some fields that may each be a string or a list of them. */
function stringsOf(...values: unknown[]): string[] {
  return values.flatMap((v) =>
    typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [],
  );
}

function searchCall(query: string, options: ClassifyOptions): OutboundCall | null {
  const shown = clipText(query, 160);
  if (options.containsSecret?.(query)) {
    return {
      category: 'contact',
      certain: true,
      summary: `cercare sul web un testo che contiene una delle tue chiavi (${shown})`,
      args: shown,
    };
  }
  // A search engine is always a known site: only a private note stops a search.
  return leakCall(query, null, 'cercare sul web', shown, options.taint);
}

/**
 * What an action of a tool does towards the outside, or null for one that
 * stays on the computer (or only reads).
 */
export function classifyOutbound(
  t: MonstersTool,
  input: unknown,
  options: ClassifyOptions = {},
): OutboundCall | null {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (t.name === 'shell' && typeof i['command'] === 'string')
    return shellCall(i['command'], options);
  // Since D-071 a page may come in `url` or `urls` and a search in `query` or
  // `queries` (a string or a list): every one is checked and the most severe
  // wins (D-074: a mark on the first one hid a key in the second).
  if (t.name === 'web_fetch') {
    return mostSevere(stringsOf(i['url'], i['urls']).map((url) => urlCall(url, 'aprire', options)));
  }
  if (t.name === 'web_search') {
    return mostSevere(stringsOf(i['query'], i['queries']).map((q) => searchCall(q, options)));
  }
  if (t.name === ARTIFACT_TOOL && typeof i['html'] === 'string') return artifactCall(i, options);
  const mcp = splitAgentToolName(t.name);
  if (mcp) return mcpCall(t, mcp.server, mcp.tool, input, options);
  return null;
}

// --- pages of the monsters ------------------------------------------------------------------

/** `artifact_create` (files/tools.ts; named here to keep the instinct free of the files store). */
const ARTIFACT_TOOL = 'artifact_create';
/**
 * A host no run ever knows: the page of a tainted run is checked as data
 * going to a site never seen (its scripts could talk to anyone).
 */
const PAGE_HOST = 'pagina.monsters.invalid';

/**
 * An HTML page a monster saves (review of 16/10): with scripts a page could
 * send out what it holds (WebRTC gets past the CSP in Chromium). A page made
 * after third-party text was read is served without scripts (D-085), so only
 * a private note or a key in it is a card; pieces of notes or of the profile
 * are a mark on the receipt. Before any third-party text, nothing.
 */
function artifactCall(
  input: Record<string, unknown>,
  options: ClassifyOptions,
): OutboundCall | null {
  const { containsSecret, taint } = options;
  if (!taint?.tainted && !taint?.guarded) return null;
  const html = String(input['html']);
  const name = typeof input['name'] === 'string' ? clipText(input['name'], 80) : 'pagina';
  const args = clipText(`${name}: ${html}`, 300);
  const after = 'dopo aver letto contenuti esterni';
  if (containsSecret?.(html)) {
    return {
      category: 'contact',
      certain: true,
      summary: `creare una pagina («${name}») che contiene una delle tue chiavi, ${after}`,
      args,
    };
  }
  const leak = taint.leak(html, PAGE_HOST);
  if (!leak) return null;
  if (leak.kind === 'private') {
    return {
      category: 'contact',
      certain: true,
      summary: `mettere un pezzo di una tua nota privata in una pagina («${name}»), ${after}`,
      args,
    };
  }
  return {
    category: 'contact',
    certain: true,
    summary: `mettere ${leak.chars >= NOTE_LEAK_CHARS ? 'pezzi delle tue note' : 'qualche parola delle tue note'} in una pagina («${name}»)`,
    args,
    markOnly: `pagina creata ${after}: si apre senza script`,
  };
}
