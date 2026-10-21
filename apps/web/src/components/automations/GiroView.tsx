import { dotPalette } from '@monsters/monster-kit';
import type { AutomationRunDetail, AutomationView } from '@monsters/shared';
import { CaretLeft, FileText } from '@phosphor-icons/react';
import { useMemo } from 'react';
import {
  formatWhen,
  runDuration,
  runStateText,
  runStateTone,
  triggerText,
  usageText,
} from '../../lib/automations.ts';
import { automationPath, notePath, PATHS } from '../../lib/router.ts';
import { cn, formatTime } from '../../lib/utils.ts';
import { useApp } from '../../store/app.ts';
import { usePrefs } from '../../store/prefs.ts';
import { useAgent, useResolvedTheme } from '../../store/hooks.ts';
import { bubbleColors } from '../../theme/bubbles.ts';
import { THEMES } from '../../theme/tokens.ts';
import { QuestionCard } from '../chat/QuestionCard.tsx';
import { FileById } from '../files/FileChip.tsx';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { Group } from '../settings/parts.tsx';
import { Markdown } from '../ui/Markdown.tsx';
import { automationsStrings } from './automations.strings.ts';
import { RunState } from './parts.tsx';
import '../chat/chat.css';

/*
 * One giro of an automation (docs/design.md, "Automazioni"): a conversation
 * of its own, read only, in the bubbles of the chat. On top the state of the
 * giro on a small screen (when, why, how long, what it used), the questions
 * that wait (answered here: a message in the chat of the capo does not answer
 * them, D-094), the capo's final answer and what the giro made (notes, files),
 * then the conversation: the objective, the capo, the monsters it asked.
 */

type Message = AutomationRunDetail['messages'][number];

function AgentMessage({ m, first }: { m: Message; first: boolean }) {
  const s = automationsStrings().giro;
  const agent = useAgent(m.agent);
  const theme = useResolvedTheme();
  const lit = useMemo(
    () => (agent ? dotPalette(agent.genome).lit : THEMES[theme].screenMuted),
    [agent, theme],
  );
  const c = bubbleColors(lit, theme);
  return (
    <div className={cn('pr-8 sm:pr-16', m.delegated && 'pl-6 sm:pl-10')} data-testid="giro-message">
      {first && (
        <p className="label mb-1.5 pl-[44px] text-ink-muted">
          {agent?.name ?? m.agent}
          {m.delegated ? s.forLead : ''} · {formatTime(m.ts)}
        </p>
      )}
      <div className="flex items-start gap-2.5">
        <div className="w-[34px] shrink-0">
          {first && agent && (
            <MonsterScreen
              genome={agent.genome}
              mood="idle"
              width={34}
              height={30}
              pad={2}
              animated={false}
            />
          )}
        </div>
        <span className="sr-only">{agent?.name ?? m.agent}:</span>
        <div
          className="bubble bubble-agent w-fit max-w-full min-w-0 px-4 py-2.5 text-large leading-[1.55] break-words"
          style={{ background: c.bg, color: c.fg }}
          data-testid="agent-bubble"
        >
          <Markdown text={m.text} codeBg={c.codeBg} />
        </div>
      </div>
    </div>
  );
}

function Objective({ m }: { m: Message }) {
  const s = automationsStrings().giro;
  return (
    <div className="flex flex-col items-end pl-12 sm:pl-24" data-testid="giro-objective">
      <p className="label mb-1.5 pr-1 text-ink-muted">
        {s.goal} · {formatTime(m.ts)}
      </p>
      <div className="bubble bubble-user w-fit max-w-full px-4 py-2.5 text-large leading-[1.55] whitespace-pre-wrap break-words">
        {m.text}
      </div>
    </div>
  );
}

