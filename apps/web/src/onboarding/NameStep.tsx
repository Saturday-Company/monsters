import { ArrowRight } from '@phosphor-icons/react';
import {
  AGENT_NAME_PATTERN,
  appLang,
  DEFAULT_AGENT_PERMISSIONS,
  ONBOARDING_QUESTIONS,
  defaultWritingLanguage,
  type OnboardingAnswer,
  type OnboardingGroup,
  type OnboardingState,
} from '@monsters/shared';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/button.tsx';
import { Chip } from '../components/ui/controls.tsx';
import { Input, Label } from '../components/ui/field.tsx';
import { playSound } from '../lib/sound.ts';
import { domId } from '../lib/utils.ts';
import { onboardingApi, onboardingError } from './api.ts';
import { Guide } from './Guide.tsx';
import { nameStrings } from './name.strings.ts';
import { ErrorLine, genomeFrom } from './parts.tsx';

/*
 * The one question of the express first start: what to call you, and the lead's name,
 * already filled in. Work, hand-offs, rules, tone and writing language are the "Tell me more
 * about you" card in the lead's chat; until then the tone is friendly, the writing language the
 * app's, the always-asked kinds the four fixed ones, and the monsters may use the notes, the web
 * and run commands (D-159), as the squad screen says.
 */

const nomi = () => ONBOARDING_QUESTIONS.find((q) => q.id === 'nomi')!;
const group = (id: string): OnboardingGroup => nomi().groups.find((g) => g.id === id)!;

/** The tone and writing language a new install starts on, as the question would preselect them. */
function defaultTone(): OnboardingAnswer {
  const tono = ONBOARDING_QUESTIONS.find((q) => q.id === 'tono')!;
  const lingua = tono.groups.find((g) => g.id === 'lingua')!;
  const language = defaultWritingLanguage(
    lingua.options.map((o) => o.id),
    appLang(),
    typeof navigator === 'undefined' ? '' : (navigator.language ?? ''),
  );
  return {
    values: {
      tono: [...tono.groups.find((g) => g.id === 'tono')!.defaults],
      lingua: language ? [language] : [...lingua.defaults],
    },
  };
}

function NameField({
  group: g,
  value,
  onChange,
  invalid,
  autoFocus,
}: {
  group: OnboardingGroup;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  autoFocus: boolean;
}) {
  const id = domId(useId());
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{g.label}</Label>
      <Input
        id={id}
        value={value}
        maxLength={24}
        autoComplete={g.id === 'user' ? 'given-name' : 'off'}
        placeholder={g.placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid ? true : undefined}
        autoFocus={autoFocus}
      />
      {g.options.length > 0 && (
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label={nameStrings().suggestedNames}
        >
          {g.options.map((o) => (
            <Chip
              size="lg"
              key={o.id}
              role="radio"
              pressed={value.trim().toLowerCase() === o.id.toLowerCase()}
              onClick={() => onChange(o.id)}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

/** Step 2: your name and the lead's, on one screen. */
export function NameStep({
  state,
  onState,
  onDone,
}: {
  state: OnboardingState;
  onState: (s: OnboardingState) => void;
  /** The names are in (saved, or unchanged): on to the squad. */
  onDone: () => void;
}) {
  const s = nameStrings();
  const saved = state.answers['nomi']?.values;
  const [user, setUser] = useState(saved?.['user']?.[0] ?? '');
  const [lead, setLead] = useState(
    saved?.['orchestrator']?.[0] ?? group('orchestrator').defaults[0]!,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guideName = lead.trim() || state.guide.name;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const userName = user.trim();
    // The lead's name is optional: empty is the one it came with.
    const leadName = lead.trim() || group('orchestrator').defaults[0]!;
    if (!userName) return setProblem(s.writeName(group('user').label));
    if (![userName, leadName].every((n) => AGENT_NAME_PATTERN.test(n))) {
      return setProblem(s.badName);
    }
    setProblem(null);
    // Back from the squad with nothing changed: the proposal stays as it is.
    if (
      state.permissions &&
      saved?.['user']?.[0] === userName &&
      saved['orchestrator']?.[0] === leadName
    ) {
      onDone();
      return;
    }
    setBusy(true);
    try {
      const next = await onboardingApi.submit({
        answers: {
          nomi: { values: { user: [userName], orchestrator: [leadName] } },
          // Never over what an older start already answered.
          ...(state.answers['tono'] ? {} : { tono: defaultTone() }),
        },
        ...(state.permissions ? {} : { permissions: { ...DEFAULT_AGENT_PERMISSIONS } }),
      });
      onState(next);
      onDone();
    } catch (err) {
      setProblem(onboardingError(err));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      className="grid gap-6"
      data-testid="question"
      data-question="nomi"
    >
      {/* Before its name is chosen the guide is "il tuo primo mostro" (audit 2.16). */}
      <Guide
        genome={genomeFrom(state.guide.genome, guideName)}
        name={guideName}
        named={false}
        expression="talk"
        sayKey="q-nomi"
        say={nomi().title}
        hint={nomi().hint}
      />

      <fieldset className="grid gap-5" disabled={busy}>
        <legend className="sr-only">{nomi().title}</legend>
        <NameField
          group={group('user')}
          value={user}
          onChange={setUser}
          invalid={!!problem}
          autoFocus
        />
        <NameField
          group={group('orchestrator')}
          value={lead}
          onChange={setLead}
          invalid={!!problem}
          autoFocus={false}
        />
      </fieldset>

      {problem && <ErrorLine>{problem}</ErrorLine>}

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" size="lg" disabled={busy} onClick={() => playSound('click')}>
          {s.next} <ArrowRight size={18} aria-hidden />
        </Button>
      </div>
    </form>
  );
}
