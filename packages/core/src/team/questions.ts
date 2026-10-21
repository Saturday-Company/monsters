import { ulid, type Channel, type Question } from '@monsters/shared';
import type { Db } from '../db/sqlite.ts';
import type { Migration } from '../db/migrations.ts';
import type { EventLog } from '../log/event-log.ts';
import { decisionStrings } from './decision.strings.ts';

/*
 * Questions to the user (`ask_user`, ARCHITECTURE §5.4): a row per question in
 * the `questions` table, plus the in-memory waiters of blocking questions. The
 * kill switch expires every open question and rejects its waiters.
 *
 * Questions do not expire on their own (D-078): when nothing waits for one
 * anymore (a harness ended its turn, a native wait reached its limit, the run
 * finished, the core restarted) a question of `ask_user` is *parked*: still
 * open, tied to its monster rather than to a live run, and its answer starts
 * a new run. A question of the brake (`brake`: "Rhea vuole …: procedo?")
 * belongs to one tool call: when its run ends it expires instead.
 */

/**
 * How long after a question a plain message to its monster is the answer
 * (D-079): later it is a new request (the card still answers it).
 */
export const PARKED_ANSWER_WINDOW_MS = 2 * 60 * 60_000;

/** Lower case, punctuation as spaces: the words of a message or a label. */
function choiceWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

