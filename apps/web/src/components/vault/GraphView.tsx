import type { VaultEdge, VaultNoteSummary } from '@monsters/shared';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useResolvedTheme } from '../../store/hooks.ts';
import { THEMES } from '../../theme/tokens.ts';
import {
  createGraphLayout,
  layoutBounds,
  placeLabels,
  type GraphLayout,
} from '../../lib/graph-layout.ts';

/*
 * Link graph of the vault on a canvas (loaded with its own chunk), drawn as a
 * black screen (docs/design.md, "Note"): one luminous dot per note in the LED
 * colour of the monster that wrote it, sized by links; links are thin lines,
 * labels in Martian Mono. Drag to move, wheel or pinch to zoom, click (or
 * Enter on the selected node) to open the note. Arrow keys walk the notes from
 * the most linked; the selection is announced.
 */

/** Room left free at the top of the screen for the legend (it wraps on a phone). */
const topRoom = (width: number) => (width < 640 ? 64 : 44);
/** Longest label, in characters: shorter on a phone, where the screen is narrow. */
const labelChars = (width: number) => (width < 640 ? 18 : 28);

export interface GraphViewProps {
  notes: readonly VaultNoteSummary[];
  edges: readonly VaultEdge[];
  colorOf: (note: VaultNoteSummary) => string;
  current: string | null;
  /** Notes found by the search: the others fade (null = no search). */
  highlight?: ReadonlySet<string> | null;
  reduceMotion: boolean;
  onOpen: (path: string) => void;
}

const MAX_LABELS = 160;

/** The most a fitted view zooms in: a few notes spread over the screen, not blown up. */
const FIT_MAX_ZOOM = 3.4;

function radiusOf(degree: number): number {
  return 3.2 + Math.min(9, Math.sqrt(degree) * 1.6);
}

declare global {
  interface Window {
    /** Dev builds only: screen position of a note in the graph (e2e tests). */
    __monstersGraph?: { pointOf: (path: string) => { x: number; y: number } | null };
  }
}

