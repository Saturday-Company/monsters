import { Plus, Robot, UserPlus } from '@phosphor-icons/react';
import {
  extractTelegramToken,
  TELEGRAM_BOT_DAILY_MAX,
  TELEGRAM_TOKEN_SHAPE_MESSAGE,
  type TelegramBotChat,
  type TelegramBotPerson,
  type TelegramBotView,
  type TelegramView,
} from '@monsters/shared';
import { useEffect, useId, useMemo, useState, type ClipboardEvent, type FormEvent } from 'react';
import { domId } from '../../lib/utils.ts';
import { getApi, notify, useApp } from '../../store/app.ts';
import { useAgents, type AgentView } from '../../store/hooks.ts';
import { useProjects } from '../../store/projects.ts';
import { Button } from '../ui/button.tsx';
import { Switch } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
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
 * Settings → Collegamenti → Telegram, second kind of entry (D-107): bots
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

const STATUS_TEXT: Record<TelegramBotView['status'], string> = {
  off: 'Spento.',
  connecting: 'Mi collego a Telegram…',
  online: 'Collegato.',
  retrying: 'Telegram non risponde: riprovo da solo.',
  conflict: 'Un altro programma usa questo bot: fermalo, o creane uno nuovo.',
  error: 'Fermo: serve il tuo intervento.',
};

