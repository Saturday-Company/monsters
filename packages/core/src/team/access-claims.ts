import type { LogEvent } from '@monsters/shared';
import type { FinalAnswerHook } from '../agents/run-agent.ts';
import type { EventLog } from '../log/event-log.ts';
import { accessPrompts } from './access.prompts.ts';
import { accessStrings } from './access.strings.ts';
import { unicodeWords } from './word-boundary.ts';

/*
 * What a monster says about its accesses, against the facts (D-140, D-141; audit of 19/10,
 * the capability audit of 19/10, D3 and D4). On 19/10 the monsters of a user project
 * wrote "il web mi è stato negato in questa sessione", "Canva non è collegato", "la ricerca
 * web è negata in modalità «don't ask»" with the web permission on and Canva connected, and
 * saved it in their memory. Rules, not a model:
 * - `findAccessClaims`: the sentences of a text that say an access is denied, blocked, off,
 *   not connected or missing, or that the user refused;
 * - `judgeAccessClaims`: each claim against the state of now (permissions, the project's
 *   connections, the run's tools) and the facts of the run (a no of the user, the causes the
 *   tools wrote): the claims the facts do not back;
 * - `isAccessClaim`: a line about accesses, never saved as memory nor kept in a summary.
 */

/** The state of one access for a monster now. */
export interface AccessFact {
  /** The run has it. */
  has: boolean;
  /**
   * Truly off by a setting of the user, or not connected to the account: a claim that it is
   * denied, off or not connected is true. False: it is missing for another reason (not one of
   * this run's tools, connected but not given to the project), and saying "negato" is wrong.
   */
  off?: boolean;
  /** Why it is missing (or what the run has), in Italian, with where it is turned on. */
  why?: string;
  /** Missing because the monster's project does not give it: "non è collegato al progetto" is true. */
  project?: boolean;
}

export interface ServiceFact extends AccessFact {
  /** As the app shows it: "Canva", "Notion". */
  name: string;
  /** Other names of the same service in a text ("Google Drive", "Drive"). */
  aliases?: readonly string[];
}

/** The accesses of a monster now (computed by the hub from the settings and the run's tools). */
export interface AccessState {
  web: AccessFact;
  terminal: AccessFact;
  browser?: AccessFact;
  services: readonly ServiceFact[];
  /** The other monsters, by name, with their web; `squad`: of its own squad. */
  members: readonly { name: string; web: AccessFact; squad?: boolean }[];
  /** How the user is called ("Giulio"): "Giulio ha rifiutato" is a refusal of the user. */
  userNames?: readonly string[];
}

/** What the log of the run says. */
export interface RunAccessFacts {
  /** The no's of the user: brake cards, questions, access requests (in Italian). */
  userNo: readonly string[];
  /** What the failed tools of this monster answered (their causes, D-127). */
  toolCauses: readonly string[];
}

export interface AccessClaim {
  sentence: string;
  /** It says the user refused or denied something. */
  user: boolean;
  /** It names a cause (denied, blocked, off, not connected, no permission), not only a lack. */
  cause: boolean;
  /** "modalità don't ask", "questa sessione": a cause that never exists. */
  session: boolean;
  /** "nessun mostro può…": about the whole squad. */
  squad: boolean;
  web: boolean;
  terminal: boolean;
  browser: boolean;
  /** Names of the services it mentions (as in `ServiceFact.name`). */
  services: string[];
  /** Another monster of the squad it is about. */
  member?: string;
  /** It speaks of the project ("non è collegato a questo progetto"). */
  project?: boolean;
}

export interface UnbackedClaim {
  claim: AccessClaim;
  /** What is true instead, in Italian (lines of the reminder). */
  truth: string[];
}

