import { ArrowCounterClockwise, Plus } from '@phosphor-icons/react';
import {
  type ArchivedMemberView,
  type ProfileUpdate,
  type ProfileView,
  type TeamView,
} from '@monsters/shared';
import { useCallback, useEffect, useId, useState } from 'react';
import { squadsOf } from '../../lib/projects.ts';
import { projectPath, settingsPath, vaultPath } from '../../lib/router.ts';
import { domId } from '../../lib/utils.ts';
import { genomeFrom } from '../../onboarding/parts.tsx';
import { getApi, notify, refreshAgents } from '../../store/app.ts';
import { clearDraft, peekDraft } from '../../store/draft-handoff.ts';
import { useAgents } from '../../store/hooks.ts';
import { useProjects } from '../../store/projects.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { Button } from '../ui/button.tsx';
import { nameProblem, plainly, teamError } from './data.ts';
import { InstinctSection } from './InstinctSection.tsx';
import { Group, InlineEdit, Row, RowBody, selectClass, TextSetting } from './parts.tsx';
import { ScorecardSection } from './ScorecardSection.tsx';
import { AddMonster, MemberRow } from './TeamMembers.tsx';

/*
 * Settings → Squadra (D-058, D-066): who is in the team (rename, look, role
 * and duties, remove: archived, can come back; add), who the user is for
 * the monsters (the profile, also in the note Profilo), the instinct of the
 * team (InstinctSection.tsx, D-068) and the pagella of the monsters. What they
 * always ask lives in Permessi (AskAlwaysSection.tsx).
 */

/** The note with what the monsters know about the user (written by the onboarding). */
const PROFILE_NOTE = 'profilo.md';

/** A refused change that has no field of its own to show it: a toast. */
const complain = (err: unknown) => notify(teamError(err), 'error');

