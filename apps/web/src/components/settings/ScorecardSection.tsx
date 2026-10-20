import { dotPalette } from '@monsters/monster-kit';
import type { ScorecardView } from '@monsters/shared';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getApi } from '../../store/app.ts';
import { useAgent, useNameOf } from '../../store/hooks.ts';
import { reorderedLines, scoreLines, type ScoreLine } from '../../store/instinct.ts';
import { AgentMark, Group, Row, RowBody, Status } from './parts.tsx';

/*
 * Settings → Squadra → Pagella dei mostri (D-067, D-068): for each monster and
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
  const parts = [`${line.delegations} ${line.delegations === 1 ? 'lavoro' : 'lavori'}`];
  parts.push(`${line.verified} ${line.verified === 1 ? 'finito' : 'finiti'} davvero`);
  if (line.costPerJob) parts.push(`${line.costPerJob} a lavoro riuscito`);
  if (line.avgSteps !== null)
    parts.push(
      `${line.avgSteps.toLocaleString('it-IT', { maximumFractionDigits: 1 })} passi in media`,
    );
  return parts.join(' · ');
}

export function ScorecardSection() {
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
        Non riesco a leggere la pagella dei mostri adesso. Riprova tra poco.
      </p>
    );
  if (!view) return null;

  const lines = scoreLines(view);
  const moved = reorderedLines(view, nameOf);
  const min = view.minDelegations;
  const ready = lines.filter((l) => l.missing === 0);
  const closest = [...lines].sort((a, b) => a.missing - b.missing)[0];

  let footer: string;
  if (!view.enabled)
    footer = `La pagella resta solo da leggere: «Impara quale modello lavora meglio» è spento in Decisioni dei mostri.`;
  else if (lines.length === 0)
    footer = `Servono almeno ${min} lavori controllati per modello prima che la squadra cambi l’ordine dei modelli.`;
  else if (ready.length === 0 && closest)
    footer = `Servono almeno ${min} lavori controllati per modello prima di cambiare l’ordine: ${closest.agentName} è a ${closest.checked}.`;
  else
    footer = `Dopo ${min} lavori controllati un modello può passare primo, tra quelli che il mostro ha già. Non usa mai modelli a pagamento se li hai spenti.`;

  return (
    <Group
      title="Pagella dei mostri"
      id="settings-pagella"
      testId="scorecard"
      as={lines.length > 0 ? 'ul' : 'div'}
      description="Per ogni mostro e modello: quanti lavori, quanti finiti davvero e quanto costa un lavoro riuscito."
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
            Ancora nessun lavoro controllato: la pagella si riempie man mano che i mostri finiscono
            i compiti.
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
              <span className="sr-only">
                {l.verified} su {l.checked} controllati finiti davvero
              </span>
            </Row>
          </li>
        ))
      )}
    </Group>
  );
}
