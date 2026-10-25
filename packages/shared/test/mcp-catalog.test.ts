import { describe, expect, it } from 'vitest';
import {
  BROWSER_SERVER,
  MCP_CATALOG,
  McpCatalogEntrySchema,
  McpServerNameSchema,
  McpServerRequestSchema,
  McpToolHintsSchema,
  UV_EXCLUDE_NEWER,
  catalogCreateUrl,
  catalogUrl,
  launcherOf,
  needsTenant,
  parseTenant,
  tenantOfUrl,
  toolHintsOf,
} from '../src/index.ts';

/* The gallery of services (D-063) is data: these checks keep it valid as it grows. */

describe('MCP catalog', () => {
  it('has at least 12 services to connect, and every entry is valid', () => {
    expect(MCP_CATALOG.filter((e) => !e.soon).length).toBeGreaterThanOrEqual(12);
    for (const e of MCP_CATALOG) expect(McpCatalogEntrySchema.safeParse(e).success).toBe(true);
  });

  it('no duplicates: ids, names, addresses', () => {
    const ids = MCP_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = MCP_CATALOG.map((e) => e.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const urls = MCP_CATALOG.flatMap((e) => [e.url, e.urlTemplate].filter((u) => u !== undefined));
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('ids are valid server names and never the browser preset (already in the settings)', () => {
    for (const e of MCP_CATALOG) {
      expect(McpServerNameSchema.safeParse(e.id).success).toBe(true);
      expect(e.id).not.toBe(BROWSER_SERVER);
      expect(e.id).not.toMatch(/playwright|browser/);
    }
  });

  it('every way of connecting has an https address or a command with an exact version', () => {
    for (const e of MCP_CATALOG) {
      if (e.transport === 'http') {
        for (const a of e.auth) {
          const url = new URL(catalogUrl(e, a, needsTenant(e) ? 'prova' : undefined)!);
          expect(url.protocol, e.id).toBe('https:');
          expect(url.username + url.password).toBe('');
        }
      } else {
        expect(e.command, e.id).toBeTruthy();
        // npx packages pinned: never `@latest` nor a bare name.
        const pkg = e.args.find((a) => a.startsWith('@') || /^[a-z]/.test(a));
        if (e.command === 'npx') expect(pkg, e.id).toMatch(/@\d+\.\d+\.\d+$/);
        // uvx: a version on PyPI or a git commit, never a branch or a tag that can move.
        if (e.command === 'uvx') {
          const from = e.args[e.args.indexOf('--from') + 1];
          expect(from, e.id).toMatch(
            /^(?:[a-z0-9-]+==\d+\.\d+\.\d+|git\+https:\/\/[^@\s]+@[0-9a-f]{40}(?:#\S*)?)$/,
          );
        }
        // A program the panel can say how to install (D-092).
        expect(launcherOf(e.command!), e.id).toBeDefined();
      }
    }
  });

  it('tokens: a page to create them on https, a header the API accepts', () => {
    for (const e of MCP_CATALOG) {
      for (const a of e.auth) {
        if (a.kind !== 'token') continue;
        const tenant = needsTenant(e) ? 'prova' : undefined;
        expect(new URL(catalogCreateUrl(a, tenant)!).protocol).toBe('https:');
        // What the gallery sends is a normal request of the settings API.
        const req = McpServerRequestSchema.safeParse({
          transport: 'http',
          url: catalogUrl(e, a, tenant),
          headers: { [a.header]: `${a.prefix}abc` },
          catalog: e.id,
        });
        expect(req.success, e.id).toBe(true);
      }
    }
  });

  it('services that cannot be connected yet say why, and come with an address all the same', () => {
    const soon = MCP_CATALOG.filter((e) => e.soon);
    expect(soon.length).toBeGreaterThan(0);
    for (const e of soon) expect(e.soon!.length).toBeGreaterThan(20);
  });

  it('descriptions are short sentences without a final period', () => {
    for (const e of MCP_CATALOG) {
      expect(e.description, e.id).not.toMatch(/\.$/);
      expect(e.description[0], e.id).toBe(e.description[0]!.toUpperCase());
    }
  });

  it('every "Presto" service is reachable through Claude, with a pattern of its own (D-069)', () => {
    for (const e of MCP_CATALOG.filter((x) => x.soon)) {
      expect(e.viaClaude, e.id).toBeDefined();
    }
    const patterns = MCP_CATALOG.flatMap((e) => e.viaClaude?.connectors.map((c) => c.url) ?? []);
    expect(new Set(patterns).size).toBe(patterns.length);
    for (const p of patterns) {
      expect(p).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/\*|\*)$/);
      expect(p).not.toContain('*.');
    }
    const design = MCP_CATALOG.find((e) => e.id === 'claude-design')!;
    expect(design.viaClaude).toMatchObject({
      login: 'design-login',
      server: { name: 'claude-design', url: 'https://api.anthropic.com/v1/design/mcp' },
    });
    expect(design.soon).toBeTruthy();
  });

  it('the gallery goes by common use: the well-known apps first, Saturday’s products after the first six', () => {
    const ids = MCP_CATALOG.map((e) => e.id);
    expect(ids.slice(0, 4)).toEqual(['github', 'notion', 'linear', 'google']);
    // The first six cards of the gallery are the first six that can be connected: none is Saturday's.
    const firstSix = MCP_CATALOG.filter((e) => !e.soon)
      .slice(0, 6)
      .map((e) => e.id);
    expect(firstSix).not.toContain('anteiku');
    expect(firstSix).not.toContain('witdesk');
    // Present all the same, and next to each other.
    expect(ids.indexOf('witdesk')).toBe(ids.indexOf('anteiku') + 1);
  });

  it('Saturday products have an address per company (D-075)', () => {
    const anteiku = MCP_CATALOG.find((e) => e.id === 'anteiku')!;
    expect(needsTenant(anteiku)).toBe(true);
    expect(anteiku.url).toBeUndefined();
    expect(anteiku.auth.map((a) => a.kind)).toEqual(['oauth', 'token']);
    expect(catalogUrl(anteiku, anteiku.auth[0]!, 'acme')).toBe('https://acme.anteiku.it/mcp');
    // Without a company, or with one that is not a DNS label, there is no address.
    for (const bad of [undefined, '', 'Acme', 'ac.me', '-sat', 'sat-', 'a b', 'x/y', 'é']) {
      expect(catalogUrl(anteiku, anteiku.auth[0]!, bad), String(bad)).toBeUndefined();
    }
    const token = anteiku.auth[1]!;
    expect(token.kind === 'token' && catalogCreateUrl(token, 'acme')).toBe(
      'https://acme.anteiku.it/sistema/connessioni',
    );
    const witdesk = MCP_CATALOG.find((e) => e.id === 'witdesk')!;
    expect(catalogUrl(witdesk, witdesk.auth[0]!, 'acme')).toBe(
      'https://acme.witdesk.it/api/saturday/mcp',
    );
    expect(witdesk.soon).toBeUndefined();
    expect(witdesk.note).toMatch(/Connettori.*Banco → Impostazioni → Collegamenti/);
  });

  it('the company field takes the name or the address copied from the browser', () => {
    const anteiku = MCP_CATALOG.find((e) => e.id === 'anteiku')!;
    expect(parseTenant(anteiku, ' Acme ')).toBe('acme');
    expect(parseTenant(anteiku, 'acme.anteiku.it')).toBe('acme');
    expect(parseTenant(anteiku, 'https://acme.anteiku.it/oggi?x=1')).toBe('acme');
    expect(parseTenant(anteiku, 'https://evil.example/acme.anteiku.it')).toBeUndefined();
    expect(parseTenant(anteiku, 'acme.anteiku.it.evil.example')).toBeUndefined();
    expect(parseTenant(anteiku, 'a.b.anteiku.it')).toBeUndefined();
    expect(parseTenant(anteiku, 'sat urday')).toBeUndefined();
    expect(tenantOfUrl(anteiku, 'https://acme.anteiku.it/mcp')).toBe('acme');
    expect(tenantOfUrl(anteiku, 'https://x.y.anteiku.it/mcp')).toBeUndefined();
    expect(tenantOfUrl(anteiku, 'https://acme.anteiku.it/altro')).toBeUndefined();
  });

  it('an address per company is checked like the others', () => {
    const base = {
      id: 'prova',
      name: 'Prova',
      description: 'Una voce di prova',
      category: 'lavoro',
      transport: 'http',
      auth: [{ kind: 'oauth' }],
      icon: 'prova',
      docs: 'https://example.com',
    };
    const ok = {
      ...base,
      urlTemplate: 'https://{azienda}.example.com/mcp',
      tenantLabel: 'Azienda',
    };
    expect(McpCatalogEntrySchema.safeParse(ok).success).toBe(true);
    for (const urlTemplate of [
      'http://{azienda}.example.com/mcp',
      'https://example.com/{azienda}/mcp',
      'https://{azienda}.{azienda}.example.com',
      'https://x{azienda}.example.com',
    ]) {
      expect(McpCatalogEntrySchema.safeParse({ ...ok, urlTemplate }).success, urlTemplate).toBe(
        false,
      );
    }
    // A label is needed; an address per company is the only address; no company without one.
    const { tenantLabel: _, ...noLabel } = ok;
    expect(McpCatalogEntrySchema.safeParse(noLabel).success).toBe(false);
    expect(McpCatalogEntrySchema.safeParse({ ...ok, url: 'https://example.com/mcp' }).success).toBe(
      false,
    );
    expect(
      McpCatalogEntrySchema.safeParse({
        ...base,
        url: 'https://example.com',
        tenantLabel: 'Azienda',
      }).success,
    ).toBe(false);
  });

  it('Blender is the official server of Blender Lab, pinned to the commit of v1.0.3 (D-092)', () => {
    const blender = MCP_CATALOG.find((e) => e.id === 'blender')!;
    expect(blender).toMatchObject({
      category: 'design',
      transport: 'stdio',
      command: 'uvx',
      auth: [{ kind: 'none' }],
      docs: 'https://www.blender.org/lab/mcp-server/',
    });
    // Never the community `blender-mcp` of PyPI: the package comes from Blender's own repository.
    expect(blender.args).toEqual([
      '--exclude-newer',
      UV_EXCLUDE_NEWER,
      '--from',
      'git+https://projects.blender.org/lab/blender_mcp.git@2cea8d566dde07fbac28a61d698909d69724e853#subdirectory=mcp',
      'blender-mcp',
    ]);
    expect(blender.note).toMatch(/Blender 5\.1\+.*MCP add-on.*Python code/);
    expect(blender.soon).toBeUndefined();
    // Its moves of the view read, its renders write a file; code keeps the server's hints.
    expect(toolHintsOf(blender.toolHints, 'jump_to_tab_by_name')).toEqual({ readOnly: true });
    expect(toolHintsOf(blender.toolHints, 'jump_to_view3d_object_data_by_name')).toEqual({
      readOnly: true,
    });
    expect(toolHintsOf(blender.toolHints, 'render_viewport_to_path')).toEqual({
      writesPath: 'output_path',
    });
    for (const name of ['execute_blender_code', 'get_objects_summary', 'xjump_to_tab', 'render']) {
      expect(toolHintsOf(blender.toolHints, name), name).toBeUndefined();
    }
    expect(toolHintsOf(undefined, 'jump_to_tab_by_name')).toBeUndefined();
  });

  it('hints of the gallery are tool names with `*`, nothing else', () => {
    const ok = { readOnly: ['jump_to_*'], writesPath: [{ tool: 'render_*', arg: 'output_path' }] };
    expect(McpToolHintsSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['.*', 'a|b', 'jump(', 'Jump', '']) {
      expect(McpToolHintsSchema.safeParse({ readOnly: [bad] }).success, bad).toBe(false);
    }
    expect(
      McpToolHintsSchema.safeParse({ writesPath: [{ tool: 'render_*', arg: 'a.b' }] }).success,
    ).toBe(false);
  });

  it('the programs of the stdio servers say what to install', () => {
    expect(launcherOf('uvx')?.needs).toBe('uv');
    expect(launcherOf('/home/a/.local/bin/uvx')?.needs).toBe('uv');
    expect(launcherOf('C:\\Program Files\\nodejs\\npx.cmd')?.needs).toBe('Node.js');
    expect(launcherOf('python3')).toBeUndefined();
    expect(launcherOf('toString')).toBeUndefined();
    expect(launcherOf('__proto__')).toBeUndefined();
  });

  it('Blender waits up to 10 minutes for a call (renders), others use the default', () => {
    expect(MCP_CATALOG.find((e) => e.id === 'blender')?.timeoutSec).toBe(600);
    expect(MCP_CATALOG.every((e) => e.timeoutSec === undefined || e.timeoutSec <= 600)).toBe(true);
  });
});
