import { Lock } from '@phosphor-icons/react';
import { SETTINGS_TABS, settingsLabel } from '@monsters/shared';
import type { ProfileUpdate, ProfileView } from '@monsters/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { settingsPath } from '../../lib/router.ts';
import { hashOf } from '../../lib/route-names.ts';
import { domId } from '../../lib/utils.ts';
import { errorText, getApi, notify, sendMessage, useApp } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Chip } from '../ui/controls.tsx';
import { Input, Label } from '../ui/field.tsx';
import { teamStrings } from '../settings/team.strings.ts';
import { prefillComposer } from './Composer.tsx';
import { firstStepsStrings } from './first-steps.strings.ts';

/*
 * After the first answer of the lead (plan C1, C7): one calm row of first jobs to try, and
 * the "Tell me more about you" card, the old questions of the first start (work, hand-offs, what
 * they always ask, tone, writing language) saved to the profile through the same API as Settings →
 * Squad → You. The card is skippable ("Not now" answers it empty, so it does not come back) and
 * opens again from the row or from a link (`tellMorePath`).
 */

/** The lead's chat with the card open: for a link from anywhere (a settings page, a message). */
export function tellMorePath(leadId: string): string {
  return hashOf('home', { chat: leadId, profile: '1' });
}

/**
 * What eats your time follows the work chosen (audit 2.11): the union of the lists of every work,
 * in the order of the question; the ones already chosen stay.
 */
const DELEGATE_BY_WORK: Record<string, string[]> = {
  social: ['bozze', 'piano', 'ricerche', 'note', 'numeri'],
  sviluppo: ['bug', 'test', 'docs', 'review', 'capire', 'ricerche'],
  marketing: ['ricerche', 'bozze', 'piano', 'numeri'],
  consulenza: ['ricerche', 'riassunti', 'bozze', 'note'],
  impresa: ['bozze', 'numeri', 'riassunti', 'note'],
  studio: ['ricerche', 'riassunti', 'note'],
  scrittura: ['bozze', 'riassunti', 'ricerche', 'note'],
};
const DELEGATE_DEFAULT = ['ricerche', 'bozze', 'riassunti', 'note', 'piano', 'numeri'];

function delegateShown(work: string[], chosen: string[]): Set<string> {
  const ids = work.flatMap((w) => DELEGATE_BY_WORK[w] ?? []);
  return new Set([...(ids.length ? ids : DELEGATE_DEFAULT), ...chosen]);
}

const toggle = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

/** Anything said already (a skipped card is an empty answer). */
const said = (p: ProfileView): boolean =>
  !!(p.work?.options.length || p.work?.text || p.delegate?.options.length || p.delegate?.text);

