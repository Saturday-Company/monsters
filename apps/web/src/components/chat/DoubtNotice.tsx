import { clipText, plainText } from '../../lib/markdown.ts';
import { capitalize } from '../../store/derive.ts';
import { closeDoubt, useDoubts } from '../../store/doubts.ts';
import { useAgent } from '../../store/hooks.ts';
import type { TurnFlag } from '../../store/turn.ts';
import { openTerminalAt } from '../terminal/focus.ts';
import { Button } from '../ui/button.tsx';
import { NoteChip } from '../ui/MarkdownRenderer.tsx';
import { chatStrings } from './chat.strings.ts';
import { prefillComposer } from './Composer.tsx';

/** The most notes shown as chips; the rest are in Behind the scenes. */
const MAX_NOTES = 6;
/** A criterion longer than this is cut in the notice and in the request. */
const MAX_POINT = 160;

/**
 * The doubt of the check ("really finished?" in the middle band) with what the person needs to
 * decide: the point it was unsure of, the notes delivered to open in the preview, and two keys,
 * "Looks fine" (closes the notice, for this browser) and "Ask <lead> to double-check" (writes
 * the request in the message field, never sends it). The sentence still opens Behind the scenes.
 */
export function DoubtNotice({
  flag,
  runId,
  lead,
}: {
  flag: TurnFlag & { doubt: NonNullable<TurnFlag['doubt']> };
  runId: string;
  /** The monster of this chat: the one who asked for the work. */
  lead: string;
}) {
  const { doubt } = flag;
  const s = chatStrings().strip;
  const closed = useDoubts((st) => st.closed.includes(doubt.id));
  const monster = useAgent(doubt.agent);
  const leader = useAgent(lead);
  if (closed) return null;
  const name = monster?.name ?? capitalize(doubt.agent);
  const points = doubt.points.map((p) => clipText(plainText(p), MAX_POINT));
  // Asking the monster to check its own work makes no sense: the key is for the one who asked.
  const canAsk = leader !== null && lead !== doubt.agent;
  const headline = points.length > 0 ? s.doubt.headline(name, points.length) : flag.text;
  return (
    <div className="flex items-start gap-2 text-footnote leading-snug" data-testid="doubt-notice">
      <span aria-hidden className="led mt-[6px]" data-tone="signal" />
      <div className="grid min-w-0 gap-1.5">
        <button
          type="button"
          onClick={() => openTerminalAt(flag.agent, runId)}
          title={chatStrings().events.instinctTitle(flag.text)}
          data-testid="turn-flag"
          data-tone={flag.tone}
          className="min-h-6 rounded-[6px] text-left text-signal-ink hover:underline focus-visible:outline-2 focus-visible:outline-signal-ink"
        >
          <span className="sr-only">{s.flag[flag.tone]}</span>
          {headline}
        </button>
        {points.length > 0 && (
          <ul className="grid gap-0.5 text-ink" data-testid="doubt-points">
            {points.map((p) => (
              <li key={p}>{s.doubt.point(p)}</li>
            ))}
          </ul>
        )}
        {doubt.notes.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="label text-ink-muted">{s.doubt.notes}</span>
            <span className="md flex flex-wrap gap-1.5 text-caption text-ink">
              {doubt.notes.slice(0, MAX_NOTES).map((n) => (
                <NoteChip key={n} target={n} />
              ))}
            </span>
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-0.5">
          <Button
            size="sm"
            variant="secondary"
            className="h-9 px-3.5 text-footnote"
            title={s.doubt.fineTitle}
            onClick={() => closeDoubt(doubt.id)}
            data-testid="doubt-fine"
          >
            {s.doubt.fine}
          </Button>
          {canAsk && (
            <Button
              size="sm"
              variant="secondary"
              className="h-9 px-3.5 text-footnote"
              title={s.doubt.askTitle}
              onClick={() => prefillComposer(s.doubt.request(name, points))}
              data-testid="doubt-ask"
            >
              {s.doubt.ask(leader.name)}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
