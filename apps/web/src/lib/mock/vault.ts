import {
  VaultCreateRequestSchema,
  VaultDeleteRequestSchema,
  VaultRestoreRequestSchema,
  VaultSaveRequestSchema,
  type EventInput,
  type LogEvent,
  type VaultEdge,
  type VaultHistoryEntry,
  type VaultNote,
  type VaultNoteSummary,
  type VaultOverview,
  type VaultSearchHit,
  type VaultTrashItem,
  type VaultVersion,
} from '@monsters/shared';
import { createRng } from '@monsters/monster-kit';
import { lineDiff } from '../line-diff.ts';
import type { RawResponse } from '../transport.ts';

/*
 * The vault of the mock core (M2.8): notes with their versions in memory, so
 * the vault view can be developed and tested without a core: list, search,
 * links and backlinks, history with diff, trash, restore, undo and edits.
 * `?mockNotes=2000` adds generated notes to try the graph on a big vault.
 */

interface Version {
  commit: string;
  ts: number;
  author: string;
  actionId: string | null;
  message: string;
  /** Whole file (frontmatter included); null = deleted (in the trash). */
  text: string | null;
}

interface MockNote {
  path: string;
  versions: Version[];
}

type Props = Record<string, unknown>;

const ok = (body: unknown, status = 200): RawResponse => ({ status, body });
const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: message ? { error, message } : { error },
});

function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Tiny frontmatter reader for the mock's own notes: `key: value` and `key: [a, b]`. */
function splitNote(text: string): { props: Props; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { props: {}, body: text };
  const props: Props = {};
  for (const line of m[1]!.split('\n')) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const raw = kv[2]!.trim();
    if (raw.startsWith('[') && raw.endsWith(']'))
      props[kv[1]!] = raw
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    else if (raw === 'true' || raw === 'false') props[kv[1]!] = raw === 'true';
    else props[kv[1]!] = raw;
  }
  return { props, body: text.slice(m[0].length) };
}

