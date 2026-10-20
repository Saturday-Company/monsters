import { SETTINGS_SECTIONS } from '@monsters/shared';
import type { ProfileUpdate, ProfileView } from '@monsters/shared';
import { useCallback, useEffect, useState } from 'react';
import { PATHS } from '../../lib/router.ts';
import { getApi, notify } from '../../store/app.ts';
import { Switch } from '../ui/controls.tsx';
import { plainly, teamError } from './data.ts';
import { Group, Row, TextSetting } from './parts.tsx';

/*
 * Settings → Permessi, first group (D-066): what the monsters always ask
 * before acting. Publishing, writing to others, spending and deleting are
 * fixed; a few more can be turned on, and anything else said in words. It is
 * part of the profile (the core keeps it there), shown where the user looks
 * for permissions.
 */

const complain = (err: unknown) => notify(teamError(err), 'error');

export function AskAlwaysSection() {
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    getApi()
      .profile()
      .then((p) => {
        setProfile(p);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const save = async (update: ProfileUpdate, done: string) => {
    setProfile(await getApi().updateProfile(update));
    notify(done, 'success');
  };

  if (failed)
    return (
      <p className="px-1 text-footnote text-ink-muted" role="status">
        Non riesco a leggere cosa ti chiedono sempre. Riprova tra poco.
      </p>
    );
  if (!profile) return null;

  const extras = profile.askAlways.extras;
  const fixed = profile.askAlways.fixed
    .map((f, i) => (i === 0 ? f.label : f.label.charAt(0).toLowerCase() + f.label.slice(1)))
    .join(', ');
  return (
    <Group
      title={SETTINGS_SECTIONS.teLoChiedonoSempre.label}
      testId="team-ask-always"
      id="settings-chiedono"
      footer={
        <>
          Per tutto il resto decidono i mostri: chi decide lo scegli in{' '}
          <a
            href={`${PATHS.settings}?sezione=istinto`}
            className="font-medium text-ink underline underline-offset-2"
            data-testid="ask-always-instinct-link"
          >
            Squadra → Decisioni dei mostri
          </a>
          .
        </>
      }
    >
      <Row label={fixed} description="Sempre: non si può spegnere." />
      {profile.options.extras.map((o) => (
        <Row key={o.id} label={o.label}>
          <Switch
            words
            checked={extras.some((x) => x === o.id)}
            label={o.label}
            onCheckedChange={(on) =>
              void save(
                {
                  askAlways: {
                    extras: on
                      ? [...extras, o.id as (typeof extras)[number]]
                      : extras.filter((x) => x !== o.id),
                    text: profile.askAlways.text,
                  },
                },
                on ? `Da ora ti chiedono prima di: ${o.label.toLowerCase()}.` : 'Fatto.',
              ).catch(complain)
            }
          />
        </Row>
      ))}
      <TextSetting
        label="Altro da chiederti sempre"
        value={profile.askAlways.text}
        empty="Niente altro."
        placeholder="Per esempio: prima di toccare i file del lavoro."
        onSave={(text) => plainly(() => save({ askAlways: { extras, text } }, 'Salvato.'))}
      />
    </Group>
  );
}