// The words of a refusal of the user, in both families (data, not copy).
const USER_REFUSAL_SRC = String.raw`(?:mi |me lo |me l'|l'|lo |la )?hai (?:detto|risposto) (?:di )?no\b|\bhai (?:rifiutato|negato|bocciato|bloccato|vietato|tolto)|\bnon (?:mi |ci |gli |le )?hai (?:dato|concesso|autorizzato|permesso|abilitato)|\b(?:rifiutat|negat|vietat|bloccat)\w* (?:dall'utente|da te)\b|\bl'utente (?:ha|aveva) (?:rifiutato|negato|vietato|bloccato|detto (?:di )?no|risposto (?:di )?no)|\bthe user (?:has |had )?(?:refused|denied|declined|blocked|forbade|rejected|revoked|said no|answered no)\b|\byou (?:have |had |already )?(?:refused|denied|declined|blocked|forbade|rejected|revoked|said no|answered no|told me no)\b|\b(?:you|the user) (?:did not|didn't|have not|haven't|has not|hasn't|never) (?:give|given|grant|granted|allow|allowed|authorize|authorized|permit|permitted|enable|enabled)\b|\b(?:refused|denied|declined|blocked|rejected|forbidden|revoked) by (?:the user|you)\b`; // i18n-ignore

/** A cause: denied, blocked, off, not connected, no permission. */
const CAUSE = unicodeWords(
  /\b(?:negat[oaie]|rifiutat[oaie]|bloccat[oaie]|vietat[oaie]|disattivat[oaie]|disabilitat[oaie]|spent[oaie]|revocat[oaie]|scollegat[oaie]|non (?:ho|hai|ha|abbiamo|hanno|avete|avevo|aveva|avevano) (?:avuto )?(?:il |i |un |alcun |nessun )?permess\w*|senza (?:il |i |alcun )?permess\w*|non (?:mi |gli |le |ci |ti )?(?:è|e'|era|sono|erano) (?:stat[oaie] )?(?:permess|consentit|concess|autorizzat)\w*|non (?:è|e'|sono|era|erano|risulta|risultano) (?:più |ancora )?(?:collegat|connes|attiv|abilitat|concess)\w*|not (?:connected|allowed|permitted|enabled|granted)|denied|blocked|refused|disabled|rejected|forbidden|prohibited|restricted|unauthori[sz]ed|revoked|disconnected|unlinked|unavailable|(?:turned|switched) off|(?:isn't|aren't|wasn't|weren't|is not|are not|was not|were not|has not been|hasn't been|have not been|haven't been|not yet) (?:\w+ )?(?:connected|allowed|permitted|enabled|granted|given|linked|available|turned on|switched on|active|authori[sz]ed)|(?:don't|do not|doesn't|does not|didn't|did not|haven't|have not|hasn't|has not) (?:have|had|got) (?:the |any |a |an )?permission\w*|(?:no|without|lack(?:s|ed|ing)?) (?:the |any )?permission\w*|permission\w* (?:is |was |has been |were |are )?(?:off|denied|missing|revoked))\b/iu, // i18n-ignore
);

/** A lack, without a cause: "non ho accesso al web", "non riesco a cercare online". */
const PLAIN = unicodeWords(
  /\b(?:non (?:ho|hai|ha|abbiamo|hanno|avevo|aveva|avevamo|avevano) (?:più |ancora |avuto |mai )?(?:(?:il|lo|la|l'|un|uno|una|gli|i|alcun|alcuno|nessun|nessuno) ?)?(?:accesso|accessi|strument\w*|web|internet|terminale|browser|collegament\w*)|non (?:posso|puoi|può|possiamo|possono|riesco|riesce|riusciamo|riescono|sono riuscit\w*|è riuscit\w*|ho potuto|ha potuto|abbiamo potuto)(?: a| ad)? (?:accedere|cercare|navigare|usare|utilizzare|collegarmi|collegarsi|raggiungere|aprire|vedere|leggere|entrare)|non vedo|non (?:è|e'|sono) (?:tra i miei|tra i suoi|tra gli|fra i miei|fra gli) strumenti|non (?:è|e'|sono) disponibil\w*|nessun\w*(?: \w+){0,3} (?:può|possono|riesce|riescono)(?: a| ad)? (?:accedere|cercare|navigare|usare)|nessun\w*(?: \w+){0,3} (?:ha|hanno) (?:il |l')?(?:web|accesso)|(?:can(?:no|')t|cannot|can not|couldn't|could not|(?:am|are|is|was|were) (?:un|not )able to|wasn't able to|isn't able to|unable to) (?:access|search|browse|use|reach|connect|open|see|read|enter|fetch|get)|no access|no (?:web|internet|terminal|browser|network|online) access|(?:don't|do not|doesn't|does not|didn't|did not|haven't|have not|hasn't|has not|no longer have|no longer has) (?:have |had |get |got )?(?:any |the |an? )?(?:access|accessible|tools?|web|internet|terminal|browser|connections?|connectors?)|(?:have|has|had|got) no (?:access|tools?|web|internet|terminal|browser|connections?)|(?:isn't|aren't|is not|are not) (?:available|among my tools|in my tools|one of my tools)|(?:nobody|no ?one|none|no \w+)(?: \w+){0,3} (?:can|could|is able to|are able to)(?: to)? (?:access|search|browse|use))\b/iu, // i18n-ignore
);

/** "Non è un no dell'utente", "non l'hai negato tu": the opposite of a claim, taken out first. */
const NEGATED = unicodeWords(
  /\bnon (?:(?:mi|ti|gli|le|ci|vi|l'|lo|la)\s*)?(?:è|e'|sono|era|erano|hai|ha|ho|abbiamo|hanno)\s+(?:stat[oaie]\s+)?(?:mai\s+)?(?:negat|rifiutat|bloccat|vietat)\w*(?:\s+tu)?|\bnessun\w* (?:mi |ti |ci |gli |l')?ha (?:negat|rifiutat|bloccat|vietat)\w*|\bnon (?:è|e'|si tratta di|era) (?:un |il |una )?(?:rifiuto|divieto|blocco|no|permesso|limite)\b(?: (?:dell'utente|tuo|dei permessi))?|\bnot (?:a |the )?(?:refusal|denial|block|ban|veto|limit)\b|\b(?:wasn't|isn't|was not|is not|weren't|were not|hasn't been|has not been|never been|not been|never) (?:denied|refused|blocked|forbidden|a no)\b|\b(?:nobody|no ?one|the user didn't|the user did not|the user has not|the user hasn't|you didn't|you did not|you never) (?:has |have )?(?:denied|refused|blocked|forbidden|said no)\b/giu, // i18n-ignore
);

/** "modalità don't ask", "i permessi di questa sessione": a cause that does not exist in Monsters. */
const SESSION = unicodeWords(
  /\b(?:don'?t ?ask|dontask|non chiedere|questa sessione|della sessione|sessione corrente|this session|current session|(?:of|for|in) the session|session (?:permissions?|mode))\b/iu, // i18n-ignore
);

/** "nessun mostro può accedere al web", "nessuno della squadra". */
const SQUAD = unicodeWords(
  /\b(?:nessun(?:o|a)? (?:mostr\w*|di noi|dei mostri|della squadra|nella squadra|del team|nel team)|nessun mostro|tutti i mostri|i mostri non|no monsters?|no ?one (?:in|on|of) (?:the |our )?(?:squad|team|monsters)|nobody (?:in|on|of) (?:the |our )?(?:squad|team|monsters)|none of (?:us|the monsters)|(?:all|every) (?:the )?monsters?|the monsters (?:don't|do not|can't|cannot|have no)|the (?:whole |entire )?(?:squad|team) (?:doesn't|does not|has no|can't|cannot))\b/iu, // i18n-ignore
);

const WEB = unicodeWords(
  /\b(?:web|internet|online|on-line|ricerc\w*\b(?!\s+(?:nelle|nel|tra|fra|in|delle|della|dei) (?:note|vault|memoria|strumenti|cartell\w*|file))|websearch|webfetch|web_search|web_fetch|navigare|navigazione|web ?pages?|search(?:es|ing)?\b(?!\s+(?:in|within|through|across|among|the|my|your) (?:the |my |your )?(?:notes|vault|memory|tools|folders?|files?))|browsing|browse|navigat\w*)\b/iu, // i18n-ignore
);
const TERMINAL = unicodeWords(
  /\b(?:terminale|shell|bash|riga di comando|terminal|command[- ]line)\b/iu,
); // i18n-ignore
const BROWSER = unicodeWords(/\bbrowser\b/iu);

/** A third party refused (a site, a login wall): not an access of Monsters. */
const THIRD_PARTY = unicodeWords(
  /\b(?:(?:il|del|dal|al|un|dai|i|quel|questo) sit[oi]|40[13]|cloudflare|captcha|paywall|anti-?bot|robots\.txt|chiede il login|richiede (?:il )?login|(?:the|this|that|a|some|those|these) (?:web)?sites?|(?:asks? for|requires?|needs?) (?:a |the )?(?:log-?in|sign-?in)|login wall)\b/iu, // i18n-ignore
);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cache = new Map<string, RegExp>();
function namesRegex(names: readonly string[]): RegExp | null {
  const clean = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))];
  if (clean.length === 0) return null;
  // Longest first: "Google Drive" before "Google".
  clean.sort((a, b) => b.length - a.length);
  const key = clean.join('\u0000');
  let re = cache.get(key);
  if (!re) {
    re = unicodeWords(new RegExp(`\\b(?:${clean.map(escape).join('|')})\\b`, 'giu'));
    if (cache.size > 200) cache.clear();
    cache.set(key, re);
  }
  re.lastIndex = 0;
  return re;
}

/** Plain sentences of a text: no Markdown decoration, one per line or per final mark. */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/[’`´]/g, "'").split('\n')) {
    const line = raw
      .replace(/^\s*(?:[-*+>]|\d+[.)])\s+/, '')
      .replace(/\*\*|__|[*_~#]/g, '')
      .replace(/[«»"“”]/g, '')
      .trim();
    if (!line) continue;
    for (const s of line.match(/[^.!?;]+[.!?;]*/gu) ?? [line]) {
      const t = s.trim();
      if (/[\p{L}]/u.test(t)) out.push(t);
    }
  }
  return out;
}

export interface ClaimContext {
  /** Names of the services the text may mention (connected or not). */
  services?: readonly { name: string; aliases?: readonly string[] }[];
  /** The other monsters of the squad. */
  members?: readonly string[];
  userNames?: readonly string[];
}

function userRefusal(userNames: readonly string[]): RegExp {
  const names = userNames.map((n) => n.trim()).filter((n) => n.length >= 2);
  const named = names.length
    ? `|\\b(?:${names.map(escape).join('|')}) (?:ha|aveva) (?:rifiutato|negato|vietato|bloccato|detto (?:di )?no|risposto (?:di )?no)|\\b(?:rifiutat|negat|vietat)\\w* da (?:${names.map(escape).join('|')})\\b|\\b(?:${names.map(escape).join('|')}) (?:has |had )?(?:refused|denied|declined|blocked|forbade|rejected|revoked|said no|answered no)\\b|\\b(?:refused|denied|declined|blocked|rejected|forbidden|revoked) by (?:${names.map(escape).join('|')})\\b`
    : '';
  const key = `user\u0000${names.join('\u0000')}`;
  let re = cache.get(key);
  if (!re) {
    re = unicodeWords(new RegExp(`(?:${USER_REFUSAL_SRC}${named})`, 'iu'));
    cache.set(key, re);
  }
  return re;
}

const PROJECT = unicodeWords(/\bprogett\w*/iu);

/** A lack of somebody else ("non ha il permesso", "non riesce a cercare"). */
const THIRD_PERSON = unicodeWords(
  /\b(?:non (?:gli |le )?(?:ha|hanno|aveva|avevano|può|possono|poteva|potevano|riesce|riescono|è riuscit\w*|ha potuto|hanno potuto|ha avuto|hanno avuto)|doesn't|does not|hasn't|has not|has no|had no)\b/iu, // i18n-ignore
);

/** Where a clause ends inside a sentence. */
const CLAUSE_BREAK = unicodeWords(
  /[,:()[\]]|\s[-–—]\s|\b(?:quindi|perché|perciò|però|mentre|così|ma|so|because|but|while|whereas|although|though)\b/iu, // i18n-ignore
);

interface Subjects {
  any: boolean;
  squad: boolean;
  web: boolean;
  terminal: boolean;
  browser: boolean;
  services: string[];
  member?: string;
}

function subjectsOf(
  clause: string,
  sre: RegExp | null,
  mre: RegExp | null,
  byAlias: ReadonlyMap<string, string>,
  members: readonly string[],
): Subjects {
  const services = new Set<string>();
  if (sre) {
    sre.lastIndex = 0;
    for (const m of clause.matchAll(sre)) services.add(byAlias.get(m[0].toLowerCase()) ?? m[0]);
  }
  let member: string | undefined;
  if (mre) {
    mre.lastIndex = 0;
    const m = mre.exec(clause)?.[0];
    if (m) member = members.find((n) => n.toLowerCase() === m.toLowerCase());
  }
  const out: Subjects = {
    any: false,
    squad: SQUAD.test(clause),
    web: WEB.test(clause),
    terminal: TERMINAL.test(clause),
    browser: BROWSER.test(clause),
    services: [...services],
    ...(member ? { member } : {}),
  };
  out.any = out.web || out.terminal || out.browser || out.services.length > 0 || out.squad;
  return out;
}

/**
 * The sentences of a text that say something about an access: denied, blocked, off, not
 * connected, missing, or refused by the user. Questions, conditionals and third parties
 * (a site that blocks robots) are not claims.
 */
export function findAccessClaims(text: string, ctx: ClaimContext = {}): AccessClaim[] {
  const out: AccessClaim[] = [];
  const user = userRefusal(ctx.userNames ?? []);
  const serviceNames = (ctx.services ?? []).flatMap((s) => [s.name, ...(s.aliases ?? [])]);
  const byAlias = new Map<string, string>();
  for (const s of ctx.services ?? []) {
    for (const n of [s.name, ...(s.aliases ?? [])]) byAlias.set(n.toLowerCase(), s.name);
  }
  const sre = () => namesRegex(serviceNames);
  const mre = () => namesRegex(ctx.members ?? []);
  for (const sentence of sentencesOf(text)) {
    if (sentence.endsWith('?') || /^(?:se|if)\s/iu.test(sentence)) continue;
    const s = sentence.replace(NEGATED, ' ');
    const isUser = user.test(s);
    if (!isUser && !CAUSE.test(s) && !PLAIN.test(s)) continue;
    const session = SESSION.test(s);
    if (!isUser && !session && THIRD_PARTY.test(s)) continue;
    // Clause by clause: the subject of "non è collegato" is the one of its clause ("il
    // dominio non è collegato, nei post su Anteiku…" is not about Anteiku), or of the clause
    // before when it has none ("Ho provato 4 ricerche, e sono state tutte rifiutate").
    const claim: AccessClaim = {
      sentence,
      user: isUser,
      cause: false,
      session: false,
      squad: false,
      web: false,
      terminal: false,
      browser: false,
      services: [],
    };
    const services = new Set<string>();
    let before: Subjects | null = null;
    let claimed = isUser;
    for (const clause of s.split(CLAUSE_BREAK)) {
      if (!clause?.trim()) continue;
      const own = subjectsOf(clause, sre(), mre(), byAlias, ctx.members ?? []);
      const cause = CAUSE.test(clause);
      const plain = PLAIN.test(clause);
      const said = cause || plain || user.test(clause);
      if (said) {
        const subj = own.any ? own : (before ?? own);
        const member = own.member ?? subj.member;
        claimed = true;
        // "Non ha il web" of somebody it does not name: not about this monster.
        if (THIRD_PERSON.test(clause) && !member && !subj.squad) {
          if (own.any) before = own;
          continue;
        }
        claim.cause ||= cause;
        claim.squad ||= subj.squad;
        claim.web ||= subj.web;
        claim.terminal ||= subj.terminal;
        claim.browser ||= subj.browser;
        for (const n of subj.services) services.add(n);
        if (member && !claim.member) claim.member = member;
      }
      if (own.any) before = own;
    }
    if (!claimed) continue;
    claim.session = session;
    claim.services = [...services];
    if (PROJECT.test(s)) claim.project = true;
    const about =
      claim.web || claim.terminal || claim.browser || claim.services.length > 0 || claim.session;
    if (claim.user || about) out.push(claim);
  }
  return out;
}

/**
 * A line about accesses (permissions, connections, tools, the session): it is never saved
 * as memory nor kept in a summary, since the state of now says it at every run (D-141).
 * Wider than a claim: the subject may be any service, and a rule about accesses counts too
 * ("prima di un incarico conviene verificare che sia concessa").
 */
export function isAccessClaim(line: string, ctx: ClaimContext = {}): boolean {
  if (findAccessClaims(line, ctx).length > 0) return true;
  const s = line.replace(/[’`´]/g, "'").replace(NEGATED, ' ');
  if (!(CAUSE.test(s) || PLAIN.test(s) || SESSION.test(s))) return false;
  return ACCESS_WORDS.test(s);
}

/** What a line about accesses talks about, whatever the service. */
const ACCESS_WORDS = unicodeWords(
  /\b(?:permess\w*|accesso|accessi|collegament\w*|collegat\w*|strument\w*|connettor\w*|servizi|integrazion\w*|don'?t ?ask|sessione|web|internet|terminale|browser|tool|tools|permission\w*|access|connect\w*|link\w*|integration\w*|terminal|session|service|services)\b/iu, // i18n-ignore
);

/** The text without the lines about accesses (a summary, D-141); the lines taken out. */
export function withoutAccessClaims(
  text: string,
  ctx: ClaimContext = {},
): { text: string; dropped: string[] } {
  const dropped: string[] = [];
  const kept = text.split('\n').filter((line) => {
    if (!line.trim() || /^\s*#/.test(line)) return true;
    // "L'utente ha deciso di non collegare Canva": a decision of the user stays.
    if (
      /\b(?:l'utente (?:ha deciso|ha chiesto|vuole|preferisce)|the user (?:has )?(?:decided|asked|wants|prefers|chose|has chosen))\b/iu.test(
        // i18n-ignore
        line.replace(/[’`´]/g, "'"),
      )
    )
      return true;
    if (!isAccessClaim(line, ctx)) return true;
    dropped.push(line.trim());
    return false;
  });
  return { text: kept.join('\n'), dropped };
}

/** Facts of one subject of a claim, or null when the state does not know it. */
function judge(fact: AccessFact | undefined, claim: AccessClaim): boolean | null {
  if (!fact) return null;
  if (fact.has) return false;
  if (claim.cause && !fact.off && !(claim.project && fact.project)) return false;
  return true;
}

const label = (fact: AccessFact, what: string, has: string) =>
  fact.has ? `${what}: ${has}` : `${what}: ${fact.why ?? accessPrompts().defaultWhy}`;

/**
 * The claims of a text the facts do not back, each with what is true instead. A refusal of
 * the user needs a no of the user in the log (or a setting the user turned off); "negato",
 * "spento", "non collegato" need the access truly off; "non ho il web" needs the run without
 * it; "modalità don't ask" and "questa sessione" are never a cause.
 */
export function judgeAccessClaims(
  claims: readonly AccessClaim[],
  state: AccessState,
  facts: RunAccessFacts,
): UnbackedClaim[] {
  const out: UnbackedClaim[] = [];
  const t = accessPrompts();
  const service = (name: string) => state.services.find((s) => s.name === name);
  for (const claim of claims) {
    const subjects: { what: string; fact: AccessFact | undefined; has: string }[] = [];
    if (claim.member && claim.web) {
      const m = state.members.find((x) => x.name === claim.member);
      subjects.push({
        what: t.webOf(claim.member),
        fact: m?.web,
        has: t.hasIt(claim.member),
      });
    } else if (!claim.member) {
      if (claim.web) subjects.push({ what: t.whatWeb, fact: state.web, has: t.youHaveIt });
      if (claim.terminal) {
        subjects.push({ what: t.whatTerminal, fact: state.terminal, has: t.youHaveThem });
      }
      if (claim.browser && state.browser) {
        subjects.push({ what: t.whatBrowser, fact: state.browser, has: t.youHaveIt });
      }
    }
    // The services of another monster are not known here.
    for (const name of claim.member ? [] : claim.services) {
      subjects.push({ what: name, fact: service(name), has: t.youHaveIt });
    }
    const truth: string[] = [];
    if (claim.user) {
      if (facts.userNo.length > 0) continue;
      if (subjects.some((x) => x.fact && !x.fact.has && x.fact.off)) continue;
      truth.push(t.noUserNo);
      for (const x of subjects) if (x.fact) truth.push(label(x.fact, x.what, x.has));
      out.push({ claim, truth });
      continue;
    }
    if (claim.session) {
      truth.push(t.noSession);
      for (const x of subjects) if (x.fact) truth.push(label(x.fact, x.what, x.has));
      out.push({ claim, truth });
      continue;
    }
    if (claim.squad && claim.web) {
      const who = [
        ...(state.web.has ? [t.squadYou] : []),
        ...state.members.filter((m) => m.squad !== false && m.web.has).map((m) => m.name),
      ];
      if (who.length > 0) {
        truth.push(t.squadWeb(who));
        out.push({ claim, truth });
      }
      continue;
    }
    let unbacked = false;
    for (const x of subjects) {
      const ok = judge(x.fact, claim);
      if (ok === false) {
        unbacked = true;
        truth.push(label(x.fact!, x.what, x.has));
      }
    }
    if (unbacked) out.push({ claim, truth });
  }
  return out;
}

// The words of a no, in both families (data, not copy).
const NO_OPTION =
  /^\s*(?:no\b|non\b|annulla|rifiuta|nega|don[’']t\b|do not\b|cancel|refuse|deny|decline|never mind)/iu; // i18n-ignore
/** "No", "no, aspetta", "Risposta alla tua domanda «…»: No", "No, wait", "Answer to your question: No". */
const NO_WORDS =
  /(?:^|[:\n]\s*)no\b|\bnon (?:farlo|mandarl\w*|inviarl\w*|pubblicarl\w*|procedere)\b|\b(?:don[’']t|do not|dont) (?:do it|send|publish|post|proceed|go ahead)\b/iu; // i18n-ignore

/** The causes and the no's of the user in the log of a run (and recent answers to the monster). */
export function runAccessFacts(
  log: Pick<EventLog, 'query'>,
  params: { runId: string; agentId: string; now?: number },
): RunAccessFacts {
  const since = (params.now ?? Date.now()) - 24 * 3_600_000;
  const inRun = log.query({
    runId: params.runId,
    type: ['instinct', 'question', 'answer', 'access_grant', 'tool_result', 'message'],
    limit: 1000,
  });
  const userNo: string[] = [];
  const questions = new Map<string, LogEvent<'question'>>();
  const remember = (e: LogEvent) => {
    if (e.type === 'question') questions.set(e.data.questionId, e);
  };
  inRun.forEach(remember);
  // Questions of this monster answered later, in another run (a parked card, an access request).
  for (const e of log.query({ agent: params.agentId, type: 'question', since, limit: 200 })) {
    remember(e);
  }
  const answers = [
    ...inRun.filter((e): e is LogEvent<'answer'> => e.type === 'answer'),
    ...log
      .query({ type: 'answer', since, limit: 500 })
      .filter(
        (e): e is LogEvent<'answer'> => e.type === 'answer' && questions.has(e.data.questionId),
      ),
  ];
  const seen = new Set<string>();
  for (const a of answers) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    const q = questions.get(a.data.questionId);
    const option = q?.data.options.find((o) => o.id === a.data.optionId);
    const no = option ? NO_OPTION.test(option.label) : NO_WORDS.test(a.data.text ?? '');
    if (no) userNo.push(accessPrompts().userNoQuestion(q?.data.question.slice(0, 120)));
  }
  for (const e of inRun) {
    if (
      e.type === 'instinct' &&
      e.data.action === 'outbound_refused' &&
      e.data.details?.['outcome'] === 'refused'
    ) {
      userNo.push(e.data.message);
    } else if (e.type === 'message' && e.data.role === 'user' && NO_WORDS.test(e.data.text)) {
      userNo.push(e.data.text.slice(0, 120));
    }
  }
  for (const e of log.query({ type: 'access_grant', since, limit: 200 })) {
    if (e.type === 'access_grant' && e.data.from === params.agentId && e.data.outcome === 'denied')
      userNo.push(accessPrompts().userNoAccess(e.data.summary));
  }
  const causes = new Set<string>();
  for (const e of inRun) {
    if (e.type !== 'tool_result' || e.agent !== params.agentId || e.data.ok) continue;
    const error = e.data.error?.trim();
    if (!error) continue;
    if (e.data.refusal || ACCESS_WORDS.test(error) || CAUSE.test(error)) {
      causes.add(error.length > 220 ? `${error.slice(0, 219)}…` : error);
    }
  }
  return { userNo, toolCauses: [...causes].slice(0, 3) };
}

const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The reminder of the end of the turn: the claims, what is true, the causes of the tools. */
export function accessReminder(unbacked: readonly UnbackedClaim[], facts: RunAccessFacts): string {
  const p = accessPrompts();
  const said = [...new Set(unbacked.map((u) => p.quote(clip(u.claim.sentence))))].slice(0, 4);
  const truth = [...new Set(unbacked.flatMap((u) => u.truth))];
  const lines = [p.reminderHead(said.join(' ')), p.reminderTruth, ...truth.map((t) => `- ${t}`)];
  if (facts.toolCauses.length > 0) {
    lines.push(p.reminderTools, ...facts.toolCauses.map((c) => `- ${c}`));
  }
  lines.push(p.reminderTail);
  return lines.join('\n');
}

/** The note after the answer of a harness without a stop hook (Codex): the core corrects it. */
export function accessCorrection(unbacked: readonly UnbackedClaim[]): string {
  const truth = [...new Set(unbacked.flatMap((u) => u.truth))];
  return [accessPrompts().correctionHead, ...truth.map((t) => `- ${t}`)].join('\n');
}

/**
 * The stop hook of a run with the access check beside the other one (the done check of a
 * delegation, the question left in the text): one reminder per turn. A report to rewrite
 * ("finito davvero?") goes with it; a reminder whose reply would be only "OK" (the question
 * in the text) gives way, since the answer must be rewritten anyway.
 */
export function withAccessHook(
  access: (text: string) => string | null,
  other?: (text: string) => FinalAnswerHook | Promise<FinalAnswerHook>,
): (text: string) => Promise<FinalAnswerHook> {
  return async (text) => {
    const hooked = other ? await other(text) : null;
    const reminder = access(text);
    if (!reminder) return hooked;
    const otherText = typeof hooked === 'string' ? hooked : hooked?.text;
    const rewrite = typeof hooked === 'object' && hooked !== null && hooked.textCounts === true;
    return {
      text: otherText && rewrite ? `${otherText}\n\n${reminder}` : reminder,
      textCounts: true,
    };
  };
}

export interface AccessCheckOptions {
  log: Pick<EventLog, 'query' | 'append'>;
  agent: { id: string; name: string };
  runId: string;
  parentId?: string | null;
  /** Names the claims may mention (services, the squad, the user): read only when needed. */
  context: () => ClaimContext;
  /** The accesses of now: computed only when the answer has a claim. */
  state: () => AccessState;
}

/**
 * The check of the end of a turn (D-140), for every monster and every loop: `hook` is the
 * stop hook's part (a reminder, once: the monster rewrites), `correct` the note after an
 * answer that cannot be sent back (Codex, no stop hook). Both log what they found.
 */
export function accessCheck(o: AccessCheckOptions): {
  hook: (text: string) => string | null;
  correct: (text: string) => string | null;
} {
  let fired = false;
  const find = (
    text: string,
    mode: 'rewrite' | 'note',
  ): { unbacked: UnbackedClaim[]; facts: RunAccessFacts } | null => {
    if (fired || !text.trim()) return null;
    const claims = findAccessClaims(text, o.context());
    if (claims.length === 0) return null;
    const facts = runAccessFacts(o.log, { runId: o.runId, agentId: o.agent.id });
    const unbacked = judgeAccessClaims(claims, o.state(), facts);
    if (unbacked.length === 0) return null;
    fired = true;
    o.log.append({
      agent: 'system',
      runId: o.runId,
      parentId: o.parentId ?? null,
      type: 'instinct',
      data: {
        use: 'done_check',
        action: 'access_claim',
        message:
          mode === 'rewrite'
            ? accessStrings().claimCorrected(o.agent.name)
            : accessStrings()
                .claimNote(o.agent.name, unbacked[0]!.truth[0] ?? '')
                .trim(),
        subject: o.agent.id,
        details: {
          mode,
          sentences: unbacked.map((u) => clip(u.claim.sentence, 300)),
          truth: [...new Set(unbacked.flatMap((u) => u.truth))],
        },
      },
    });
    return { unbacked, facts };
  };
  return {
    hook: (text) => {
      const found = find(text, 'rewrite');
      return found ? accessReminder(found.unbacked, found.facts) : null;
    },
    correct: (text) => {
      const found = find(text, 'note');
      return found ? accessCorrection(found.unbacked) : null;
    },
  };
}
