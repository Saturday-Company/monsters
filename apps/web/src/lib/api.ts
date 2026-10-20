import {
  ClaudeConnectionsResponseSchema,
  type ClaudeConnectionRequest,
  type ClaudeConnectionsResponse,
} from '@monsters/shared';
import { MemoryOwnResponseSchema, type MemoryOwnResponse } from '@monsters/shared';
import { LogArchiveStatusSchema, type LogArchiveStatus } from '@monsters/shared';
import {
  McpOAuthFinishResponseSchema,
  McpOAuthStartResponseSchema,
  McpServersResponseSchema,
  McpTestResponseSchema,
  type McpOAuthFinishResponse,
  type McpOAuthStartResponse,
  type McpServerRequest,
  type McpServersResponse,
  type McpTestResponse,
} from '@monsters/shared';
import {
  AgentModelsSchema,
  ChatGPTLoginResponseSchema,
  SubscriptionsResponseSchema,
  type ChatGPTLoginResponse,
  type SubscriptionsResponse,
  ProviderModelsResponseSchema,
  ProviderViewSchema,
  ProvidersResponseSchema,
  type AgentModels,
  type AutoModels,
  type ModelRefView,
  type ProviderModelsResponse,
  type ProviderView,
  type ProvidersResponse,
} from '@monsters/shared';
import {
  AgentSummarySchema,
  ApiErrorSchema,
  BraveKeyResponseSchema,
  LogEventSchema,
  MeResponseSchema,
  NewConversationResponseSchema,
  OpenRouterKeyResponseSchema,
  PermissionsResponseSchema,
  QuestionSchema,
  ResumeResponseSchema,
  SendMessageResponseSchema,
  SetupRequestSchema,
  SetupStatusResponseSchema,
  SettingsResponseSchema,
  type WebSearchSettingsRequest,
  StatusResponseSchema,
  UndoResponseSchema,
  type AgentSummary,
  type AnswerRequest,
  type BraveKeyResponse,
  type EventsQuery,
  type LogEvent,
  type MeResponse,
  type NewConversationResponse,
  type OpenRouterKeyResponse,
  type PermissionsResponse,
  type PermissionsUpdateRequest,
  type Question,
  type ResumeResponse,
  type SendMessageRequest,
  type SendMessageResponse,
  type SetupStatusResponse,
  type SettingsResponse,
  type StatusResponse,
  type UndoResponse,
} from '@monsters/shared';
import {
  AutomationRunDetailSchema,
  AutomationRunNowResponseSchema,
  AutomationRunSummarySchema,
  AutomationViewSchema,
  type AutomationCreate,
  type AutomationRunDetail,
  type AutomationRunNowResponse,
  type AutomationRunSummary,
  type AutomationUpdate,
  type AutomationView,
} from '@monsters/shared';
import {
  DraftConfirmResponseSchema,
  DraftViewSchema,
  type DraftConfirmResponse,
  type DraftKind,
  type DraftView,
} from '@monsters/shared';
import {
  ProjectSpendViewSchema,
  ProjectStopResponseSchema,
  ProjectViewSchema,
  type ProjectCreateRequest,
  type ProjectMemberRequest,
  type ProjectSpendView,
  type ProjectStopResponse,
  type ProjectUpdateRequest,
  type ProjectView,
} from '@monsters/shared';
import { DecisionsViewSchema, type DecisionEngine, type DecisionsView } from '@monsters/shared';
import { AgentUsageViewSchema, type AgentUsageView } from '@monsters/shared';
import {
  InstinctViewSchema,
  SpendViewSchema,
  type SpendUpdate,
  type SpendView,
  ReceiptSchema,
  ScorecardViewSchema,
  UndoRunResultSchema,
  type InstinctUpdate,
  type InstinctView,
  type Receipt,
  type ScorecardView,
  type UndoRunResult,
} from '@monsters/shared';
import {
  TelegramPairingSchema,
  TelegramViewSchema,
  type TelegramBotCreateRequest,
  type TelegramBotPersonRequest,
  type TelegramBotUpdateRequest,
  type TelegramTokenRequest,
  type TelegramPairing,
  type TelegramPrefsUpdate,
  type TelegramView,
} from '@monsters/shared';
import {
  PasswordChangeResponseSchema,
  ProfileViewSchema,
  TeamArchiveResponseSchema,
  TeamDraftSchema,
  TeamLooksResponseSchema,
  TeamMemberViewSchema,
  TeamSuggestionsSchema,
  TeamViewSchema,
  type PasswordChangeResponse,
  type ProfileUpdate,
  type ProfileView,
  type TeamArchiveResponse,
  type TeamDraft,
  type TeamDraftRequest,
  type TeamLooksRequest,
  type TeamLooksResponse,
  type TeamMemberCreateRequest,
  type TeamMemberUpdate,
  type TeamMemberView,
  type TeamSuggestions,
  type TeamView,
} from '@monsters/shared';
import { z } from 'zod';
import { desktop } from './desktop.ts';
import { adoptSessionSecret, forgetSessionSecret } from './session-secret.ts';
import { NetworkError, type RawResponse, type Transport } from './transport.ts';
import {
  FILE_TICKET_PARAM,
  FileListSchema,
  FileMetaSchema,
  FileTextSchema,
  FileTicketResponseSchema,
  SessionResponseSchema,
  type FileTicketResponse,
  type FileListQuery,
  type FileMeta,
  type FileText,
} from '@monsters/shared';

