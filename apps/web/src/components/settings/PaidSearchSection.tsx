import {
  SETTINGS_TABS,
  type PaidSearchEngineName,
  type SettingsResponse,
  type WebSearchSettings,
} from '@monsters/shared';
import { useState } from 'react';
import { errorText, getApi, notify } from '../../store/app.ts';
import { settingsPath } from '../../lib/router.ts';
import { eurFirst } from '../../lib/utils.ts';
import { Segmented, Switch } from '../ui/controls.tsx';
import { Row, RowBody } from './parts.tsx';
import { searchStrings } from './search.strings.ts';

/*
 * Settings → Apps and Telegram → Web search, the paid search row (D-071; one place, U-12): the
 * paid search on OpenRouter.
 * One lever: on, the monsters search through OpenRouter with the account's credit
 * (~1 $ every 1,000 searches); off, the free chain (DuckDuckGo, then
 * Wikipedia). Untouched, it follows the paid-models switch of Models, whose home that is: where
 * this row depends on it, it says so in a line with the link (C8). With the
 * lever on, the engine: Cheap (Parallel) or Precise (Exa).
 */

/** "0.9 € (1.1 $)": the cost of 1,000 searches, euros first as the caps are. */
export function per1000(usd: number): string {
  return eurFirst(usd);
}

/** The sentence under the lever: what happens now, and why when it is not on. */
export function paidSearchText(ws: WebSearchSettings): string {
  const s = searchStrings().paid;
  const cost = s.cost(per1000(ws.usdPer1000[ws.engine]));
  if (ws.active) return s.active(cost);
  switch (ws.reason) {
    case 'no_key':
      return s.noKey;
    case 'spend_cap':
      return s.spendCap;
    case 'no_credit':
      return s.noCredit;
    case 'key_rejected':
      return s.keyRejected;
    case 'paused':
      return s.paused;
    case 'free_only':
      return s.freeOnly(cost);
    default:
      return s.off(cost);
  }
}

/** The lever: on when chosen, or when left to follow the models and paid models are on. */
export function paidSearchOn(ws: WebSearchSettings, freeOnly: boolean): boolean {
  return ws.mode === 'on' || (ws.mode === 'auto' && !freeOnly);
}

/** The paid search's row (and its engine) in the Web search group. */
export function PaidSearchRow({
  settings,
  onChanged,
}: {
  settings: SettingsResponse | null;
  onChanged: () => void;
}) {
  const s = searchStrings().paid;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ws = settings?.webSearch;
  if (!ws) return null;
  const freeOnly = settings.openrouterKey.freeOnly;
  const on = paidSearchOn(ws, freeOnly);
  const noKey = ws.reason === 'no_key';
  // What depends on the OpenRouter account or on paid models is set in Models: a line, not a switch.
  const inModels =
    ws.reason === 'no_key' ||
    ws.reason === 'no_credit' ||
    ws.reason === 'key_rejected' ||
    ws.reason === 'free_only';

  const apply = async (change: { mode?: 'on' | 'off'; engine?: PaidSearchEngineName }) => {
    setBusy(true);
    setError(null);
    try {
      await getApi().setWebSearch(change);
      onChanged();
      if (change.mode) {
        notify(change.mode === 'on' ? s.turnedOn : s.turnedOff, 'success');
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="paid-search-row"
      data-on={on ? 'yes' : 'no'}
      data-active={ws.active ? 'yes' : 'no'}
    >
      <Row
        label={s.title}
        description={
          <>
            <span data-testid="paid-search-status">{paidSearchText(ws)}</span>
            {inModels && (
              <span data-testid="paid-search-models">
                {' '}
                {s.modelsBefore}
                <a
                  href={settingsPath('modelli')}
                  className="font-medium text-ink underline underline-offset-2"
                >
                  {SETTINGS_TABS.modelli}
                </a>
                {s.modelsAfter}
              </span>
            )}
          </>
        }
      >
        <Switch
          words
          checked={on}
          disabled={busy || (noKey && !on)}
          onCheckedChange={(v) => void apply({ mode: v ? 'on' : 'off' })}
          label={s.title}
        />
      </Row>
      {(on || error) && (
        <RowBody className="pt-0">
          {on && (
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                size="sm"
                label={s.engine}
                value={ws.engine}
                onChange={(engine) => {
                  if (engine !== ws.engine) void apply({ engine });
                }}
                options={[
                  {
                    value: 'parallel',
                    label: s.cheap(per1000(ws.usdPer1000.parallel)),
                  },
                  { value: 'exa', label: s.precise(per1000(ws.usdPer1000.exa)) },
                ]}
              />
              <span className="text-footnote text-ink-muted">{s.per1000}</span>
            </div>
          )}
          {error && (
            <p className="text-footnote text-stop-ink" role="alert">
              {error}
            </p>
          )}
        </RowBody>
      )}
    </div>
  );
}
