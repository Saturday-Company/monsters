import type { PaidSearchEngineName, SettingsResponse, WebSearchSettings } from '@monsters/shared';
import { useState } from 'react';
import { errorText, getApi, notify } from '../../store/app.ts';
import { eurFirst } from '../../lib/utils.ts';
import { Segmented, Switch } from '../ui/controls.tsx';
import { Group, Row, RowBody } from './parts.tsx';

/*
 * Settings → Collegamenti → Ricerca a pagamento (D-071; one place, U-12): the paid search on OpenRouter.
 * One lever: on, the monsters search through OpenRouter with the key's credit
 * (~1 $ every 1,000 searches); off, the free chain (DuckDuckGo, then
 * Wikipedia). Untouched, it follows "Usa anche modelli a pagamento". With the
 * lever on, the engine: Economica (Parallel) or Precisa (Exa).
 */

/** "0,9 € (1,1 $)": the cost of 1,000 searches, euros first as the caps are. */
export function per1000(usd: number): string {
  return eurFirst(usd);
}

/** The sentence under the lever: what happens now, and why when it is not on. */
export function paidSearchText(ws: WebSearchSettings): string {
  const cost = `circa ${per1000(ws.usdPer1000[ws.engine])} ogni 1.000 ricerche`;
  if (ws.active) {
    return `I mostri cercano con OpenRouter: risultati più affidabili, ${cost} dal credito della tua chiave. Se il credito finisce, tornano alla ricerca gratuita da soli.`;
  }
  switch (ws.reason) {
    case 'no_key':
      return 'Serve una chiave OpenRouter con credito. Intanto i mostri cercano gratis con DuckDuckGo e Wikipedia, che dopo qualche decina di ricerche si bloccano.';
    case 'spend_cap':
      return 'Il tetto di spesa è raggiunto: fino a quando non lo alzi, o finisce il periodo, i mostri cercano gratis con DuckDuckGo e Wikipedia.';
    case 'no_credit':
      return 'La chiave OpenRouter non ha credito: per ora i mostri cercano gratis con DuckDuckGo e Wikipedia.';
    case 'key_rejected':
      return 'OpenRouter ha rifiutato la chiave: controllala nelle impostazioni. Intanto i mostri cercano gratis con DuckDuckGo e Wikipedia.';
    case 'paused':
      return 'La ricerca a pagamento è in pausa perché non ha dato risultati: per ora i mostri cercano gratis con DuckDuckGo e Wikipedia, poi riprova da sola.';
    case 'free_only':
      return `Spenta come i modelli a pagamento: i mostri cercano gratis con DuckDuckGo e Wikipedia, che dopo qualche decina di ricerche si bloccano. Accesa costa ${cost}.`;
    default:
      return `Spenta: i mostri cercano gratis con DuckDuckGo e Wikipedia. Accesa costa ${cost}.`;
  }
}

/** The lever: on when chosen, or when left to follow the models and paid models are on. */
export function paidSearchOn(ws: WebSearchSettings, freeOnly: boolean): boolean {
  return ws.mode === 'on' || (ws.mode === 'auto' && !freeOnly);
}

export function PaidSearchSection({
  settings,
  onChanged,
}: {
  settings: SettingsResponse | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ws = settings?.webSearch;
  if (!ws) return null;
  const freeOnly = settings.openrouterKey.freeOnly;
  const on = paidSearchOn(ws, freeOnly);
  const noKey = ws.reason === 'no_key';

  const apply = async (change: { mode?: 'on' | 'off'; engine?: PaidSearchEngineName }) => {
    setBusy(true);
    setError(null);
    try {
      await getApi().setWebSearch(change);
      onChanged();
      if (change.mode) {
        notify(
          change.mode === 'on'
            ? 'Ricerca a pagamento accesa, da subito.'
            : 'Di nuovo ricerca gratuita, da subito.',
          'success',
        );
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Ricerca a pagamento" testId="paid-search">
      <div
        data-testid="paid-search-row"
        data-on={on ? 'yes' : 'no'}
        data-active={ws.active ? 'yes' : 'no'}
      >
        <Row
          label="Ricerca a pagamento"
          description={<span data-testid="paid-search-status">{paidSearchText(ws)}</span>}
        >
          <Switch
            words
            checked={on}
            disabled={busy || (noKey && !on)}
            onCheckedChange={(v) => void apply({ mode: v ? 'on' : 'off' })}
            label="Ricerca a pagamento"
          />
        </Row>
        {(on || error) && (
          <RowBody className="pt-0">
            {on && (
              <div className="flex flex-wrap items-center gap-3">
                <Segmented
                  size="sm"
                  label="Motore della ricerca a pagamento"
                  value={ws.engine}
                  onChange={(engine) => {
                    if (engine !== ws.engine) void apply({ engine });
                  }}
                  options={[
                    {
                      value: 'parallel',
                      label: `Economica · ${per1000(ws.usdPer1000.parallel)}`,
                    },
                    { value: 'exa', label: `Precisa · ${per1000(ws.usdPer1000.exa)}` },
                  ]}
                />
                <span className="text-footnote text-ink-muted">ogni 1.000 ricerche</span>
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
    </Group>
  );
}