/** Starts of a choice: yes and no, ordinals, numbers, "both", "none" (an article before is fine). */
const CHOICE_START =
  /^((la|il|lo|l'|opzione|scelgo|preferisco|meglio)\s+)?(s[iì]|no|nessun[ao]?|entramb[ie]|tutt[ie] e due|prim[ao]|second[ao]|terz[ao]|quart[ao]|ultim[ao]|\d+)(\s|$)/u;
/** Answers only when the message is very short: "ok", "va bene", "quella", "b". */
const SHORT_CHOICE =
  /^((la|il|lo|l'|opzione)\s+)?(ok|okay|vai|yes|procedi|va bene|vanno bene|certo|d'accordo|perfetto|esatto|giusto|quell[ao]|quest[ao]|altr[ao]|tutt[ie]|[a-f])(\s|$)/u;
/** A choice is short: past this a message without an option's words is a request of its own. */
const CHOICE_MAX_WORDS = 8;

/**
 * Whether a plain message reads as the answer to a question with options
 * (review of 16/10: "Hai risposto: …" to a new request typed after a trivial
 * question). It answers when it names an option (its label or id, or a word
 * of 4+ letters of its label, in a message that is not long), or when it is
 * short, not a question, and starts like a choice ("sì", "la seconda", "2",
 * "nessuna"). A question without options takes any message as its answer.
 */
export function readsAsAnswer(
  question: { options: readonly { id: string; label: string }[] },
  text: string,
): boolean {
  if (question.options.length === 0) return true;
  const words = choiceWords(text);
  if (words.length === 0) return false;
  const joined = ` ${words.join(' ')} `;
  for (const o of question.options) {
    const label = choiceWords(o.label);
    if (label.length > 0 && joined.includes(` ${label.join(' ')} `)) return true;
    if (words.length === 1 && words[0] === o.id.toLowerCase()) return true;
    // A word of the label (not a short one: "di", "il", "con"), within a short message.
    if (words.length <= CHOICE_MAX_WORDS && label.some((w) => w.length >= 4 && words.includes(w))) {
      return true;
    }
  }
  if (text.includes('?')) return false;
  const line = words.join(' ');
  return (
    (words.length <= CHOICE_MAX_WORDS && CHOICE_START.test(line)) ||
    (words.length <= 3 && SHORT_CHOICE.test(line))
  );
}

/** Words that say yes or no in a short message ("va bene", "annulla"): at most three words. */
const SHORT_YES = new Set([
  'ok',
  'okay',
  'yes',
  'procedi',
  'vai',
  'certo',
  'perfetto',
  'esatto',
  'giusto',
  "d'accordo",
  'va bene',
  'confermo',
  'fallo',
]);
const SHORT_NO = new Set(['annulla', 'lascia stare', 'non farlo', 'stop', 'fermo', 'fermati']);
const ORDINALS: Record<string, number> = {
  prima: 0,
  primo: 0,
  seconda: 1,
  secondo: 1,
  terza: 2,
  terzo: 2,
  quarta: 3,
  quarto: 3,
};
const ARTICLES = new Set(['la', 'il', 'lo', 'opzione', 'scelgo', 'preferisco', 'meglio']);
const YES_LABEL = /^(s[iì]|yes|ok)$/u;
/**
 * Words that may come with a yes and add nothing to it ("sì grazie", "ok vai pure"). Anything
 * else after the yes is a condition or a request ("sì ma non a Marco", "ok però prima…",
 * "sì, solo se…"): not an approval (review of 19/10, item 2).
 */
const PLAIN_YES_WORDS = new Set([
  'sì',
  'si',
  'yes',
  'ok',
  'okay',
  'vai',
  'pure',
  'procedi',
  'certo',
  'perfetto',
  'esatto',
  'giusto',
  "d'accordo",
  'va',
  'bene',
  'confermo',
  'fallo',
  'fai',
  'dai',
  'grazie',
  'per',
  'favore',
  'please',
  'thanks',
]);

/**
 * The option a plain message picks, when it picks one for sure: the id alone ("1"), the
 * whole label, an ordinal ("la prima", "l'ultima", "la 2"), or a yes or a no ("sì", "va bene",
 * "certo", "no", "annulla") when one option starts with "Sì" and another with "No". Anything
 * else is undefined: for the brake that message is not an answer (review of 18/10, item 3:
 * "va bene" was taken as an answer and then read as a no). The first option ("Sì, procedi")
 * is picked only by a plain yes: the words around the choice may only be words of a yes.
 */
export function pickedOption(
  question: { options: readonly { id: string; label: string }[] },
  text: string,
): string | undefined {
  const { options } = question;
  const picked = pick(options, text);
  if (picked === undefined) return undefined;
  if (picked.id !== options[0]?.id) return picked.id;
  return picked.rest.every((w) => PLAIN_YES_WORDS.has(w)) ? picked.id : undefined;
}

/** The option a message picks, and its words left once the choice is taken out. */
function pick(
  options: readonly { id: string; label: string }[],
  text: string,
): { id: string; rest: string[] } | undefined {
  if (options.length === 0 || text.includes('?')) return undefined;
  const words = choiceWords(text);
  if (words.length === 0) return undefined;
  if (words.length === 1) {
    const byId = options.find((o) => o.id.toLowerCase() === words[0]);
    if (byId) return { id: byId.id, rest: [] };
  }
  const joined = ` ${words.join(' ')} `;
  const byLabel = options.filter((o) => {
    const label = choiceWords(o.label);
    return label.length > 0 && joined.includes(` ${label.join(' ')} `);
  });
  if (byLabel.length === 1) {
    const label = ` ${choiceWords(byLabel[0]!.label).join(' ')} `;
    return { id: byLabel[0]!.id, rest: joined.replace(label, ' ').split(' ').filter(Boolean) };
  }
  if (words.length > CHOICE_MAX_WORDS) return undefined;
  const rest = words.length > 1 && ARTICLES.has(words[0]!) ? words.slice(1) : words;
  const head = rest[0]!.replace(/^l'/, '');
  const index = /^\d+$/.test(head)
    ? Number(head) - 1
    : head === 'ultima' || head === 'ultimo'
      ? options.length - 1
      : ORDINALS[head];
  if (index !== undefined) {
    const id = options[index]?.id;
    return id === undefined ? undefined : { id, rest: rest.slice(1) };
  }
  const firstOf = (o: { label: string }) => choiceWords(o.label)[0] ?? '';
  const yesOption = options.find((o) => YES_LABEL.test(firstOf(o)));
  const noOption = options.find((o) => firstOf(o) === 'no');
  if (!yesOption || !noOption) return undefined;
  if (/^s[iì]$/u.test(head)) return { id: yesOption.id, rest: rest.slice(1) };
  if (head === 'no') return { id: noOption.id, rest: rest.slice(1) };
  if (words.length > 3) return undefined;
  const two = rest.slice(0, 2).join(' ');
  if (SHORT_YES.has(two)) return { id: yesOption.id, rest: rest.slice(2) };
  if (SHORT_YES.has(head)) return { id: yesOption.id, rest: rest.slice(1) };
  if (SHORT_NO.has(two) || SHORT_NO.has(head)) return { id: noOption.id, rest: [] };
  return undefined;
}

export const teamMigrations: readonly Migration[] = [
  {
    version: 1,
    name: 'questions',
    up: `
      CREATE TABLE questions (
        id          TEXT    PRIMARY KEY,
        agent       TEXT    NOT NULL,
        run_id      TEXT    NOT NULL,
        event_id    TEXT,
        question    TEXT    NOT NULL,
        options     TEXT    NOT NULL,
        recommended TEXT,
        blocking    INTEGER NOT NULL,
        status      TEXT    NOT NULL CHECK (status IN ('open', 'answered', 'expired')),
        created_at  INTEGER NOT NULL,
        answered_at INTEGER,
        answer      TEXT
      ) STRICT;
      CREATE INDEX questions_status ON questions (status, created_at);
      CREATE INDEX questions_run ON questions (run_id);
    `,
  },
  {
    version: 2,
    name: 'parked questions',
    up: `
      ALTER TABLE questions ADD COLUMN kind TEXT NOT NULL DEFAULT 'ask' CHECK (kind IN ('ask', 'brake'));
      ALTER TABLE questions ADD COLUMN parked_at INTEGER;
    `,
  },
  {
    // A request of an access (D-130): what the core applies when the user grants it (JSON).
    version: 3,
    name: 'access requests',
    up: `ALTER TABLE questions ADD COLUMN access TEXT;`,
  },
];

export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface QuestionAnswer {
  optionId?: string;
  text?: string;
}

export type QuestionStatus = Question['status'];

/** `ask`: `ask_user` (parked when nothing waits); `brake`: the card of one tool call (expires). */
export type QuestionKind = 'ask' | 'brake';

/** Why a question was parked (see `question_parked`). */
export type ParkReason = 'harness' | 'timeout' | 'run_ended' | 'restart';

/** Why open questions expired (see `question_expired`). */
export type ExpireReason = 'kill' | 'run_aborted' | 'restart' | 'agent_archived' | 'run_ended';

/** What `answer` did, for the listeners. */
export interface AnswerInfo {
  /** A live wait (`waitFor`) got the answer: the run that asked goes on by itself. */
  woke: boolean;
}

interface QuestionRow {
  id: string;
  agent: string;
  run_id: string;
  event_id: string | null;
  question: string;
  options: string;
  recommended: string | null;
  blocking: number;
  status: QuestionStatus;
  created_at: number;
  answered_at: number | null;
  answer: string | null;
  kind: QuestionKind;
  parked_at: number | null;
  access: string | null;
}

/** Why an answer was refused. */
export class QuestionError extends Error {
  readonly code: 'not_found' | 'not_open' | 'invalid_option';
  constructor(code: QuestionError['code'], message: string) {
    super(message);
    this.name = 'QuestionError';
    this.code = code;
  }
}

/** Rejects a blocking wait when the question expires (kill switch, run stopped). */
export class QuestionExpiredError extends Error {
  constructor(id: string) {
    super(`question ${id} expired`);
    this.name = 'AbortError';
  }
}

function toQuestion(row: QuestionRow): Question {
  const q: Question = {
    id: row.id,
    from: row.agent,
    runId: row.run_id,
    question: row.question,
    options: JSON.parse(row.options) as QuestionOption[],
    blocking: row.blocking === 1,
    status: row.status,
    createdAt: row.created_at,
  };
  if (row.recommended !== null) q.recommended = row.recommended;
  if (row.answer !== null) q.answer = JSON.parse(row.answer) as QuestionAnswer;
  if (row.parked_at !== null && row.status === 'open') q.parked = true;
  return q;
}

interface Waiter {
  resolve: (answer: QuestionAnswer) => void;
  reject: (err: Error) => void;
}

export class QuestionStore {
  readonly #db: Db;
  readonly #log: EventLog;
  readonly #now: () => number;
  readonly #waiters = new Map<string, Set<Waiter>>();
  readonly #listeners = new Set<(q: Question, info: AnswerInfo) => void>();

  constructor(db: Db, log: EventLog, options: { now?: () => number } = {}) {
    this.#db = db;
    this.#log = log;
    this.#now = options.now ?? Date.now;
  }

  /** Creates an open question and logs the `question` event. */
  create(params: {
    agent: string;
    runId: string;
    parentId?: string | null;
    question: string;
    options: QuestionOption[];
    recommended?: string | undefined;
    blocking: boolean;
    /** Default `ask`. */
    kind?: QuestionKind;
    /**
     * A request of an access (`access_request`, D-130): what the core applies when the
     * user grants it. Parked like `ask_user`, answered only by the user in person.
     */
    access?: unknown;
  }): Question {
    const id = ulid();
    const event = this.#log.append({
      agent: params.agent,
      runId: params.runId,
      parentId: params.parentId ?? null,
      type: 'question',
      data: {
        questionId: id,
        question: params.question,
        options: params.options,
        ...(params.recommended !== undefined ? { recommended: params.recommended } : {}),
        blocking: params.blocking,
        ...(params.kind === 'brake'
          ? { kind: 'brake' as const }
          : params.access !== undefined
            ? { kind: 'access' as const }
            : {}),
      },
    });
    this.#db.run(
      `INSERT INTO questions (id, agent, run_id, event_id, question, options, recommended, blocking, status, created_at, kind, access)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      id,
      params.agent,
      params.runId,
      event.id,
      params.question,
      JSON.stringify(params.options),
      params.recommended ?? null,
      params.blocking ? 1 : 0,
      event.ts,
      params.kind ?? 'ask',
      params.access !== undefined ? JSON.stringify(params.access) : null,
    );
    return this.get(id)!;
  }

  get(id: string): Question | undefined {
    const row = this.#db.get<QuestionRow>('SELECT * FROM questions WHERE id = ?', id);
    return row ? toQuestion(row) : undefined;
  }

  kindOf(id: string): QuestionKind | undefined {
    return this.#db.get<{ kind: QuestionKind }>('SELECT kind FROM questions WHERE id = ?', id)
      ?.kind;
  }

  /** What a request of an access grants (D-130), or undefined for any other question. */
  accessOf(id: string): unknown {
    const raw = this.#db.get<{ access: string | null }>(
      'SELECT access FROM questions WHERE id = ?',
      id,
    )?.access;
    if (raw === null || raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }

  /**
   * A question only the user answers, in person (D-130): a card of the brake or a
   * request of an access. Never the CLI token, never a person of a Telegram group,
   * never a message that does not pick an option for sure.
   */
  ownerOnly(id: string): boolean {
    const row = this.#db.get<{ kind: QuestionKind; access: string | null }>(
      'SELECT kind, access FROM questions WHERE id = ?',
      id,
    );
    return row !== undefined && (row.kind === 'brake' || row.access !== null);
  }

  /** Event id of the `question` event (parent of the answer). */
  eventIdOf(id: string): string | null {
    return (
      this.#db.get<{ event_id: string | null }>('SELECT event_id FROM questions WHERE id = ?', id)
        ?.event_id ?? null
    );
  }

  list(
    filter: {
      status?: QuestionStatus | undefined;
      runId?: string;
      agent?: string;
      /** Only the parked open questions (true), or only the ones never parked (false). */
      parked?: boolean;
    } = {},
  ): Question[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.runId) {
      where.push('run_id = ?');
      params.push(filter.runId);
    }
    if (filter.agent) {
      where.push('agent = ?');
      params.push(filter.agent);
    }
    if (filter.parked === true) where.push(`status = 'open' AND parked_at IS NOT NULL`);
    if (filter.parked === false) where.push('parked_at IS NULL');
    const sql = `SELECT * FROM questions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT 200`;
    return this.#db.all<QuestionRow>(sql, ...params).map(toQuestion);
  }

  /**
   * Records the user's answer: `answer` event, plus a `decision` event (the
   * user's choice is part of the System 1 dataset). Wakes blocking waiters.
   */
  answer(
    id: string,
    given: QuestionAnswer,
    channel: Channel,
    by?: string,
    /** The `message` event that gave the answer (D-078). */
    message?: string,
  ): Question {
    const q = this.get(id);
    if (!q) throw new QuestionError('not_found', `question ${id} not found`);
    if (q.status !== 'open') throw new QuestionError('not_open', `question ${id} is ${q.status}`);
    // An open question has no options: a bare "2" typed in a client is the answer itself.
    const answer: QuestionAnswer =
      q.options.length === 0 && given.optionId !== undefined && given.text === undefined
        ? { text: given.optionId }
        : given;
    const option =
      answer.optionId !== undefined ? q.options.find((o) => o.id === answer.optionId) : undefined;
    if (answer.optionId !== undefined && !option) {
      throw new QuestionError(
        'invalid_option',
        q.options.length === 0
          ? 'this question has no options: answer with text'
          : `unknown option "${answer.optionId}": use one of ${q.options.map((o) => o.id).join(', ')}`,
      );
    }
    const stored: QuestionAnswer = {
      ...(answer.optionId !== undefined ? { optionId: answer.optionId } : {}),
      ...(answer.text !== undefined && answer.text.trim() !== '' ? { text: answer.text } : {}),
    };
    const changed = this.#db.run(
      `UPDATE questions SET status = 'answered', answered_at = ?, answer = ? WHERE id = ? AND status = 'open'`,
      this.#now(),
      JSON.stringify(stored),
      id,
    );
    if (changed.changes === 0) throw new QuestionError('not_open', `question ${id} is not open`);
    const event = this.#log.append({
      agent: 'user',
      runId: q.runId,
      parentId: this.eventIdOf(id),
      type: 'answer',
      data: {
        questionId: id,
        ...stored,
        channel,
        ...(by ? { by: by.slice(0, 120) } : {}),
        ...(message ? { message } : {}),
      },
    });
    this.#log.append({
      agent: 'user',
      runId: q.runId,
      parentId: event.id,
      type: 'decision',
      data: {
        kind: 'user_choice',
        question: q.question,
        options: q.options.map((o) => o.label),
        choice: option?.label ?? stored.text ?? '',
        decidedBy: 'user',
        ...(q.recommended !== undefined
          ? {
              reason:
                answer.optionId === q.recommended
                  ? decisionStrings().pickedRecommended
                  : decisionStrings().pickedOther,
            }
          : {}),
      },
    });
    const updated = this.get(id)!;
    const waiters = this.#waiters.get(id);
    const woke = (waiters?.size ?? 0) > 0;
    for (const w of waiters ?? []) w.resolve(stored);
    this.#waiters.delete(id);
    for (const l of this.#listeners) l(updated, { woke });
    return updated;
  }

  /**
   * Called with every answered question: an answer that no wait received
   * (non-blocking, parked) must reach the monster as a message.
   */
  onAnswer(listener: (q: Question, info: AnswerInfo) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Waits for the answer of a question; rejects when `signal` aborts or the question expires. */
  waitFor(id: string, signal: AbortSignal): Promise<QuestionAnswer> {
    const q = this.get(id);
    if (!q) return Promise.reject(new QuestionError('not_found', `question ${id} not found`));
    if (q.status === 'answered') return Promise.resolve(q.answer ?? {});
    if (q.status === 'expired') return Promise.reject(new QuestionExpiredError(id));
    if (signal.aborted) return Promise.reject(signal.reason as Error);
    return new Promise<QuestionAnswer>((resolve, reject) => {
      const set = this.#waiters.get(id) ?? new Set<Waiter>();
      this.#waiters.set(id, set);
      const onAbort = () => {
        set.delete(waiter);
        if (set.size === 0 && this.#waiters.get(id) === set) this.#waiters.delete(id);
        reject(signal.reason as Error);
      };
      const waiter: Waiter = {
        resolve: (a) => {
          signal.removeEventListener('abort', onAbort);
          resolve(a);
        },
        reject: (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      };
      set.add(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** True while a blocking wait (`waitFor`) holds the question. */
  isAwaited(id: string): boolean {
    return (this.#waiters.get(id)?.size ?? 0) > 0;
  }

  /**
   * Expires open questions (all, or those of one run, agent or kind) and logs
   * a `question_expired` event for each, so clients drop them. Returns how many.
   */
  expireOpen(
    filter: { id?: string; runId?: string; agent?: string; kind?: QuestionKind } = {},
    reason?: ExpireReason,
  ): number {
    const where = [
      ...(filter.id ? ['AND id = ?'] : []),
      ...(filter.runId ? ['AND run_id = ?'] : []),
      ...(filter.agent ? ['AND agent = ?'] : []),
      ...(filter.kind ? ['AND kind = ?'] : []),
    ].join(' ');
    const open = this.#db.all<{
      id: string;
      agent: string;
      run_id: string;
      event_id: string | null;
    }>(
      `SELECT id, agent, run_id, event_id FROM questions WHERE status = 'open' ${where}`,
      ...(filter.id ? [filter.id] : []),
      ...(filter.runId ? [filter.runId] : []),
      ...(filter.agent ? [filter.agent] : []),
      ...(filter.kind ? [filter.kind] : []),
    );
    let expired = 0;
    for (const row of open) {
      const changed = this.#db.run(
        `UPDATE questions SET status = 'expired' WHERE id = ? AND status = 'open'`,
        row.id,
      );
      for (const w of this.#waiters.get(row.id) ?? []) w.reject(new QuestionExpiredError(row.id));
      this.#waiters.delete(row.id);
      if (changed.changes === 0) continue;
      expired++;
      this.#log.append({
        agent: row.agent,
        runId: row.run_id,
        parentId: row.event_id,
        type: 'question_expired',
        data: { questionId: row.id, ...(reason ? { reason } : {}) },
      });
    }
    return expired;
  }

  /** Open blocking questions of a run. */
  openBlocking(runId: string): Question[] {
    return this.list({ status: 'open', runId }).filter((q) => q.blocking);
  }

  /** Parked questions (open, nothing waiting on them), newest first; of one monster with `agent`. */
  parked(agent?: string): Question[] {
    return this.list({ parked: true, ...(agent ? { agent } : {}) });
  }

  /**
   * Parks an open question (D-078): it stays open with nothing waiting on it,
   * and logs `question_parked` so clients show "aspetta te". False when it is
   * not open, already parked, or a question of the brake (those expire).
   */
  park(id: string, reason: ParkReason): boolean {
    const row = this.#db.get<{ agent: string; run_id: string; event_id: string | null }>(
      `SELECT agent, run_id, event_id FROM questions
       WHERE id = ? AND status = 'open' AND parked_at IS NULL AND kind = 'ask'`,
      id,
    );
    if (!row) return false;
    const changed = this.#db.run(
      `UPDATE questions SET parked_at = ? WHERE id = ? AND status = 'open' AND parked_at IS NULL`,
      this.#now(),
      id,
    );
    if (changed.changes === 0) return false;
    this.#log.append({
      agent: row.agent,
      runId: row.run_id,
      parentId: row.event_id,
      type: 'question_parked',
      data: { questionId: id, reason },
    });
    return true;
  }

  /**
   * A run ended (completed or failed): no open question of it is left with
   * nothing behind it. Those of `ask_user` are parked (the monster waits for
   * the user), those of the brake expire (their tool call is gone). Returns
   * how many questions of the run wait for the user (parked before or now).
   */
  settleRun(runId: string): number {
    this.expireOpen({ runId, kind: 'brake' }, 'run_ended');
    let waiting = 0;
    // Oldest first: the events follow the order of the questions.
    for (const q of this.list({ status: 'open', runId }).reverse()) {
      if (!q.parked) this.park(q.id, 'run_ended');
      waiting++;
    }
    return waiting;
  }

  /**
   * At startup, when the runs of the previous core are gone: open questions
   * of `ask_user` are parked (a native run may have been waiting on one), the
   * brake's expire. Questions parked before stay as they are.
   */
  settleAtStartup(): { parked: number; expired: number } {
    const expired = this.expireOpen({ kind: 'brake' }, 'restart');
    let parked = 0;
    for (const q of this.list({ status: 'open', parked: false }).reverse()) {
      if (this.park(q.id, 'restart')) parked++;
    }
    return { parked, expired };
  }
}
