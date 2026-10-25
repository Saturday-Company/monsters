import { CLAUDE_PLAN_MODELS, isOpenRouterFreeModel, type ModelInfoView } from '@monsters/shared';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { capitalize, modelLabel } from '../../store/derive.ts';
import { cn, domId } from '../../lib/utils.ts';
import { Input } from '../ui/field.tsx';
import { modelsStrings } from './models.strings.ts';
import { fieldOnGroup, selectClass } from './parts.tsx';

/*
 * The model of one link of a chain (D-093): a choice from the service's own
 * list, not a text field with suggestions (a `<datalist>` showed only the
 * models starting like the one already written). A short list (the Claude
 * plan, Codex, ChatGPT, a key) is a select with one line on each model and
 * "Other…" at the bottom for a name that is not there; a long one (OpenRouter,
 * hundreds of models) is a field that searches the list as you type, where a
 * name that is not in the list counts as "Other".
 */

export type ModelList = ModelInfoView[] | 'loading' | 'error' | undefined;

/** More models than this: a searchable list instead of a select. */
const SELECT_MAX = 15;
/** Rows shown at once in the searchable list. */
const SHOWN = 60;
const OTHER = '__other__';

/** A model as people say it: its name in the list, "Free, picked by OpenRouter" for the free router. */
export function modelName(model: string, list: ModelList): string {
  const id = model.trim();
  if (!id) return '';
  if (id === 'openrouter/free') return modelsStrings().picker.freeRouter;
  const named = Array.isArray(list) ? list.find((m) => m.id === id)?.name : undefined;
  return named ?? capitalize(modelLabel(id));
}

/** The models of a service in the order to show them: the Claude plan from the lightest. */
export function orderedModels(provider: string, list: readonly ModelInfoView[]): ModelInfoView[] {
  if (provider !== 'claude-agent') return [...list];
  const rank = (id: string) => {
    const i = CLAUDE_PLAN_MODELS.findIndex((m) => m.id === id);
    return i < 0 ? CLAUDE_PLAN_MODELS.length : i;
  };
  return [...list].sort((a, b) => rank(a.id) - rank(b.id));
}

/** "Sonnet · balanced", "Gemini 2.5 Flash Lite · paid, not enabled". */
export function optionText(provider: string, m: ModelInfoView, freeOnly: boolean): string {
  const name = m.name ?? m.id;
  if (provider === 'openrouter' && !isOpenRouterFreeModel(m.id)) {
    return modelsStrings().picker.paidOption(name, freeOnly);
  }
  return m.description ? `${name} · ${m.description}` : name;
}

