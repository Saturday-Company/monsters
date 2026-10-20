/**
 * The alias of the user's `~/.ssh/config` for an address typed by hand: `Host my-desktop` with
 * `HostName 100.64.0.1` and `User alice` is how the user already reaches that computer,
 * but ssh applies the block only when the alias itself is the destination. Typing the address
 * would log in with the local user name and be refused. Only literal aliases (no `*`, `?` or
 * `!`) of `Host` blocks; `Match` blocks and `Include` are not followed. Null when nothing
 * matches or when the address is itself an alias (its settings already apply).
 */
export function sshAliasFor(address: string, config: string): string | null {
  const wanted = address.trim().toLowerCase();
  if (wanted === '') return null;
  const aliases = new Set<string>();
  let block: string[] = [];
  let blockHasHostName = false;
  let found: string | null = null;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(line);
    if (!m) continue;
    const keyword = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();
    if (keyword === 'host') {
      block = value
        .split(/\s+/)
        .map((v) => v.replace(/^"|"$/g, ''))
        .filter((v) => v !== '' && !/[*?!]/.test(v));
      for (const a of block) aliases.add(a.toLowerCase());
      blockHasHostName = false;
    } else if (keyword === 'match') {
      block = [];
    } else if (keyword === 'hostname' && block.length > 0 && !blockHasHostName) {
      // The first value wins in OpenSSH, within a block too.
      blockHasHostName = true;
      const hostname = value.replace(/^"|"$/g, '').toLowerCase();
      if (found === null && hostname === wanted) found = block[0] ?? null;
    }
  }
  return aliases.has(wanted) ? null : found;
}