function ProfileGroups({
  profile,
  lead,
  save,
}: {
  profile: ProfileView;
  lead: TeamView['members'][number] | undefined;
  save: (update: ProfileUpdate, done: string) => Promise<void>;
}) {
  const toneId = domId(useId());
  const languageId = domId(useId());
  return (
    <>
      <Group
        title="Tu"
        testId="team-you"
        footer={
          <>
            Tutto questo sta anche nella nota{' '}
            <a
              href={vaultPath(PROFILE_NOTE)}
              className="font-medium text-ink underline underline-offset-2"
              data-testid="team-profile-link"
            >
              Profilo
            </a>
            , insieme a quello che i mostri imparano di te. Cosa ti chiedono sempre prima di agire
            lo scegli in{' '}
            <a
              href={settingsPath('permessi')}
              className="font-medium text-ink underline underline-offset-2"
              data-testid="team-ask-always-link"
            >
              Permessi
            </a>
            .
          </>
        }
      >
        <Row label="Il tuo nome" description="Come ti chiamano i mostri.">
          <InlineEdit
            value={profile.userName}
            label="il tuo nome"
            testId="team-user-name"
            check={nameProblem}
            onSave={(userName) =>
              plainly(() => save({ userName }, `Da ora i mostri ti chiamano ${userName}.`))
            }
          />
        </Row>
        <Row label="Il tuo capo" description="Ti risponde per primo e passa i compiti agli altri.">
          <InlineEdit
            value={profile.orchestratorName}
            label="il nome del tuo capo"
            testId="team-lead-name"
            check={nameProblem}
            before={
              lead && (
                <MonsterScreen
                  genome={genomeFrom(lead.genome, lead.name)}
                  mood="idle"
                  width={32}
                  height={28}
                />
              )
            }
            onSave={(orchestratorName) =>
              plainly(() =>
                save({ orchestratorName }, `Il tuo capo ora si chiama ${orchestratorName}.`),
              )
            }
          />
        </Row>
        <Row label="Tono" htmlFor={toneId} description="Come ti scrivono.">
          <select
            id={toneId}
            className={selectClass}
            value={profile.tone}
            onChange={(e) => void save({ tone: e.target.value }, 'Tono salvato.').catch(complain)}
          >
            {profile.options.tones.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Lingua" htmlFor={languageId} description="In che lingua ti rispondono.">
          <select
            id={languageId}
            className={selectClass}
            value={profile.language}
            onChange={(e) =>
              void save({ language: e.target.value }, 'Lingua salvata.').catch(complain)
            }
          >
            {profile.options.languages.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
        <TextSetting
          label="Il tuo stile"
          value={profile.style}
          empty="Niente di particolare."
          placeholder="Per esempio: frasi brevi, niente emoji, dammi sempre un esempio."
          onSave={(style) => plainly(() => save({ style }, 'Stile salvato.'))}
        />
      </Group>
    </>
  );
}

function ArchivedRow({
  member,
  onRestored,
}: {
  member: ArchivedMemberView;
  onRestored: () => void;
}) {
  const id = domId(useId());
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [name, setName] = useState('');
  const restore = async (newName?: string) => {
    setBusy(true);
    try {
      const back = await getApi().restoreMember(member.id, newName);
      notify(`${back.name} è di nuovo nella squadra.`, 'success');
      onRestored();
    } catch (err) {
      const text = teamError(err);
      if ((err as { code?: string }).code === 'name_taken' || newName) setAsking(text);
      else notify(text, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li data-testid={`team-archived-${member.id}`}>
      <Row
        leading={
          <MonsterScreen
            genome={genomeFrom(member.genome, member.name)}
            mood="stopped"
            width={52}
            height={44}
          />
        }
        label={member.name}
        description={`Tolto il ${new Date(member.archivedAt).toLocaleDateString('it-IT', {
          day: 'numeric',
          month: 'long',
        })} · ${member.role}`}
      >
        {!asking && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void restore()}>
            <ArrowCounterClockwise size={16} aria-hidden />
            Riporta
          </Button>
        )}
      </Row>
      {asking && (
        <form
          className="set-seam-t"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.replace(/\s+/g, ' ').trim();
            const p = nameProblem(n);
            if (p) return setAsking(p);
            void restore(n);
          }}
        >
          <RowBody>
            <p role="alert" className="text-footnote text-ink-muted">
              {asking}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={id} className="sr-only">
                Nuovo nome per {member.name}
              </label>
              <input
                id={id}
                value={name}
                maxLength={24}
                autoFocus
                placeholder="Un altro nome"
                onChange={(e) => setName(e.target.value)}
                className="well h-10 w-48 rounded-[10px] px-3.5 text-body text-ink focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink"
              />
              <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                Riporta con questo nome
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAsking(null)}>
                Annulla
              </Button>
            </div>
          </RowBody>
        </form>
      )}
    </li>
  );
}

/** The monsters of the projects, read-only here: a project's squad is managed on its page (U-12). */
function ProjectSquads() {
  const agents = useAgents();
  const projects = useProjects();
  const { squads } = squadsOf(agents, projects);
  const withProject = squads.filter((sq) => sq.key !== '');
  return (
    <>
      {withProject.map((sq) => (
        <li key={sq.key} className="list-none" data-testid={`team-squad-${sq.key}`}>
          <p className="label px-4 pt-3 pb-1 text-ink-muted">{sq.label}</p>
          <ul className="set-rows">
            {sq.members.map((m) => (
              <Row
                key={m.id}
                as="li"
                testId={`team-member-${m.id}`}
                leading={<MonsterScreen genome={m.genome} mood="idle" width={52} height={44} />}
                label={
                  <span className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className="text-large font-semibold">{m.name}</span>
                    {m.isLead && <span className="label text-signal-ink">capo del progetto</span>}
                  </span>
                }
                description={m.role}
              >
                <a
                  href={`#${projectPath(sq.key, 'squadra')}`}
                  className="text-footnote font-medium text-signal-ink hover:underline"
                  aria-label={`Apri la squadra di ${sq.label}`}
                >
                  Apri il progetto
                </a>
              </Row>
            ))}
          </ul>
        </li>
      ))}
    </>
  );
}

