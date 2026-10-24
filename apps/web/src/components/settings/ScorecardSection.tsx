import { dotPalette } from '@monsters/monster-kit';
import { formatNumber, type ScorecardView } from '@monsters/shared';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getApi } from '../../store/app.ts';
import { useAgent, useNameOf } from '../../store/hooks.ts';
import { reorderedLines, scoreLines, type ScoreLine } from '../../store/instinct.ts';
import { AgentMark, Group, Row, RowBody, Status } from './parts.tsx';
import { teamStrings } from './team.strings.ts';

/*
 * Settings → Squad → Advanced → Monster scorecard (D-067, D-068): for each monster and
 * model, how many jobs, how many really finished, what a job that worked
 * costs; when the scorecard moved a model first in a chain, it says so in
 * words. The numbers sit on a small screen with a bar in the monster's light.
 */

/** Ten segments in the monster's light on a small screen: the share of jobs really finished. */
function ScoreDisplay({ line }: { line: ScoreLine }) {
  const agent = useAgent(line.agent);
  const lit = useMemo(() => (agent ? dotPalette(agent.genome).lit : 'var(--screen-ink)'), [agent]);
  const on = line.rate === null ? 0 : Math.round(line.rate * 10);
  return (
    <span
      className="screen inline-flex h-8 items-center gap-2.5 rounded-[8px] px-2.5"
      style={{ '--lit': lit } as CSSProperties}
      aria-hidden
    >
      <span className="flex items-center gap-[2px]">
        {Array.from({ length: 10 }, (_, i) => (
          <i
            key={i}
            className="block h-[12px] w-[4px] rounded-[1px]"
            style={{ background: i < on ? 'var(--lit)' : 'var(--screen-off)' }}
          />
        ))}
      </span>
      <span className="font-mono text-micro leading-none tracking-[0.04em] text-screen-ink tabular-nums">
        {line.verified}/{line.checked}
      </span>
    </span>
  );
}

function lineDescription(line: ScoreLine): string {
  const s = teamStrings().score;
  const parts = [s.jobs(line.delegations)];
  parts.push(s.finished(line.verified));
  if (line.costPerJob) parts.push(s.perJob(line.costPerJob));
  if (line.avgSteps !== null)
    parts.push(s.steps(formatNumber(line.avgSteps, { maximumFractionDigits: 1 })));
  return parts.join(' · ');
}

export function ScorecardSection() {
  const s = teamStrings().score;
  const nameOf = useNameOf();
  const [view, setView] = useState<ScorecardView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getApi()
      .scorecard()
      .then((v) => alive && (setView(v), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed)
    return (
      <p className="px-1 text-footnote text-ink-muted" role="status">
        {s.failed}
      </p>
    );
  if (!view) return null;

  const lines = scoreLines(view);
  const moved = reorderedLines(view, nameOf);
  const min = view.minDelegations;
  const ready = lines.filter((l) => l.missing === 0);
  const closest = [...lines].sort((a, b) => a.missing - b.missing)[0];

  let footer: string;
  if (!view.enabled) footer = s.footerOff;
  else if (lines.length === 0) footer = s.footerNone(min);
  else if (ready.length === 0 && closest)
    footer = s.footerClosest(min, closest.agentName, closest.checked);
  else footer = s.footerReady(min);

  return (
    <Group
      title={s.title}
      id="settings-pagella"
      testId="scorecard"
      as={lines.length > 0 ? 'ul' : 'div'}
      description={s.description}
      footer={footer}
    >
      {moved.length > 0 &&
        (lines.length > 0 ? (
          <li>
            <RowBody>
              {moved.map((m) => (
                <Status key={m} ok testId="scorecard-reordered">
                  {m}
                </Status>
              ))}
            </RowBody>
          </li>
        ) : (
          <RowBody>
            {moved.map((m) => (
              <Status key={m} ok testId="scorecard-reordered">
                {m}
              </Status>
            ))}
          </RowBody>
        ))}
      {lines.length === 0 ? (
        <RowBody>
          <p className="text-footnote leading-snug text-ink-muted" data-testid="scorecard-empty">
            {s.empty}
          </p>
        </RowBody>
      ) : (
        lines.map((l) => (
          <li key={l.key} data-testid={`scorecard-row-${l.agent}`}>
            <Row
              className="max-sm:items-start"
              leading={<AgentMark id={l.agent} color="var(--ink-muted)" width={40} height={34} />}
              label={
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{l.agentName}</span>
                  <span className="font-mono text-micro text-ink-muted">{l.model}</span>
                </span>
              }
              description={
                <>
                  {lineDescription(l)}
                  {/* On a phone the display goes under the words, in their column. */}
                  <span className="mt-2 block sm:hidden">
                    <ScoreDisplay line={l} />
                  </span>
                </>
              }
            >
              <span className="max-sm:hidden">
                <ScoreDisplay line={l} />
              </span>
              <span className="sr-only">{s.checkedOf(l.verified, l.checked)}</span>
            </Row>
          </li>
        ))
      )}
    </Group>
  );
}
