/*
 * The app's theme (D-091): the choice of the web UI's Settings ("Sistema", "Chiaro", "Scuro")
 * applied to the whole app through `nativeTheme.themeSource`, so the pages the app builds
 * itself (data: URLs with `prefers-color-scheme`: first start, status, "Connessioni", the
 * banner), the window backgrounds and the title bar overlay follow it, not only the system.
 * The web UI sends the choice, never the resolved theme: with `light` or `dark` forced, its
 * own `prefers-color-scheme` would no longer say what the system wants, and "Sistema" could
 * never come back. Stored with the connections (profiles.ts) and applied at start, before the
 * first window. MONSTERS_DESKTOP_THEME (tests) stands in for the system theme: it is what
 * "Sistema" shows. Pure Node, no Electron.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Environment variable of the tests: the system theme, `light` or `dark`. */
export const THEME_ENV = 'MONSTERS_DESKTOP_THEME';

/** The choice a page sends, or null: exactly one of the three strings. */
export function parseThemeChoice(input: unknown): ThemeChoice | null {
  return input === 'system' || input === 'light' || input === 'dark' ? input : null;
}

/** The system theme forced by the environment (tests), or null. */
export function envTheme(
  env: Readonly<Record<string, string | undefined>>,
): 'light' | 'dark' | null {
  const v = env[THEME_ENV];
  return v === 'light' || v === 'dark' ? v : null;
}

/** `nativeTheme.themeSource` for `choice`: "Sistema" is the environment's theme when set. */
export function themeSourceFor(choice: ThemeChoice, env: 'light' | 'dark' | null): ThemeChoice {
  return choice === 'system' ? (env ?? 'system') : choice;
}

export interface AppThemeDeps {
  /** Where the choice is kept (ProfileStore). */
  store: { readonly theme: ThemeChoice; setTheme(choice: ThemeChoice): void };
  /** Sets `nativeTheme.themeSource`. */
  apply(source: ThemeChoice): void;
  env: 'light' | 'dark' | null;
  log(line: string): void;
}

/** The stored choice at start, then the choices the web UI sends (already checked: the core's page). */
export class AppTheme {
  readonly #d: AppThemeDeps;
  #applied: ThemeChoice | null = null;

  constructor(deps: AppThemeDeps) {
    this.#d = deps;
  }

  get choice(): ThemeChoice {
    return this.#d.store.theme;
  }

  /** At start, before the first window: the stored choice. */
  start(): void {
    this.#show(this.#d.store.theme);
  }

  /** A choice from the web UI. False if refused (not one of the three strings). */
  fromPage(input: unknown): boolean {
    const choice = parseThemeChoice(input);
    if (!choice) {
      this.#d.log('theme refused (not system, light or dark)');
      return false;
    }
    if (choice !== this.#d.store.theme) {
      this.#d.log(`theme: ${choice}`);
      this.#d.store.setTheme(choice);
    }
    this.#show(choice);
    return true;
  }

  #show(choice: ThemeChoice): void {
    const source = themeSourceFor(choice, this.#d.env);
    if (source === this.#applied) return;
    this.#applied = source;
    this.#d.apply(source);
  }
}
