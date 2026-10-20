import { app, session, WebContentsView, type BrowserWindow } from 'electron';
import { bannerHtml } from './remote-copy.ts';

/*
 * The banner over the window in the client mode (M3.3, D-047): "Riconnessione…" while the
 * tunnel is down, "Collegato a …" for a moment when it is back. A small transparent
 * WebContentsView at the bottom of the window, above the page, so the remote UI stays
 * where it is (no reload, nothing injected into it). Its page is a data: URL without
 * script, in a sandboxed renderer of its own session; it cannot navigate.
 */

const HEIGHT = 48;
const MAX_WIDTH = 520;
const MARGIN = 16;

export class LinkBanner {
  #view: WebContentsView | null = null;
  #win: BrowserWindow | null = null;
  #hideTimer: ReturnType<typeof setTimeout> | undefined;
  #shown: string | null = null;
  readonly #layout = () => this.#place();

  #ensure(win: BrowserWindow): WebContentsView {
    if (this.#view && this.#win === win && !win.isDestroyed()) return this.#view;
    this.#detach();
    const view = new WebContentsView({
      webPreferences: {
        session: session.fromPartition('monsters-banner'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        devTools: !app.isPackaged,
        spellcheck: false,
      },
    });
    view.setBackgroundColor('#00000000');
    const wc = view.webContents;
    wc.on('will-frame-navigate', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.setVisible(false);
    win.contentView.addChildView(view);
    win.on('resize', this.#layout);
    this.#view = view;
    this.#win = win;
    this.#place();
    return view;
  }

  #place(): void {
    const win = this.#win;
    if (!win || win.isDestroyed() || !this.#view) return;
    const [w = 0, h = 0] = win.getContentSize();
    const width = Math.max(0, Math.min(MAX_WIDTH, w - 2 * MARGIN));
    this.#view.setBounds({
      x: Math.round((w - width) / 2),
      y: Math.max(0, h - HEIGHT - MARGIN),
      width,
      height: HEIGHT,
    });
  }

  /** Shows `text` over `win`; with `hideAfterMs` it goes away by itself. */
  show(win: BrowserWindow, text: string, tone: 'busy' | 'ok', hideAfterMs?: number): void {
    clearTimeout(this.#hideTimer);
    const view = this.#ensure(win);
    const key = `${tone}:${text}`;
    if (this.#shown !== key) {
      this.#shown = key;
      const html = bannerHtml(text, tone);
      void view.webContents
        .loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`)
        .catch(() => {});
    }
    view.setVisible(true);
    if (hideAfterMs) this.#hideTimer = setTimeout(() => this.hide(), hideAfterMs);
  }

  hide(): void {
    clearTimeout(this.#hideTimer);
    this.#shown = null;
    if (this.#view && this.#win && !this.#win.isDestroyed()) this.#view.setVisible(false);
  }

  #detach(): void {
    const { view, win } = { view: this.#view, win: this.#win };
    this.#view = null;
    this.#win = null;
    this.#shown = null;
    if (win && !win.isDestroyed()) {
      win.off('resize', this.#layout);
      if (view) win.contentView.removeChildView(view);
    }
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
  }

  /** The window is about to be replaced or the app quits. */
  dispose(): void {
    clearTimeout(this.#hideTimer);
    this.#detach();
  }
}