function joinNote(props: Props, body: string): string {
  const keys = Object.keys(props);
  if (keys.length === 0) return body;
  const lines = keys.map((k) => {
    const v = props[k];
    return `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : String(v)}`;
  });
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

const titleOf = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '');
const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function inlineTags(body: string): string[] {
  return [...body.matchAll(/(?:^|\s)#([\p{L}_/-][\p{L}\p{N}_/-]*)/gu)].map((m) =>
    m[1]!.toLowerCase(),
  );
}

export interface MockVaultOptions {
  mode: 'fresh' | 'team' | 'demo';
  /** Extra generated notes (graph on a big vault). */
  extraNotes?: number;
  log: (event: EventInput) => LogEvent;
}

export class MockVault {
  private readonly notes = new Map<string, MockNote>();
  private readonly log: (event: EventInput) => LogEvent;
  private seq = 0;

  constructor(opts: MockVaultOptions) {
    this.log = opts.log;
    this.seed(opts.mode);
    if (opts.extraNotes) this.generate(opts.extraNotes);
  }

  /* --------------------------------------------------------------- data */

  private commitId(): string {
    this.seq++;
    return (0x1a2b3c0 + this.seq * 7919).toString(16).padStart(7, '0') + 'f'.repeat(33);
  }

  private add(path: string, v: Omit<Version, 'commit'> & { commit?: string }): Version {
    const version: Version = { ...v, commit: v.commit ?? this.commitId() };
    this.lookup = null;
    const n = this.notes.get(path);
    if (n) n.versions.push(version);
    else this.notes.set(path, { path, versions: [version] });
    return version;
  }

  private current(n: MockNote): Version {
    return n.versions.at(-1)!;
  }

  private live(): MockNote[] {
    return [...this.notes.values()].filter((n) => this.current(n).text !== null);
  }

  /** Lookup by path, path without `.md` and title, rebuilt when the notes change. */
  private lookup: Map<string, MockNote> | null = null;

  private find(ref: string): MockNote | null {
    if (!this.lookup) {
      const map = new Map<string, MockNote>();
      const live = this.live();
      for (const n of live) map.set(titleOf(n.path).toLowerCase(), n);
      for (const n of live) {
        map.set(n.path.toLowerCase(), n);
        map.set(n.path.toLowerCase().replace(/\.md$/, ''), n);
      }
      this.lookup = map;
    }
    const r = ref
      .replace(/^\.?\//, '')
      .trim()
      .toLowerCase();
    return this.lookup.get(r) ?? this.lookup.get(r.replace(/\.md$/, '')) ?? null;
  }

  private summary(n: MockNote): VaultNoteSummary {
    const v = this.current(n);
    const { props, body } = splitNote(v.text ?? '');
    const tags = [
      ...new Set([
        ...(Array.isArray(props['tags']) ? (props['tags'] as string[]) : []),
        ...inlineTags(body),
      ]),
    ];
    return {
      path: n.path,
      title: titleOf(n.path),
      type: typeof props['type'] === 'string' ? props['type'] : null,
      author: typeof props['author'] === 'string' ? props['author'] : n.versions[0]!.author,
      updated: localIso(v.ts),
      private: props['private'] === true || n.path.startsWith('Privato/'),
      tags: tags.sort(),
      // As the core's index: the first lines that are not empty nor the title.
      summary: body
        .split('\n')
        .filter((l) => l.trim() !== '' && !/^#\s/.test(l.trim()))
        .slice(0, 6)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240),
    };
  }

  private links(n: MockNote): { target: string; embed: boolean }[] {
    const { body } = splitNote(this.current(n).text ?? '');
    return [...body.matchAll(/(!?)\[\[([^\]|#\n]+)/g)].map((m) => ({
      target: m[2]!.trim(),
      embed: m[1] === '!',
    }));
  }

  private edges(): VaultEdge[] {
    const out = new Map<string, VaultEdge>();
    for (const n of this.live()) {
      for (const l of this.links(n)) {
        const t = this.find(l.target);
        if (!t || t.path === n.path) continue;
        out.set(`${n.path}>${t.path}`, { from: n.path, to: t.path, embed: l.embed });
      }
    }
    return [...out.values()];
  }

  /** Writes a new version as the user, logs it like the core does. */
  private write(
    path: string,
    text: string | null,
    tool: string,
    action: 'create' | 'edit' | 'delete' | 'restore' | 'undo',
    extra: { undoneActionId?: string } = {},
  ): Version {
    const actionId = `act_mock_${Date.now().toString(36)}_${this.seq + 1}`;
    const v = this.add(path, {
      ts: Date.now(),
      author: 'user',
      actionId,
      message: `${tool}: ${path} [agent=user action=${actionId}]`,
      text,
    });
    this.log({
      agent: 'user',
      type: 'vault_change',
      data: { action, path, commit: v.commit.slice(0, 7), actionId, ...extra },
    });
    return v;
  }

  /* ------------------------------------------------------------- routes */

  handle(method: string, path: string, query: URLSearchParams, body: unknown): RawResponse | null {
    if (!path.startsWith('/api/vault/') || path.startsWith('/api/vault/undo')) return null;
    const route = `${method} ${path}`;
    const checkPath = (p: string): RawResponse | null => {
      const segs = p.replace(/\\/g, '/').split('/');
      if (segs.includes('..') || p.startsWith('/'))
        return fail(400, 'invalid_input', 'path outside the vault');
      if (segs[0]?.startsWith('.')) return fail(403, 'permission_denied', 'managed by the system');
      return null;
    };
    switch (route) {
      case 'GET /api/vault/notes':
        return ok(this.overview());
      case 'GET /api/vault/search':
        return ok({
          hits: this.search(query),
          mode: query.get('mode') === 'text' ? 'text' : 'hybrid',
        });
      case 'GET /api/vault/note': {
        const p = query.get('path') ?? '';
        if (!p) return fail(400, 'invalid_request');
        return checkPath(p) ?? this.read(p);
      }
      case 'GET /api/vault/related': {
        const n = this.find(query.get('path') ?? '');
        if (!n) return fail(404, 'not_found');
        return ok({ hits: this.related(n), mode: 'hybrid' });
      }
      case 'GET /api/vault/history': {
        const n = this.notes.get(query.get('path') ?? '') ?? this.find(query.get('path') ?? '');
        if (!n) return ok({ entries: [] });
        const entries: VaultHistoryEntry[] = [...n.versions].reverse().map((v) => ({
          commit: v.commit,
          date: localIso(v.ts),
          author: v.author,
          actionId: v.actionId,
          message: v.message,
        }));
        return ok({ entries });
      }
      case 'GET /api/vault/version': {
        const n = this.notes.get(query.get('path') ?? '');
        const commit = query.get('commit') ?? '';
        const i = n?.versions.findIndex((v) => v.commit.startsWith(commit)) ?? -1;
        if (!n || i < 0 || !commit) return fail(404, 'not_found');
        const after = n.versions[i]!.text;
        const before = i > 0 ? n.versions[i - 1]!.text : null;
        const version: VaultVersion = {
          path: n.path,
          commit: n.versions[i]!.commit,
          parent: i > 0 ? n.versions[i - 1]!.commit : null,
          before,
          after,
          diff: lineDiff(before ?? '', after ?? ''),
        };
        return ok(version);
      }
      case 'GET /api/vault/trash':
        return ok({ items: this.trash() });
      case 'POST /api/vault/restore': {
        const p = VaultRestoreRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request');
        if ('trashPath' in p.data) {
          const { trashPath } = p.data;
          const item = this.trash().find((i) => i.trashPath === trashPath);
          if (!item?.originalPath) return fail(404, 'not_found');
          return this.restore(item.originalPath);
        }
        return checkPath(p.data.path) ?? this.restore(p.data.path, p.data.commit);
      }
      case 'POST /api/vault/delete': {
        const p = VaultDeleteRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request');
        const bad = checkPath(p.data.path);
        if (bad) return bad;
        const n = this.find(p.data.path);
        if (!n) return fail(404, 'not_found');
        const v = this.write(n.path, null, 'vault_delete', 'delete');
        return ok(this.written(n.path, v));
      }
      case 'POST /api/vault/note': {
        const p = VaultCreateRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request');
        const title = p.data.title.replace(/\.md$/i, '').trim();
        if (!title || /[/\\#|^:%[\]?*"<>]/.test(title))
          return fail(400, 'invalid_input', `invalid characters in "${title}"`);
        const folder = p.data.folder.replace(/^\/+|\/+$/g, '');
        const path = folder ? `${folder}/${title}.md` : `${title}.md`;
        const bad = checkPath(path);
        if (bad) return bad;
        const n = this.notes.get(path);
        if (n && this.current(n).text !== null) return fail(409, 'exists', `${path} exists`);
        const v = this.write(
          path,
          joinNote({ author: 'user' }, p.data.content),
          'vault_write',
          'create',
        );
        return ok(this.written(path, v));
      }
      case 'PUT /api/vault/note': {
        const p = VaultSaveRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request');
        const bad = checkPath(p.data.path);
        if (bad) return bad;
        const n = this.notes.get(p.data.path);
        if (!n || this.current(n).text === null) return fail(404, 'not_found');
        if (this.current(n).commit !== p.data.baseHash)
          return fail(409, 'conflict', `${n.path} changed since you read it`);
        const { props } = splitNote(this.current(n).text ?? '');
        const v = this.write(n.path, joinNote(props, p.data.content), 'vault_write', 'edit');
        return ok(this.written(n.path, v));
      }
      default:
        return fail(404, 'not_found');
    }
  }

  private written(path: string, v: Version) {
    return { ok: true, path, hash: v.commit, commit: v.commit, actionId: v.actionId };
  }

  overview(): VaultOverview {
    const notes = this.live()
      .map((n) => this.summary(n))
      .sort((a, b) => b.updated.localeCompare(a.updated) || a.path.localeCompare(b.path));
    const tagCount = new Map<string, number>();
    for (const n of notes) for (const t of n.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    return {
      notes,
      edges: this.edges(),
      tags: [...tagCount.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
      total: notes.length,
      semantic: 'ready',
    };
  }

  private search(q: URLSearchParams): VaultSearchHit[] {
    const query = (q.get('q') ?? '').trim().toLowerCase();
    const tags = (q.get('tags') ?? '').split(',').filter(Boolean);
    const folder = q.get('folder') ?? '';
    const words = query.split(/\s+/).filter(Boolean);
    const out: VaultSearchHit[] = [];
    for (const n of this.live()) {
      const s = this.summary(n);
      if (folder && !n.path.startsWith(`${folder}/`)) continue;
      if (!tags.every((t) => s.tags.includes(t))) continue;
      const { body } = splitNote(this.current(n).text ?? '');
      const hay = `${s.title}\n${body}`.toLowerCase();
      if (words.length > 0 && !words.every((w) => hay.includes(w))) continue;
      const flat = body.replace(/\s+/g, ' ').trim();
      const at = words[0] ? flat.toLowerCase().indexOf(words[0]) : -1;
      const start = Math.max(0, at - 40);
      let snippet = flat.slice(start, start + 140);
      for (const w of words) {
        const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        snippet = snippet.replace(re, (m) => `**${m}**`);
      }
      out.push({
        path: n.path,
        title: s.title,
        type: s.type,
        updated: s.updated,
        score: 1,
        snippet: `${start > 0 ? '…' : ''}${snippet}${flat.length > start + 140 ? '…' : ''}`,
        tags: s.tags,
      });
    }
    return out.slice(0, Number(q.get('limit') ?? 30));
  }

  private read(ref: string): RawResponse {
    const n = this.find(ref);
    if (!n) return fail(404, 'not_found', `note not found: ${ref}`);
    const v = this.current(n);
    const { props, body } = splitNote(v.text ?? '');
    const s = this.summary(n);
    const backlinks = this.live()
      .filter((o) => o !== n && this.links(o).some((l) => this.find(l.target) === n))
      .map((o) => ({ path: o.path, title: titleOf(o.path) }))
      .sort((a, b) => a.title.localeCompare(b.title));
    const note: VaultNote = {
      path: n.path,
      title: s.title,
      frontmatter: props,
      content: body.replace(/^\n+/, ''),
      hash: v.commit,
      private: s.private,
      author: typeof props['author'] === 'string' ? props['author'] : null,
      backlinks,
    };
    return ok(note);
  }

  private related(n: MockNote): VaultSearchHit[] {
    const me = this.summary(n);
    return this.live()
      .filter((o) => o !== n)
      .map((o) => ({ o, s: this.summary(o) }))
      .map(({ o, s }) => ({
        o,
        s,
        score:
          s.tags.filter((t) => me.tags.includes(t)).length * 2 +
          (folderOf(o.path) === folderOf(n.path) ? 1 : 0),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.s.title.localeCompare(b.s.title))
      .slice(0, 6)
      .map(({ o, s, score }) => ({
        path: o.path,
        title: s.title,
        type: s.type,
        updated: s.updated,
        score,
        snippet: '',
        tags: s.tags,
      }));
  }

  private trash(): VaultTrashItem[] {
    return [...this.notes.values()]
      .filter((n) => this.current(n).text === null)
      .sort((a, b) => this.current(b).ts - this.current(a).ts)
      .map((n) => {
        const v = this.current(n);
        const last = [...n.versions].reverse().find((x) => x.text !== null);
        const { props } = splitNote(last?.text ?? '');
        return {
          trashPath: `.trash/${titleOf(n.path)}.md`,
          title: titleOf(n.path),
          originalPath: n.path,
          deletedAt: localIso(v.ts),
          deletedBy: v.author,
          actionId: v.actionId,
          private: props['private'] === true,
          size: last?.text?.length ?? 0,
        };
      });
  }

  private restore(path: string, commit?: string): RawResponse {
    const n = this.notes.get(path);
    if (!n) return fail(404, 'not_found');
    let text: string | null;
    if (commit) {
      text = n.versions.find((v) => v.commit.startsWith(commit))?.text ?? null;
      if (text === null) return fail(404, 'not_found');
    } else {
      if (this.current(n).text !== null)
        return fail(
          400,
          'invalid_input',
          `${path} exists: pass the commit of the version to restore`,
        );
      text = [...n.versions].reverse().find((v) => v.text !== null)?.text ?? null;
      if (text === null) return fail(404, 'not_found');
    }
    const v = this.write(path, text, 'vault_restore', 'restore');
    return ok(this.written(path, v));
  }

  /** Undo of an action of the vault (null: not a vault action of this mock). */
  undo(actionId: string, force: boolean): RawResponse | null {
    for (const n of this.notes.values()) {
      const i = n.versions.findIndex((v) => v.actionId === actionId);
      if (i < 0) continue;
      if (n.versions.some((v) => v.actionId === `undo-${actionId}`))
        return fail(400, 'invalid_input', `action ${actionId} was already undone`);
      // As the core: a conflict only if the note is not as the action left it (an undo of a
      // later action that brought it back is fine: "Annulla tutto il lavoro" goes newest first).
      if (n.versions.at(-1)!.text !== n.versions[i]!.text && !force)
        return {
          status: 409,
          body: { error: 'conflict', message: 'changed after the action', files: [n.path] },
        };
      const before = i > 0 ? n.versions[i - 1]!.text : null;
      const v = this.add(n.path, {
        ts: Date.now(),
        author: 'user',
        actionId: `undo-${actionId}`,
        message: `vault_undo: ${n.path} [agent=user action=undo-${actionId}]`,
        text: before,
      });
      this.log({
        agent: 'user',
        type: 'vault_change',
        data: {
          action: 'undo',
          path: n.path,
          commit: v.commit.slice(0, 7),
          actionId: `undo-${actionId}`,
          files: [n.path],
          undoneActionId: actionId,
        },
      });
      return ok({ ok: true, commit: v.commit.slice(0, 7), files: [n.path] });
    }
    return null;
  }

  /** A vault change of the scripted scenarios: the note appears in the vault too. */
  observe(e: LogEvent): void {
    if (e.type !== 'vault_change' || e.agent === 'user') return;
    const { action, path, actionId } = e.data;
    if (action !== 'create' && action !== 'edit') return;
    const n = this.notes.get(path);
    if (n && actionId && n.versions.some((v) => v.actionId === actionId)) return;
    const prev = n ? (this.current(n).text ?? '') : '';
    const text = n
      ? `${prev.trimEnd()}\n\n- Aggiunto da ${e.agent}.\n`
      : `---\nauthor: ${e.agent}\ntags: [spunti]\n---\n# ${titleOf(path)}\n\nNota scritta da ${e.agent} nella prova.\n`;
    this.add(path, {
      ts: e.ts,
      author: e.agent,
      actionId: actionId ?? null,
      message: `${action === 'create' ? 'vault_write' : 'vault_edit'}: ${path} [agent=${e.agent} action=${actionId ?? '-'}]`,
      text,
    });
  }

  /* ---------------------------------------------------------------- seed */

  private seed(mode: MockVaultOptions['mode']): void {
    const now = Date.now();
    const ago = (min: number) => now - min * 60_000;
    const put = (
      path: string,
      versions: {
        min: number;
        author: string;
        actionId?: string;
        tool?: string;
        text: string | null;
      }[],
    ) => {
      for (const v of versions)
        this.add(path, {
          ts: ago(v.min),
          author: v.author,
          actionId: v.actionId ?? null,
          message: `${v.tool ?? (v.text === null ? 'vault_delete' : 'vault_write')}: ${path} [agent=${v.author} action=${v.actionId ?? '-'}]`,
          text: v.text,
        });
    };

    put('LEGGIMI.md', [
      {
        min: 60 * 24 * 6,
        author: 'monsters',
        text: '# Leggimi\n\nQuesto è il tuo vault: note in Markdown, apribili anche con Obsidian.\nI mostri scrivono qui quello che imparano. Ogni modifica si può annullare.\n',
      },
    ]);
    put('Diario/2026-10-14.md', [
      {
        min: 60 * 5,
        author: 'user',
        text: '---\ntype: diario\ntags: [diario]\n---\n# 14 ottobre\n\n- Corsa al parco, 6 km.\n- Chiamata con [[Sara]] per il sito.\n',
      },
      {
        min: 42,
        author: 'enceladus',
        actionId: 'act_seed_diary',
        tool: 'vault_edit',
        text: '---\ntype: diario\ntags: [diario]\n---\n# 14 ottobre\n\n- Corsa al parco, 6 km. Vedi [[Corsa]].\n- Chiamata con [[Sara]] per il sito: vedi [[Brief del sito]].\n\n## Agenti\n- Encelado ha riordinato il diario.\n',
      },
    ]);
    if (mode !== 'demo') return;

    const lisbon =
      '---\nauthor: rhea\ntags: [viaggi, spunti]\nsources: 3\n---\n# Lisbona, spunti per il weekend\n\n1. Giro sul [[Tram 28]] la mattina presto.\n2. [[Pastéis de nata]] a Belém, meglio alle 9.\n3. Tramonto al Miradouro da Senhora do Monte.\n\nFonti: [Visit Lisboa](https://www.visitlisboa.com) #viaggi\n';
    put('Risorse/Lisbona, spunti per il weekend.md', [
      { min: 30, author: 'rhea', actionId: 'act_seed_lisbon', text: lisbon },
    ]);
    put('Risorse/Pastéis de nata.md', [
      {
        min: 29,
        author: 'rhea',
        text: '---\nauthor: rhea\ntags: [viaggi, cibo]\n---\n# Pastéis de nata\n\nDolci di pasta sfoglia e crema, nati a Belém. Collegati a [[Lisbona, spunti per il weekend]].\n',
      },
    ]);
    put('Risorse/Tram 28.md', [
      {
        min: 29,
        author: 'rhea',
        text: '---\nauthor: rhea\ntags: [viaggi]\n---\n# Tram 28\n\nLa linea storica che attraversa Alfama, Baixa e Graça. Vedi [[Lisbona, spunti per il weekend]].\n',
      },
    ]);
    put('Risorse/Ricette/Carbonara.md', [
      {
        min: 60 * 30,
        author: 'user',
        text: '---\ntags: [cibo, ricette]\n---\n# Carbonara\n\nGuanciale, tuorli, pecorino, pepe. Niente panna.\n\n```\n4 tuorli per 320 g di pasta\n```\n',
      },
    ]);
    put('Inbox/Bozze dei post.md', [
      {
        min: 20,
        author: 'dione',
        text: '---\nauthor: dione\ntags: [social, spunti]\n---\n# Bozze dei post\n\n## Variante A\nTre giorni a Lisbona tra tram e pastéis.\n\n## Variante B\nLisbona in un weekend: cosa non perdere. Spunti da [[Lisbona, spunti per il weekend]].\n',
      },
    ]);
    put('Inbox/Idea veloce.md', [
      {
        min: 8,
        author: 'user',
        text: '# Idea veloce\n\nRifare la mappa del viaggio. Da incorporare:\n\n![[Tram 28]]\n\nPoi scrivere [[Nota da scrivere]] e un link sbagliato <script>alert(1)</script> [clic](javascript:alert(1)).\n\n- [x] trovare il volo\n- [ ] prenotare #viaggi/lisbona\n',
      },
    ]);
    put('Progetti/Monsters/Roadmap.md', [
      {
        min: 60 * 50,
        author: 'titan',
        text: '---\nauthor: titan\ntype: progetto\ntags: [monsters, lavoro]\n---\n# Roadmap\n\n| Fase | Cosa |\n| --- | --- |\n| 2 | Integrazioni e [[Idee per la piazzetta]] |\n| 3 | App desktop |\n\nPersone: [[Giulio]], [[Sara]].\n',
      },
    ]);
    const ideas =
      '---\nauthor: titan\ntags: [monsters, idee]\n---\n# Idee per la piazzetta\n\n- I mostri si salutano quando si incrociano.\n\nVedi [[Roadmap]].\n';
    put('Progetti/Monsters/Idee per la piazzetta.md', [
      { min: 60 * 26, author: 'titan', actionId: 'act_seed_ideas', text: ideas },
      {
        min: 60 * 2,
        author: 'user',
        actionId: 'act_seed_ideas_edit',
        tool: 'vault_write',
        text: ideas.replace(
          'incrociano.\n',
          "incrociano.\n- Un mostro che dorme se non lavora da un'ora.\n",
        ),
      },
    ]);
    put('Progetti/Sito Saturday/Brief del sito.md', [
      {
        min: 60 * 8,
        author: 'user',
        text: '---\ntags: [lavoro, clienti]\n---\n# Brief del sito\n\nPagine: home, servizi, contatti. Referente: [[Sara]].\n',
      },
    ]);
    put('Aree/Salute/Corsa.md', [
      {
        min: 60 * 72,
        author: 'user',
        text: "---\ntags: [salute]\n---\n# Corsa\n\nObiettivo: 10 km sotto l'ora entro dicembre.\n",
      },
    ]);
    put('Aree/Finanze/Budget di ottobre.md', [
      {
        min: 60 * 48,
        author: 'user',
        text: '---\nprivate: true\ntags: [finanze]\n---\n# Budget di ottobre\n\nAffitto, bollette e il viaggio a Lisbona.\n',
      },
    ]);
    put('Privato/Diario personale.md', [
      {
        min: 60 * 36,
        author: 'user',
        text: '---\nprivate: true\n---\n# Diario personale\n\nSolo per me.\n',
      },
    ]);
    put('Persone/Giulio.md', [
      {
        min: 60 * 90,
        author: 'user',
        text: '---\ntype: persona\ntags: [persone]\n---\n# Giulio\n\nCo-fondatore. Lavora con [[Sara]] al [[Brief del sito]].\n',
      },
    ]);
    put('Persone/Sara.md', [
      {
        min: 60 * 90,
        author: 'user',
        text: '---\ntype: persona\ntags: [persone]\n---\n# Sara\n\nDesigner. Vedi [[Giulio]].\n',
      },
    ]);
    put('Agenti/Rhea/MEMORY.md', [
      {
        min: 29,
        author: 'rhea',
        actionId: 'act_seed_memory',
        tool: 'vault_edit',
        text: '---\nauthor: rhea\n---\n# Memoria di Rhea\n\n- Giulio preferisce fonti in italiano.\n- Per Lisbona: [[Lisbona, spunti per il weekend]].\n',
      },
    ]);
    put('Archivio/Vecchio piano.md', [
      {
        min: 60 * 24 * 20,
        author: 'user',
        text: '# Vecchio piano\n\nSostituito dalla [[Roadmap]].\n',
      },
    ]);
    put('Risorse/Lista della spesa.md', [
      {
        min: 60 * 26,
        author: 'user',
        text: '---\ntags: [casa]\n---\n# Lista della spesa\n\nUova, guanciale, pecorino.\n',
      },
      { min: 60 * 3, author: 'dione', actionId: 'act_seed_trash', text: null },
    ]);
  }

  /** Generated notes in 8 folders with a few links each (deterministic). */
  private generate(count: number): void {
    const random = createRng(2026);
    const rng = () => random.next();
    const folders = [
      'Risorse',
      'Progetti',
      'Aree',
      'Persone',
      'Diario',
      'Inbox',
      'Archivio',
      'Agenti/Rhea',
    ];
    const authors = ['user', 'rhea', 'dione', 'titan'];
    const paths: string[] = [];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const folder = folders[Math.floor(rng() * folders.length)]!;
      paths.push(`${folder}/Nota ${String(i + 1).padStart(4, '0')}.md`);
    }
    paths.forEach((path, i) => {
      const links = Math.floor(rng() * 4);
      const targets: string[] = [];
      for (let k = 0; k < links; k++) {
        // Mostly near notes, so the graph has clusters.
        const j =
          rng() < 0.75 ? Math.max(0, i - 1 - Math.floor(rng() * 12)) : Math.floor(rng() * count);
        if (j !== i) targets.push(titleOf(paths[j]!));
      }
      const author = authors[Math.floor(rng() * authors.length)]!;
      this.add(path, {
        ts: now - (count - i) * 60_000,
        author,
        actionId: null,
        message: `vault_write: ${path} [agent=${author} action=-]`,
        text: `---\nauthor: ${author}\ntags: [gen${i % 9}]\n---\n# ${titleOf(path)}\n\n${targets.map((t) => `- [[${t}]]`).join('\n')}\n`,
      });
    });
  }
}