function ChipGroup({
  label,
  options,
  chosen,
  radio,
  onPick,
}: {
  label: string;
  options: { id: string; label: string }[];
  chosen: string[];
  radio?: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-footnote font-medium text-ink">{label}</p>
      <div
        className="flex flex-wrap gap-2"
        role={radio ? 'radiogroup' : 'group'}
        aria-label={label}
      >
        {options.map((o) => (
          <Chip
            key={o.id}
            {...(radio ? { role: 'radio' as const } : {})}
            pressed={chosen.includes(o.id)}
            onClick={() => onPick(o.id)}
          >
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function TellMoreCard({
  profile,
  onSaved,
  onSkip,
}: {
  profile: ProfileView;
  onSaved: (p: ProfileView) => void;
  onSkip: () => void;
}) {
  const s = firstStepsStrings().card;
  const [work, setWork] = useState(profile.work?.options ?? []);
  const [workText, setWorkText] = useState(profile.work?.text ?? '');
  const [delegate, setDelegate] = useState(profile.delegate?.options ?? []);
  const [tone, setTone] = useState(profile.tone);
  const [language, setLanguage] = useState(profile.language);
  const [goal, setGoal] = useState(profile.askAlways.extras.some((x) => x === 'goal'));
  const [askText, setAskText] = useState(profile.askAlways.text);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const textId = domId(useId());
  const askId = domId(useId());
  const goalOption = profile.options.extras[0];
  const shown = delegateShown(work, delegate);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const askChanged =
      goal !== profile.askAlways.extras.some((x) => x === 'goal') ||
      askText.trim() !== profile.askAlways.text;
    const extras: NonNullable<ProfileUpdate['askAlways']>['extras'] = goal ? ['goal'] : [];
    const update: ProfileUpdate = {
      work: { options: work, text: workText.trim() },
      delegate: { options: delegate, text: profile.delegate?.text ?? '' },
      ...(tone !== profile.tone ? { tone } : {}),
      ...(language !== profile.language ? { language } : {}),
      ...(askChanged ? { askAlways: { extras, text: askText.trim() } } : {}),
    };
    try {
      onSaved(await getApi().updateProfile(update));
    } catch {
      setProblem(s.failed);
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void save(e)}
      className="card grid gap-5 rounded-[14px] p-4 sm:p-5"
      data-testid="tell-more"
      aria-labelledby={`${textId}-title`}
    >
      <div className="grid gap-1">
        <h3 id={`${textId}-title`} className="text-large font-semibold text-ink">
          {s.title}
        </h3>
        <p className="text-footnote text-ink-muted">{s.hint}</p>
      </div>

      <fieldset className="grid gap-5" disabled={busy}>
        <legend className="sr-only">{s.title}</legend>
        <ChipGroup
          label={s.work}
          options={profile.options.work}
          chosen={work}
          onPick={(id) => setWork((w) => toggle(w, id))}
        />
        <div className="grid gap-2">
          <Label htmlFor={textId}>{s.workText}</Label>
          <Input
            id={textId}
            value={workText}
            maxLength={1000}
            onChange={(e) => setWorkText(e.target.value)}
          />
        </div>
        <ChipGroup
          label={s.delegate}
          options={profile.options.delegate.filter((o) => shown.has(o.id))}
          chosen={delegate}
          onPick={(id) => setDelegate((d) => toggle(d, id))}
        />

        {/* What they always ask: four kinds are fixed, one can be added, the rest in words (V-11). */}
        <div className="grid gap-2" data-testid="tell-more-ask">
          <p className="text-footnote font-medium text-ink">{s.ask}</p>
          <ul
            className="flex flex-wrap gap-x-4 gap-y-1.5 text-footnote text-ink-muted"
            aria-label={s.askFixed}
          >
            {profile.askAlways.fixed.map((f) => (
              <li key={f.id} className="flex items-center gap-1.5">
                <Lock size={14} aria-hidden /> {f.label}
              </li>
            ))}
          </ul>
          {goalOption && (
            <div className="flex flex-wrap gap-2">
              <Chip pressed={goal} onClick={() => setGoal((g) => !g)}>
                {goalOption.label}
              </Chip>
            </div>
          )}
          <Label htmlFor={askId} className="sr-only">
            {s.askText}
          </Label>
          <Input
            id={askId}
            value={askText}
            maxLength={1000}
            placeholder={s.askTextPlaceholder}
            aria-label={s.askText}
            onChange={(e) => setAskText(e.target.value)}
          />
        </div>

        <ChipGroup
          label={s.tone}
          options={profile.options.tones}
          chosen={[tone]}
          radio
          onPick={setTone}
        />
        <ChipGroup
          label={s.language}
          options={profile.options.languages}
          chosen={[language]}
          radio
          onPick={setLanguage}
        />
      </fieldset>

      {problem && (
        <p role="alert" className="text-footnote text-stop-ink">
          {problem}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onSkip} disabled={busy}>
          {s.notNow}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? s.saving : s.save}
        </Button>
      </div>
    </form>
  );
}

/**
 * The card (until it is answered or skipped) and one compact row: first jobs to try, and a key to
 * open the card again. Shown in the lead's chat after its first answer.
 */
export function FirstSteps({ forceOpen }: { forceOpen: boolean }) {
  const s = firstStepsStrings();
  const halted = useApp((st) => st.halted);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  // An invitation by itself (calm: it does not push the answer out of sight), the form once
  // asked for, or at once when a link asks (`tellMorePath`), until it is closed.
  const [stage, setStage] = useState<'invite' | 'form' | null>(null);
  const [closed, setClosed] = useState(false);
  const shown = closed ? null : forceOpen ? 'form' : stage;
  const show = (what: 'invite' | 'form' | null) => {
    setStage(what);
    setClosed(what === null);
  };
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    getApi()
      .profile()
      .then((p) => {
        if (!alive) return;
        setProfile(p);
        // Nobody answered or skipped it yet: it comes by itself, once.
        if (p.work === null || p.delegate === null) setStage('invite');
      })
      // No profile (an old core): no card, the row of jobs still works.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const skip = async () => {
    if (!profile) return;
    show(null);
    try {
      // An empty answer: the card does not come back by itself.
      setProfile(
        await getApi().updateProfile({
          ...(profile.work === null ? { work: { options: [], text: '' } } : {}),
          ...(profile.delegate === null ? { delegate: { options: [], text: '' } } : {}),
        }),
      );
    } catch {
      // It stays unanswered: it comes again next time.
    }
  };

  const pick = (text: string) => {
    if (text.endsWith('…')) {
      prefillComposer(`${text.slice(0, -1)} `);
      return;
    }
    sendMessage(text).catch((err: unknown) => notify(errorText(err), 'error'));
  };

  const where = `${settingsLabel()} → ${SETTINGS_TABS.squadra} → ${teamStrings().tab.youTitle}`;
  return (
    <div className="grid gap-4" data-testid="first-steps">
      {shown === 'invite' && profile && (
        <div
          className="card flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[14px] p-4"
          data-testid="tell-more-invite"
        >
          <div className="grid min-w-0 flex-1 basis-56 gap-1">
            <p className="text-large font-semibold text-ink">{s.card.title}</p>
            <p className="text-footnote text-ink-muted">{s.card.hint}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => void skip()}>
              {s.card.notNow}
            </Button>
            <Button variant="secondary" onClick={() => show('form')}>
              {s.card.open}
            </Button>
          </div>
        </div>
      )}
      {shown === 'form' && profile && (
        <TellMoreCard
          profile={profile}
          onSaved={(p) => {
            setProfile(p);
            show(null);
            setSaved(true);
          }}
          onSkip={() => void skip()}
        />
      )}
      {saved && !shown && (
        <p className="text-footnote text-ink-muted" role="status" data-testid="tell-more-saved">
          {s.card.saved}{' '}
          <a
            href={settingsPath('squadra')}
            className="font-medium text-ink underline underline-offset-2"
          >
            {where}
          </a>
          {s.card.savedAfter}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2" data-testid="first-jobs">
        <span className="label mr-1 text-ink-muted">{s.examples.label}</span>
        <ul className="contents">
          {s.examples.list.map((text) => (
            <li key={text}>
              <Button
                variant="secondary"
                size="sm"
                className="font-medium"
                disabled={halted && !text.endsWith('…')}
                onClick={() => pick(text)}
              >
                {text}
              </Button>
            </li>
          ))}
        </ul>
        {!shown && profile && !said(profile) && (
          <Button variant="ghost" size="sm" onClick={() => show('form')}>
            {s.examples.tellMore}
          </Button>
        )}
      </div>
    </div>
  );
}
