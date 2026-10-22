import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHATGPT_USAGE_URL,
  CLAUDE_AGENT_SDK_INTEGRITY,
  CLAUDE_AGENT_SDK_PACKAGE,
  CLAUDE_AGENT_SDK_VERSION,
  CODEX_INTEGRITY,
  CODEX_PACKAGE,
  CODEX_VERSION,
  ChatGPTProvider,
  chatgptUnreachableText,
  ClaudeAgentHarness,
  CodexHarness,
  SiwcClient,
  SiwcError,
  findOnPath,
  installPackage,
  isHostId,
  newHostId,
  plainSpawn,
  type ClaudeStatus,
  type CredentialStore,
  type HarnessBinary,
  type HarnessSpawn,
  type ProviderRegistry,
  type SiwcEndpoints,
  type SiwcLogin,
  type SiwcRecord,
} from '@monsters/providers';
import { nodeRuntime } from '@monsters/shared/node';
import type {
  ChatGPTLoginResponse,
  ClaudeAgentStatus,
  CodexStatus,
  SubscriptionsResponse,
} from '@monsters/shared';
import { DIR_MODE, chmodSafe, writeSensitiveFile } from '../config.ts';
import type { StateStore } from '../db/state-store.ts';
import { secretStoreFor } from '../secrets/store.ts';
import type { EventLog } from '../log/event-log.ts';
import { ProviderSetupError } from './manager.ts';
import type { PlanLimits } from './plan-limits.ts';
import { providerStrings } from './providers.strings.ts';

/*
 * The subscriptions (M2.7, D-005, D-035), set up by the user from the UI:
 *
 * - ChatGPT: Sign in with ChatGPT (our implementation, no DevKit). Tokens in
 *   the secret `chatgpt.json` (keychain or file backend, D-042), the host
 *   id in `chatgpt-host-id` (an identifier, not a secret).
 *   Once signed in, the `chatgpt` model provider is registered.
 * - Claude Agent: off until the user turns it on. Monsters uses the `claude`
 *   already installed, or installs `@anthropic-ai/claude-agent-sdk` (exact
 *   version, proprietary license) into `harness/claude-agent` only when the
 *   user agrees. The login is the user's, in a terminal; its state comes from
 *   the binary, never from `~/.claude`.
 * - Codex: off until the user turns it on; needs the ChatGPT sign-in. Monsters
 *   installs `@openai/codex` (exact version, Apache-2.0) into `harness/codex`
 *   when the user agrees, or uses a `codex` on the PATH; it runs with the SIWC
 *   token and its own `CODEX_HOME`, never with `codex login`.
 */

const CHATGPT_FILE = 'chatgpt.json';
const HOST_ID_FILE = 'chatgpt-host-id';
const WELCOME_KEY = 'subscriptions.chatgpt.welcome_seen';
const ENABLED_KEY = (id: string) => `subscriptions.${id}.enabled`;

export const HARNESS_DIR = 'harness';

export interface SubscriptionServiceOptions {
  registry: ProviderRegistry;
  home: string;
  secretsDir: string;
  log: EventLog;
  state: StateStore;
  /** The plans' limits read from the harnesses (D-111). */
  planLimits: PlanLimits;
  /** The user's environment (children get it, cleaned). */
  env: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** Fake OpenAI in tests. */
  siwcEndpoints?: Partial<SiwcEndpoints>;
  /** Callback port of the sign-in. Default 1455 (another free one when taken). */
  callbackPort?: number;
  /** Binaries to use instead of looking for them (tests: the fake ones). `null` = none. */
  binaries?: { claude?: HarnessBinary | null; codex?: HarnessBinary | null };
  /** How packages are installed (tests). */
  install?: (dir: string, spec: string) => Promise<void>;
  /** Kill switch hook: an install in progress stops with it. */
  onKill?: (hook: () => void) => () => void;
  version: string;
  /**
   * A plan became usable (D-069): Claude Agent signed in with a subscription,
   * ChatGPT signed in. The hub moves to it the agents still on Monsters' defaults.
   */
  onReady?: (id: 'claude-agent' | 'chatgpt') => void;
}

function secretCredentialStore(secretsDir: string): CredentialStore {
  return {
    read() {
      try {
        const raw = secretStoreFor(secretsDir).read(CHATGPT_FILE);
        if (raw === null) return null;
        const parsed = JSON.parse(raw) as SiwcRecord;
        return parsed.version === 1 ? parsed : null;
      } catch {
        return null;
      }
    },
    write(record) {
      secretStoreFor(secretsDir).write(CHATGPT_FILE, `${JSON.stringify(record, null, 2)}\n`);
    },
  };
}

