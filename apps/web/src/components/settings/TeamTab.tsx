import { ArrowCounterClockwise, Plus } from '@phosphor-icons/react';
import {
  SETTINGS_SECTIONS,
  vaultLayout,
  formatDate,
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
import { partsStrings } from './parts.strings.ts';
import {
  DisclosureRow,
  Group,
  InlineEdit,
  LoadFailed,
  Row,
  RowBody,
  selectClass,
  TextSetting,
} from './parts.tsx';
import { ScorecardSection } from './ScorecardSection.tsx';
import { useSettingsTarget } from './settings-target.ts';
import { teamStrings } from './team.strings.ts';
import { AddMonster, MemberRow } from './TeamMembers.tsx';

/*
 * Settings → Squadra (D-058, D-066): who is in the team (rename, look, role
 * and duties, remove: archived, can come back; add; the lead is renamed on
 * its own row), who the user is for the monsters (the profile, also in the
 * note Profilo) and, in a closed drawer at the bottom (Advanced), the instinct
 * of the team (InstinctSection.tsx, D-068) and the pagella of the monsters.
 * What they always ask lives in Permessi (AskAlwaysSection.tsx).
 */

/** A refused change that has no field of its own to show it: a toast. */
const complain = (err: unknown) => notify(teamError(err), 'error');

function ProfileGroups({
  profile,
  save,
}: {
  profile: ProfileView;
  save: (update: ProfileUpdate, done: string) => Promise<void>;
}) {
  const s = teamStrings().tab;
  const toneId = domId(useId());
  const languageId = domId(useId());
  return (
    <>
      <Group
        title={s.youTitle}
        testId="team-you"
        footer={
          <>
            {s.footerBefore}
            <a
              href={vaultPath(vaultLayout().profile)}
              className="font-medium text-ink underline underline-offset-2"
              data-testid="team-profile-link"
            >
              {s.profileLink}
            </a>
            {s.footerMid}
            <a
              href={settingsPath('permessi')}
              className="font-medium text-ink underline underline-offset-2"
              data-testid="team-ask-always-link"
            >
              {s.permissionsLink}
            </a>
            {s.footerAfter}
          </>
        }
      >
        <Row label={s.yourName} description={s.yourNameHint}>
          <InlineEdit
            value={profile.userName}
            label={s.yourNameLabel}
            testId="team-user-name"
            check={nameProblem}
            onSave={(userName) => plainly(() => save({ userName }, s.nameSaved(userName)))}
          />
        </Row>
        <Row label={s.tone} htmlFor={toneId} description={s.toneHint}>
          <select
            id={toneId}
            className={selectClass}
            value={profile.tone}
            onChange={(e) => void save({ tone: e.target.value }, s.toneSaved).catch(complain)}
          >
            {profile.options.tones.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label={s.language} htmlFor={languageId} description={s.languageHint}>
          <select
            id={languageId}
            className={selectClass}
            value={profile.language}
            onChange={(e) =>
              void save({ language: e.target.value }, s.languageSaved).catch(complain)
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
          label={s.style}
          value={profile.style}
          empty={s.styleEmpty}
          placeholder={s.stylePlaceholder}
          onSave={(style) => plainly(() => save({ style }, s.styleSaved))}
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
  const s = teamStrings().tab;
  const common = partsStrings();
  const id = domId(useId());
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [name, setName] = useState('');
  const restore = async (newName?: string) => {
    setBusy(true);
    try {
      const back = await getApi().restoreMember(member.id, newName);
      notify(s.backInSquad(back.name), 'success');
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
        description={s.removedOn(
          formatDate(member.archivedAt, { day: 'numeric', month: 'long' }),
          member.role,
        )}
      >
        {!asking && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void restore()}>
            <ArrowCounterClockwise size={16} aria-hidden />
            {s.bringBack}
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
                {s.newNameFor(member.name)}
              </label>
              <input
                id={id}
                value={name}
                maxLength={24}
                autoFocus
                placeholder={s.anotherName}
                onChange={(e) => setName(e.target.value)}
                className="well h-10 w-48 rounded-[10px] px-3.5 text-body text-ink focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink"
              />
              <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                {s.bringBackAs}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAsking(null)}>
                {common.cancel}
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
  const s = teamStrings().tab;
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
                    {m.isLead && <span className="label text-signal-ink">{s.projectLead}</span>}
                  </span>
                }
                description={m.role}
              >
                <a
                  href={projectPath(sq.key, 'squadra')}
                  className="text-footnote font-medium text-signal-ink hover:underline"
                  aria-label={s.openSquadOf(sq.label)}
                >
                  {s.openProject}
                </a>
              </Row>
            ))}
          </ul>
        </li>
      ))}
    </>
  );
}

/** The parts of the tab inside Advanced: a link to one of them opens the drawer first. */
const ADVANCED_PARTS: ReadonlySet<string> = new Set(['avanzate', 'istinto', 'pagella']);

/**
 * "Advanced": one closed drawer at the bottom with the instinct (who takes the quick calls) and
 * the scorecard. A link to either (`?sezione=istinto`, `?sezione=pagella`) opens it, and the
 * view then scrolls to the part.
 */
function Advanced() {
  const s = teamStrings().tab;
  const target = useSettingsTarget();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  if (target !== seen) {
    setSeen(target);
    if (target && ADVANCED_PARTS.has(target)) setOpen(true);
  }
  return (
    <>
      <Group label={SETTINGS_SECTIONS.avanzate.label} id="settings-avanzate" testId="team-advanced">
        <DisclosureRow
          as="div"
          label={SETTINGS_SECTIONS.avanzate.label}
          description={s.advancedHint}
          open={open}
          onOpenChange={setOpen}
          testId="team-advanced-toggle"
          advanced
        />
      </Group>
      {open && (
        <>
          <InstinctSection />
          <ScorecardSection />
        </>
      )}
    </>
  );
}

export function TeamTab() {
  const s = teamStrings().tab;
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
  };

  const retry = () => {
    setFailed(false);
    load();
  };
  if (failed) return <LoadFailed what={s.what} onRetry={retry} />;
  if (!team || !profile) return null;

  const lead = team.members.find((m) => m.isOrchestrator);
  const others = team.members.filter((m) => !m.isOrchestrator);
  const full = others.length >= team.maxMembers;
  const taken = (n: string, self?: string) =>
    team.members.some((m) => m.id !== self && m.name.toLowerCase() === n.toLowerCase());

  return (
    <>
      <Group
        title={s.squad}
        as="ul"
        testId="team-members"
        footer={full ? s.squadFull(team.maxMembers) : s.squadFooter}
      >
        {lead && (
          <li className="list-none" data-testid="team-squad-boss">
            <p className="label px-4 pt-3 pb-1 text-ink-muted">{s.leadGroup}</p>
            <ul className="set-rows">
              <MemberRow member={lead} taken={taken} onChanged={changed} />
            </ul>
          </li>
        )}
        <li className="list-none" data-testid="team-squad-personal">
          <p className="label px-4 pt-3 pb-1 text-ink-muted">{s.personalSquad}</p>
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
                  {s.addMonster}
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
        <Group title={s.archived} as="ul" testId="team-archived" footer={s.archivedFooter}>
          {team.archived.map((a) => (
            <ArchivedRow key={a.id} member={a} onRestored={changed} />
          ))}
        </Group>
      )}

      <ProfileGroups profile={profile} save={saveProfile} />

      <Advanced />
    </>
  );
}
