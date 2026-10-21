import { Plus, Robot, UserPlus } from '@phosphor-icons/react';
import {
  extractTelegramToken,
  TELEGRAM_BOT_DAILY_MAX,
  telegramTokenShapeMessage,
  type TelegramBotChat,
  type TelegramBotPerson,
  type TelegramBotView,
  type TelegramView,
} from '@monsters/shared';
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { domId } from '../../lib/utils.ts';
import { getApi, notify, useApp } from '../../store/app.ts';
import { useAgents, type AgentView } from '../../store/hooks.ts';
import { useProjects } from '../../store/projects.ts';
import { Button } from '../ui/button.tsx';
import { Switch } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
import { partsStrings } from './parts.strings.ts';
import { telegramStrings } from './telegram.strings.ts';
import {
  ConfirmButton,
  fieldOnGroup,
  FormField,
  Group,
  Row,
  RowBody,
  selectClass,
} from './parts.tsx';

/*
 * Settings → Connections → Telegram, second kind of entry (D-107): bots
 * dedicated to one monster, each with its own token, to put in a group of
 * Telegram. Who may talk to it: the paired accounts (the user, always) and the
 * people approved here; which chats: private ones with them and the groups
 * approved here. The approvals of the monster (brake cards, drafts, spend
 * over the cap) never go to the group: they reach the user on the main bot,
 * in private, and in the app.
 */

/**
 * A paste into a token field: the token alone, also when the clipboard has BotFather's whole
 * message (a one-line field would glue or drop its line breaks). Anything else pastes as usual.
 */
export function pasteTelegramToken(set: (token: string) => void) {
  return (e: ClipboardEvent<HTMLInputElement>) => {
    const token = extractTelegramToken(e.clipboardData.getData('text'));
    if (!token) return;
    e.preventDefault();
    set(token);
  };
}

// i18n-ignore: the commands a group bot understands are identifiers, not copy
const GROUP_COMMANDS = ['/stato', '/join', '/aiuto'];
const JOIN = '/join';

/** Commands as code tags, apart by commas. */
export function CommandList({ commands }: { commands: readonly string[] }): ReactNode {
  return commands.map((c, i) => (
    <span key={c}>
      {i > 0 && ', '}
      <code>{c}</code>
    </span>
  ));
}

/** "Calypso · Saturday’s social", "Rhea · Personal squad". */
function useMonsterLabel(): (id: string) => string {
  const agents = useAgents();
  const projects = useProjects();
  return useMemo(() => {
    const names = new Map(agents.map((a) => [a.id, a]));
    const projectName = (id: string) => projects?.find((p) => p.id === id)?.name ?? id;
    return (id: string) => {
      const a = names.get(id);
      if (!a) return id;
      return `${a.name} · ${a.project ? projectName(a.project) : telegramStrings().bots.personalSquad}`;
    };
  }, [agents, projects]);
}

/** The monsters a bot can be dedicated to: everyone but the God (he has the main bot). */
function useCandidates(): AgentView[] {
  const agents = useAgents();
  return useMemo(() => agents.filter((a) => !a.isOrchestrator), [agents]);
}

/**
 * Id of the latest event of a dedicated bot (a group added, a `/join`): the
 * list is read again when it changes, without polling.
 */
function useBotEventMark(): string | null {
  return useApp((s) => {
    const evs = s.events;
    for (let i = evs.length - 1; i >= 0 && i >= evs.length - 300; i--) {
      const e = evs[i]!;
      if (e.type === 'channel' && e.data.bot) return e.id;
    }
    return null;
  });
}

type ToolRisks = NonNullable<TelegramView['toolRisks']>;
type ToolRisk = ToolRisks[string];

/** "the Terminal and connected apps": what a monster can do beyond notes and web (D-114). */
function riskWords(risk: ToolRisk): string {
  const s = telegramStrings().bots;
  if (risk.terminal && risk.programs) return s.riskTerminalAndApps;
  return risk.terminal ? s.riskTerminal : s.riskApps;
}

/** The warning when a bot is (or is about to be) dedicated to a monster that can do more. */
function RiskNote({ name, risk, testId }: { name: string; risk: ToolRisk; testId: string }) {
  return (
    <p
      className="rounded-[10px] px-3 py-2 text-footnote leading-snug text-signal-ink shadow-[inset_0_0_0_1px_var(--seam)]"
      role="note"
      data-testid={testId}
    >
      {telegramStrings().bots.riskNote(name, riskWords(risk))}
    </p>
  );
}

