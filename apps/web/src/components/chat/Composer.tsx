import {
  ArrowBendDownRight,
  At,
  Paperclip,
  PauseCircle,
  WifiSlash,
  X,
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
  useApp,
} from '../../store/app.ts';
import { draftOf, saveDraft } from '../../store/drafts.ts';
import { useAgents, useConnection, useMediaQuery, type AgentView } from '../../store/hooks.ts';
import { openChat } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { plainText } from '../../lib/markdown.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { Button, KeyCap } from '../ui/button.tsx';
import { keypadPick, lettersText } from './QuestionCard.tsx';
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
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(before);
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, query: m[2]!.toLowerCase() };
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
 * that chat, where the answer will come. With an open question it answers it;
 * while the monsters are stopped the message waits for "Riprendi"; without a
 * model it is off.
 */
export function Composer({
  agent,
  question = null,
  noModel = false,
}: {
  agent: AgentView;
  question?: ComposerQuestion | null;
  noModel?: boolean;
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
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Where the caret goes once a text set by the code is in the field (see the layout effect). */
  const pendingCaret = useRef<number | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const files = useAttachments(agent.id);
  const attaching = files.items.length > 0;

  const mq = mentionOff ? null : mentionQuery(text, caret);
  const suggestions = useMemo(
    () =>
      mq
        ? agents
            .filter((a) => a.name.toLowerCase().startsWith(mq.query) || a.id.startsWith(mq.query))
            // In a project's chat its own monsters come first (D-100).
            .sort(
              (a, b) =>
                Number((b.project ?? '') === (agent.project ?? '')) -
                Number((a.project ?? '') === (agent.project ?? '')),
            )
        : [],
    [agents, mq, agent.project],
  );
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
  // A letter of the keypad alone: Enter picks that option, with the moment to undo it (V-1).
  const pickAt = answering && question.picks ? keypadPick(text, question.picks.length) : null;
  const pick = pickAt !== null ? question?.picks?.[pickAt] : undefined;

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

  const submit = async () => {
    const t = text.trim();
    const sent = files.ready.map((m) => m.id);
    if ((!t && sent.length === 0) || sending || noModel || offline || files.uploading) return;
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
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + d + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(suggestions[Math.min(active, suggestions.length - 1)]!);
        return;
      }
      if (e.key === 'Escape') {
        setMentionOff(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const listId = 'mention-list';
  const ready =
    (!!text.trim() || files.ready.length > 0) &&
    !sending &&
    !noModel &&
    !offline &&
    !files.uploading;
  const showList = suggestions.length > 0;

  return (
    <div className="relative">
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={s.pickMonster}
          className="popover rise-in absolute bottom-full left-0 z-40 mb-2 w-[min(360px,100%)] overflow-hidden rounded-[14px] p-1.5"
        >
          <li role="presentation" className="label px-2.5 pt-1.5 pb-1 text-ink-muted">
            {s.writeTo}
          </li>
          {suggestions.map((a, i) => (
            <li key={a.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickMention(a)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-left',
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
          ))}
        </ul>
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
        {canAnswer && text.trim() && !mentioning && (
          <p
            className="flex items-center gap-1.5 px-1.5 text-footnote text-ink-muted"
            data-testid={answering ? 'composer-answering' : 'composer-not-answering'}
          >
            {answering ? (
              <>
                <ArrowBendDownRight size={16} weight="bold" aria-hidden />
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
                    className="key ml-0.5 inline-flex size-6 items-center justify-center rounded-[6px] text-ink-muted hover:text-ink"
                  >
                    <X size={11} weight="bold" aria-hidden />
                  </button>
                )}
              </>
            ) : (
              <>
                <span>{s.normalMessage(question.from)}</span>
                <button
                  type="button"
                  onClick={() => setNotAnswerTo(null)}
                  className="font-medium text-signal-ink hover:underline"
                >
                  {s.itIsAnswer}
                </button>
              </>
            )}
          </p>
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
            disabled={noModel}
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
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart);
              setActive(0);
              setMentionOff(false);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files);
              if (pasted.length === 0) return;
              e.preventDefault();
              files.add(pasted);
            }}
            role="combobox"
            aria-expanded={showList}
            aria-controls={showList ? listId : undefined}
            aria-autocomplete="list"
            placeholder={composerPlaceholder({
              name: agent.name,
              halted,
              offline,
              noModel,
              question,
              wide,
              keyboard: wide && keyboard,
            })}
            disabled={noModel}
            className="scroll-soft max-h-[168px] min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-large leading-6 text-ink placeholder:text-ink-muted focus:outline-none disabled:cursor-not-allowed"
          />
          <Button
            variant={ready ? 'primary' : 'secondary'}
            onClick={() => void submit()}
            disabled={!ready}
            aria-label={answering ? s.sendAnswer : s.send}
            title={offline ? s.sendOffline : undefined}
            aria-keyshortcuts="Enter"
            className="label h-10 shrink-0 gap-2 px-4 text-micro font-semibold disabled:opacity-60"
          >
            <span className="max-sm:hidden">{s.send}</span> <span aria-hidden>↵</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