function platformPackage(): string {
  let musl = false;
  if (process.platform === 'linux') {
    const report = process.report?.getReport() as
      { header?: { glibcVersionRuntime?: string } } | undefined;
    musl = !report?.header?.glibcVersionRuntime;
  }
  return `${CLAUDE_AGENT_SDK_PACKAGE}-${process.platform}-${process.arch}${musl ? '-musl' : ''}`;
}

export class SubscriptionService {
  readonly #o: SubscriptionServiceOptions;
  readonly #siwc: SiwcClient;
  readonly claude: ClaudeAgentHarness;
  #login: SiwcLogin | null = null;
  #chatgptMessage: string | undefined;
  #claudeStatus: ClaudeStatus | null = null;
  #claudeMessage: string | undefined;
  #codexMessage: string | undefined;
  readonly #installing = new Set<string>();

  constructor(options: SubscriptionServiceOptions) {
    this.#o = options;
    mkdirSync(options.secretsDir, { recursive: true, mode: DIR_MODE });
    chmodSafe(options.secretsDir, DIR_MODE);
    this.#siwc = new SiwcClient({
      store: secretCredentialStore(options.secretsDir),
      hostId: this.#hostId(),
      ...(options.siwcEndpoints ? { endpoints: options.siwcEndpoints } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.claude = new ClaudeAgentHarness({
      binary: () => this.#claudeBinary(),
      env: options.env,
      isSecret: (_n, v) => options.log.redactor.containsKnown(v),
    });
  }

  /** The persistent `ext_agent_host_id` of this machine (kept after a sign-out). */
  #hostId(): string {
    const path = join(this.#o.home, HOST_ID_FILE);
    try {
      const id = readFileSync(path, 'utf8').trim();
      if (isHostId(id)) return id;
    } catch {
      // first sign-in on this machine
    }
    const id = newHostId();
    writeSensitiveFile(path, `${id}\n`);
    return id;
  }

  get #harnessDir(): string {
    return join(this.#o.home, HARNESS_DIR);
  }

  #claudeBinary(): HarnessBinary | null {
    const o = this.#o.binaries;
    if (o && 'claude' in o) return o.claude ?? null;
    const onPath = findOnPath('claude', this.#o.env);
    if (onPath) return { command: onPath, args: [], source: 'path' };
    const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const installed = join(
      this.#harnessDir,
      'claude-agent',
      'node_modules',
      platformPackage(),
      exe,
    );
    return existsSync(installed) ? { command: installed, args: [], source: 'installed' } : null;
  }

  #codexBinary(): HarnessBinary | null {
    const o = this.#o.binaries;
    if (o && 'codex' in o) return o.codex ?? null;
    const script = join(
      this.#harnessDir,
      'codex',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    );
    // The Node that runs JavaScript children: inside the desktop app, the one on the PATH.
    const node = existsSync(script) ? nodeRuntime(this.#o.env) : null;
    if (node) return { command: node.command, args: [script], source: 'installed' };
    const onPath = findOnPath('codex', this.#o.env);
    return onPath ? { command: onPath, args: [], source: 'path' } : null;
  }

  #enabled(id: string): boolean {
    return this.#o.state.get<boolean>(ENABLED_KEY(id)) === true;
  }

  /** Registers what is set up (startup, after a change). No network, no process. */
  configure(): void {
    const reg = this.#o.registry;
    const signedIn = this.#siwc.signedIn();
    if (signedIn && !reg.has('chatgpt')) {
      reg.register(
        new ChatGPTProvider({
          client: this.#siwc,
          ...(this.#o.fetch ? { fetch: this.#o.fetch } : {}),
          // The windows ChatGPT's route puts on a model response (D-156).
          onPlanLimits: (reading) => this.#o.planLimits.observe(reading),
        }),
      );
    } else if (!signedIn && reg.has('chatgpt')) {
      reg.unregister('chatgpt');
    }
    const claudeOn = this.#enabled('claude-agent') && this.#claudeBinary() !== null;
    if (claudeOn && !reg.has('claude-agent')) reg.register(this.claude);
    else if (!claudeOn && reg.has('claude-agent')) reg.unregister('claude-agent');
    const codexOn = this.#enabled('codex') && signedIn && this.#codexBinary() !== null;
    if (codexOn && !reg.has('codex')) reg.register(this.#codex());
    else if (!codexOn && reg.has('codex')) reg.unregister('codex');
  }

  #codex(): CodexHarness {
    return new CodexHarness({
      binary: () => this.#codexBinary(),
      accessToken: (o) => this.#siwc.accessToken(o),
      codexHome: join(this.#harnessDir, 'codex-home'),
      baseURL: this.#siwc.endpoints.resource,
      models: () =>
        this.#o.registry.has('chatgpt')
          ? this.#o.registry.get('chatgpt').listModels()
          : Promise.resolve([]),
      env: this.#o.env,
      isSecret: (_n, v) => this.#o.log.redactor.containsKnown(v),
      clientVersion: this.#o.version,
    });
  }

  /** Where the runs of a harness keep their private files. */
  get runsDir(): string {
    return join(this.#harnessDir, 'runs');
  }

  // --- ChatGPT ---------------------------------------------------------------------

  async startChatGPTLogin(): Promise<ChatGPTLoginResponse> {
    this.#login?.cancel();
    this.#chatgptMessage = undefined;
    let login: SiwcLogin;
    try {
      login = await this.#siwc.startLogin({ port: this.#o.callbackPort ?? 1455 });
    } catch (err) {
      throw new ProviderSetupError(
        'verification_failed',
        providerStrings().portFailed((err as Error).message),
      );
    }
    this.#login = login;
    login.done.then(
      () => {
        if (this.#login === login) this.#login = null;
        // A new account starts with the welcome again.
        this.#o.state.delete(WELCOME_KEY);
        this.configure();
        this.#o.log.append({
          agent: 'system',
          type: 'message',
          data: { role: 'system', text: providerStrings().chatgptConnected },
        });
        this.#o.onReady?.('chatgpt');
      },
      (err: unknown) => {
        if (this.#login === login) this.#login = null;
        if (err instanceof SiwcError && err.code === 'cancelled') return;
        this.#chatgptMessage =
          err instanceof SiwcError && err.code === 'access_denied'
            ? providerStrings().signInCancelled
            : (chatgptUnreachableText(err, 'sign_in') ??
              providerStrings().chatgptIncomplete((err as Error).message));
      },
    );
    return { authorizeUrl: login.url, redirectUri: login.redirectUri };
  }

  async signOutChatGPT(): Promise<void> {
    this.#login?.cancel();
    const { confirmed } = await this.#siwc.signOut();
    this.#chatgptMessage = confirmed ? undefined : providerStrings().revokeUnconfirmed;
    // The numbers were the account's that signed out.
    this.#o.planLimits.clear('chatgpt');
    this.configure();
  }

  markWelcomeSeen(): void {
    this.#o.state.set(WELCOME_KEY, true);
  }

  // --- harnesses --------------------------------------------------------------------

  /** Turns a harness on; installs its official package first when allowed and needed. */
  async activate(id: string, install: boolean): Promise<void> {
    if (id !== 'claude-agent' && id !== 'codex') {
      throw new ProviderSetupError('unknown_provider', providerStrings().unknownSubscription(id));
    }
    if (id === 'codex' && !this.#siwc.signedIn()) {
      throw new ProviderSetupError('invalid_request', providerStrings().codexNeedsChatgpt);
    }
    this.#o.state.set(ENABLED_KEY(id), true);
    const found = id === 'claude-agent' ? this.#claudeBinary() : this.#codexBinary();
    if (!found && install) {
      void this.#install(id);
    } else if (!found) {
      this.#setMessage(id, providerStrings().programMissing);
    }
    this.configure();
    if (id === 'claude-agent' && found) await this.checkClaude();
  }

  deactivate(id: string): void {
    if (id !== 'claude-agent' && id !== 'codex') {
      throw new ProviderSetupError('unknown_provider', providerStrings().unknownSubscription(id));
    }
    this.#o.state.set(ENABLED_KEY(id), false);
    this.configure();
  }

  #setMessage(id: string, message: string | undefined): void {
    if (id === 'claude-agent') this.#claudeMessage = message;
    else this.#codexMessage = message;
  }

  async #install(id: 'claude-agent' | 'codex'): Promise<void> {
    if (this.#installing.has(id)) return;
    this.#installing.add(id);
    this.#setMessage(id, undefined);
    const spec =
      id === 'claude-agent'
        ? `${CLAUDE_AGENT_SDK_PACKAGE}@${CLAUDE_AGENT_SDK_VERSION}`
        : `${CODEX_PACKAGE}@${CODEX_VERSION}`;
    const dir = join(this.#harnessDir, id);
    const controller = new AbortController();
    const off = this.#o.onKill?.(() => controller.abort());
    try {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE });
      if (this.#o.install) {
        await this.#o.install(dir, spec);
      } else {
        const spawn: HarnessSpawn = (command, args, options) => {
          const child = plainSpawn(command, args, options);
          controller.signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
          return child;
        };
        const integrity = id === 'claude-agent' ? CLAUDE_AGENT_SDK_INTEGRITY : CODEX_INTEGRITY;
        await installPackage(dir, spec, { integrity, spawn, env: this.#o.env });
      }
      this.#o.log.append({
        agent: 'system',
        type: 'message',
        data: {
          role: 'system',
          text: providerStrings().installed(spec, id === 'codex' ? 'Codex' : 'Claude Agent'),
        },
      });
      this.configure();
      if (id === 'claude-agent') await this.checkClaude();
    } catch (err) {
      this.#setMessage(id, providerStrings().installFailed((err as Error).message));
      this.#o.log.append({
        agent: 'system',
        type: 'error',
        data: { code: 'harness_install', message: `${spec}: ${(err as Error).message}` },
      });
    } finally {
      off?.();
      this.#installing.delete(id);
    }
  }