export function TeamTab() {
  const [team, setTeam] = useState<TeamView | null>(null);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [failed, setFailed] = useState(false);
  // "Cambia" on a proposal in the chat (D-075): the form opens with its draft.
  const [handoff] = useState(peekDraft);
  const [adding, setAdding] = useState(handoff !== null);
  useEffect(() => clearDraft(), []);

  const load = useCallback(() => {
    const api = getApi();
    void Promise.all([api.team(), api.profile()])
      .then(([t, p]) => {
        setTeam(t);
        setProfile(p);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  /** After a change: this page and the rest of the app (sidebar, chats) read the team again. */
  const changed = useCallback(() => {
    load();
    void refreshAgents().catch(() => {});
  }, [load]);

  const saveProfile = async (update: ProfileUpdate, done: string) => {
    setProfile(await getApi().updateProfile(update));
    notify(done, 'success');
    if (update.orchestratorName) changed();
  };

  if (failed) {
    return (
      <p className="px-1 text-footnote text-ink-muted" role="status">
        Non riesco a leggere la squadra adesso. Riprova tra poco.
      </p>
    );
  }
  if (!team || !profile) return null;

  const lead = team.members.find((m) => m.isOrchestrator);
  const others = team.members.filter((m) => !m.isOrchestrator);
  const full = others.length >= team.maxMembers;
  const taken = (n: string, self?: string) =>
    team.members.some((m) => m.id !== self && m.name.toLowerCase() === n.toLowerCase());

  return (
    <>
      <Group
        title="La squadra"
        as="ul"
        testId="team-members"
        footer={
          full
            ? `La squadra è al completo: al massimo ${team.maxMembers} mostri oltre al capo. Per aggiungerne uno, prima togline un altro.`
            : 'Ognuno ha la sua chat, i suoi compiti e una cartella nelle note dove scrive.'
        }
      >
        {lead && (
          <li className="list-none" data-testid="team-squad-boss">
            <p className="label px-4 pt-3 pb-1 text-ink-muted">Il tuo capo</p>
            <ul className="set-rows">
              <MemberRow member={lead} taken={taken} onChanged={changed} />
            </ul>
          </li>
        )}
        <li className="list-none" data-testid="team-squad-personal">
          <p className="label px-4 pt-3 pb-1 text-ink-muted">Squadra personale</p>
          <ul className="set-rows">
            {others.map((m) => (
              <MemberRow key={m.id} member={m} taken={taken} onChanged={changed} />
            ))}
            {!adding && (
              <li>
                <button
                  type="button"
                  disabled={full}
                  onClick={() => setAdding(true)}
                  className="row-key flex min-h-[52px] w-full items-center gap-2.5 px-4 text-left text-body font-medium text-ink [&_svg]:text-signal-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink disabled:text-ink-muted"
                >
                  <Plus size={18} aria-hidden />
                  Aggiungi un mostro
                </button>
              </li>
            )}
          </ul>
        </li>
        <ProjectSquads />
      </Group>

      {adding && (
        <AddMonster
          initial={handoff}
          taken={(n) => taken(n)}
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            changed();
          }}
        />
      )}

      {team.archived.length > 0 && (
        <Group
          title="Mostri archiviati"
          as="ul"
          testId="team-archived"
          footer="La loro chat resta in Attività. Riportati, ritrovano compiti e note."
        >
          {team.archived.map((a) => (
            <ArchivedRow key={a.id} member={a} onRestored={changed} />
          ))}
        </Group>
      )}

      <ProfileGroups profile={profile} lead={lead} save={saveProfile} />

      <InstinctSection />

      <ScorecardSection />
    </>
  );
}
