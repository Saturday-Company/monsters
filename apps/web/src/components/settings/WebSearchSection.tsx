import { ArrowSquareOut } from '@phosphor-icons/react';
import { BraveKeyRequestSchema, type SettingsResponse, SETTINGS_SECTIONS } from '@monsters/shared';
import { useId, useState, type FormEvent } from 'react';
import { cn, domId } from '../../lib/utils.ts';
import { errorText, getApi, notify } from '../../store/app.ts';
import { Button, buttonVariants } from '../ui/button.tsx';
import { Input } from '../ui/field.tsx';
import { fieldOnGroup, FormField, Group, Row, RowBody } from './parts.tsx';

/*
 * Settings → Collegamenti → Ricerca sul web: without a key the
 * monsters search with DuckDuckGo (Wikipedia as a fallback); a Brave Search
 * key searches the whole web. The paid search on OpenRouter (D-071) is turned
 * on just below (PaidSearchSection), in the same tab.
 */
export function WebSearchSection({
  settings,
  onSaved,
}: {
  settings: SettingsResponse | null;
  onSaved: () => void;
}) {
  const id = domId(useId());
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isSet = settings?.braveKey.set ?? false;
  const paid = settings?.webSearch?.active ?? false;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = BraveKeyRequestSchema.safeParse({ key });
    if (!parsed.success) {
      setError('Incolla la chiave completa, senza spazi.');
      return;
    }
    setSaving(true);
    try {
      await getApi().setBraveKey(parsed.data.key);
      setKey('');
      setOpen(false);
      onSaved();
      notify('Chiave di Brave salvata: le ricerche partono da lì.', 'success');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Group title={SETTINGS_SECTIONS.ricercaWeb.label} testId="web-search">
      <Row
        label={paid ? 'Ricerca a pagamento' : isSet ? 'Brave Search' : 'Ricerca gratuita'}
        description={
          <span data-testid="brave-key-status" data-set={isSet ? 'yes' : 'no'}>
            {paid
              ? `Ora i mostri cercano con OpenRouter (la ricerca a pagamento, qui sotto); ${isSet ? 'Brave Search' : 'DuckDuckGo e Wikipedia'} restano di riserva.`
              : isSet
                ? 'Con la tua chiave di Brave Search i mostri cercano su tutto il web.'
                : 'I mostri cercano con DuckDuckGo e, quando non risponde, su Wikipedia. Con una chiave di Brave Search (ha un piano gratuito) o la ricerca a pagamento (qui sotto) cercano su tutto il web.'}
          </span>
        }
        wrap
      >
        {!open && (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {isSet ? 'Cambia chiave' : 'Aggiungi la chiave di Brave'}
          </Button>
        )}
      </Row>
      {open && (
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <RowBody>
            <FormField
              id={id}
              label={isSet ? 'Nuova chiave di Brave Search' : 'Chiave di Brave Search'}
              error={error}
              hint="Resta su questo computer e non la mostriamo più dopo il salvataggio."
            >
              <Input
                id={id}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="BSA…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className={fieldOnGroup}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : `${id}-hint`}
              />
            </FormField>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={saving || !key.trim()}>
                {saving ? 'Salvo…' : 'Salva la chiave di Brave'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Annulla
              </Button>
              <a
                href="https://api-dashboard.search.brave.com/app/keys"
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'sm:ml-auto')}
              >
                Crea la chiave
                <ArrowSquareOut size={16} aria-hidden />
              </a>
            </div>
          </RowBody>
        </form>
      )}
    </Group>
  );
}
