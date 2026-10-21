import { ArrowSquareOut } from '@phosphor-icons/react';
import { BraveKeyRequestSchema, type SettingsResponse, SETTINGS_SECTIONS } from '@monsters/shared';
import { useId, useState, type FormEvent } from 'react';
import { cn, domId } from '../../lib/utils.ts';
import { errorText, getApi, notify } from '../../store/app.ts';
import { Button, buttonVariants } from '../ui/button.tsx';
import { Input } from '../ui/field.tsx';
import { partsStrings } from './parts.strings.ts';
import { fieldOnGroup, FormField, Group, Row, RowBody } from './parts.tsx';
import { searchStrings } from './search.strings.ts';

/*
 * Settings → Connections → Web search: without a key the
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
  const s = searchStrings().web;
  const common = partsStrings();
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
      setError(s.keyInvalid);
      return;
    }
    setSaving(true);
    try {
      await getApi().setBraveKey(parsed.data.key);
      setKey('');
      setOpen(false);
      onSaved();
      notify(s.saved, 'success');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Group title={SETTINGS_SECTIONS.ricercaWeb.label} testId="web-search">
      <Row
        label={paid ? s.paidLabel : isSet ? s.braveLabel : s.freeLabel}
        description={
          <span data-testid="brave-key-status" data-set={isSet ? 'yes' : 'no'}>
            {paid ? s.paidText(isSet) : isSet ? s.braveText : s.freeText}
          </span>
        }
        wrap
      >
        {!open && (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {isSet ? s.changeKey : s.addKey}
          </Button>
        )}
      </Row>
      {open && (
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <RowBody>
            <FormField
              id={id}
              label={isSet ? s.newKeyLabel : s.keyLabel}
              error={error}
              hint={s.keyHint}
            >
              <Input
                id={id}
                type="password"
                autoComplete="off"
                spellCheck={false}
                // i18n-ignore: an example value, not copy
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
                {saving ? common.saving : s.saveKey}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {common.cancel}
              </Button>
              <a
                href="https://api-dashboard.search.brave.com/app/keys"
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'sm:ml-auto')}
              >
                {s.createKey}
                <ArrowSquareOut size={16} aria-hidden />
              </a>
            </div>
          </RowBody>
        </form>
      )}
    </Group>
  );
}