/** "Calypso · Social di Saturday", "Rhea · Squadra personale". */
function useMonsterLabel(): (id: string) => string {
  const agents = useAgents();
  const projects = useProjects();
  return useMemo(() => {
    const names = new Map(agents.map((a) => [a.id, a]));
    const projectName = (id: string) => projects?.find((p) => p.id === id)?.name ?? id;
    return (id: string) => {
      const a = names.get(id);
      if (!a) return id;
      return `${a.name} · ${a.project ? projectName(a.project) : 'Squadra personale'}`;
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

/** "il Terminale e altri programmi": what a monster can do beyond notes and web (D-114). */
function riskWords(risk: ToolRisk): string {
  if (risk.terminal && risk.programs) return 'il Terminale e altri programmi collegati';
  return risk.terminal ? 'il Terminale' : 'altri programmi collegati';
}

/** What the people of a bot's chats who are not the user cannot do, by default (D-114). */
const REDUCED_TOOLS =
  'niente terminale né modifiche ai file, gli altri programmi solo con il tuo ok, nel vault solo l’area del progetto, quella del mostro e Inbox; una risposta che ripete note o chiavi resta a te';

/** The warning when a bot is (or is about to be) dedicated to a monster that can do more. */
function RiskNote({ name, risk, testId }: { name: string; risk: ToolRisk; testId: string }) {
  return (
    <p
      className="rounded-[10px] px-3 py-2 text-footnote leading-snug text-signal-ink shadow-[inset_0_0_0_1px_var(--seam)]"
      role="note"
      data-testid={testId}
    >
      {name} ha {riskWords(risk)}, che agiscono a nome tuo. Chi ammetti in questo bot non li usa
      finché non li riaccendi, sotto “Strumenti per gli altri”.
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
  const [asking, setAsking] = useState(false);
  const set = (fullTools: boolean) =>
    void act(
      () => getApi().updateTelegramBot(bot.id, { fullTools }),
      fullTools
        ? `Chi ammetti in @${bot.bot.username} usa tutti gli strumenti di ${monster}.`
        : `Chi ammetti in @${bot.bot.username} torna agli strumenti ridotti.`,
    );
  return (
    <div className="grid gap-1.5" data-testid="telegram-bot-tools">
      <h4 className="label text-ink-muted">Strumenti per gli altri</h4>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Switch
          checked={bot.fullTools}
          disabled={busy || asking}
          words
          label={`Tutti gli strumenti di ${monster} per chi ammetti in @${bot.bot.username}`}
          onCheckedChange={(on) => (on ? setAsking(true) : set(false))}
        />
        <span className="min-w-[min(100%,240px)] flex-1 text-footnote leading-snug text-ink-muted">
          {bot.fullTools
            ? `Acceso: chi ammetti usa tutto quello che ${monster} può fare, con i tuoi permessi${risk ? `, anche ${riskWords(risk)}` : ''}.`
            : `Spento: chi non sei tu lavora con meno strumenti (${REDUCED_TOOLS}).`}
        </span>
      </span>
      {asking && (
        <span
          className="flex flex-wrap items-center gap-1.5"
          role="alert"
          data-testid="telegram-bot-tools-confirm"
        >
          <span className="text-footnote text-stop-ink">
            Chi ammetti potrà usare {risk ? riskWords(risk) : 'tutti gli strumenti'} di {monster}{' '}
            come se fossi tu, e leggere tutto il vault tranne le note private. Accendo?
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
            Sì, accendi
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
            Annulla
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
      setError(TELEGRAM_TOKEN_SHAPE_MESSAGE);
      return;
    }
    if (!agent) {
      setError('Scegli il mostro che risponde da questo bot.');
      return;
    }
    const n = limit.trim() ? Number(limit) : undefined;
    if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > TELEGRAM_BOT_DAILY_MAX)) {
      setError(`Il limite è un numero intero tra 1 e ${TELEGRAM_BOT_DAILY_MAX}, o niente.`);
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
      notify(
        `Bot ${added ? `@${added.bot.username} ` : ''}collegato a ${label(agent).split(' · ')[0]}.`,
        'success',
      );
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
            Su Telegram apri{' '}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-ink underline underline-offset-2"
            >
              @BotFather
            </a>
            , scrivi <Code>/newbot</Code> e dagli un nome: ti dà il token.
          </li>
          <li>
            Sempre a BotFather: <Code>/setprivacy</Code>, scegli il bot, <b>Enable</b>. Nei gruppi
            il bot riceve solo i messaggi che lo nominano, le risposte ai suoi messaggi e i comandi.
          </li>
          <li>
            Un token lo usa un programma alla volta. Se oggi il bot è di un altro programma (per
            esempio un altro assistente già attivo nel gruppo), crea un bot nuovo o ferma prima quel
            programma.
          </li>
          <li>
            Aggiungi il bot al gruppo: compare qui sotto e lo approvi. Chi vuole parlargli scrive{' '}
            <Code>/join</Code> nel gruppo (o al bot in privato) e lo approvi qui.
          </li>
        </ol>
        <FormField
          id={`${ids}-token`}
          label="Codice del bot (token)"
          error={error}
          hint="Resta su questo computer, protetto: lo legge solo Monsters. Non lo mostriamo più."
        >
          <Input
            id={`${ids}-token`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="123456789:AAH…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onPaste={pasteTelegramToken(setToken)}
            className={fieldOnGroup}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-token-error` : `${ids}-token-hint`}
          />
        </FormField>
        <FormField
          id={`${ids}-agent`}
          label="Il mostro che risponde"
          hint="Parla solo lui: con @Nome non arriva agli altri mostri. Il tuo capo resta sul bot principale."
        >
          <select
            id={`${ids}-agent`}
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className={`${selectClass} w-full sm:w-[340px]`}
            data-testid="telegram-bot-agent"
          >
            <option value="" disabled>
              Scegli un mostro
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
        <FormField
          id={`${ids}-limit`}
          label="Messaggi al giorno (facoltativo)"
          hint="Oltre questo numero il bot risponde che per oggi ha finito. Vuoto: 100 al giorno."
        >
          <Input
            id={`${ids}-limit`}
            inputMode="numeric"
            placeholder="es. 200"
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ''))}
            className={`${fieldOnGroup} w-36 tabular-nums`}
          />
        </FormField>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving || !token.trim()}>
            {saving ? 'Controllo…' : 'Collega il bot'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Annulla
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
  const pending = chat.status === 'pending';
  return (
    <li
      className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1.5"
      data-testid="telegram-bot-chat"
      data-status={chat.status}
    >
      <span className="min-w-0 flex-1 text-body text-ink">
        {chat.title}
        <span className="text-footnote text-ink-muted">
          {pending ? ' · da approvare' : ' · approvato'}
        </span>
      </span>
      <span className="flex gap-1.5">
        {pending && (
          <Button
            size="sm"
            disabled={busy}
            onClick={onApprove}
            aria-label={`Approva ${chat.title}`}
          >
            Approva
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onRemove}
          aria-label={`${pending ? 'Rifiuta' : 'Togli'} ${chat.title}`}
        >
          {pending ? 'Rifiuta' : 'Togli'}
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
  const pending = person.status === 'pending';
  const note = person.owner
    ? ' · tu: le tue parole contano come tue, le approvazioni sono tue'
    : pending
      ? ' · ha chiesto con /join: da approvare'
      : '';
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
              aria-label={`Approva ${person.name}`}
            >
              Approva
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onRemove}
            aria-label={`${pending ? 'Rifiuta' : 'Togli'} ${person.name}`}
          >
            {pending ? 'Rifiuta' : 'Togli'}
          </Button>
        </span>
      )}
    </li>
  );
}

function AddPerson({ onAdd, busy }: { onAdd: (id: number) => Promise<boolean>; busy: boolean }) {
  const id = domId(useId());
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) {
      setError('L’ID di Telegram è un numero, come 123456789.');
      return;
    }
    setError(null);
    if (await onAdd(n)) setValue('');
  };
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-1.5">
      <label htmlFor={id} className="text-footnote font-medium text-ink">
        Aggiungi con l’ID di Telegram
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
          Aggiungi
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

/** "Cambia il token": the same bot with a token BotFather issued again (after `/revoke`). */
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
  const id = domId(useId());
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const token = extractTelegramToken(value);
    if (!token) {
      setError(TELEGRAM_TOKEN_SHAPE_MESSAGE);
      return;
    }
    setError(null);
    const ok = await act(
      () => getApi().changeTelegramBotToken(bot.id, { token }),
      `Token di @${bot.bot.username} cambiato: gruppi e persone restano.`,
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
      <FormField
        id={id}
        label={`Nuovo token di @${bot.bot.username}`}
        error={error}
        hint="Deve essere dello stesso bot (lo ha cambiato BotFather con /revoke). Gruppi e persone approvati restano."
      >
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
          Salva e riavvia
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          Annulla
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
                {pending === 1 ? '1 da approvare' : `${pending} da approvare`}
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
              {bot.error ?? STATUS_TEXT[bot.status]}
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
          Cambia il token
        </Button>
        <ConfirmButton
          label="Rimuovi bot"
          question={`Tolgo @${bot.bot.username}?`}
          confirm="Sì, togli"
          busy={busy}
          onConfirm={() =>
            void act(
              () => api.removeTelegramBot(bot.id),
              `@${bot.bot.username} non risponde più: il token è cancellato da Monsters.`,
            )
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
          <h4 className="label text-ink-muted">Gruppi</h4>
          {bot.chats.length === 0 ? (
            <p className="text-footnote leading-snug text-ink-muted">
              Nessun gruppo ancora: aggiungi @{bot.bot.username} al gruppo su Telegram, poi
              approvalo qui. Nei gruppi non approvati il bot non risponde.
            </p>
          ) : (
            <ul className="grid" aria-label={`Gruppi di @${bot.bot.username}`}>
              {bot.chats.map((c) => (
                <ChatLine
                  key={c.id}
                  chat={c}
                  busy={busy}
                  onApprove={() =>
                    void act(
                      () => api.approveTelegramBotChat(bot.id, c.id),
                      `Gruppo «${c.title}» approvato.`,
                    )
                  }
                  onRemove={() =>
                    void act(
                      () => api.removeTelegramBotChat(bot.id, c.id),
                      c.status === 'pending'
                        ? `Gruppo «${c.title}» rifiutato.`
                        : `Il bot non risponde più in «${c.title}».`,
                    )
                  }
                />
              ))}
            </ul>
          )}
        </div>
        <div className="grid gap-1">
          <h4 className="label text-ink-muted">Chi può parlargli</h4>
          {bot.people.length === 0 && (
            <p className="text-footnote leading-snug text-ink-muted">
              Collega il tuo account al bot principale qui sopra: le approvazioni arrivano lì.
            </p>
          )}
          <ul className="grid" aria-label={`Chi può parlare con @${bot.bot.username}`}>
            {bot.people.map((p) => (
              <PersonLine
                key={p.id}
                person={p}
                busy={busy}
                onApprove={() =>
                  void act(
                    () => api.approveTelegramBotPerson(bot.id, p.id),
                    `${p.name} può parlare con @${bot.bot.username}.`,
                  )
                }
                onRemove={() =>
                  void act(
                    () => api.removeTelegramBotPerson(bot.id, p.id),
                    `${p.name} non può più parlare con @${bot.bot.username}.`,
                  )
                }
              />
            ))}
          </ul>
          <p className="text-footnote leading-snug text-ink-muted">
            Gli altri scrivono <Code>/join</Code> nel gruppo, o al bot in privato: li trovi qui da
            approvare. I messaggi di chi non è ammesso vengono ignorati e finiscono in Attività.
          </p>
          <AddPerson
            busy={busy}
            onAdd={(id) => act(() => api.addTelegramBotPerson(bot.id, { id }), 'Persona aggiunta.')}
          />
        </div>
        <ToolsForOthers bot={bot} monster={monsterName} risk={risk} busy={busy} act={act} />
        <p className="text-footnote text-ink-muted" data-testid="telegram-bot-today">
          Messaggi di oggi: {bot.today}
          {` su ${bot.dailyLimit}`}
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
      title="Bot dedicati a un mostro"
      level={3}
      as="ul"
      testId="telegram-bots"
      description="Un bot tutto suo per un mostro, da mettere in un gruppo di Telegram: chi ammetti qui gli parla con @nome, rispondendo ai suoi messaggi o con un comando. Ogni bot ha il suo token."
      footer={
        <>
          Le cose che decidi tu (il freno su un’azione, le bozze di mostri, progetti e automazioni,
          la spesa oltre il tetto) non si approvano mai nel gruppo: arrivano a te in privato sul bot
          principale e nell’app. Nel gruppo, solo le parole tue contano come tue, e chi non sei tu
          lavora con meno strumenti finché non li riaccendi per quel bot. Dal gruppo:{' '}
          <code>/stato</code>, <code>/join</code>, <code>/aiuto</code>.
        </>
      }
    >
      {view.bots.length === 0 && !adding && (
        <Row
          as="li"
          label="Nessun bot dedicato"
          description="Ad esempio un mostro per il gruppo della squadra: note, compiti e progetti per tutti."
        />
      )}
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
            Aggiungi un bot per un mostro
          </button>
        )}
      </li>
    </Group>
  );
}