/**
 * "Strumenti per gli altri" (D-114): the people of the bot's chats who are not the user work
 * with fewer tools; turned on bot by bot, after a clear warning.
 */
function ToolsForOthers({
  bot,
  monster,
  risk,
  busy,
  act,
}: {
  bot: TelegramBotView;
  monster: string;
  risk: ToolRisk | undefined;
  busy: boolean;
  act: (job: () => Promise<TelegramView>, done?: string) => Promise<boolean>;
}) {
  const s = telegramStrings().bots;
  const common = partsStrings();
  const [asking, setAsking] = useState(false);
  const set = (fullTools: boolean) =>
    void act(
      () => getApi().updateTelegramBot(bot.id, { fullTools }),
      fullTools ? s.toolsOn(bot.bot.username, monster) : s.toolsOff(bot.bot.username),
    );
  return (
    <div className="grid gap-1.5" data-testid="telegram-bot-tools">
      <h4 className="label text-ink-muted">{s.toolsTitle}</h4>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Switch
          checked={bot.fullTools}
          disabled={busy || asking}
          words
          label={s.toolsLabel(monster, bot.bot.username)}
          onCheckedChange={(on) => (on ? setAsking(true) : set(false))}
        />
        <span className="min-w-[min(100%,240px)] flex-1 text-footnote leading-snug text-ink-muted">
          {bot.fullTools
            ? s.toolsOnState(monster, risk ? riskWords(risk) : null)
            : s.toolsOffState(s.reducedTools)}
        </span>
      </span>
      {asking && (
        <span
          className="flex flex-wrap items-center gap-1.5"
          role="alert"
          data-testid="telegram-bot-tools-confirm"
        >
          <span className="text-footnote text-stop-ink">
            {s.toolsConfirm(monster, risk ? riskWords(risk) : null)}
          </span>
          <Button
            variant="dangerSoft"
            size="sm"
            disabled={busy}
            onClick={() => {
              setAsking(false);
              set(true);
            }}
          >
            {s.toolsYes}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
            {common.cancel}
          </Button>
        </span>
      )}
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="rounded-[5px] bg-well px-1 font-mono text-[0.9em] text-ink">{children}</code>
  );
}

