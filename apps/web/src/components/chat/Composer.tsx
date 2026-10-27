import {
  ArrowBendDownRight,
  At,
  NotePencil,
  Paperclip,
  PauseCircle,
  Stop,
  TerminalWindow,
  WifiSlash,
  X,
  type Icon,
} from '@phosphor-icons/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  answerQuestion,
  chooseOption,
  errorText,
  notify,
  sendMessage,
  startNewConversation,
  stopAgent,
  useApp,
} from '../../store/app.ts';
import { draftOf, saveDraft } from '../../store/drafts.ts';
import { useAgents, useConnection, useMediaQuery, type AgentView } from '../../store/hooks.ts';
import { openChat } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { clipText, plainText } from '../../lib/markdown.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { openTerminalAt } from '../terminal/focus.ts';
import { Button, KeyCap } from '../ui/button.tsx';
import { KEYPAD_LETTERS, keypadPick, lettersText } from './QuestionCard.tsx';
import { ACCEPT } from '../../lib/files.ts';
import { FileChip } from '../files/FileChip.tsx';
import { useAttachments } from './attachments.ts';
import { chatStrings } from './chat.strings.ts';

/** Where the user manages the plan usage of the apps (OpenAI's SIWC guidelines). */
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';

/** The agent addressed with `@Name` (the first mention that matches a team member). */
export function mentionTarget<T extends { id: string; name: string }>(
  text: string,
  agents: readonly T[],
): T | null {
  const re = /(^|\s)@([\p{L}\p{N}_-]+)/gu;
  const lower = text.toLowerCase();
  // Longest names first: "@Rhea · Saturday" is the copy in the project, not Rhea (D-100).
  const byLength = [...agents].sort((a, b) => b.name.length - a.name.length);
  for (const m of text.matchAll(re)) {
    const at = m.index + m[1]!.length + 1;
    const full = byLength.find((a) => {
      const name = a.name.toLowerCase();
      return lower.startsWith(name, at) && !/[\p{L}\p{N}_-]/u.test(lower.charAt(at + name.length));
    });
    if (full) return full;
    const word = m[2]!.toLowerCase();
    const hit = agents.find((a) => a.id === word);
    if (hit) return hit;
  }
  return null;
}

/** The `@partial` word right before the caret, if any. */
function mentionQuery(
  text: string,
  caret: number,
): { start: number; query: string; typed: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(before);
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, query: m[2]!.toLowerCase(), typed: m[2]! };
}

/** The commands of the `/` menu (F-9): what they do, and the words that name them. */
export type SlashId = 'newConversation' | 'stop' | 'behind' | 'attach';

/**
 * The `/word` being typed at the very start of the field, if any: the commands are the first
 * thing typed, never a path or a fraction in the middle of a sentence.
 */
export function slashQuery(text: string, caret: number): string | null {
  const m = /^\/([\p{L}]*)$/u.exec(text.slice(0, caret));
  return m && text === text.slice(0, caret) ? m[1]!.toLowerCase() : null;
}

/** The commands whose name (in the language of the app, or in English) starts with `query`. */
export function matchSlash<T extends { names: readonly string[] }>(
  commands: readonly T[],
  query: string,
): T[] {
  return commands.filter((c) => c.names.some((n) => n.startsWith(query)));
}

/**
 * `/nuova` (or `/new`): start a new conversation instead of sending. With a
 * recipient (`/nuova @Rhea`, or `@Rhea /nuova` after picking her with @) only
 * the conversation with that agent starts over.
 */
export function newConversationCommand(text: string): { to: string | undefined } | null {
  const m = /^(?:@([\p{L}\p{N}_-]+)\s+)?\/(?:nuova|new)(?:\s+@?([\p{L}\p{N}_-]+))?$/iu.exec(
    text.trim(),
  );
  if (!m || (m[1] !== undefined && m[2] !== undefined)) return null;
  return { to: m[1] ?? m[2] };
}

const PREFILL = 'monsters:composer-prefill';

