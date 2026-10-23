import { uiButtons, type UiNode } from '@monsters/shared';
import { useContext, useRef } from 'react';
import { errorText, notify } from '../../../store/app.ts';
import { cn } from '../../../lib/utils.ts';
import { UiReplyContext } from './reply.ts';
import { uiBlockViewStrings } from './ui-block.strings.ts';

/*
 * The buttons of a block (D-162): suggested next replies, in the style of the chat's keys. A tap
 * sends the label, exactly as drawn, as the user's message (never a hidden text: a block written
 * after a page was read cannot make the user say words they did not see) through the composer's
 * own path. No other action and no tool call comes from here. They can be pressed only while
 * the chat allows it (`replyGate`); otherwise they stay in sight, `aria-disabled`, with the
 * reason as title. Without a chat to send to they are not drawn at all.
 */

export function Buttons({ node, streaming }: { node: UiNode; streaming: boolean }) {
  const reply = useContext(UiReplyContext);
  const s = uiBlockViewStrings();
  // A tap before the chat shows the pending message must not send twice.
  const busy = useRef(false);
  if (!reply) return null;
  const buttons = uiButtons(node);
  if (buttons.length === 0) return null;
  const gate = streaming ? 'streaming' : reply.gate;
  const closed = gate !== 'open';
  const press = (label: string) => {
    if (closed || busy.current) return;
    busy.current = true;
    reply
      .send(label)
      .catch((err: unknown) => {
        notify(errorText(err), 'error');
      })
      .finally(() => {
        busy.current = false;
      });
  };
  return (
    <div
      className="ui-part ui-buttons"
      role="group"
      aria-label={s.buttons}
      data-testid="ui-buttons"
      data-gate={gate}
    >
      {buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          className={cn('key ui-button', b.primary && 'key-primary')}
          aria-disabled={closed ? 'true' : undefined}
          title={closed ? s.buttonsOff[gate] : s.sends(b.label)}
          data-testid="ui-button"
          data-primary={b.primary ? 'true' : undefined}
          onClick={() => press(b.label)}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
