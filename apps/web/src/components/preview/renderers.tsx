import { formatNumber, type FileMeta } from '@monsters/shared';
import { File as FileIcon } from '@phosphor-icons/react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { desktop } from '../../lib/desktop.ts';
import { getApi, notify } from '../../store/app.ts';
import { formatBytes, kindWord, replaceFileMeta, textFlavor } from './files.ts';
import { previewStrings } from './preview.strings.ts';
import {
  commentMarks,
  parseCsv,
  prettyJsonText,
  TEXT_MAX_BYTES,
  TEXT_MAX_LINES,
  tokenizeLine,
} from './text.ts';

/*
 * The renderers of the preview by kind (docs/design.md, "Pannello a destra"):
 * images fitted on a checkerboard, a click for the real size with panning;
 * text and code in monospace with line numbers and a few colours, CSV as a
 * table; the HTML pages of the monsters in a sandbox with no network and no
 * origin (`sandbox="allow-scripts"`, never `allow-same-origin`, and the core's
 * CSP on the page); anything else with its name, size and what can be done.
 */

function useBox(ref: React.RefObject<HTMLElement | null>): { w: number; h: number } {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

const PAD = 24;

export function ImageView({ meta, url }: { meta: FileMeta; url: string }) {
  const s = previewStrings().image;
  const area = useRef<HTMLDivElement>(null);
  const box = useBox(area);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(
    meta.width && meta.height ? { w: meta.width, h: meta.height } : null,
  );
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(
    null,
  );
  const [panning, setPanning] = useState(false);

  const fit =
    natural && box.w > 0 ? Math.min(1, (box.w - PAD) / natural.w, (box.h - PAD) / natural.h) : null;
  // Already shown whole: the real size would be the same, so the zoom doubles it.
  const scale = zoom && natural ? (fit !== null && fit >= 1 ? 2 : 1) : (fit ?? 1);
  const shownW = natural ? Math.max(1, Math.round(natural.w * scale)) : undefined;
  const shownH = natural ? Math.max(1, Math.round(natural.h * scale)) : undefined;

  // Entering the zoom keeps the point that was clicked under the pointer.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !zoom || !shownW || !shownH) return;
    el.scrollLeft = Math.max(0, zoom.x * shownW - el.clientWidth / 2);
    el.scrollTop = Math.max(0, zoom.y * shownH - el.clientHeight / 2);
    el.focus({ preventScroll: true });
    // Only when the zoom starts: panning moves the scroll afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  if (failed)
    return (
      <p className="px-5 py-10 text-center text-screen-muted" data-testid="preview-image-failed">
        {s.failed}
      </p>
    );

  const percent = Math.round(scale * 100);
  const toggle = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    if (zoom) {
      setZoom(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setZoom({
      x: r.width ? (e.clientX - r.left) / r.width : 0.5,
      y: r.height ? (e.clientY - r.top) / r.height : 0.5,
    });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!zoom || e.button !== 0) return;
    const el = area.current!;
    pan.current = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) > 4) {
      p.moved = true;
      setPanning(true);
    }
    if (p.moved) {
      area.current!.scrollLeft = p.left - dx;
      area.current!.scrollTop = p.top - dy;
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    pan.current = null;
    setPanning(false);
    // A click without dragging goes back to the fitted image.
    if (p && !p.moved) setZoom(null);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && zoom) {
      // Esc leaves the zoom first; the next one closes the pane.
      e.preventDefault();
      e.stopPropagation();
      setZoom(null);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={area}
        tabIndex={zoom ? 0 : -1}
        onKeyDown={onKey}
        className={
          zoom
            ? 'pv-zoomed scroll-screen grid min-h-0 flex-1 place-items-center overflow-auto outline-none'
            : 'grid min-h-0 flex-1 place-items-center overflow-hidden'
        }
        data-panning={panning ? '' : undefined}
        data-testid="preview-image-area"
        data-zoom={zoom ? 'real' : 'fit'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={zoom ? s.real(meta.name) : undefined}
        role={zoom ? 'group' : undefined}
      >
        {zoom ? (
          <div className="pv-checker" style={{ width: shownW, height: shownH, margin: PAD / 2 }}>
            <img
              src={url}
              alt={meta.name}
              draggable={false}
              width={shownW}
              height={shownH}
              className="block max-w-none select-none"
              data-testid="preview-image"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={toggle}
            className="pv-checker block cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            style={
              shownW ? { width: shownW, height: shownH } : { maxWidth: '100%', maxHeight: '100%' }
            }
            aria-label={s.zoom(meta.name)}
            title={s.zoomTitle}
            data-testid="preview-image-fit"
          >
            <img
              src={url}
              alt={meta.name}
              draggable={false}
              className="block h-full w-full select-none"
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && (!natural || natural.w !== img.naturalWidth))
                  setNatural({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              onError={() => setFailed(true)}
              data-testid="preview-image"
            />
          </button>
        )}
      </div>
      <p
        aria-live="polite"
        className="label pointer-events-none absolute right-3 bottom-3 rounded-[6px] bg-screen/80 px-2 py-1 text-screen-muted"
        data-testid="preview-zoom"
      >
        {zoom ? `${percent}%` : s.fitted(percent)}
        {natural ? ` · ${natural.w}×${natural.h}` : ''}
      </p>
    </div>
  );
}

type TextState =
  { state: 'loading' } | { state: 'ready'; text: string; cut: boolean } | { state: 'error' };

function useText(url: string): TextState {
  const [state, setState] = useState<{ url: string; value: TextState }>({
    url,
    value: { state: 'loading' },
  });
  useEffect(() => {
    let alive = true;
    const ctl = new AbortController();
    (async () => {
      const res = await fetch(url, { credentials: 'same-origin', signal: ctl.signal });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const buf = await res.arrayBuffer();
      const cut = buf.byteLength > TEXT_MAX_BYTES;
      const text = new TextDecoder('utf-8').decode(cut ? buf.slice(0, TEXT_MAX_BYTES) : buf);
      if (alive) setState({ url, value: { state: 'ready', text, cut } });
    })().catch(() => alive && setState({ url, value: { state: 'error' } }));
    return () => {
      alive = false;
      ctl.abort();
    };
  }, [url]);
  return state.url === url ? state.value : { state: 'loading' };
}

function CodeLines({ text, comments }: { text: string; comments: string[] | null }) {
  const s = previewStrings().text;
  const lines = useMemo(() => {
    const all = text.replace(/\r\n?/g, '\n').split('\n');
    if (all.length > 1 && all.at(-1) === '') all.pop();
    return { shown: all.slice(0, TEXT_MAX_LINES), more: all.length > TEXT_MAX_LINES };
  }, [text]);
  return (
    <>
      <pre className="pv-code text-screen-ink" data-testid="preview-code">
        {lines.shown.map((line, i) => (
          <span key={i}>
            {line === ''
              ? ' '
              : comments
                ? tokenizeLine(line, comments).map((t, j) =>
                    t.kind ? (
                      <i key={j} className={`t-${t.kind}`}>
                        {t.text}
                      </i>
                    ) : (
                      t.text
                    ),
                  )
                : line}
          </span>
        ))}
      </pre>
      {lines.more && (
        <p className="mt-3 text-caption text-screen-muted">
          {s.firstLines(formatNumber(TEXT_MAX_LINES))}
        </p>
      )}
    </>
  );
}

function CsvTable({ text }: { text: string }) {
  const s = previewStrings().text;
  const { rows, more } = useMemo(() => parseCsv(text), [text]);
  const [head, ...body] = rows;
  if (!head) return <p className="text-screen-muted">{s.csvEmpty}</p>;
  return (
    <>
      <table className="pv-table text-screen-ink" data-testid="preview-table">
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {more && <p className="mt-3 text-caption text-screen-muted">{s.csvMore}</p>}
    </>
  );
}

export function TextView({ meta, url }: { meta: FileMeta; url: string }) {
  const s = previewStrings().text;
  const loaded = useText(url);
  const flavor = textFlavor(meta);
  const [asTable, setAsTable] = useState(true);
  if (loaded.state === 'loading') return <p className="sr-only">{s.loading}</p>;
  if (loaded.state === 'error')
    return <p className="px-5 py-10 text-center text-screen-muted">{s.error}</p>;
  const text = flavor === 'json' ? prettyJsonText(loaded.text) : loaded.text;
  const comments = flavor === 'code' ? commentMarks(meta.name) : flavor === 'json' ? [] : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {flavor === 'csv' && (
        <div role="radiogroup" aria-label={s.how} className="flex shrink-0 gap-1 px-4 pb-2">
          {(
            [
              [true, s.table],
              [false, s.text],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={asTable === value}
              onClick={() => setAsTable(value)}
              className="term-filter label"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div
        className="scroll-screen min-h-0 flex-1 overflow-auto px-4 pb-6"
        data-testid="preview-text"
      >
        {flavor === 'csv' && asTable ? (
          <CsvTable text={text} />
        ) : (
          <CodeLines text={text} comments={comments} />
        )}
        {loaded.cut && (
          <p className="mt-3 text-caption text-screen-muted">
            {s.long(formatBytes(TEXT_MAX_BYTES))}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A page made by a monster. The iframe has an opaque origin (`allow-scripts`
 * without `allow-same-origin`): no cookie, no storage, no access to this page
 * or to the core's API; the core's CSP on the page allows no network at all,
 * and its lockdown script takes WebRTC and every other network API away
 * (D-085). Without `allow-top-navigation`, `allow-popups`, `allow-forms` or
 * `allow-modals` it cannot leave its frame.
 *
 * A page made after reading third-party text (`meta.inert`) comes without
 * scripts: the user turns them on here, with a click and a second one.
 */
export function HtmlView({ meta, url, who }: { meta: FileMeta; url: string; who: string }) {
  const s = previewStrings().html;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const allow = () => {
    setBusy(true);
    getApi()
      .allowFileScripts(meta.id)
      .then(replaceFileMeta, () => notify(s.scriptsFailed, 'error'))
      .finally(() => {
        setBusy(false);
        setAsking(false);
      });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
      {meta.inert && (
        <div className="flex shrink-0 flex-wrap items-center gap-2" data-testid="preview-inert">
          <p className="min-w-0 flex-1 text-caption leading-5 text-screen-muted">
            {asking ? s.askingScripts : s.inert}
          </p>
          <button
            type="button"
            className="screen-key h-8 px-2.5"
            disabled={busy}
            onClick={() => (asking ? allow() : setAsking(true))}
            data-testid="preview-allow-scripts"
          >
            {asking ? s.yes : s.turnOn}
          </button>
          {asking && (
            <button
              type="button"
              className="screen-key h-8 px-2.5"
              onClick={() => setAsking(false)}
            >
              {s.leaveOff}
            </button>
          )}
        </div>
      )}
      <iframe
        key={meta.inert ? 'inert' : 'scripts'}
        src={url}
        title={s.frame(meta.name)}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; payment 'none'; usb 'none'"
        className="pv-frame min-h-0 w-full flex-1"
        data-testid="preview-html"
      />
      <p className="label shrink-0 text-screen-muted" data-testid="preview-sandbox-note">
        {s.note(who, Boolean(meta.inert))}
      </p>
    </div>
  );
}

export function OtherView({ meta }: { meta: FileMeta }) {
  const s = previewStrings().other;
  const bridge = desktop();
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center"
      data-testid="preview-other"
    >
      <span className="screen-key pointer-events-none size-16 rounded-[14px] bg-white/5 px-0">
        <FileIcon size={34} weight="thin" aria-hidden className="text-screen-ink" />
      </span>
      <p className="text-body text-screen-ink">{meta.name}</p>
      <p className="label text-screen-muted">
        {kindWord(meta.kind)} · {formatBytes(meta.size)}
      </p>
      <p className="max-w-[340px] text-caption leading-5 text-screen-muted">
        {bridge?.openFile ? s.withBridge : s.withoutBridge}
      </p>
    </div>
  );
}