/** Puts a text in the composer of the open chat and focuses it (the suggestions of an empty chat). */
export function prefillComposer(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(PREFILL, { detail: text }));
}

/** The open question the composer answers: what is typed becomes its answer. */
export interface ComposerQuestion {
  id: string;
  /** Name of the monster that asked. */
  from: string;
  /** The question itself, for the bar above the field while its card is out of sight. */
  text?: string;
  /** How many options the question has (0: an open question); they are keys A, B, C… */
  options: number;
  /** The options, in order: a letter alone and Enter picks one (V-1). */
  picks?: readonly { id: string; label: string }[];
  /**
   * The monster's work waits on it: the core takes any message to that monster
   * as the answer, so it cannot be turned into a normal message here.
   */
  blocking?: boolean;
}

/** The placeholder of the composer, from what the chat is waiting for. */
export function composerPlaceholder(o: {
  name: string;
  halted: boolean;
  /** The core does not answer: the text stays here until it is back. */
  offline?: boolean;
  noModel: boolean;
  question: ComposerQuestion | null;
  wide: boolean;
  /** A real keyboard (no touch-first pointer): the letters can press the keypad. Defaults to `wide`. */
  keyboard?: boolean;
}): string {
  const s = chatStrings().composer;
  if (o.noModel) return s.connectFirst;
  if (o.offline) return o.wide ? s.offlineWide : s.offlineNarrow;
  if (o.halted) return o.wide ? s.haltedWide : s.haltedNarrow;
  if (o.question) {
    if (o.question.options === 0) return s.answer(o.question.from);
    // With a keyboard the letters press the keys of the keypad (QuestionCard).
    return (o.keyboard ?? o.wide)
      ? s.writeOrPress(o.question.from, lettersText(o.question.options))
      : s.answerOrPick(o.question.from);
  }
  return o.wide ? s.writeWide(o.name) : s.writeNarrow(o.name);
}

/**
 * The message field of a chat: what is typed goes to the monster of the chat.
 * A leading `@Name` sends it to another monster instead, and the UI moves to
 * that chat, where the answer will come; a leading `/` opens the commands. With an
 * open question it answers it; while the monsters are stopped the message waits for
 * "Riprendi"; without a model it is off. While the monster works the "Send" key is
 * "Stop" (and a message written then waits for the monster's next step).
 */