/** The models of a long list matching what was typed (id or name), the current one first. */
export function searchModels(list: readonly ModelInfoView[], query: string): ModelInfoView[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  const words = q.split(/\s+/);
  return list.filter((m) => {
    const hay = `${m.id} ${m.name ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/**
 * What a search left in the field without a choice from the list becomes (review of 19/10,
 * n. 10): always an id, never the readable name a provider does not know. An id of the list,
 * or the name of one of its models (that model's id); another text without spaces is an id
 * written by hand (kept, the field says it is not in the list); anything else (the readable
 * name with a letter less, a search) changes nothing: null.
 */
export function typedModel(query: string, models: readonly ModelInfoView[]): string | null {
  const text = query.trim();
  if (!text) return null;
  const byId = models.find((m) => m.id === text);
  if (byId) return byId.id;
  const lower = text.toLowerCase();
  const byName = models.find(
    (m) => modelName(m.id, models as ModelInfoView[]).toLowerCase() === lower,
  );
  if (byName) return byName.id;
  return /\s/.test(text) ? null : text;
}

/**
 * A model id written by hand. The chain saves itself a moment after every change, so what is
 * typed halfway ("anthropic/claude-") must not reach it: the draft stays here and the value
 * is committed on Enter or when the field loses the focus (W-19).
 */
function CommitInput({
  value,
  onCommit,
  ref,
  ...props
}: {
  value: string;
  onCommit: (value: string) => void;
  ref?: React.Ref<HTMLInputElement>;
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur' | 'ref'>) {
  /** What is being typed; null while the field just shows the saved value. */
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <Input
      {...props}
      ref={ref}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        commit();
      }}
    />
  );
}

export function ModelPicker({
  provider,
  value,
  list,
  label,
  freeOnly,
  onChange,
}: {
  provider: string;
  value: string;
  list: ModelList;
  /** "Model 1 of Rhea": the name of the control. */
  label: string;
  /** OpenRouter accepts only free models for now. */
  freeOnly: boolean;
  onChange: (model: string) => void;
}) {
  const s = modelsStrings().picker;
  const models = useMemo(
    () => (Array.isArray(list) ? orderedModels(provider, list) : null),
    [provider, list],
  );
  const searchable = models !== null && (provider === 'openrouter' || models.length > SELECT_MAX);
  const name = modelName(value, list);
  const nameLine = value.trim() && name !== value.trim() && (
    <p className="mt-1 px-1 text-footnote text-ink-muted" data-testid="model-name">
      {name}
    </p>
  );

  if (!models) {
    // The list is loading or did not come: the name can still be written.
    return (
      <div>
        <CommitInput
          aria-label={label}
          value={value}
          spellCheck={false}
          placeholder={list === 'loading' ? s.loading : s.modelName}
          onCommit={onChange}
          className={cn(fieldOnGroup, 'h-10 text-body')}
        />
        {nameLine}
      </div>
    );
  }
  if (searchable) {
    return (
      <SearchPicker
        provider={provider}
        value={value}
        models={models}
        label={label}
        freeOnly={freeOnly}
        onChange={onChange}
      />
    );
  }
  return (
    <SelectPicker
      provider={provider}
      value={value}
      models={models}
      label={label}
      freeOnly={freeOnly}
      onChange={onChange}
    />
  );
}

function SelectPicker({
  provider,
  value,
  models,
  label,
  freeOnly,
  onChange,
}: {
  provider: string;
  value: string;
  models: ModelInfoView[];
  label: string;
  freeOnly: boolean;
  onChange: (model: string) => void;
}) {
  const s = modelsStrings().picker;
  const known = models.some((m) => m.id === value.trim());
  const [other, setOther] = useState(false);
  const custom = other || (!!value.trim() && !known);
  const field = useRef<HTMLInputElement>(null);
  return (
    <div className="grid gap-1.5">
      <select
        className={cn(selectClass, 'h-10 w-full')}
        aria-label={label}
        value={custom ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setOther(true);
            // The field takes the focus once it is there.
            setTimeout(() => field.current?.focus(), 0);
            return;
          }
          setOther(false);
          onChange(e.target.value);
        }}
      >
        {!value.trim() && !custom && (
          <option value="" disabled>
            {s.choose}
          </option>
        )}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {optionText(provider, m, freeOnly)}
          </option>
        ))}
        <option value={OTHER}>{s.other}</option>
      </select>
      {custom && (
        <CommitInput
          ref={field}
          aria-label={s.nameOf(label)}
          value={value}
          spellCheck={false}
          placeholder={s.exactName}
          onCommit={onChange}
          className={cn(fieldOnGroup, 'h-10 text-body')}
          data-testid="model-other"
        />
      )}
    </div>
  );
}

function SearchPicker({
  provider,
  value,
  models,
  label,
  freeOnly,
  onChange,
}: {
  provider: string;
  value: string;
  models: ModelInfoView[];
  label: string;
  freeOnly: boolean;
  onChange: (model: string) => void;
}) {
  const s = modelsStrings().picker;
  const listId = domId(useId());
  const [open, setOpen] = useState(false);
  /**
   * What is typed since the list opened (null: nothing): it searches, it is never the model
   * until a choice (`pick`) or `typedModel` says it is an id. Until then the whole list shows.
   */
  const [query, setQuery] = useState<string | null>(null);
  const typed = query !== null;
  const [at, setAt] = useState(0);
  const found = typed ? searchModels(models, query) : models;
  const shown = found.slice(0, SHOWN);
  const active = Math.min(at, Math.max(0, shown.length - 1));
  // The field says the model as people say it; the id is the detail below. What is being
  // typed shows as typed.
  const current = models.find((m) => m.id === value.trim());
  const readable = typed ? query : current ? modelName(value, models) : value;
  const idLine = !typed && current && readable !== current.id ? current.id : null;
  // An id written by hand: used as it is, and the field says so.
  const unknown = !typed && !open && value.trim() !== '' && !current;

  const show = () => {
    setQuery(null);
    const i = models.findIndex((m) => m.id === value.trim());
    setAt(i >= 0 && i < SHOWN ? i : 0);
    setOpen(true);
  };
  const pick = (m: ModelInfoView) => {
    onChange(m.id);
    setQuery(null);
    setOpen(false);
  };
  /** Leaving the field without a choice: what was typed counts only as an id. */
  const settle = () => {
    if (query !== null) {
      const id = typedModel(query, models);
      if (id !== null && id !== value.trim()) onChange(id);
    }
    setQuery(null);
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return show();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setAt((active + step + shown.length) % Math.max(1, shown.length));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      const m = shown[active];
      if (m) pick(m);
      else settle();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setQuery(null);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown.length > 0 ? `${listId}-${active}` : undefined}
        value={readable}
        spellCheck={false}
        autoComplete="off"
        placeholder={s.search}
        onFocus={show}
        onClick={() => !open && show()}
        onBlur={settle}
        onKeyDown={onKey}
        onChange={(e) => {
          setQuery(e.target.value);
          setAt(0);
          setOpen(true);
        }}
        className={cn(fieldOnGroup, 'h-10 text-body')}
      />
      {idLine && (
        <p
          className="mt-1 truncate px-1 font-mono text-footnote text-ink-muted"
          data-testid="model-id"
        >
          {idLine}
        </p>
      )}
      {unknown && (
        <p className="mt-1 px-1 text-footnote text-ink-muted" data-testid="model-unknown">
          {s.unknown}
        </p>
      )}
      {open && (
        <div
          className="popover absolute top-11 right-0 left-0 z-30 overflow-hidden rounded-[14px]"
          data-testid="model-list"
        >
          <ul
            id={listId}
            role="listbox"
            aria-label={s.listLabel(label)}
            className="scroll-soft max-h-72 overflow-y-auto p-1.5"
          >
            {shown.map((m, i) => (
              <li
                key={m.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // The field keeps the focus: the choice happens before its blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                onMouseMove={() => setAt(i)}
                className={cn(
                  'grid min-h-11 cursor-pointer content-center rounded-[10px] px-3 py-1.5',
                  i === active && 'bg-panel',
                )}
              >
                <span className="truncate text-body text-ink">
                  {optionText(provider, m, freeOnly)}
                </span>
                {m.name && m.name !== m.id && (
                  <span className="truncate font-mono text-footnote text-ink-muted">{m.id}</span>
                )}
              </li>
            ))}
            {shown.length === 0 && (
              <li role="presentation" className="px-3 py-2.5 text-footnote text-ink-muted">
                {s.none}
              </li>
            )}
          </ul>
          <p className="label seam-t px-3.5 py-2 text-ink-muted">
            {found.length > SHOWN ? s.partial(SHOWN, found.length) : s.count(found.length)}
          </p>
        </div>
      )}
    </div>
  );
}
