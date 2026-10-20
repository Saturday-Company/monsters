import type { FileMeta } from '@monsters/shared';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/*
 * PDFs in Anteprima, drawn by pdf.js in a chunk of their own (~450 kB, plus its
 * worker ~1.3 MB, fetched only when a PDF opens). Why not the browser's viewer
 * in an iframe: in the desktop app it needs `plugins: true` in Electron, and
 * its frame could not keep the sandbox CSP every file is served with. Here the
 * bytes are read like any file and painted on canvases: no plugin, no frame,
 * no eval and no WebAssembly (the core's CSP allows neither: pdf.js falls back
 * to its JavaScript decoders). Pages are drawn when they come near the view.
 */

GlobalWorkerOptions.workerSrc = workerUrl;

const GAP = 12;
const SIDE = 12;

function PdfPage({
  doc,
  number,
  width,
  ratio,
  onSeen,
}: {
  doc: PDFDocumentProxy;
  number: number;
  width: number;
  ratio: number;
  onSeen: (n: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(number <= 2);
  const [height, setHeight] = useState(Math.round(width * ratio));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setNear(true);
          if (e.intersectionRatio >= 0.5) onSeen(number);
        }
      },
      { rootMargin: '600px 0px', threshold: [0, 0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [number, onSeen]);

  useEffect(() => {
    if (!near || width <= 0) return;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    let alive = true;
    void doc.getPage(number).then((page) => {
      if (!alive || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: scale * dpr });
      const c = canvas.current;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      setHeight(Math.round(base.height * scale));
      task = page.render({ canvas: c, viewport });
      task.promise.catch(() => {
        // cancelled by a new width or by closing: nothing to say
      });
    });
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, number, width, near]);

  return (
    <div
      ref={box}
      className="pv-paper mx-auto overflow-hidden"
      style={{ width, height }}
      data-testid="preview-pdf-page"
      data-page={number}
    >
      <canvas ref={canvas} style={{ width, height }} aria-hidden className="block" />
    </div>
  );
}

export default function PdfView({ meta, url }: { meta: FileMeta; url: string }) {
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [doc, setDoc] = useState<{ doc: PDFDocumentProxy; ratio: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const measure = () => setWidth(Math.max(120, el.clientWidth - 2 * SIDE));
    measure();
    // Redrawing every page at each step of a drag is wasted work: once it settles.
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(measure, 120);
    });
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let task: ReturnType<typeof getDocument> | null = null;
    (async () => {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const data = new Uint8Array(await res.arrayBuffer());
      if (!alive) return;
      task = getDocument({ data, useWasm: false, enableXfa: false });
      const loaded = await task.promise;
      const first = await loaded.getPage(1);
      const v = first.getViewport({ scale: 1 });
      if (alive) setDoc({ doc: loaded, ratio: v.height / v.width });
    })().catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      void task?.destroy();
    };
  }, [url]);

  if (failed)
    return (
      <p className="px-5 py-10 text-center text-screen-muted" data-testid="preview-pdf-failed">
        Questo PDF non si apre qui: scaricalo per leggerlo con il suo programma.
      </p>
    );

  const pages = doc?.doc.numPages ?? 0;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={area}
        className="scroll-screen min-h-0 flex-1 overflow-y-auto pb-6"
        style={{ paddingInline: SIDE }}
        data-testid="preview-pdf"
        aria-label={`${meta.name}, ${pages} ${pages === 1 ? 'pagina' : 'pagine'}`}
        role="document"
      >
        {doc && width > 0 && (
          <div className="flex flex-col" style={{ gap: GAP }}>
            {Array.from({ length: pages }, (_, i) => (
              <PdfPage
                key={i}
                doc={doc.doc}
                number={i + 1}
                width={width}
                ratio={doc.ratio}
                onSeen={setPage}
              />
            ))}
          </div>
        )}
        {!doc && <p className="px-5 py-10 text-center text-screen-muted">Carico il PDF…</p>}
      </div>
      {pages > 0 && (
        <p
          className="label pointer-events-none absolute right-4 bottom-3 rounded-[6px] bg-screen/80 px-2 py-1 text-screen-muted"
          data-testid="preview-pdf-pages"
        >
          Pagina {page} / {pages}
        </p>
      )}
    </div>
  );
}