export function Composer({
  agent,
  question = null,
  noModel = false,
  working = false,
  canStartOver = false,
  questionHidden = false,
  onShowQuestion,
  readOnly = false,
}: {
  agent: AgentView;
  question?: ComposerQuestion | null;
  noModel?: boolean;
  /** The monster works or writes in this chat: the key is "Stop". */
  working?: boolean;
  /** The conversation has something to close: `/new` is offered. */
  canStartOver?: boolean;
  /** The open question's card is out of sight: its bar has the keys and "Show". */
  questionHidden?: boolean;
  onShowQuestion?: () => void;
  /** An earlier conversation is on screen: nothing can be written until the current one is back. */
  readOnly?: boolean;
}) {
  const s = chatStrings().composer;
  const agents = useAgents();
  const halted = useApp((s) => s.halted);
  const offline = useConnection() === 'closed';
  const wide = useMediaQuery('(min-width: 640px)');
  const keyboard = !useMediaQuery('(pointer: coarse)');
  const account = useApp((s) => s.email);
  // The draft of this chat survives a chat switch, a page change, a language switch and a
  // reload (W-7); it goes when the message is sent.
  const [text, setTextState] = useState(() => draftOf(account, agent.id));
  const draftFor = useRef(agent.id);
  const setText = useCallback(
    (t: string) => {
      setTextState(t);
      saveDraft(account, agent.id, t);
    },
    [account, agent.id],
  );
  useEffect(() => {
    // The same field for another chat (a page that does not mount it again): that chat's draft.
    if (draftFor.current === agent.id) return;
    draftFor.current = agent.id;
    setTextState(draftOf(account, agent.id));
  }, [account, agent.id]);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const [mentionOff, setMentionOff] = useState(false);
  const [slashOff, setSlashOff] = useState(false);
  const [stopping, setStopping] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Where the caret goes once a text set by the code is in the field (see the layout effect). */
  const pendingCaret = useRef<number | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const files = useAttachments(agent.id);
  const attaching = files.items.length > 0;

  const mq = mentionOff || readOnly ? null : mentionQuery(text, caret);
  const suggestions = useMemo(
    () =>
      mq
        ? agents
            // Not the chat's own monster: a message to it here needs no @.
            .filter((a) => a.id !== agent.id)
            .filter((a) => a.name.toLowerCase().startsWith(mq.query) || a.id.startsWith(mq.query))
            // In a project's chat its own monsters come first (D-100).
            .sort(
              (a, b) =>
                Number((b.project ?? '') === (agent.project ?? '')) -
                Number((a.project ?? '') === (agent.project ?? '')),
            )
        : [],
    [agents, mq, agent.id, agent.project],
  );
  /** "@zz": nobody of that name (an "@" alone shows the list, never this). */
  const noSuchMonster = !!mq && mq.typed !== '' && suggestions.length === 0;
  const target = mentionTarget(text, agents);
  // Another monster named with @: the message goes to its own chat.
  const elsewhere = target && target.id !== agent.id ? target : null;
  const talking = elsewhere ?? agent;
  // OpenAI's indicator: requests of this agent use the user's ChatGPT plan (M2.7).
  const onPlan = talking.provider === 'chatgpt' || talking.provider === 'codex';
  const isCommand = newConversationCommand(text) !== null;
  /** The question the user said this message is not an answer to (the ✕ of the answer line). */
  const [notAnswerTo, setNotAnswerTo] = useState<string | null>(null);
  // A message with files is never an answer: the card of the question takes only words.
  const canAnswer = !!question && !elsewhere && !isCommand && !halted && !attaching;
  // What is typed answers the open question, unless it goes elsewhere, is a command, or the user said no.
  const answering = canAnswer && (question.blocking === true || notAnswerTo !== question.id);
  // A mention being typed ("@", "@Rh") is not an answer yet: the line waits for real words.
  const mentioning = /^@\S*$/.test(text.trim());
  // Nor is a command being typed ("/", "/ne").
  const commanding = /^\/\p{L}*$/u.test(text.trim());
  // A letter of the keypad alone: Enter picks that option, with the moment to undo it (V-1).
  const pickAt = answering && question.picks ? keypadPick(text, question.picks.length) : null;
  const pick = pickAt !== null ? question?.picks?.[pickAt] : undefined;

  const stop = useCallback(async () => {
    if (!working || stopping) return;
    setStopping(true);
    try {
      await stopAgent(agent.id);
    } catch (err) {
      setStopping(false);
      notify(errorText(err), 'error');
    }
  }, [agent.id, working, stopping]);
  // The key goes back to "Send" when the work has ended (or if nothing ended after a while).
  const [wasWorking, setWasWorking] = useState(working);
  if (working !== wasWorking) {
    setWasWorking(working);
    if (!working) setStopping(false);
  }
  useEffect(() => {
    if (!stopping) return;
    const t = setTimeout(() => setStopping(false), 5000);
    return () => clearTimeout(t);
  }, [stopping]);
  // ⌘/Ctrl+Shift+Backspace stops the work from anywhere in the chat; Esc never does (too easy).
  useEffect(() => {
    if (!working) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Backspace' || !e.shiftKey || !(e.metaKey || e.ctrlKey) || e.repeat) return;
      e.preventDefault();
      void stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [working, stop]);

  /** The commands of the `/` menu that apply now. */
  const commands = useMemo(() => {
    const c = s.slash;
    const list: {
      id: SlashId;
      names: string[];
      name: string;
      description: string;
      icon: Icon;
    }[] = [];
    const entry = (
      id: SlashId,
      english: string[],
      d: { name: string; description: string },
      icon: Icon,
    ) => list.push({ id, names: [...new Set([d.name, ...english])], ...d, icon });
    // Named in the language of the app and in the other one: "/nuova" worked before this menu.
    if (canStartOver) entry('newConversation', ['new', 'nuova'], c.newConversation, NotePencil);
    if (working) entry('stop', ['stop', 'ferma'], c.stop, Stop);
    entry('behind', ['behind', 'dietro'], c.behind, TerminalWindow);
    if (!noModel) entry('attach', ['attach', 'allega'], c.attach, Paperclip);
    return list;
  }, [s, canStartOver, working, noModel]);
  const sq = slashOff || readOnly ? null : slashQuery(text, caret);
  const slashList = useMemo(() => (sq === null ? [] : matchSlash(commands, sq)), [commands, sq]);

  useEffect(() => {
    const onPrefill = (e: Event) => {
      const t = (e as CustomEvent<string>).detail;
      const el = ref.current;
      if (el && el.value === t) {
        // The same text: no render, the caret goes now.
        el.focus();
        el.setSelectionRange(t.length, t.length);
      } else pendingCaret.current = t.length;
      setText(t);
      setCaret(t.length);
    };
    window.addEventListener(PREFILL, onPrefill);
    return () => window.removeEventListener(PREFILL, onPrefill);
  }, [setText]);

  // Auto-grow up to ~6 lines.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
    // The caret of a text set by the code (a picked mention, a prefill), placed as soon as the
    // value is in the field: a frame later, keys typed meanwhile went in before the caret jumped.
    const pos = pendingCaret.current;
    if (pos !== null) {
      pendingCaret.current = null;
      el.focus();
      el.setSelectionRange(pos, pos);
    }
  }, [text]);

  const pickMention = (a: AgentView) => {
    if (!mq) return;
    const next = `${text.slice(0, mq.start)}@${a.name} ${text.slice(caret)}`;
    const pos = mq.start + a.name.length + 2;
    pendingCaret.current = pos;
    setText(next);
    setCaret(pos);
  };

  const pickCommand = (c: (typeof slashList)[number]) => {
    setText('');
    setCaret(0);
    if (c.id === 'newConversation')
      startNewConversation(agent.id).catch((err: unknown) => notify(errorText(err), 'error'));
    else if (c.id === 'stop') void stop();
    else if (c.id === 'behind') openTerminalAt(agent.id);
    else picker.current?.click();
    // The file dialog takes the focus itself; the others give it back to the field.
    if (c.id !== 'attach') ref.current?.focus();
  };

  const submit = async () => {
    const t = text.trim();
    const sent = files.ready.map((m) => m.id);
    if ((!t && sent.length === 0) || sending || noModel || offline || files.uploading || readOnly)
      return;
    setSending(true);
    setText('');
    setCaret(0);
    try {
      const command = sent.length === 0 ? newConversationCommand(t) : null;
      if (command) await startNewConversation(command.to ?? agent.id);
      else if (pick && question) chooseOption(question.id, pick.id);
      else if (answering && question) await answerQuestion(question.id, { text: t });
      else {
        // The orchestrator's messages go without an addressee, as always: the core routes them to it.
        await sendMessage(t, talking.isOrchestrator ? undefined : talking.id, sent);
        files.clear();
        if (elsewhere) openChat(elsewhere.id);
      }
    } catch (err) {
      setText(t);
      notify(errorText(err), 'error');
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const count = suggestions.length > 0 ? suggestions.length : slashList.length;
    if (count > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + d + count) % count);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (suggestions.length > 0) pickMention(suggestions[Math.min(active, count - 1)]!);
        else pickCommand(slashList[Math.min(active, count - 1)]!);
        return;
      }
      if (e.key === 'Escape') {
        // The list closes; a sheet or the pane behind the chat stays.
        e.preventDefault();
        if (suggestions.length > 0) setMentionOff(true);
        else setSlashOff(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const listId = suggestions.length > 0 ? 'mention-list' : 'slash-list';
  const hasContent = !!text.trim() || files.ready.length > 0;
  const ready = hasContent && !sending && !noModel && !offline && !files.uploading && !readOnly;
  const showList = suggestions.length > 0 || slashList.length > 0;
  const listCount = suggestions.length > 0 ? suggestions.length : slashList.length;
  // While the monster works the key is "Stop"; with words in the field both are there.
  const showStop = working && !readOnly;
  // With files on their way the key is there too (disabled until they are up).
  const showSend = !showStop || hasContent || attaching;
  const mac = isMac();

  // One line above the field for the question the chat waits on (docs/design.md, "The chat"): the
  // answer in progress ("Answering Titan's question") and, with the card out of sight, the
  // question itself with its keys and "Show". Never two elements.
  const answerLine = canAnswer && !!text.trim() && !mentioning && !commanding;
  const showBar = !!question && !readOnly && (questionHidden || answerLine);
  const barKeys = !!question?.picks?.length && questionHidden && !answerLine;

  return (
    <div className="relative">
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={suggestions.length > 0 ? s.pickMonster : s.slash.label}
          data-testid={suggestions.length > 0 ? 'mention-list' : 'slash-menu'}
          className="popover rise-in absolute bottom-full left-0 z-40 mb-2 w-[min(360px,100%)] overflow-hidden rounded-[14px] p-1.5"
        >
          <li role="presentation" className="label px-2.5 pt-1.5 pb-1 text-ink-muted">
            {suggestions.length > 0 ? s.writeTo : s.slash.label}
          </li>
          {suggestions.length > 0
            ? suggestions.map((a, i) => (
                <li key={a.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickMention(a)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-left',
                      i === active && 'bg-panel shadow-[inset_0_0_0_1.5px_var(--ink)]',
                    )}
                  >
                    <MonsterScreen genome={a.genome} mood="idle" width={40} height={34} pad={2} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-semibold text-ink">{a.name}</span>
                      <span className="block truncate text-footnote text-ink-muted">{a.role}</span>
                    </span>
                    {i === active && <KeyCap className="mr-1">↵</KeyCap>}
                  </button>
                </li>
              ))
            : slashList.map((c, i) => {
                const CommandIcon = c.icon;
                return (
                  <li key={c.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickCommand(c)}
                      onMouseEnter={() => setActive(i)}
                      data-testid={`slash-${c.id}`}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-left',
                        i === active && 'bg-panel shadow-[inset_0_0_0_1.5px_var(--ink)]',
                      )}
                    >
                      <CommandIcon size={20} aria-hidden className="shrink-0 text-ink-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-footnote font-semibold text-ink">
                          /{c.name}
                        </span>
                        <span className="block truncate text-footnote text-ink-muted">
                          {c.description}
                        </span>
                      </span>
                      {i === active && <KeyCap className="mr-1">↵</KeyCap>}
                    </button>
                  </li>
                );
              })}
        </ul>
      )}
      {noSuchMonster && mq && (
        <p
          role="status"
          data-testid="no-monster"
          className="popover rise-in absolute bottom-full left-0 z-40 mb-2 w-[min(360px,100%)] rounded-[14px] px-3.5 py-3 text-footnote text-ink-muted"
        >
          {s.noMonster(mq.typed)}
        </p>
      )}

      <div className="flex flex-col gap-1.5" data-testid="composer">
        {onPlan && (
          <p
            className="flex flex-wrap items-center gap-x-1.5 px-1.5 text-footnote text-ink-muted"
            data-testid="chatgpt-plan-indicator"
          >
            <span className="font-medium text-ink">{s.usingPlan}</span>
            <span aria-hidden>·</span>
            <a
              href={CHATGPT_USAGE_URL}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-from-font underline-offset-2 hover:text-ink"
            >
              {s.manageUsage}
            </a>
          </p>
        )}
        {elsewhere && (
          <p className="flex items-center gap-1.5 px-1.5 text-footnote text-ink-muted">
            <At size={16} weight="bold" aria-hidden />
            {s.sendBefore}
            <strong className="font-semibold text-ink">{elsewhere.name}</strong>
            {s.sendAfter}
          </p>
        )}
        {showBar && question && (
          <div
            className="composer-question card rise-in flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[12px] px-3 py-1"
            data-testid="question-bar"
            data-hidden={questionHidden ? 'true' : undefined}
          >
            {answerLine ? (
              <p
                className="flex min-w-0 flex-1 items-center gap-1.5 text-footnote text-ink-muted"
                data-testid={answering ? 'composer-answering' : 'composer-not-answering'}
              >
                {answering ? (
                  <>
                    <ArrowBendDownRight size={16} weight="bold" aria-hidden className="shrink-0" />
                    {pick ? (
                      <span data-testid="composer-pick">
                        {s.pickBefore}
                        <strong className="font-semibold text-ink">{plainText(pick.label)}</strong>
                      </span>
                    ) : (
                      <span>
                        {s.answeringBefore}
                        <strong className="font-semibold text-ink">{question.from}</strong>
                        {s.answeringAfter}
                      </span>
                    )}
                    {!question.blocking && (
                      <button
                        type="button"
                        onClick={() => setNotAnswerTo(question.id)}
                        aria-label={s.notAnswer}
                        title={s.notAnswer}
                        className="key ml-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-muted hover:text-ink"
                      >
                        <X size={12} weight="bold" aria-hidden />
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <span>{s.normalMessage(question.from)}</span>
                    <button
                      type="button"
                      onClick={() => setNotAnswerTo(null)}
                      className="min-h-8 font-medium text-signal-ink hover:underline"
                    >
                      {s.itIsAnswer}
                    </button>
                  </>
                )}
              </p>
            ) : (
              <p className="flex min-w-[15rem] flex-1 items-center gap-2 text-footnote text-ink-muted">
                <span aria-hidden className="led" data-tone="signal" data-blink="" />
                <span className="min-w-0 truncate" data-testid="question-bar-text">
                  <span className="font-semibold text-ink">
                    {chatStrings().panel.asks(question.from)}
                  </span>{' '}
                  {clipText(plainText(question.text ?? ''), 90)}
                </span>
              </p>
            )}
            {barKeys && (
              <span
                role="group"
                aria-label={chatStrings().question.options}
                className="flex shrink-0 items-center gap-1.5"
              >
                {question.picks!.slice(0, 4).map((o, i) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      answerQuestion(question.id, { optionId: o.id }).catch((err: unknown) =>
                        notify(errorText(err), 'error'),
                      );
                    }}
                    aria-label={chatStrings().panel.answerWith(
                      KEYPAD_LETTERS[i] ?? String(i + 1),
                      plainText(o.label),
                    )}
                    title={plainText(o.label)}
                    data-testid={`question-bar-key-${KEYPAD_LETTERS[i]}`}
                    className="key inline-flex size-9 items-center justify-center rounded-[9px] font-mono text-footnote font-semibold text-ink"
                  >
                    {KEYPAD_LETTERS[i]}
                  </button>
                ))}
              </span>
            )}
            {questionHidden && (
              <button
                type="button"
                onClick={onShowQuestion}
                data-testid="question-bar-show"
                aria-label={chatStrings().panel.showQuestion}
                className="label ml-auto inline-flex h-9 shrink-0 items-center rounded-[8px] px-2 text-signal-ink hover:underline"
              >
                {chatStrings().panel.show}
              </button>
            )}
          </div>
        )}
        {offline && !noModel && (
          // No queue behind this: a message held by the browser alone could go out late, twice or
          // to a question that is gone. The text stays in the field; Invia wakes up with the link.
          <p
            data-testid="composer-offline"
            className="flex items-center gap-1.5 px-1.5 text-footnote text-ink-muted"
          >
            <WifiSlash size={16} weight="bold" aria-hidden />
            {s.offlineNote}
          </p>
        )}
        {halted && !offline && !noModel && text.trim() && (
          <p className="flex items-center gap-1.5 px-1.5 text-footnote text-ink-muted">
            <PauseCircle size={16} weight="bold" aria-hidden />
            {s.haltedNote}
          </p>
        )}
        {attaching && (
          <ul
            aria-label={s.attachments}
            className="flex flex-wrap gap-2 px-0.5 pb-0.5"
            data-testid="composer-attachments"
          >
            {files.items.map((a) => (
              <li key={a.key} className="min-w-0">
                <FileChip
                  file={a.file}
                  progress={a.progress}
                  error={a.error}
                  open={false}
                  onRemove={() => files.remove(a.key)}
                />
              </li>
            ))}
          </ul>
        )}
        {files.uploading && (
          <p className="sr-only" role="status">
            {s.uploading}
          </p>
        )}
        <div className="composer-well well flex min-h-[52px] items-end gap-2 p-1.5 pl-1">
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            data-testid="composer-file-input"
            tabIndex={-1}
            onChange={(e) => {
              const list = Array.from(e.currentTarget.files ?? []);
              e.currentTarget.value = '';
              if (list.length > 0) files.add(list);
              ref.current?.focus();
            }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={noModel || readOnly}
            aria-label={s.attach}
            title={s.attachTitle}
            data-testid="composer-attach"
            className="key-ghost inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink disabled:opacity-50"
          >
            <Paperclip size={20} aria-hidden />
          </button>
          <label htmlFor="composer-input" className="sr-only">
            {s.message}
          </label>
          <textarea
            id="composer-input"
            data-testid="composer-input"
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart);
              setActive(0);
              setMentionOff(false);
              setSlashOff(false);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files);
              if (pasted.length === 0) return;
              e.preventDefault();
              files.add(pasted);
            }}
            // A plain text box until a list is open: a combobox that never opens is noise (W-30).
            {...(showList
              ? {
                  role: 'combobox',
                  'aria-expanded': true,
                  'aria-controls': listId,
                  'aria-autocomplete': 'list' as const,
                  'aria-haspopup': 'listbox' as const,
                  'aria-activedescendant': `${listId}-${Math.min(active, listCount - 1)}`,
                }
              : {})}
            placeholder={
              readOnly
                ? chatStrings().conversations.placeholder
                : composerPlaceholder({
                    name: agent.name,
                    halted,
                    offline,
                    noModel,
                    question,
                    wide,
                    keyboard: wide && keyboard,
                  })
            }
            disabled={noModel || readOnly}
            className="scroll-soft max-h-[168px] min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-large leading-6 text-ink placeholder:text-ink-muted focus:outline-none disabled:cursor-not-allowed"
          />
          {showStop && (
            <Button
              variant="dangerSoft"
              onClick={() => void stop()}
              disabled={stopping}
              aria-label={s.stopLabel(agent.name)}
              aria-keyshortcuts="Control+Shift+Backspace Meta+Shift+Backspace"
              aria-busy={stopping}
              title={stopping ? s.stopping : s.stopHint(mac)}
              data-testid="composer-stop"
              className="label h-10 shrink-0 gap-2 px-3.5 text-micro font-semibold disabled:opacity-60"
            >
              <Stop size={15} weight="fill" aria-hidden />
              {stopping ? s.stopping : s.stop}
            </Button>
          )}
          {showSend && (
            <Button
              variant={ready ? 'primary' : 'secondary'}
              onClick={() => void submit()}
              disabled={!ready}
              aria-label={answering ? s.sendAnswer : showStop ? s.sendQueued : s.send}
              title={offline ? s.sendOffline : undefined}
              aria-keyshortcuts="Enter"
              data-testid="composer-send"
              className="label h-10 shrink-0 gap-2 px-4 text-micro font-semibold disabled:opacity-60"
            >
              <span className="max-sm:hidden">{s.send}</span> <span aria-hidden>↵</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