  /** Asks Claude Code about the login (never reads its files). */
  async checkClaude(): Promise<ClaudeStatus> {
    this.#claudeStatus = await this.claude.status();
    if (this.#claudeStatus.state === 'subscription' && this.claudeReady()) {
      this.#o.onReady?.('claude-agent');
    }
    return this.#claudeStatus;
  }

  /**
   * The Claude plan can be used now (D-069): Claude Agent on and not known to
   * be signed out or on an API key (unchecked after a restart counts as ready:
   * a run says it clearly when the login is gone).
   */
  claudeReady(): boolean {
    if (!this.#o.registry.has('claude-agent')) return false;
    const state = this.#claudeStatus?.state;
    return state === undefined || state === 'subscription';
  }

  // --- view -------------------------------------------------------------------------

  view(): SubscriptionsResponse {
    // A sign-in that expired meanwhile (terminal refresh error) takes ChatGPT and Codex off.
    this.configure();
    const account = this.#siwc.account();
    const claudeBinary = this.#claudeBinary();
    const s = this.#claudeStatus;
    const claude: ClaudeAgentStatus = {
      enabled: this.#enabled('claude-agent'),
      state: claudeBinary ? (s?.state ?? 'unknown') : 'not_found',
      ...(s?.authMethod ? { authMethod: s.authMethod } : {}),
      ...(s?.version ? { version: s.version } : {}),
      ...(claudeBinary ? { binarySource: claudeBinary.source } : {}),
      installing: this.#installing.has('claude-agent'),
      ...((this.#claudeMessage ?? s?.message)
        ? { message: this.#claudeMessage ?? s?.message }
        : {}),
      package: {
        name: CLAUDE_AGENT_SDK_PACKAGE,
        version: CLAUDE_AGENT_SDK_VERSION,
        // An id, not a sentence: the UI says it in the app's language (`licenseName`).
        license: 'proprietary',
      },
    };
    const codexBinary = this.#codexBinary();
    const codex: CodexStatus = {
      enabled: this.#enabled('codex'),
      state: !account ? 'needs_chatgpt' : codexBinary ? 'ready' : 'not_found',
      ...(codexBinary ? { binarySource: codexBinary.source } : {}),
      installing: this.#installing.has('codex'),
      ...(this.#codexMessage ? { message: this.#codexMessage } : {}),
      package: { name: CODEX_PACKAGE, version: CODEX_VERSION, license: 'Apache-2.0' },
    };
    return {
      chatgpt: {
        signedIn: account !== null,
        ...(account?.email ? { email: account.email } : {}),
        pending: this.#login !== null,
        ...(this.#login ? { callbackPort: this.#login.port } : {}),
        welcomeSeen: this.#o.state.get<boolean>(WELCOME_KEY) === true,
        ...(this.#chatgptMessage ? { message: this.#chatgptMessage } : {}),
        usageUrl: CHATGPT_USAGE_URL,
      },
      claude,
      codex,
      limits: this.#o.planLimits.all(),
    };
  }

  close(): void {
    this.#login?.cancel();
  }
}
