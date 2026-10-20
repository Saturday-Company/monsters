import { dotPalette } from '@monsters/monster-kit';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { AgentView } from '../../store/hooks.ts';
import { Monster } from '../monster/Monster.tsx';

/**
 * The role as proposals write it ("trova idee e dati per i post", third person,
 * often lowercase) cannot be glued after "Sono Rhea.": it becomes a short
 * sentence of its own, with a capital, so the greeting reads as speech.
 */
export function roleSentence(role: string, isLead = false): string {
  const text = role.trim().replace(/[.:;,\s]+$/, '');
  if (!text) return '';
  return `${isLead ? 'Il mio ruolo' : 'Mi occupo di questo'}: ${text.charAt(0).toUpperCase()}${text.slice(1)}. `;
}

/**
 * What a monster says when its chat is empty, in its own words: a lively
 * monster (bounce) greets warmly, a calm one plainly; the lead speaks for the
 * team, a member for its role. Neutral forms: they read well whatever the
 * name and gender.
 */
export function greetingWords(
  agent: Pick<AgentView, 'name' | 'role' | 'isOrchestrator' | 'isLead'> & {
    genome: { personality: { bounce: number } };
  },
  noModel: boolean,
): { hello: string; words: string } {
  const lively = agent.genome.personality.bounce >= 0.55;
  const hello = lively ? `Eccomi! Sono ${agent.name}.` : `Ciao, sono ${agent.name}.`;
  if (noModel)
    return { hello, words: 'Per lavorare mi manca solo un modello: collegane uno e partiamo.' };
  if (agent.isOrchestrator)
    return {
      hello,
      words: lively
        ? 'Dimmi cosa ti serve: ci penso io, e se serve sveglio qualcuno della squadra.'
        : 'Dimmi cosa ti serve: ci penso io e, se serve, chiamo qualcuno della squadra.',
    };
  // The lead of a project passes the work to its monsters: "senza passare
  // dagli altri" said the opposite (collaudo of 17/10).
  if (agent.isLead)
    return {
      hello,
      words: `${roleSentence(agent.role, true)}${
        lively
          ? 'Dimmi cosa serve al progetto: ci penso io, e se serve lo passo ai mostri del progetto.'
          : 'Dimmi cosa serve al progetto: ci penso io e, se serve, lo passo ai mostri del progetto.'
      }`,
    };
  return {
    hello,
    words: `${roleSentence(agent.role)}${
      lively
        ? 'Scrivimi qui: rispondo io, al volo, senza passare dagli altri.'
        : 'Scrivimi qui: ti rispondo io, senza passare dagli altri.'
    }`,
  };
}

/** How long the monster talks before it rests (the words are on the screen). */
const TALK_MS = 2600;

/*
 * The empty chat (docs/design.md, "La chat"): the monster on a big screen,
 * talking for a moment, and its greeting in Martian Mono with a blinking
 * cursor (its name is on the monitor above, once is enough). Below, what to
 * do first.
 */
export function Greeting({
  agent,
  noModel,
  children,
}: {
  agent: AgentView;
  noModel: boolean;
  /** The first things to do (suggestions, "Collega un modello"). */
  children?: ReactNode;
}) {
  const [talking, setTalking] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTalking(false), TALK_MS);
    return () => clearTimeout(t);
  }, []);
  const lit = dotPalette(agent.genome).lit;
  const { hello, words } = greetingWords(agent, noModel);
  return (
    <div
      className="@container flex flex-1 flex-col items-center justify-center gap-6 py-10"
      data-testid="greeting"
    >
      <div
        className="screen screen-lines flex w-full max-w-[560px] flex-col items-center gap-5 rounded-[14px] px-6 py-7 @min-[480px]:flex-row @min-[480px]:items-center @min-[480px]:gap-7 @min-[480px]:px-8"
        style={{ '--lit': lit } as CSSProperties}
      >
        <Monster
          genome={agent.genome}
          size={136}
          expression={talking ? 'talk' : 'happy'}
          title={agent.name}
          className="shrink-0"
        />
        {/* The name is on the monitor above: here only the monster's words. */}
        <div className="min-w-0 text-center @min-[480px]:text-left">
          <p className="font-mono text-caption leading-[21px] text-screen-ink">
            {hello} {words}
            <span
              aria-hidden
              className="screen-cursor ml-1 inline-block h-[15px] w-[7px] translate-y-[2px]"
              style={{ background: lit }}
            />
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}