/** Setup body: the shared schema, with the one-time code trimmed (it is copied from a terminal). */
export const SetupBodySchema = SetupRequestSchema.extend({
  setupCode: z.string().trim().min(1).max(64),
});
export type SetupBody = z.infer<typeof SetupBodySchema>;

/**
 * Inside the desktop app the window keeps the cookie in a session of its own (D-044): the core
 * opens its sessions without a secret (S-B13), as before.
 */
function partitioned(): { partitioned?: true } {
  return desktop() ? { partitioned: true } : {};
}

const EventsResponseSchema = z.object({ events: z.array(z.unknown()) });
const OkSchema = z.looseObject({ ok: z.boolean() });

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** `conflict` of an undo: the files changed after the action. */
  readonly files: string[] | undefined;
  constructor(status: number, code: string, message?: string, files?: string[]) {
    super(message ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.files = files;
  }
}

/** Friendly Italian text for an error, ready to show in the UI. */
export function describeError(err: unknown): string {
  if (err instanceof NetworkError) return 'Non riesco a raggiungere Monsters. È acceso?';
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_credentials':
        return 'Email o password non corrette.';
      case 'too_many_attempts':
        return 'Troppi tentativi. Aspetta un minuto e riprova.';
      case 'already_configured':
        return 'Monsters è già configurato: accedi con il tuo account.';
      case 'invalid_setup_code':
        return 'Il codice non è giusto. Lo trovi nel terminale dove hai avviato Monsters.';
      case 'unauthorized':
        return 'La sessione è scaduta. Accedi di nuovo.';
      case 'owner_required':
        return 'Questa la decidi solo tu: serve la tua password (o rispondi dal tuo Telegram).';
      case 'confirm_required':
        return 'Per questa serve di nuovo la tua password.';
      case 'session_secret_required':
        return 'Questa scheda non ha la chiave della sessione: accedi di nuovo.';
      case 'wrong_password':
        return err.message && err.message !== err.code ? err.message : 'La password non è giusta.';
      case 'halted':
        return 'I mostri sono fermi. Premi “Riprendi” per farli ripartire.';
      case 'no_provider':
        return 'Manca un modello: aggiungi una chiave in Impostazioni → Modelli e scegli il modello del mostro.';
      case 'key_from_env':
      case 'not_configured':
      case 'unknown_provider':
        return err.message && err.message !== err.code
          ? err.message
          : 'Questo provider non è collegato.';
      case 'invalid_key':
        return 'OpenRouter non riconosce questa chiave. Controlla di averla copiata tutta.';
      case 'invalid_token':
        return 'Telegram non riconosce questo token. Copialo di nuovo da @BotFather.';
      case 'token_from_env':
      case 'no_token':
        return err.message && err.message !== err.code
          ? err.message
          : 'Collega prima il bot con il suo token.';
      case 'bot_in_use':
        return err.message && err.message !== err.code
          ? err.message
          : 'Questo bot è già collegato a Monsters: per un altro mostro crea un bot nuovo con @BotFather.';
      case 'invalid_agent':
        return err.message && err.message !== err.code
          ? err.message
          : 'Scegli un mostro della squadra: il tuo capo parla già con il bot principale.';
      case 'owner':
        return err.message && err.message !== err.code
          ? err.message
          : 'Il tuo account resta sempre: è quello che approva.';
      case 'verification_failed':
        return 'Non riesco a verificare la chiave con OpenRouter. Controlla la connessione e riprova.';
      case 'busy':
        return err.message && err.message !== err.code
          ? err.message
          : 'Qualcuno sta ancora lavorando: aspetta che finisca o fermalo, poi riprova.';
      case 'unknown_agent':
        return 'Non c’è nessun mostro con questo nome nella squadra.';
      case 'not_open':
        return 'Questa domanda non aspetta più una risposta.';
      case 'conflict':
        return 'La nota è cambiata dopo questa modifica: annullarla cancellerebbe il lavoro fatto dopo.';
      case 'invalid_input':
        return err.message && /already undone/.test(err.message)
          ? 'Questa modifica è già stata annullata.'
          : 'Non posso farlo con questi dati.';
      case 'not_found':
        return 'Non lo trovo: forse non esiste più.';
      case 'invalid_server':
      case 'unknown_server':
        return err.message && err.message !== err.code
          ? err.message
          : 'Questo server non si può salvare così.';
      case 'invalid_folder':
        return err.message && err.message !== err.code
          ? err.message
          : 'Questa cartella non si può concedere.';
      case 'invalid_request':
        return err.message && err.message !== err.code
          ? `Qualcosa non va nei dati: ${err.message}`
          : 'Qualcosa non va nei dati inviati.';
      case 'invalid_response':
        return 'Il core ha risposto in un modo che non capisco.';
      case 'file_too_large':
        return 'Il file è troppo grande: al massimo 25 MB.';
      case 'unsupported_type':
        return err.message && err.message !== err.code
          ? err.message
          : 'Questo tipo di file non si può allegare.';
      case 'unknown_file':
        return 'Il file non c’è più.';
      case 'unknown_automation':
        return 'Questa automazione non c’è più.';
      case 'unknown_run':
        return 'Questo giro non c’è più.';
      case 'already_running':
        return 'C’è già un giro in corso: aspetta che finisca.';
      case 'draft':
        return 'È ancora una bozza: confermala prima di farla girare.';
      case 'unknown_draft':
        return 'Questa bozza non c’è più.';
      case 'draft_closed':
        return 'Questa bozza è già stata confermata o lasciata stare.';
      case 'unknown_project':
        return 'Questo progetto non c’è più.';
      case 'name_taken':
      case 'invalid_name':
      case 'project_draft':
      case 'project_archived':
      case 'not_archived':
      case 'not_draft':
      case 'team_full':
      case 'color_too_close':
        return err.message && err.message !== err.code
          ? err.message
          : 'Non posso farlo con questo progetto, adesso.';
      case 'invalid_schedule':
        return err.message && err.message !== err.code
          ? `Non capisco quando: ${err.message.replace(/^quando:\s*/, '')}`
          : 'Non capisco quando deve girare.';
      default:
        return 'Qualcosa è andato storto. Riprova tra poco.';
    }
  }
  return 'Qualcosa è andato storto. Riprova tra poco.';
}