export default function GraphView({
  notes,
  edges,
  colorOf,
  current,
  highlight = null,
  reduceMotion,
  onOpen,
}: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The canvas cannot read CSS variables: it takes the colours of the theme tokens.
  const theme = useResolvedTheme();
  const paletteRef = useRef(THEMES[theme]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number>(-1);
  const [announce, setAnnounce] = useState('');

  const index = useMemo(() => new Map(notes.map((n, i) => [n.path, i])), [notes]);
  const links = useMemo(() => {
    const out: [number, number][] = [];
    for (const e of edges) {
      const a = index.get(e.from);
      const b = index.get(e.to);
      if (a !== undefined && b !== undefined && a !== b) out.push([a, b]);
    }
    return out;
  }, [edges, index]);
  const neighbours = useMemo(() => {
    const out: number[][] = notes.map(() => []);
    for (const [a, b] of links) {
      out[a]!.push(b);
      out[b]!.push(a);
    }
    return out;
  }, [notes, links]);
  const colors = useMemo(() => notes.map(colorOf), [notes, colorOf]);
  /** Keyboard order: most linked first, then by title. */
  const order = useMemo(
    () =>
      notes
        .map((_, i) => i)
        .sort(
          (a, b) =>
            neighbours[b]!.length - neighbours[a]!.length ||
            notes[a]!.title.localeCompare(notes[b]!.title),
        ),
    [notes, neighbours],
  );

  // Mutable state of the drawing loop (no re-render per frame).
  const state = useRef({
    layout: null as GraphLayout | null,
    view: { k: 1, tx: 0, ty: 0 },
    fitted: false,
    userMoved: false,
    hover: -1,
    selected: -1,
    current: -1,
    lit: null as Set<number> | null,
    dirty: true,
    width: 0,
    height: 0,
  });
  useEffect(() => {
    paletteRef.current = THEMES[theme];
    state.current.dirty = true;
  }, [theme]);

  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    const s = state.current;
    s.selected = selected;
    s.current = current ? (index.get(current) ?? -1) : -1;
    s.lit = highlight
      ? new Set([...highlight].flatMap((p) => (index.has(p) ? [index.get(p)!] : [])))
      : null;
    s.dirty = true;
  }, [selected, current, highlight, index]);

  useEffect(() => {
    const s = state.current;
    const layout = createGraphLayout(notes.length, links);
    if (reduceMotion) layout.settle();
    s.layout = layout;
    s.fitted = false;
    s.userMoved = false;
    s.hover = -1;
    s.dirty = true;
  }, [notes, links, reduceMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = state.current;

    const fit = () => {
      if (!s.layout || s.width === 0) return;
      const b = layoutBounds(s.layout);
      // Room for the labels: half a label on the sides, one line under the lowest dots.
      const padX = s.width < 640 ? 72 : 96;
      const padY = 36;
      const top = topRoom(s.width);
      const w = Math.max(1, b.maxX - b.minX);
      const h = Math.max(1, b.maxY - b.minY);
      // Fit to the screen (a small vault fills it too, up to a sensible zoom).
      const k = Math.min(
        FIT_MAX_ZOOM,
        Math.max(0.05, Math.min((s.width - padX * 2) / w, (s.height - padY * 2 - top) / h)),
      );
      s.view = {
        k,
        tx: s.width / 2 - ((b.minX + b.maxX) / 2) * k,
        ty: top + (s.height - top) / 2 - ((b.minY + b.maxY) / 2) * k,
      };
    };

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      s.width = r.width;
      s.height = r.height;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      if (!s.userMoved) fit();
      s.dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const draw = () => {
      const SCREEN = paletteRef.current.screen;
      const SCREEN_INK = paletteRef.current.screenInk;
      const SCREEN_MUTED = paletteRef.current.screenMuted;
      const SIGNAL = paletteRef.current.signal;
      const layout = s.layout;
      if (!layout) return;
      const dpr = window.devicePixelRatio || 1;
      const { k, tx, ty } = s.view;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s.width, s.height);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
      const { x, y } = layout;
      const focus = s.hover >= 0 ? s.hover : s.selected >= 0 ? s.selected : s.lit ? -1 : s.current;
      // A focused note lights its neighbours; otherwise the search results stand out.
      const near = new Set<number>(
        focus >= 0 ? [focus, ...neighbours[focus]!] : s.lit ? s.lit : [],
      );

      ctx.lineWidth = 1 / k;
      // Links: thin muted lines, never louder than the lights.
      ctx.strokeStyle = SCREEN_MUTED;
      ctx.globalAlpha = 0.42;
      ctx.beginPath();
      for (const [a, b] of links) {
        if (near.has(a) && near.has(b) && (a === focus || b === focus)) continue;
        ctx.moveTo(x[a]!, y[a]!);
        ctx.lineTo(x[b]!, y[b]!);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (focus >= 0) {
        ctx.strokeStyle = SCREEN_INK;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.4 / k;
        ctx.beginPath();
        for (const n of neighbours[focus]!) {
          ctx.moveTo(x[focus]!, y[focus]!);
          ctx.lineTo(x[n]!, y[n]!);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Nodes, batched by colour.
      const byColor = new Map<string, number[]>();
      for (let i = 0; i < notes.length; i++) {
        const c = colors[i]!;
        const list = byColor.get(c);
        if (list) list.push(i);
        else byColor.set(c, [i]);
      }
      const dim = (focus >= 0 || s.lit !== null) && notes.length > 1;
      // Tiny on screen: squares are much cheaper to fill than arcs (big vaults zoomed out).
      const tiny = k * 4 < 3;
      const shape = (i: number, grow = 0) => {
        const r = radiusOf(layout.degree[i]!) + grow;
        if (tiny) {
          ctx.rect(x[i]! - r, y[i]! - r, r * 2, r * 2);
        } else {
          ctx.moveTo(x[i]! + r, y[i]!);
          ctx.arc(x[i]!, y[i]!, r, 0, Math.PI * 2);
        }
      };
      for (const [c, list] of byColor) {
        ctx.fillStyle = c;
        // The lens of a LED: a faint ring of light around the lit dots (a fill, no blur).
        if (!tiny) {
          ctx.globalAlpha = 0.16;
          ctx.beginPath();
          for (const i of list) if (!dim || near.has(i)) shape(i, 3.2 / k + 1.5);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.beginPath();
        for (const i of list) if (!dim || near.has(i)) shape(i);
        ctx.fill();
        if (dim) {
          ctx.globalAlpha = 0.28;
          ctx.beginPath();
          for (const i of list) if (!near.has(i)) shape(i);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      // Rings: the open note and the keyboard selection.
      for (const [i, color] of [
        [s.current, SCREEN_INK],
        [s.selected, SIGNAL],
      ] as const) {
        if (i < 0) continue;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 / k;
        ctx.beginPath();
        ctx.arc(x[i]!, y[i]!, radiusOf(layout.degree[i]!) + 5 / k, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Labels in screen space (constant size), cut out of the lines by a halo of screen.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const labelled: number[] = [];
      if (notes.length <= 60 || k >= 1.5) {
        for (let i = 0; i < notes.length && labelled.length < MAX_LABELS; i++) {
          const sx = x[i]! * k + tx;
          const sy = y[i]! * k + ty;
          if (sx < -40 || sy < -20 || sx > s.width + 40 || sy > s.height + 20) continue;
          if (dim && !near.has(i)) continue;
          labelled.push(i);
        }
      } else if (focus >= 0 || s.lit) labelled.push(...[...near].slice(0, MAX_LABELS));
      ctx.font = '500 11px "Martian Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      const max = labelChars(s.width);
      const textOf = (i: number) => {
        const title = notes[i]!.title;
        return title.length > max ? `${title.slice(0, max - 1)}…` : title;
      };
      const labelY = (i: number) => y[i]! * k + ty + radiusOf(layout.degree[i]!) * k + 6;
      // No label on another (audit UI-26): the focused, the open, then the most linked first.
      const rank = (i: number) =>
        i === focus ? -2 : i === s.current ? -1 : -(layout.degree[i]! + (near.has(i) ? 1000 : 0));
      const ordered = [...labelled].sort((a, b) => rank(a) - rank(b));
      const widthOf = (i: number) => ctx.measureText(textOf(i)).width + 6;
      /** The centre of a label, kept inside the screen: a dot near the edge keeps its name. */
      const labelX = (i: number) => {
        const half = widthOf(i) / 2;
        return Math.min(s.width - half - 4, Math.max(half + 4, x[i]! * k + tx));
      };
      const boxOf = (i: number) => {
        const w = widthOf(i);
        return { x: labelX(i) - w / 2, y: labelY(i) - 1, w, h: 15 };
      };
      const dotBoxes =
        notes.length <= 400
          ? labelled.map((i) => {
              const r = radiusOf(layout.degree[i]!) * k + 2;
              return {
                id: i,
                box: { x: x[i]! * k + tx - r, y: y[i]! * k + ty - r, w: r * 2, h: r * 2 },
              };
            })
          : [];
      const shown = placeLabels(
        ordered.map((i) => ({ id: i, box: boxOf(i) })),
        dotBoxes,
      );
      for (const i of ordered) {
        if (!shown.has(i)) continue;
        const label = textOf(i);
        const sx = labelX(i);
        const sy = labelY(i);
        ctx.lineWidth = 5;
        ctx.strokeStyle = SCREEN;
        ctx.strokeText(label, sx, sy);
        ctx.fillStyle =
          i === focus || i === s.current || (focus < 0 && near.has(i)) ? SCREEN_INK : SCREEN_MUTED;
        ctx.fillText(label, sx, sy);
      }
    };

    let raf = 0;
    let budget = 4;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const layout = s.layout;
      if (!layout) return;
      if (layout.alpha >= 0.001) {
        const started = performance.now();
        layout.tick(budget);
        const spent = performance.now() - started;
        // Keep the frame short: fewer ticks on big vaults, more on small ones.
        budget = Math.max(1, Math.min(30, Math.round(budget * (spent > 10 ? 0.7 : 1.25))));
        if (!s.userMoved) fit();
        s.dirty = true;
      }
      if (s.dirty) {
        s.dirty = false;
        draw();
      }
    };
    raf = requestAnimationFrame(frame);

    const toWorld = (cx: number, cy: number) => {
      const r = canvas.getBoundingClientRect();
      return { x: (cx - r.left - s.view.tx) / s.view.k, y: (cy - r.top - s.view.ty) / s.view.k };
    };
    const hit = (cx: number, cy: number): number => {
      const layout = s.layout;
      if (!layout) return -1;
      const p = toWorld(cx, cy);
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < notes.length; i++) {
        const dx = layout.x[i]! - p.x;
        const dy = layout.y[i]! - p.y;
        const d = dx * dx + dy * dy;
        const r = radiusOf(layout.degree[i]!) + 6 / s.view.k;
        if (d <= r * r && d < bestD) {
          best = i;
          bestD = d;
        }
      }
      return best;
    };
    const zoomAt = (cx: number, cy: number, factor: number) => {
      const r = canvas.getBoundingClientRect();
      const px = cx - r.left;
      const py = cy - r.top;
      const k = Math.min(8, Math.max(0.03, s.view.k * factor));
      const f = k / s.view.k;
      s.view = { k, tx: px - (px - s.view.tx) * f, ty: py - (py - s.view.ty) * f };
      s.userMoved = true;
      s.dirty = true;
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let downAt: { x: number; y: number } | null = null;
    let moved = false;
    let pinch = 0;
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        downAt = { x: e.clientX, y: e.clientY };
        moved = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        moved = true;
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        const h = hit(e.clientX, e.clientY);
        if (h !== s.hover) {
          s.hover = h;
          s.dirty = true;
          canvas.style.cursor = h >= 0 ? 'pointer' : 'grab';
        }
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch > 0) zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, d / pinch);
        pinch = d;
        return;
      }
      if (downAt && !moved && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4)
        moved = true;
      if (moved) {
        s.view = {
          ...s.view,
          tx: s.view.tx + e.clientX - prev.x,
          ty: s.view.ty + e.clientY - prev.y,
        };
        s.userMoved = true;
        s.dirty = true;
        canvas.style.cursor = 'grabbing';
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (wasSingle && !moved) {
        const h = hit(e.clientX, e.clientY);
        if (h >= 0) openRef.current(notes[h]!.path);
      }
      if (pointers.size === 0) {
        downAt = null;
        canvas.style.cursor = s.hover >= 0 ? 'pointer' : 'grab';
      }
    };
    const onLeave = () => {
      if (s.hover !== -1) {
        s.hover = -1;
        s.dirty = true;
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    if (import.meta.env.DEV) {
      window.__monstersGraph = {
        pointOf: (path) => {
          const i = notes.findIndex((n) => n.path === path);
          const layout = s.layout;
          if (i < 0 || !layout) return null;
          const r = canvas.getBoundingClientRect();
          return {
            x: r.left + layout.x[i]! * s.view.k + s.view.tx,
            y: r.top + layout.y[i]! * s.view.k + s.view.ty,
          };
        },
      };
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      if (import.meta.env.DEV) delete window.__monstersGraph;
    };
  }, [notes, links, neighbours, colors]);

  const select = (i: number) => {
    setSelected(i);
    const n = notes[i];
    if (!n) return;
    const count = neighbours[i]!.length;
    setAnnounce(
      `${n.title}, ${count === 1 ? '1 collegamento' : `${count} collegamenti`}. Invio per aprirla.`,
    );
  };

  const onKey = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (notes.length === 0) return;
    const pos = order.indexOf(selected);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      select(order[(pos + 1) % order.length]!);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      select(order[(pos - 1 + order.length) % order.length]!);
    } else if ((e.key === 'Enter' || e.key === ' ') && selected >= 0) {
      e.preventDefault();
      onOpen(notes[selected]!.path);
    } else if (e.key === 'Escape') {
      setSelected(-1);
      setAnnounce('');
    }
  };

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden" data-testid="vault-graph">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={`Grafo dei collegamenti: ${notes.length} note, ${links.length} collegamenti. Usa le frecce per scorrere le note e Invio per aprirle.`}
        onKeyDown={onKey}
        onBlur={() => setSelected(-1)}
        className="absolute inset-0 cursor-grab touch-none rounded-[12px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal"
      />
      <p className="sr-only" aria-live="polite" data-testid="graph-selection">
        {announce}
      </p>
    </div>
  );
}
