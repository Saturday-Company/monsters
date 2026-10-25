import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Notebook,
  TerminalWindow,
  type Icon,
} from '@phosphor-icons/react';
import type { AgentPermissions, OnboardingState } from '@monsters/shared';
import { DEFAULT_AGENT_PERMISSIONS } from '@monsters/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button.tsx';
import { playSound } from '../lib/sound.ts';
import { Switch } from '../components/ui/controls.tsx';
import { cn } from '../lib/utils.ts';
import { onboardingApi, onboardingError } from './api.ts';
import { Guide } from './Guide.tsx';
import { onboardingStrings } from './onboarding.strings.ts';
import { ErrorLine, genomeFrom } from './parts.tsx';

/** How long the confirmation stays before the team step. */
const REPLY_MS = 800;

interface Row {
  key: 'vault' | 'web' | 'shell';
  icon: Icon;
}

/**
 * One true sentence about the terminal, the same in Settings → Permissions (audit
 * 2.9): commands run in the agent's folder, without administrator rights, but
 * with the user's account (`shell` reaches beyond the granted folders).
 */
export function terminalText(): string {
  return onboardingStrings().permissions.terminal;
}

/*
 * What the agents may do (M2.5, D-033), last screen of "Su di te": only the
 * three switches, all on to start (D-159). Folders of the
 * computer, the browser and the MCP tools are set up later in the settings
 * (D-053), so the first start stays short.
 */
const ROWS: Row[] = [
  { key: 'vault', icon: Notebook },
  { key: 'web', icon: Globe },
  { key: 'shell', icon: TerminalWindow },
];

function rowText(key: Row['key']): { title: string; text: string } {
  const s = onboardingStrings().permissions;
  if (key === 'vault') return { title: s.notesTitle, text: s.notesText };
  if (key === 'web') return { title: s.webTitle, text: s.webText };
  return { title: s.terminalTitle, text: s.terminal };
}

/** Step 2, last screen: the permissions of the agents, in one go (editable later). */
export function PermissionsStep({
  state,
  onState,
}: {
  state: OnboardingState;
  onState: (s: OnboardingState) => void;
}) {
  const s = onboardingStrings().permissions;
  // Everything on (D-159): the user turns off what they do not want.
  const [perm, setPerm] = useState<AgentPermissions>(
    () => state.permissions ?? { ...DEFAULT_AGENT_PERMISSIONS },
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const grant = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await onboardingApi.submit({
        permissions: { ...perm, folders: perm.folders ?? [] },
      });
      setSaved(true);
      timer.current = setTimeout(() => onState(next), REPLY_MS);
    } catch (err) {
      setError(onboardingError(err));
      setBusy(false);
    }
  };

  // Back to the questions: the answers are saved, the step comes from them.
  const back = () => onState({ ...state, step: 'questions' });

  return (
    <div className="grid gap-6">
      <Guide
        genome={genomeFrom(state.guide.genome, state.guide.name)}
        name={state.guide.name}
        expression={saved ? 'happy' : 'talk'}
        sayKey={saved ? 'permissions-saved' : 'permissions'}
        say={saved ? s.saidSaved : s.said}
        hint={saved ? undefined : s.hint}
      />

      <div className="card overflow-hidden rounded-[14px]">
        <ul aria-label={s.list}>
          {ROWS.map((row) => {
            const Icon = row.icon;
            const words = rowText(row.key);
            const on = perm[row.key] ?? false;
            return (
              <li
                key={row.key}
                className="seam-t flex min-h-[64px] items-center gap-3 px-4 py-3 first:shadow-none"
              >
                <span
                  className={cn(
                    'well flex size-9 shrink-0 items-center justify-center rounded-[9px]',
                    on ? 'text-ink' : 'text-ink-muted',
                  )}
                  aria-hidden
                >
                  <Icon size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-large font-semibold text-ink">{words.title}</p>
                  <p className="text-footnote leading-snug text-ink-muted">{words.text}</p>
                </div>
                <Switch
                  words
                  checked={on}
                  disabled={busy}
                  onCheckedChange={(v) => setPerm((p) => ({ ...p, [row.key]: v }))}
                  label={words.title}
                />
              </li>
            );
          })}
        </ul>
      </div>

      {error && <ErrorLine>{error}</ErrorLine>}

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={back} disabled={busy}>
          <ArrowLeft size={18} aria-hidden /> {s.back}
        </Button>
        <Button
          size="lg"
          onClick={() => {
            playSound('click');
            void grant();
          }}
          disabled={busy}
        >
          {busy && !saved ? s.working : s.next} <ArrowRight size={18} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