function Results({ d }: { d: AutomationRunDetail }) {
  const s = automationsStrings().giro;
  if (d.notes.length === 0 && d.files.length === 0) return null;
  return (
    <Group title={s.results} testId="giro-results">
      <div className="grid gap-3 px-4 pt-1 pb-4">
        {d.notes.length > 0 && (
          <ul aria-label={s.notes} className="flex flex-wrap gap-2">
            {d.notes.map((p) => (
              <li key={p}>
                <a
                  href={notePath(p)}
                  className="md-note"
                  data-testid="giro-note"
                  title={s.openNote(p)}
                >
                  <FileText size={15} weight="fill" aria-hidden className="shrink-0" />
                  <span>{(p.split('/').pop() ?? p).replace(/\.md$/, '')}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {d.files.length > 0 && (
          <div className="grid gap-2">
            <ul aria-label={s.files} className="flex flex-wrap gap-2" data-testid="giro-files">
              {d.files.map((f) => (
                <li key={f.id} className="min-w-0">
                  <FileById id={f.id} />
                </li>
              ))}
            </ul>
            <a
              href={PATHS.files}
              className="text-footnote font-medium text-signal-ink hover:underline"
            >
              {s.allFiles}
            </a>
          </div>
        )}
      </div>
    </Group>
  );
}

export function GiroView({ a, d }: { a: AutomationView; d: AutomationRunDetail }) {
  const s = automationsStrings().giro;
  const known = useApp((st) => st.questions);
  const run = d.run;
  const duration = runDuration(run);
  const showDetails = usePrefs((p) => p.showDetails);
  const usage = usageText(run, showDetails);
  const when = formatWhen(run.slot ?? run.startedAt);
  const instr = [runStateText(run.state), triggerText(run.trigger), duration, usage].filter(
    (x): x is string => !!x,
  );
  const back = automationPath(a.id);
  return (
    <div className="grid gap-5" data-testid="giro-view" data-state={run.state}>
      <a
        href={back}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          window.location.hash = back;
        }}
        className="key-ghost -ml-1 flex h-10 w-fit items-center gap-0.5 rounded-[9px] pr-2.5 pl-1 text-body font-semibold text-signal-ink max-md:hidden"
      >
        <CaretLeft size={18} weight="bold" aria-hidden /> {s.backTo(a.name)}
      </a>
      <div className="screen grid gap-1 rounded-[14px] px-4 py-3" data-testid="giro-monitor">
        <h2 className="font-mono text-micro leading-5 tracking-[0.08em] text-screen-ink uppercase">
          {s.title(when)}
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-micro leading-4 tracking-[0.06em] text-screen-muted uppercase">
          <span aria-hidden className="led" data-on-screen="" data-tone={runStateTone(run.state)} />
          {instr.map((part, k) => (
            <span key={part} className="whitespace-nowrap">
              {k > 0 && <span aria-hidden>· </span>}
              {part}
            </span>
          ))}
        </p>
        {run.state === 'skipped' && run.message && (
          <p className="text-body text-screen-muted">{run.message}</p>
        )}
        {run.error && <p className="text-body text-screen-stop">{run.error}</p>}
      </div>

      {d.questions.length > 0 && (
        <section
          aria-label={s.waitingQuestions}
          className="grid gap-3"
          data-testid="giro-questions"
        >
          <p className="flex items-center gap-2 px-1 text-body text-ink">
            <RunState state="waiting_user" className="font-semibold" />
            <span className="text-ink-muted">{s.answerHere}</span>
          </p>
          {d.questions.map((q) =>
            known[q.id] ? (
              <QuestionCard key={q.id} questionId={q.id} answerField />
            ) : (
              <p key={q.id} className="set-module px-4 py-3 text-body text-ink">
                {q.question}
              </p>
            ),
          )}
        </section>
      )}

      {d.finalAnswer && (
        <Group title={s.finalAnswer} testId="giro-final">
          <div className="max-w-[68ch] px-4 pb-4 text-large leading-[1.55] text-ink">
            <Markdown text={d.finalAnswer} />
          </div>
        </Group>
      )}
      <Results d={d} />

      <section aria-labelledby="giro-chat-title" className="grid gap-3" data-testid="giro-chat">
        <h2 id="giro-chat-title" className="label px-1 text-ink-muted">
          {s.conversation}
        </h2>
        {d.messages.length === 0 ? (
          <p className="px-1 text-body text-ink-muted">{s.noMessages}</p>
        ) : (
          <ol className="grid gap-4">
            {d.messages.map((m, i) => {
              const prev = d.messages[i - 1];
              const first = !prev || prev.agent !== m.agent || prev.role !== m.role;
              return (
                <li key={m.id}>
                  {m.role === 'user' ? <Objective m={m} /> : <AgentMessage m={m} first={first} />}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
