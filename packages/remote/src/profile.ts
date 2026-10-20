import { DEFAULT_PORT } from '@monsters/shared';
import { z } from 'zod';

// Values end up as separate argv entries of `ssh` (never through a shell), but a
// leading `-` would still be read as an option: `-oProxyCommand=…` as host is
// the classic injection. Whitespace and control characters are never valid.
const NO_OPTION = (v: string) => !v.startsWith('-');
// eslint-disable-next-line no-control-regex
const NO_CONTROL = /^[^\u0000-\u001f\u007f\s]+$/;
// Single-quoted in a remote shell command: no quotes, `$`, backslashes or control characters.
// eslint-disable-next-line no-control-regex
const SHELL_SAFE = /^[^'"`$\\\u0000-\u001f\u007f]+$/;

const Port = z.number().int().min(1).max(65_535);

/**
 * A remote Monsters core reachable over SSH. `host` may be a hostname, an IP
 * address or an alias of the user's `~/.ssh/config` (whose settings apply).
 */
export const ConnectionProfileSchema = z.object({
  /** Name shown to the user ("PC di casa"). */
  name: z.string().trim().min(1).max(80),
  host: z
    .string()
    .min(1)
    .max(255)
    .regex(NO_CONTROL, 'host must not contain spaces or control characters')
    .refine(NO_OPTION, 'host must not start with "-"')
    .refine((v) => !v.includes('@'), 'put the user in "user", not in the host'),
  /** SSH user; default from the SSH config, else the local user name. */
  user: z
    .string()
    .min(1)
    .max(64)
    .regex(NO_CONTROL, 'user must not contain spaces or control characters')
    .refine(NO_OPTION, 'user must not start with "-"')
    .optional(),
  /** SSH port; default from the SSH config, else 22. */
  sshPort: Port.optional(),
  /** Private key; default the SSH config and the agent. Only keys: no passwords. */
  identityFile: z.string().min(1).max(4096).optional(),
  /**
   * Port of the core on the remote machine. When omitted it is read from the
   * remote `server.json` at every connection, falling back to 4747.
   */
  remotePort: Port.optional(),
  /**
   * `MONSTERS_HOME` on the remote machine, used only to find `server.json`
   * (default `$MONSTERS_HOME`, else `~/.monsters`). Relative paths and `~/…`
   * are relative to the remote home folder.
   */
  remoteHome: z
    .string()
    .min(1)
    .max(1024)
    .regex(SHELL_SAFE, 'remoteHome must not contain quotes, $ or \\')
    .optional(),
});

export type ConnectionProfile = z.infer<typeof ConnectionProfileSchema>;

export const DEFAULT_REMOTE_PORT = DEFAULT_PORT;

/** Validates a profile (e.g. read from the app settings); throws a ZodError. */
export function parseProfile(value: unknown): ConnectionProfile {
  return ConnectionProfileSchema.parse(value);
}