function AddBotForm({
  known,
  risks,
  onSaved,
  onCancel,
  errorOf,
}: {
  /** Ids of the bots already there: the new one is the other. */
  known: readonly string[];
  risks: ToolRisks;
  onSaved: (v: TelegramView) => void;
  onCancel: () => void;
  errorOf: (err: unknown) => string;
}) {
  const s = telegramStrings();
  const b = s.bots;
  const common = partsStrings();
  const ids = domId(useId());
  const candidates = useCandidates();
  const label = useMonsterLabel();
  const [token, setToken] = useState('');
  const [agent, setAgent] = useState('');
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const pasted = extractTelegramToken(token);
    if (!pasted) {
      setError(telegramTokenShapeMessage());
      return;
    }
    if (!agent) {
      setError(b.chooseMonster);
      return;
    }
    const n = limit.trim() ? Number(limit) : undefined;
    if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > TELEGRAM_BOT_DAILY_MAX)) {
      setError(b.limitInvalid(TELEGRAM_BOT_DAILY_MAX));
      return;
    }
    setSaving(true);
    try {
      const before = new Set(known);
      const view = await getApi().createTelegramBot({
        token: pasted,
        agent,
        ...(n !== undefined ? { dailyLimit: n } : {}),
      });
      const added = view.bots.find((b) => b.agent === agent && !before.has(b.id));
      setToken('');
      onSaved(view);
      notify(b.addedTo(added?.bot.username, label(agent).split(' · ')[0]!), 'success');
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate data-testid="telegram-bot-form">
      <RowBody>
        <ol className="grid list-decimal gap-1 pl-5 text-footnote leading-snug text-ink-muted">
          <li>
            {b.form.step1.before}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-ink underline underline-offset-2"
            >
              {'@BotFather'}
            </a>
            {b.form.step1.mid}
            <Code>{'/newbot'}</Code>
            {b.form.step1.after}
          </li>
          <li>
            {b.form.step2.before}
            <Code>{'/setprivacy'}</Code>
            {b.form.step2.mid}
            <b>{'Enable'}</b>
            {b.form.step2.after}
          </li>
          <li>{b.form.step3}</li>
          <li>
            {b.form.step4.before}
            <Code>{JOIN}</Code>
            {b.form.step4.after}
          </li>
        </ol>
        <FormField id={`${ids}-token`} label={s.tokenLabel} error={error} hint={s.tokenHint}>
          <Input
            id={`${ids}-token`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            // i18n-ignore: an example value, not copy
            placeholder="123456789:AAH…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onPaste={pasteTelegramToken(setToken)}
            className={fieldOnGroup}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-token-error` : `${ids}-token-hint`}
          />
        </FormField>
        <FormField id={`${ids}-agent`} label={b.form.agent} hint={b.form.agentHint}>
          <select
            id={`${ids}-agent`}
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className={`${selectClass} w-full sm:w-[340px]`}
            data-testid="telegram-bot-agent"
          >
            <option value="" disabled>
              {b.form.chooseOption}
            </option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {label(a.id)}
              </option>
            ))}
          </select>
        </FormField>
        {agent && risks[agent] && (
          <RiskNote
            name={label(agent).split(' · ')[0]!}
            risk={risks[agent]}
            testId="telegram-bot-risk-new"
          />
        )}
        <FormField id={`${ids}-limit`} label={b.form.limit} hint={b.form.limitHint}>
          <Input
            id={`${ids}-limit`}
            inputMode="numeric"
            placeholder={b.form.limitPlaceholder}
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ''))}
            className={`${fieldOnGroup} w-36 tabular-nums`}
          />
        </FormField>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving || !token.trim()}>
            {saving ? s.checking : s.connectBot}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {common.cancel}
          </Button>
        </div>
      </RowBody>
    </form>
  );
}

function ChatLine({
  chat,
  busy,
  onApprove,
  onRemove,
}: {
  chat: TelegramBotChat;
  busy: boolean;
  onApprove: () => void;
  onRemove: () => void;
}) {
  const s = telegramStrings().bots;
  const pending = chat.status === 'pending';
  return (
    <li
      className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1.5"
      data-testid="telegram-bot-chat"
      data-status={chat.status}
    >
      <span className="min-w-0 flex-1 text-body text-ink">
        {chat.title}
        <span className="text-footnote text-ink-muted">{pending ? s.toApprove : s.approved}</span>
      </span>
      <span className="flex gap-1.5">
        {pending && (
          <Button
            size="sm"
            disabled={busy}
            onClick={onApprove}
            aria-label={s.approveLabel(chat.title)}
          >
            {s.approve}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onRemove}
          aria-label={s.rejectOrRemove(pending, chat.title)}
        >
          {pending ? s.reject : s.remove}
        </Button>
      </span>
    </li>
  );
}

function PersonLine({
  person,
  busy,
  onApprove,
  onRemove,
}: {
  person: TelegramBotPerson;
  busy: boolean;
  onApprove: () => void;
  onRemove: () => void;
}) {
  const s = telegramStrings().bots;
  const pending = person.status === 'pending';
  const note = person.owner ? s.youNote : pending ? s.pendingNote(JOIN) : '';
  return (
    <li
      className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1.5"
      data-testid="telegram-bot-person"
      data-status={person.status}
      data-owner={person.owner ? 'true' : undefined}
    >
      <span className="min-w-0 flex-1 text-body text-ink">
        {person.name}
        {person.username ? <span className="text-ink-muted"> · @{person.username}</span> : null}
        <span className="text-footnote text-ink-muted">{note}</span>
      </span>
      {!person.owner && (
        <span className="flex gap-1.5">
          {pending && (
            <Button
              size="sm"
              disabled={busy}
              onClick={onApprove}
              aria-label={s.approveLabel(person.name)}
            >
              {s.approve}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onRemove}
            aria-label={s.rejectOrRemove(pending, person.name)}
          >
            {pending ? s.reject : s.remove}
          </Button>
        </span>
      )}
    </li>
  );
}

function AddPerson({ onAdd, busy }: { onAdd: (id: number) => Promise<boolean>; busy: boolean }) {
  const s = telegramStrings().bots;
  const id = domId(useId());
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) {
      setError(s.idInvalid);
      return;
    }
    setError(null);
    if (await onAdd(n)) setValue('');
  };
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-1.5">
      <label htmlFor={id} className="text-footnote font-medium text-ink">
        {s.addById}
      </label>
      <span className="flex flex-wrap gap-2">
        <Input
          id={id}
          inputMode="numeric"
          placeholder="123456789"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
          className={`${fieldOnGroup} h-10 w-44 tabular-nums`}
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={busy || !value}>
          <UserPlus size={16} aria-hidden />
          {s.add}
        </Button>
      </span>
      {error && (
        <p className="text-footnote text-stop-ink" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** "Change the token": the same bot with a token BotFather issued again (after `/revoke`). */
function ChangeToken({
  bot,
  busy,
  act,
  onClose,
}: {
  bot: TelegramBotView;
  busy: boolean;
  act: (job: () => Promise<TelegramView>, done?: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const s = telegramStrings().bots;
  const common = partsStrings();
  const id = domId(useId());
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const token = extractTelegramToken(value);
    if (!token) {
      setError(telegramTokenShapeMessage());
      return;
    }
    setError(null);
    const ok = await act(
      () => getApi().changeTelegramBotToken(bot.id, { token }),
      s.tokenChanged(bot.bot.username),
    );
    if (ok) onClose();
  };
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => void submit(e)}
      noValidate
      data-testid="telegram-bot-token-form"
    >
      <FormField id={id} label={s.newToken(bot.bot.username)} error={error} hint={s.newTokenHint}>
        <Input
          id={id}
          type="password"
          value={value}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onPaste={pasteTelegramToken(setValue)}
          aria-invalid={error ? true : undefined}
          className={`${fieldOnGroup} font-mono text-footnote`}
        />
      </FormField>
      <span className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !value.trim()}>
          {s.saveRestart}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          {common.cancel}
        </Button>
      </span>
    </form>
  );
}

function BotEntry({
  bot,
  risk,
  busy,
  act,
}: {
  bot: TelegramBotView;
  risk: ToolRisk | undefined;
  busy: boolean;
  act: (job: () => Promise<TelegramView>, done?: string) => Promise<boolean>;
}) {
  const s = telegramStrings();
  const b = s.bots;
  const label = useMonsterLabel();
  const monster = label(bot.agent);
  const monsterName = monster.split(' · ')[0]!;
  const api = getApi();
  const tone = bot.status === 'online' ? 'ok' : bot.status === 'off' ? undefined : 'stop';
  const pendingChats = bot.chats.filter((c) => c.status === 'pending').length;
  const pendingPeople = bot.people.filter((p) => p.status === 'pending').length;
  const pending = pendingChats + pendingPeople;
  const [changing, setChanging] = useState(false);
  return (
    <li data-testid="telegram-bot" data-bot={bot.id} data-status={bot.status}>
      <Row
        leading={
          <span
            className="well flex size-8 items-center justify-center rounded-[8px] text-ink-muted"
            aria-hidden
          >
            <Robot size={18} />
          </span>
        }
        label={
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium" data-testid="telegram-bot-username">
              @{bot.bot.username}
            </span>
            {pending > 0 && (
              <span className="label rounded-[5px] px-1.5 py-px text-signal-ink shadow-[inset_0_0_0_1px_var(--seam)]">
                {b.toApproveCount(pending)}
              </span>
            )}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-1.5">
            <span data-testid="telegram-bot-monster">{monster}</span>
            <span aria-hidden>·</span>
            <span className="flex items-center gap-1.5" data-testid="telegram-bot-status">
              <span className="led" data-tone={tone} aria-hidden />
              {bot.error ?? s.botStatus[bot.status]}
            </span>
          </span>
        }
        wrap
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => setChanging((v) => !v)}
          data-testid="telegram-bot-change-token"
        >
          {b.changeToken}
        </Button>
        <ConfirmButton
          label={b.removeBot}
          question={b.removeQuestion(bot.bot.username)}
          confirm={b.removeConfirm}
          busy={busy}
          onConfirm={() =>
            void act(() => api.removeTelegramBot(bot.id), b.removedBot(bot.bot.username))
          }
        />
      </Row>
      <RowBody className="set-seam-t gap-4">
        {changing && (
          <ChangeToken bot={bot} busy={busy} act={act} onClose={() => setChanging(false)} />
        )}
        {risk && !bot.fullTools && (
          <RiskNote name={monsterName} risk={risk} testId="telegram-bot-risk" />
        )}
        <div className="grid gap-1">
          <h4 className="label text-ink-muted">{b.groups}</h4>
          {bot.chats.length === 0 ? (
            <p className="text-footnote leading-snug text-ink-muted">
              {b.noGroups(bot.bot.username)}
            </p>
          ) : (
            <ul className="grid" aria-label={b.groupsOf(bot.bot.username)}>
              {bot.chats.map((c) => (
                <ChatLine
                  key={c.id}
                  chat={c}
                  busy={busy}
                  onApprove={() =>
                    void act(
                      () => api.approveTelegramBotChat(bot.id, c.id),
                      b.groupApproved(c.title),
                    )
                  }
                  onRemove={() =>
                    void act(
                      () => api.removeTelegramBotChat(bot.id, c.id),
                      c.status === 'pending' ? b.groupRejected(c.title) : b.groupRemoved(c.title),
                    )
                  }
                />
              ))}
            </ul>
          )}
        </div>
        <div className="grid gap-1">
          <h4 className="label text-ink-muted">{b.whoCanTalk}</h4>
          {bot.people.length === 0 && (
            <p className="text-footnote leading-snug text-ink-muted">{b.noPeople}</p>
          )}
          <ul className="grid" aria-label={b.peopleOf(bot.bot.username)}>
            {bot.people.map((p) => (
              <PersonLine
                key={p.id}
                person={p}
                busy={busy}
                onApprove={() =>
                  void act(
                    () => api.approveTelegramBotPerson(bot.id, p.id),
                    b.personApproved(p.name, bot.bot.username),
                  )
                }
                onRemove={() =>
                  void act(
                    () => api.removeTelegramBotPerson(bot.id, p.id),
                    b.personRemoved(p.name, bot.bot.username),
                  )
                }
              />
            ))}
          </ul>
          <p className="text-footnote leading-snug text-ink-muted">
            {b.othersBefore}
            <Code>{JOIN}</Code>
            {b.othersAfter}
          </p>
          <AddPerson
            busy={busy}
            onAdd={(id) => act(() => api.addTelegramBotPerson(bot.id, { id }), b.personAdded)}
          />
        </div>
        <ToolsForOthers bot={bot} monster={monsterName} risk={risk} busy={busy} act={act} />
        <p className="text-footnote text-ink-muted" data-testid="telegram-bot-today">
          {b.today(bot.today, bot.dailyLimit)}
        </p>
      </RowBody>
    </li>
  );
}

export function TelegramBotsSection({
  view,
  setView,
  reload,
  errorOf,
}: {
  view: TelegramView;
  setView: (v: TelegramView) => void;
  reload: () => void;
  errorOf: (err: unknown) => string;
}) {
  const b = telegramStrings().bots;
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const mark = useBotEventMark();
  // A group added, a `/join`: the core logged it, read the list again.
  useEffect(() => {
    if (mark) reload();
  }, [mark, reload]);

  const act = async (job: () => Promise<TelegramView>, done?: string): Promise<boolean> => {
    setBusy(true);
    try {
      setView(await job());
      if (done) notify(done, 'success');
      return true;
    } catch (err) {
      notify(errorOf(err), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group
      title={b.title}
      level={3}
      as="ul"
      testId="telegram-bots"
      description={b.description}
      footer={
        <>
          {b.footer}
          <CommandList commands={GROUP_COMMANDS} />.
        </>
      }
    >
      {view.bots.length === 0 && !adding && <Row as="li" label={b.none} description={b.noneText} />}
      {view.bots.map((b) => (
        <BotEntry key={b.id} bot={b} risk={view.toolRisks?.[b.agent]} busy={busy} act={act} />
      ))}
      <li>
        {adding ? (
          <AddBotForm
            known={view.bots.map((b) => b.id)}
            risks={view.toolRisks ?? {}}
            errorOf={errorOf}
            onSaved={(v) => {
              setAdding(false);
              setView(v);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setAdding(true)}
            className="row-key flex min-h-[52px] w-full items-center gap-2.5 px-4 text-left text-body font-medium text-ink [&_svg]:text-signal-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
          >
            <Plus size={18} aria-hidden />
            {b.addButton}
          </button>
        )}
      </li>
    </Group>
  );
}