/** Keeps the events that match the schema; unknown or newer event types are skipped. */
export function parseEvents(raw: readonly unknown[]): LogEvent[] {
  const out: LogEvent[] = [];
  for (const item of raw) {
    const parsed = LogEventSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function toQuery(q: Partial<Record<string, string | number | undefined>>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Asks the user to type the password again, when the core says only the user in person may do
 * this (403 `owner_required`, review of 18/10, M1) or that the password is not recent enough for
 * it (403 `confirm_required`): true when they did and the request may go again. A session the
 * desktop app opened with the CLI token is not the user in person.
 */
export type ConfirmOwner = (reason: 'owner' | 'recent') => Promise<boolean>;

/** What the core answers when it wants the password again before a request. */
const CONFIRM_REASONS: Partial<Record<string, 'owner' | 'recent'>> = {
  owner_required: 'owner',
  confirm_required: 'recent',
};

/** Typed client of the core HTTP API (see packages/shared/src/api.ts). */
export class ApiClient {
  readonly transport: Transport;
  /** Set by the store: the password asked again, then the request once more. */
  confirmOwner: ConfirmOwner | null = null;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  private async call<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.infer<S>> {
    const res = await this.transport.request(method, path, body);
    const reason =
      res.status === 403
        ? CONFIRM_REASONS[ApiErrorSchema.safeParse(res.body).data?.error ?? '']
        : undefined;
    if (reason && this.confirmOwner && (await this.confirmOwner(reason))) {
      return this.parse(await this.transport.request(method, path, body), schema);
    }
    return this.parse(res, schema);
  }

  private parse<S extends z.ZodType>(res: RawResponse, schema: S): z.infer<S> {
    if (res.status < 200 || res.status >= 300) {
      const err = ApiErrorSchema.safeParse(res.body);
      throw new ApiError(
        res.status,
        err.success ? err.data.error : `http_${res.status}`,
        err.success ? err.data.message : undefined,
        err.success ? err.data.files : undefined,
      );
    }
    const parsed = schema.safeParse(res.body);
    if (!parsed.success) throw new ApiError(res.status, 'invalid_response', parsed.error.message);
    return parsed.data;
  }

  setupStatus(): Promise<SetupStatusResponse> {
    return this.call('GET', '/api/setup-status', SetupStatusResponseSchema);
  }

  async setup(body: SetupBody): Promise<{ email: string }> {
    const res = await this.call('POST', '/api/setup', SessionResponseSchema, {
      ...body,
      ...partitioned(),
    });
    adoptSessionSecret(res.sessionSecret);
    return { email: res.email };
  }

  async login(email: string, password: string): Promise<{ email: string }> {
    const res = await this.call('POST', '/api/login', SessionResponseSchema, {
      email,
      password,
      ...partitioned(),
    });
    adoptSessionSecret(res.sessionSecret);
    return { email: res.email };
  }

  /** "Conferma che sei tu": the password again in this session (same session, same secret). */
  async confirm(password: string): Promise<void> {
    await this.call('POST', '/api/auth/confirm', OkSchema, { password });
  }

  async logout(): Promise<void> {
    try {
      await this.call('POST', '/api/logout', OkSchema);
    } finally {
      forgetSessionSecret();
    }
  }

  /** The current user, or null when not logged in. */
  async me(): Promise<MeResponse | null> {
    try {
      return await this.call('GET', '/api/me', MeResponseSchema);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  }

  status(): Promise<StatusResponse> {
    return this.call('GET', '/api/status', StatusResponseSchema);
  }

  kill(reason?: string): Promise<StatusResponse> {
    return this.call('POST', '/api/kill', StatusResponseSchema, reason ? { reason } : {});
  }

  /** `continue`: also start again the work the stop left halfway (D-072). */
  resume(options: { continue?: boolean } = {}): Promise<ResumeResponse> {
    return this.call(
      'POST',
      '/api/resume',
      ResumeResponseSchema,
      options.continue ? { continue: true } : undefined,
    );
  }

  async events(query: Omit<EventsQuery, 'agent' | 'type'> & { agent?: string[]; type?: string[] }) {
    const res = await this.call(
      'GET',
      `/api/events${toQuery({
        ...query,
        agent: query.agent?.join(','),
        type: query.type?.join(','),
      })}`,
      EventsResponseSchema,
    );
    return parseEvents(res.events);
  }

  agents(): Promise<AgentSummary[]> {
    return this.call('GET', '/api/agents', z.array(AgentSummarySchema));
  }

  sendMessage(body: SendMessageRequest): Promise<SendMessageResponse> {
    return this.call('POST', '/api/messages', SendMessageResponseSchema, body);
  }

  /* Files (shared/src/files.ts, D-075). */

  /** Uploads a file (and its thumbnail, made by the browser): its metadata. */
  async uploadFile(
    file: Blob,
    name: string,
    options: {
      agent?: string | undefined;
      thumb?: Blob | null | undefined;
      onProgress?: (loaded: number, total: number) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<FileMeta> {
    if (!this.transport.upload) throw new ApiError(0, 'not_supported', 'upload not supported');
    const form = new FormData();
    form.set('file', file, name);
    if (options.agent) form.set('agent', options.agent);
    if (options.thumb) form.set('thumb', options.thumb, 'thumb.webp');
    const res = await this.transport.upload('/api/files', form, options.onProgress, options.signal);
    return this.parse(res, FileMetaSchema);
  }

  files(query: FileListQuery = {}): Promise<FileMeta[]> {
    const q = toQuery(query);
    return this.call('GET', `/api/files${q}`, FileListSchema).then((r) => r.files);
  }

  file(id: string): Promise<FileMeta> {
    return this.call('GET', `/api/files/${encodeURIComponent(id)}`, FileMetaSchema);
  }

  fileText(id: string): Promise<FileText> {
    return this.call('GET', `/api/files/${encodeURIComponent(id)}/text`, FileTextSchema);
  }

  /** "Attiva gli script" of a page made after reading third-party text (D-085). */
  allowFileScripts(id: string): Promise<FileMeta> {
    return this.call('POST', `/api/files/${encodeURIComponent(id)}/scripts`, FileMetaSchema);
  }

  deleteFile(id: string): Promise<{ ok: boolean }> {
    return this.call('DELETE', `/api/files/${encodeURIComponent(id)}`, OkSchema);
  }

  /** Where the browser loads the bytes (`content`) or the thumbnail of a file. */
  fileUrl(id: string, part: 'content' | 'thumb' | 'download' = 'content', ticket?: string): string {
    const base = `/api/files/${encodeURIComponent(id)}`;
    const query = [
      ...(part === 'download' ? ['download=1'] : []),
      ...(ticket ? [`${FILE_TICKET_PARAM}=${encodeURIComponent(ticket)}`] : []),
    ].join('&');
    const path = `${base}/${part === 'download' ? 'content' : part}${query ? `?${query}` : ''}`;
    return this.transport.fileUrl?.(path) ?? path;
  }

  /**
   * A ticket for the bytes of a file in an `<img>`, an `<iframe>` or a download (S-B13): a
   * browser's session needs it there, where no header goes. Short-lived (see files.ts).
   */
  fileTicket(id: string, part: 'content' | 'thumb'): Promise<FileTicketResponse> {
    return this.call(
      'POST',
      `/api/files/${encodeURIComponent(id)}/ticket`,
      FileTicketResponseSchema,
      { part },
    );
  }

  /** Starts a new conversation: every agent, or only `to`. */
  newConversation(to?: string): Promise<NewConversationResponse> {
    return this.call('POST', '/api/conversations', NewConversationResponseSchema, to ? { to } : {});
  }

  questions(status: 'open' | 'all' = 'open'): Promise<Question[]> {
    return this.call(
      'GET',
      `/api/questions${status === 'open' ? '?status=open' : ''}`,
      z.array(QuestionSchema),
    );
  }

  answer(questionId: string, body: AnswerRequest): Promise<Question> {
    return this.call(
      'POST',
      `/api/questions/${encodeURIComponent(questionId)}/answer`,
      QuestionSchema,
      body,
    );
  }

  undo(actionId: string, force = false): Promise<UndoResponse> {
    return this.call(
      'POST',
      '/api/vault/undo',
      UndoResponseSchema,
      force ? { actionId, force: true } : { actionId },
    );
  }

  settings(): Promise<SettingsResponse> {
    return this.call('GET', '/api/settings', SettingsResponseSchema);
  }

  setOpenRouterKey(key: string): Promise<OpenRouterKeyResponse> {
    return this.call('PUT', '/api/settings/openrouter-key', OpenRouterKeyResponseSchema, { key });
  }

  /** Paid OpenRouter models on (`freeOnly: false`) or off: applied at once by the core. */
  setOpenRouterFreeOnly(freeOnly: boolean): Promise<SettingsResponse> {
    return this.call('PUT', '/api/settings/openrouter', SettingsResponseSchema, { freeOnly });
  }

  setBraveKey(key: string): Promise<BraveKeyResponse> {
    return this.call('PUT', '/api/settings/brave-key', BraveKeyResponseSchema, { key });
  }

  /** Paid web search on OpenRouter (D-071): on, off or like the models, and the engine. */
  setWebSearch(change: WebSearchSettingsRequest): Promise<SettingsResponse> {
    return this.call('PUT', '/api/settings/web-search', SettingsResponseSchema, change);
  }

  /* Engine of the DecisionGate and TypeSafe key (M2.9, shared/src/decisions.ts). */

  decisions(): Promise<DecisionsView> {
    return this.call('GET', '/api/settings/decisions', DecisionsViewSchema);
  }

  setDecisionEngine(engine: DecisionEngine): Promise<DecisionsView> {
    return this.call('PUT', '/api/settings/decisions', DecisionsViewSchema, { engine });
  }

  setTypeSafeKey(key: string): Promise<DecisionsView> {
    return this.call('PUT', '/api/settings/typesafe-key', DecisionsViewSchema, { key });
  }

  removeTypeSafeKey(): Promise<DecisionsView> {
    return this.call('DELETE', '/api/settings/typesafe-key', DecisionsViewSchema);
  }

  /* The instinct of the team (D-067, shared/src/instinct.ts). */

  instinct(): Promise<InstinctView> {
    return this.call('GET', '/api/settings/instinct', InstinctViewSchema);
  }

  /** Engine and modes of the uses; 409 `no_key` when Jev is chosen without a TypeSafe key. */
  setInstinct(update: InstinctUpdate): Promise<InstinctView> {
    return this.call('PUT', '/api/settings/instinct', InstinctViewSchema, update);
  }

  /* Spending caps (D-070, shared/src/spend.ts). */

  /** Where the archive of the old bulky events is (log/archive.ts of the core). */
  logArchive(): Promise<LogArchiveStatus> {
    return this.call('GET', '/api/log/archive', LogArchiveStatusSchema);
  }

  spend(): Promise<SpendView> {
    return this.call('GET', '/api/settings/spend', SpendViewSchema);
  }

  setSpend(update: SpendUpdate): Promise<SpendView> {
    return this.call('PUT', '/api/settings/spend', SpendViewSchema, update);
  }

  /** Consumi of a monster: its context, its conversation, today and this month (D-075). */
  agentUsage(agentId: string): Promise<AgentUsageView> {
    return this.call(
      'GET',
      `/api/agents/${encodeURIComponent(agentId)}/usage`,
      AgentUsageViewSchema,
    );
  }

  scorecard(): Promise<ScorecardView> {
    return this.call('GET', '/api/instinct/scorecard', ScorecardViewSchema);
  }

  receipts(runId: string): Promise<Receipt[]> {
    return this.call(
      'GET',
      `/api/runs/${encodeURIComponent(runId)}/receipts`,
      z.array(ReceiptSchema),
    );
  }

  /** "Annulla tutto il lavoro": every note change of the run, newest first. */
  undoRun(runId: string): Promise<UndoRunResult> {
    return this.call('POST', `/api/runs/${encodeURIComponent(runId)}/undo`, UndoRunResultSchema);
  }

  /** «È mia»: a line of a monster's memory written after third-party text loses the mark. */
  ownMemoryLine(agentId: string, line: string): Promise<MemoryOwnResponse> {
    return this.call(
      'POST',
      `/api/team/agents/${encodeURIComponent(agentId)}/memory/own`,
      MemoryOwnResponseSchema,
      { line },
    );
  }

  /** «Manda comunque»: a reply of a dedicated bot the check held goes to its chat. */
  sendHeldReply(refusedId: string): Promise<{ chat: string }> {
    return this.call(
      'POST',
      `/api/telegram/held/${encodeURIComponent(refusedId)}/send`,
      z.object({ chat: z.string() }),
    );
  }

  permissions(): Promise<PermissionsResponse> {
    return this.call('GET', '/api/permissions', PermissionsResponseSchema);
  }

  setPermissions(body: PermissionsUpdateRequest): Promise<PermissionsResponse> {
    return this.call('PUT', '/api/permissions', PermissionsResponseSchema, body);
  }

  /* Telegram (M2.6, shared/src/telegram.ts). */

  telegram(): Promise<TelegramView> {
    return this.call('GET', '/api/telegram', TelegramViewSchema);
  }

  setTelegramToken(token: string): Promise<TelegramView> {
    return this.call('PUT', '/api/telegram/token', TelegramViewSchema, { token });
  }

  removeTelegramToken(): Promise<TelegramView> {
    return this.call('DELETE', '/api/telegram/token', TelegramViewSchema);
  }

  startTelegramPairing(): Promise<TelegramPairing> {
    return this.call('POST', '/api/telegram/pairing', TelegramPairingSchema);
  }

  cancelTelegramPairing(): Promise<TelegramView> {
    return this.call('DELETE', '/api/telegram/pairing', TelegramViewSchema);
  }

  removeTelegramUser(id: number): Promise<TelegramView> {
    return this.call('DELETE', `/api/telegram/users/${id}`, TelegramViewSchema);
  }

  setTelegramPrefs(update: TelegramPrefsUpdate): Promise<TelegramView> {
    return this.call('PUT', '/api/telegram/prefs', TelegramViewSchema, update);
  }

  /* Bots dedicated to one monster (D-107): every answer is the whole TelegramView. */

  createTelegramBot(body: TelegramBotCreateRequest): Promise<TelegramView> {
    return this.call('POST', '/api/telegram/bots', TelegramViewSchema, body);
  }

  updateTelegramBot(id: string, body: TelegramBotUpdateRequest): Promise<TelegramView> {
    return this.call(
      'PATCH',
      `/api/telegram/bots/${encodeURIComponent(id)}`,
      TelegramViewSchema,
      body,
    );
  }

  /** "Cambia il token": the same bot with a token issued again; groups and people stay. */
  changeTelegramBotToken(id: string, body: TelegramTokenRequest): Promise<TelegramView> {
    return this.call(
      'PUT',
      `/api/telegram/bots/${encodeURIComponent(id)}/token`,
      TelegramViewSchema,
      body,
    );
  }

  removeTelegramBot(id: string): Promise<TelegramView> {
    return this.call('DELETE', `/api/telegram/bots/${encodeURIComponent(id)}`, TelegramViewSchema);
  }

  approveTelegramBotChat(id: string, chat: number): Promise<TelegramView> {
    return this.call(
      'POST',
      `/api/telegram/bots/${encodeURIComponent(id)}/chats/${chat}/approve`,
      TelegramViewSchema,
    );
  }

  removeTelegramBotChat(id: string, chat: number): Promise<TelegramView> {
    return this.call(
      'DELETE',
      `/api/telegram/bots/${encodeURIComponent(id)}/chats/${chat}`,
      TelegramViewSchema,
    );
  }

  addTelegramBotPerson(id: string, body: TelegramBotPersonRequest): Promise<TelegramView> {
    return this.call(
      'POST',
      `/api/telegram/bots/${encodeURIComponent(id)}/people`,
      TelegramViewSchema,
      body,
    );
  }

  approveTelegramBotPerson(id: string, user: number): Promise<TelegramView> {
    return this.call(
      'POST',
      `/api/telegram/bots/${encodeURIComponent(id)}/people/${user}/approve`,
      TelegramViewSchema,
    );
  }

  removeTelegramBotPerson(id: string, user: number): Promise<TelegramView> {
    return this.call(
      'DELETE',
      `/api/telegram/bots/${encodeURIComponent(id)}/people/${user}`,
      TelegramViewSchema,
    );
  }

  /* External tools through MCP (M2.5, shared/src/mcp.ts). */

  mcpServers(): Promise<McpServersResponse> {
    return this.call('GET', '/api/mcp-servers', McpServersResponseSchema);
  }

  saveMcpServer(name: string, body: McpServerRequest): Promise<McpServersResponse> {
    return this.call(
      'PUT',
      `/api/mcp-servers/${encodeURIComponent(name)}`,
      McpServersResponseSchema,
      body,
    );
  }

  removeMcpServer(name: string): Promise<McpServersResponse> {
    return this.call(
      'DELETE',
      `/api/mcp-servers/${encodeURIComponent(name)}`,
      McpServersResponseSchema,
    );
  }

  testMcpServer(name: string): Promise<McpTestResponse> {
    return this.call(
      'POST',
      `/api/mcp-servers/${encodeURIComponent(name)}/test`,
      McpTestResponseSchema,
    );
  }

  /** OAuth sign-in (D-063): the page of the service to open, or already connected. */
  startMcpOAuth(name: string): Promise<McpOAuthStartResponse> {
    return this.call(
      'POST',
      `/api/mcp-servers/${encodeURIComponent(name)}/oauth`,
      McpOAuthStartResponseSchema,
      {},
    );
  }

  /** The address of a callback page that did not open, pasted by the user (D-072). */
  finishMcpOAuth(url: string): Promise<McpOAuthFinishResponse> {
    return this.call('POST', '/api/mcp-oauth/finish', McpOAuthFinishResponseSchema, { url });
  }

  /** "Accetta": tools new or changed since accepted reach the monsters again (D-070). */
  acceptMcpTools(
    name: string,
    tools?: string[],
    seen?: Record<string, string>,
  ): Promise<McpServersResponse> {
    return this.call(
      'POST',
      `/api/mcp-servers/${encodeURIComponent(name)}/accept`,
      McpServersResponseSchema,
      { ...(tools ? { tools } : {}), ...(seen ? { seen } : {}) },
    );
  }

  /** Revokes and forgets the tokens of an OAuth server. */
  signOutMcpOAuth(name: string): Promise<McpServersResponse> {
    return this.call(
      'DELETE',
      `/api/mcp-servers/${encodeURIComponent(name)}/oauth`,
      McpServersResponseSchema,
    );
  }

  /* Services through Claude (D-069, shared/src/claude-connections.ts). */

  /** With `check`, the core first asks Claude Code how the chosen services stand. */
  claudeConnections(options: { check?: boolean } = {}): Promise<ClaudeConnectionsResponse> {
    return this.call(
      'GET',
      `/api/claude-connections${options.check ? '?check=1' : ''}`,
      ClaudeConnectionsResponseSchema,
    );
  }

  setClaudeConnection(
    id: string,
    body: ClaudeConnectionRequest = {},
  ): Promise<ClaudeConnectionsResponse> {
    return this.call(
      'PUT',
      `/api/claude-connections/${encodeURIComponent(id)}`,
      ClaudeConnectionsResponseSchema,
      body,
    );
  }

  removeClaudeConnection(id: string): Promise<ClaudeConnectionsResponse> {
    return this.call(
      'DELETE',
      `/api/claude-connections/${encodeURIComponent(id)}`,
      ClaudeConnectionsResponseSchema,
    );
  }

  checkClaudeConnection(id: string): Promise<ClaudeConnectionsResponse> {
    return this.call(
      'POST',
      `/api/claude-connections/${encodeURIComponent(id)}/check`,
      ClaudeConnectionsResponseSchema,
      {},
    );
  }

  /* Providers (M2.2, shared/src/providers.ts). */

  providers(): Promise<ProvidersResponse> {
    return this.call('GET', '/api/providers', ProvidersResponseSchema);
  }

  setProviderKey(id: string, key: string): Promise<ProviderView> {
    return this.call('PUT', `/api/providers/${encodeURIComponent(id)}/key`, ProviderViewSchema, {
      key,
    });
  }

  removeProviderKey(id: string): Promise<ProviderView> {
    return this.call('DELETE', `/api/providers/${encodeURIComponent(id)}/key`, ProviderViewSchema);
  }

  setProviderUrl(id: string, baseURL: string): Promise<ProviderView> {
    return this.call('PUT', `/api/providers/${encodeURIComponent(id)}/url`, ProviderViewSchema, {
      baseURL,
    });
  }

  removeProviderUrl(id: string): Promise<ProviderView> {
    return this.call('DELETE', `/api/providers/${encodeURIComponent(id)}/url`, ProviderViewSchema);
  }

  providerModels(id: string, options: { refresh?: boolean } = {}): Promise<ProviderModelsResponse> {
    return this.call(
      'GET',
      `/api/providers/${encodeURIComponent(id)}/models${toQuery({ tools: 1, refresh: options.refresh ? 1 : undefined })}`,
      ProviderModelsResponseSchema,
    );
  }

  /* Subscriptions (M2.7, shared/src/providers.ts). */

  subscriptions(options: { check?: boolean } = {}): Promise<SubscriptionsResponse> {
    return this.call(
      'GET',
      `/api/subscriptions${toQuery({ check: options.check ? 1 : undefined })}`,
      SubscriptionsResponseSchema,
    );
  }

  chatgptLogin(): Promise<ChatGPTLoginResponse> {
    return this.call('POST', '/api/subscriptions/chatgpt/login', ChatGPTLoginResponseSchema, {});
  }

  chatgptLogout(): Promise<SubscriptionsResponse> {
    return this.call('DELETE', '/api/subscriptions/chatgpt', SubscriptionsResponseSchema);
  }

  chatgptWelcomeSeen(): Promise<SubscriptionsResponse> {
    return this.call('POST', '/api/subscriptions/chatgpt/welcome', SubscriptionsResponseSchema, {});
  }

  activateHarness(id: string, install: boolean): Promise<SubscriptionsResponse> {
    return this.call(
      'POST',
      `/api/subscriptions/${encodeURIComponent(id)}/activate`,
      SubscriptionsResponseSchema,
      { install },
    );
  }

  deactivateHarness(id: string): Promise<SubscriptionsResponse> {
    return this.call(
      'DELETE',
      `/api/subscriptions/${encodeURIComponent(id)}`,
      SubscriptionsResponseSchema,
    );
  }

  /** The chain of a monster; with `auto` the core writes the automatic chain of that base (D-093). */
  setAgentModels(agentId: string, models: ModelRefView[], auto?: AutoModels): Promise<AgentModels> {
    return this.call(
      'PUT',
      `/api/agents/${encodeURIComponent(agentId)}/models`,
      AgentModelsSchema,
      { models, ...(auto ? { auto } : {}) },
    );
  }

  /* Settings → Squadra (D-058, shared/src/team.ts): the team, the profile, the password. */

  team(): Promise<TeamView> {
    return this.call('GET', '/api/team', TeamViewSchema);
  }

  /** One monster of any squad (a project's too, D-097) with the fields its row edits. */
  teamMember(id: string): Promise<TeamMemberView> {
    return this.call('GET', `/api/team/agents/${encodeURIComponent(id)}`, TeamMemberViewSchema);
  }

  updateMember(id: string, update: TeamMemberUpdate): Promise<TeamMemberView> {
    return this.call(
      'PATCH',
      `/api/team/agents/${encodeURIComponent(id)}`,
      TeamMemberViewSchema,
      update,
    );
  }

  /** Previews of new looks (nothing saved): for a monster of the team or one still to add. */
  teamLooks(request: TeamLooksRequest): Promise<TeamLooksResponse> {
    return this.call('POST', '/api/team/looks', TeamLooksResponseSchema, request);
  }

  setMemberLook(id: string, genome: unknown): Promise<TeamMemberView> {
    return this.call(
      'PUT',
      `/api/team/agents/${encodeURIComponent(id)}/look`,
      TeamMemberViewSchema,
      { genome },
    );
  }

  archiveMember(id: string): Promise<TeamArchiveResponse> {
    return this.call(
      'DELETE',
      `/api/team/agents/${encodeURIComponent(id)}`,
      TeamArchiveResponseSchema,
    );
  }

  restoreMember(id: string, name?: string): Promise<TeamMemberView> {
    return this.call(
      'POST',
      `/api/team/archived/${encodeURIComponent(id)}/restore`,
      TeamMemberViewSchema,
      name ? { name } : {},
    );
  }

  teamSuggestions(): Promise<TeamSuggestions> {
    return this.call('GET', '/api/team/suggestions', TeamSuggestionsSchema);
  }

  teamDraft(request: TeamDraftRequest): Promise<TeamDraft> {
    return this.call('POST', '/api/team/drafts', TeamDraftSchema, request);
  }

  addMember(request: TeamMemberCreateRequest): Promise<TeamMemberView> {
    return this.call('POST', '/api/team/agents', TeamMemberViewSchema, request);
  }

  /** "Lascia stare" on a proposal of the capo squadra (D-075). */
  async discardProposal(id: string): Promise<void> {
    await this.call('POST', `/api/team/proposals/${encodeURIComponent(id)}/discard`, OkSchema);
  }

  profile(): Promise<ProfileView> {
    return this.call('GET', '/api/profile', ProfileViewSchema);
  }

  updateProfile(update: ProfileUpdate): Promise<ProfileView> {
    return this.call('PUT', '/api/profile', ProfileViewSchema, update);
  }

  changePassword(currentPassword: string, newPassword: string): Promise<PasswordChangeResponse> {
    return this.call('POST', '/api/auth/password', PasswordChangeResponseSchema, {
      currentPassword,
      newPassword,
    });
  }

  /* Automations (D-094, shared/src/automations.ts). */

  automations(): Promise<AutomationView[]> {
    return this.call('GET', '/api/automations', z.array(AutomationViewSchema));
  }

  automation(id: string): Promise<AutomationView> {
    return this.call('GET', `/api/automations/${encodeURIComponent(id)}`, AutomationViewSchema);
  }

  createAutomation(body: AutomationCreate): Promise<AutomationView> {
    return this.call('POST', '/api/automations', AutomationViewSchema, body);
  }

  updateAutomation(id: string, update: AutomationUpdate): Promise<AutomationView> {
    return this.call(
      'PATCH',
      `/api/automations/${encodeURIComponent(id)}`,
      AutomationViewSchema,
      update,
    );
  }

  async deleteAutomation(id: string): Promise<void> {
    await this.call('DELETE', `/api/automations/${encodeURIComponent(id)}`, OkSchema);
  }

  pauseAutomation(id: string): Promise<AutomationView> {
    return this.call(
      'POST',
      `/api/automations/${encodeURIComponent(id)}/pause`,
      AutomationViewSchema,
    );
  }

  resumeAutomation(id: string): Promise<AutomationView> {
    return this.call(
      'POST',
      `/api/automations/${encodeURIComponent(id)}/resume`,
      AutomationViewSchema,
    );
  }

  /** "Esegui ora": 409 `halted` while Monsters is stopped, `already_running`, `draft`. */
  runAutomation(id: string): Promise<AutomationRunNowResponse> {
    return this.call(
      'POST',
      `/api/automations/${encodeURIComponent(id)}/run`,
      AutomationRunNowResponseSchema,
    );
  }

  automationRuns(id: string, limit?: number): Promise<AutomationRunSummary[]> {
    return this.call(
      'GET',
      `/api/automations/${encodeURIComponent(id)}/runs${toQuery({ limit })}`,
      z.array(AutomationRunSummarySchema),
    );
  }

  automationRun(id: string, giro: string): Promise<AutomationRunDetail> {
    return this.call(
      'GET',
      `/api/automations/${encodeURIComponent(id)}/runs/${encodeURIComponent(giro)}`,
      AutomationRunDetailSchema,
    );
  }

  /* Drafts of the monsters (D-098, shared/src/drafts.ts): one contract for every kind. */

  drafts(): Promise<DraftView[]> {
    return this.call('GET', '/api/drafts', z.array(DraftViewSchema));
  }

  confirmDraft(kind: DraftKind, id: string): Promise<DraftConfirmResponse> {
    return this.call(
      'POST',
      `/api/drafts/${kind}/${encodeURIComponent(id)}/confirm`,
      DraftConfirmResponseSchema,
    );
  }

  async discardDraft(kind: DraftKind, id: string): Promise<void> {
    await this.call('POST', `/api/drafts/${kind}/${encodeURIComponent(id)}/discard`, OkSchema);
  }

  /* Projects (D-097, D-098, shared/src/projects.ts). */

  projects(): Promise<ProjectView[]> {
    return this.call('GET', '/api/projects', z.array(ProjectViewSchema));
  }

  project(id: string): Promise<ProjectView> {
    return this.call('GET', `/api/projects/${encodeURIComponent(id)}`, ProjectViewSchema);
  }

  createProject(body: ProjectCreateRequest): Promise<ProjectView> {
    return this.call('POST', '/api/projects', ProjectViewSchema, body);
  }

  updateProject(id: string, update: ProjectUpdateRequest): Promise<ProjectView> {
    return this.call('PATCH', `/api/projects/${encodeURIComponent(id)}`, ProjectViewSchema, update);
  }

  archiveProject(id: string): Promise<ProjectView> {
    return this.call('POST', `/api/projects/${encodeURIComponent(id)}/archive`, ProjectViewSchema);
  }

  restoreProject(id: string): Promise<ProjectView> {
    return this.call('POST', `/api/projects/${encodeURIComponent(id)}/restore`, ProjectViewSchema);
  }

  /** "Approva" (D-103): CLAUDE.md and AGENTS.md of the folder, as they are now, are the user's. */
  approveProjectDocs(id: string): Promise<ProjectView> {
    return this.call(
      'POST',
      `/api/projects/${encodeURIComponent(id)}/folder-docs/approve`,
      ProjectViewSchema,
    );
  }

  /** "Ferma progetto" (D-098): the runs of its monsters, not the kill switch. */
  stopProject(id: string): Promise<ProjectStopResponse> {
    return this.call(
      'POST',
      `/api/projects/${encodeURIComponent(id)}/stop`,
      ProjectStopResponseSchema,
    );
  }

  /** A copy of a monster (`copyOf`, a memory of its own) or a new one, as "Aggiungi un mostro". */
  addProjectMember(id: string, request: ProjectMemberRequest): Promise<ProjectView> {
    return this.call(
      'POST',
      `/api/projects/${encodeURIComponent(id)}/members`,
      ProjectViewSchema,
      request,
    );
  }

  /** The monster is archived, never deleted (the lead cannot be removed). */
  removeProjectMember(id: string, agent: string): Promise<ProjectView> {
    return this.call(
      'DELETE',
      `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(agent)}`,
      ProjectViewSchema,
    );
  }

  projectSpend(id: string): Promise<ProjectSpendView> {
    return this.call(
      'GET',
      `/api/projects/${encodeURIComponent(id)}/spend`,
      ProjectSpendViewSchema,
    );
  }
}
