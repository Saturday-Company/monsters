# Security model

Vulnerability reports must follow `SECURITY.md` (in the root of the repository), not a public issue. This document
describes the perimeter, the threat model and the risks we have accepted.

## In scope

- The **local core** and its APIs: authentication, sessions, CLI tokens, `Host` and `Origin` checks, the `/api/stream`
  WebSocket.
- The **kill switch**: any way to make the agents' work restart or continue after a `kill`.
- The **action log**: secrets (API keys, tokens, passwords) that end up in the log despite redaction.
- File permissions in `~/.monsters` and access to another user's data on the same PC.
- The vault (second brain), the agents' permissions on the vault and the reversibility of changes.
- The **granted folders** of the `fs_*` tools: any way to read or write outside those folders (paths, symbolic links),
  to reach the vault or Monsters' data with `fs_*`, or to write in a folder granted as read-only.
- The **agents' permissions**: an agent that obtains a tool the user hasn't granted it, or that keeps using it after the
  permission has been removed.
- **Monsters' secrets** (keys in `secrets/`, CLI tokens, `MONSTERS_*` variables) that reach the environment of the
  agents' commands or, in clear, the model.

## Known risks

- **The action log is append-only only toward the core.** The immutability of the `events` table rests on SQLite
  triggers that reject `UPDATE` and `DELETE`. Whoever can write the `~/.monsters/monsters.db` file (the same system
  user, so also an agent with shell access) can drop the triggers, modify the database or replace it. The log serves
  to reconstruct what happened, it is not tamper-proof evidence: a signed log, or one kept out of the agents' reach, is
  future work.
- **Orphan processes on Windows.** On Linux and macOS the agents' processes live in a group of their own, recorded in
  `~/.monsters/process-groups.json`: if the core crashes, on the next start it terminates the groups left behind, after
  checking that they are still its own (processes' start time). On Windows the child processes of a crashed core are
  not cleaned up yet.
- **The terminal is worth as much as your account.** An agent with the "Run commands" permission (`shell`, off by default)
  runs commands as your system user: it can read and write outside the granted folders too, including `~/.monsters`
  (keys, CLI token, `settings.json`, database) and the vault without going through git. It is the perimeter you choose
  by granting it, per agent, and the UI says so in plain words. Mitigations: the commands' environment doesn't contain
  Monsters' secrets (`MONSTERS_*`, provider keys, values equal to a loaded key); keys, the CLI token and the setup code
  are masked in the output that reaches the model and in the log; every command and its result end up in the log; the
  output reaches the model as external data; timeouts (120 s, 600 at most); the kill switch and the end of the work
  stop the command with all its descendants; Monsters never uses `sudo` (a command that asks for it is refused: it is
  a speed bump, not a boundary, and it doesn't replace the system's permissions).
- **Processes that leave the group.** The kill switch reaches the command's process group. A program that detaches from
  it on purpose (`setsid`, daemons, `systemd-run --user`, `launchctl`, scheduled tasks) is not stopped. On Windows the
  process tree is closed with `taskkill /T` as long as the main process is alive.
- **The check on outgoing data is a rule, not a boundary** (D-070). After a page or a result from third parties, an
  address, a search or a command that repeats a private note, or long pieces of notes headed to a site never seen in
  the work, are stopped with the card; a few words are noted in the receipt. Encrypted data, summaries in one's own
  words or split into many small requests are not recognized; on subscriptions (Claude Agent) the pages read with the
  plan's tools don't yet taint the work. Invisible characters (Unicode tags, zero-width, bidi) are removed from every
  external text. The check also applies to the arguments of every MCP tool, reads included; notes written after text
  from third parties stay marked: whoever rereads them has the defenses on.
- **Memory after text from third parties.** In a job of yours that has read pages or results from third parties, the
  `Da ricordare:` lines (“To remember:”; the marker is still Italian) are written by themselves with the mark
  `⟨da testo di terzi⟩` (“from third-party text”); only those that contain a web address, an email or an order
  (“send”, “upload”, “always use”, “ignore”…) wait for your confirmation (To review), and so do all those of a job
  asked by another person or of a Telegram group. The marked lines reach the monster inside the block of external data,
  not as “Your memory”, and a job that reads them has the defenses on. In the memory's note (Notes → Agenti), “It’s
  mine” removes the mark from a line; only you in person, not the token. It is a rule in words, not a model: a sentence
  that doesn't look like an order (“The user prefers sources from X”) is written by itself, marked, and the monster
  reads it as data. Beyond 5 open drafts per monster the oldest expires, with a line in Activity.
- **Fingerprint of MCP tools** (D-070). At a server's first connection what it sees is trusted; from then on a new tool,
  or one with a changed description or arguments, stays paused until you accept it (the gallery's services add tools
  without a pause, but a changed description stops anyway). A server that changes behavior without changing name,
  description and schema is not seen.
- **Claude Code transcripts.** Runs with the Claude subscription leave the session in `~/.claude/projects` (needed by
  `--resume`, so `--no-session-persistence` can't be used; `CLAUDE_CONFIG_DIR` would move the login too). They contain
  prompts, memory and notes read. That folder is closed to `fs_*` and to the monsters' terminal (a speed bump, like the
  rest) and Claude Code's automatic memory is off in the runs; but whoever has the terminal can always get around a
  speed bump, and every other program of the user reads them.
- **The desktop app's cookie.** The app's session lives in its data folder (`~/.config/Monsters`,
  `~/Library/Application Support/Monsters`, `%APPDATA%\Monsters`). The package has the `EnableCookieEncryption` fuse, but
  the key is within reach of every process of the user: on macOS it is in the Keychain (and with RunAsNode on, a process
  that uses the app's binary inherits the “Always allow”), on Windows it is protected by the user's DPAPI, on Linux it
  is in the keychain (libsecret or kwallet), which has no per-application controls. **On Linux without a keychain**
  (servers, sessions without D-Bus, `--password-store=basic`) Chromium uses a fixed, known key: the cookies are in
  practice in clear; without the fuse (a start from sources) they are on every system. The encryption protects from a
  copy of the disk or of the backups, not from a monster with the terminal. That is why: in local mode the owner's
  cookie is a session one (it doesn't go to disk, at every start you sign back in from the bridge) and a limited cookie
  left over from an attached session is replaced; the app's data folder is closed to the terminal, to `fs_*` and to the
  monsters' harnesses (a speed bump, like the transcripts). Attached, SSH and browser sessions keep the cookie for 7
  days, but the most sensitive actions want the password from the last 15 minutes (see below, “Recent confirmation”).
- **Gallery servers and dependencies.** Shopify runs from a package installed once with `npm ci` on a lockfile of ours
  (integrity of every package, no scripts, public registry), like the browser. Blender runs from a dedicated Python
  environment (`~/.monsters/mcp-packages/blender`): `uv pip install --require-hashes --only-binary :all:` on
  requirements of ours (version and sha256 of every file of every package, indirect ones included, for Linux, macOS and
  Windows; no builds), then the server from the tarball of its commit with its sha256 (uv refuses a different archive),
  `--no-deps`, without the user's uv/pip configuration; it starts from the environment's Python, never `uvx`. What
  remains: we generated the requirements on 18/10, so a version already compromised before that is not stopped; the
  tarball comes from projects.blender.org (if Gitea changes how it compresses archives, installation stops until we
  update the sha256).
- **The session cookie in the browser reaches every service on `127.0.0.1` (S-B13).** Cookies don't distinguish ports:
  with the UI open in a browser, another server on `127.0.0.1:<port>` that you visit (a dev server with code written by
  a monster, another user's service on the PC) receives `monsters_session`. By itself it is no longer enough: a session
  opened in the browser is tied to a **tab secret**, which the core gives to the UI at sign-in (in the response, never
  in a cookie) and which the UI keeps in memory and in `sessionStorage` (of that origin, port included: another local
  service doesn't read it). The UI sends it in the `X-Monsters-Session` header of every request and in the WebSocket's
  first message (not in the URL, which ends up in logs and history); the core accepts a request with the cookie only if
  the secret is the session's (stored as a hash), otherwise 401. Previews and downloads (`<img>`, `<iframe>` of the
  sandboxed pages, “Download” links) carry no headers: they go through with a **ticket** in the URL (`?ticket=`),
  requested by the UI with the secret, tied to the session, to that file and to that part (content or thumbnail), valid
  for 2 minutes and 16 requests, kept only in memory, with a maximum of tickets per session (those of another session
  don't push out its own). Thumbnails are the exception: one ticket is valid for the thumbnails of all the session's
  files (2,048 requests), so a long list asks for just one. In the browser “Download” is a button that asks for the
  ticket on click, not a link: an address without a ticket, opened in a new tab or copied, would answer 401. Retrieving
  the secret with an endpoint protected by headers (`Sec-Fetch-Site`, anti-CSRF) doesn't hold: a server that has the
  cookie writes them from Node as it likes. That is why **a new tab asks the secret from the tabs already open** on the
  same origin (`BroadcastChannel`, which another port doesn't reach); a reload finds it again in `sessionStorage`;
  **with no open tabs the browser asks for the password again**. **The desktop app doesn't change:** it keeps the cookie
  in a session of its own for each destination (D-044), where no other site receives it, and opens sessions without a
  secret (automatic sign-in, and `partitioned` when the password is typed in the window); the same for the app's SSH
  tunnel. The CLI uses the token, as before. What remains: a program of your user that reads the browser's profile on
  disk (cookies and `sessionStorage` saved to restore tabs) has both, as it had the cookie; and the sessions opened
  before this version were closed (you sign back in once).
- **Recent confirmation for the most sensitive actions** (residual risk of M1). A session confirmed with the password
  stays yours for 7 days, but letting a monster run commands, pairing a Telegram account or changing the main bot, and
  turning on “Tools for others” of a dedicated bot want the password typed in that session in the last 15 minutes
  (server side, `confirmed_at`); otherwise the core answers `confirm_required` and the UI asks for the password
  (“Confirm it’s you”, `POST /api/auth/confirm`, in the same session). Changing the password already asks for the
  current one. The session the desktop app opens by itself on its own core (from the app's channel, cookie never on
  disk, new at every start) always counts as recent: the local mode experience doesn't change. It lasts as long as the
  core that opened it: when the core restarts the app's sessions close and the app asks for a new one by itself, so a
  copy of its cookie doesn't stay “recent” for a week. Restoring from the archive a monster (or a project with its
  monsters) that could run commands asks for the same confirmation as granting it.
- **Attaching to the local core.** The desktop app and the CLI send the CLI token only to a core that proves to be the
  one of the data folder (HMAC with the `proofKey` of `server.json`, like the tunnel); a core without a `proofKey` is
  not attached to. The app's IPC recognizes the core's page from the frame's origin, not from the URL.
- **File trash.** `fs_delete` and the overwrites of `fs_write`/`fs_move` move or copy the files into
  `~/.monsters/trash/files/`: they can be recovered from there, but the trash doesn't empty itself.
- **Writing a file can be worth as much as the terminal.** Some files make the computer run commands later: `.git`
  folders (hooks, `core.fsmonitor` in `config`), `.husky`, shell profiles (`.bashrc`, `.profile`, `.zshrc`…), `.envrc`,
  `.npmrc`, `.yarnrc.yml`, `.vimrc`, `.ssh/`, `.vscode/`, autostart (`~/.config/autostart`, `~/Library/LaunchAgents`,
  Windows' Startup folder, PowerShell profiles). An agent **without** the “Run commands” permission can't write them or move
  files or folders into them with `fs_write`/`fs_move`, in any granted folder; with the terminal the block would make
  no sense and there isn't one. The list is not exhaustive (a program can read configurations anywhere): granting
  write access to a folder that contains projects or configuration files remains a choice to make with care, and the UI
  reminds you. Since the review of 18/10 the list also covers the files of a repo that launch commands at the next test
  or commit (`Makefile`, `justfile`, `Taskfile`, `.pre-commit-config.yaml`, `lefthook`, `conftest.py`, `tox.ini`,
  `noxfile.py`, `setup.py`, `build.rs`, `.pnpmfile.cjs`, `.devcontainer/`, `.idea/`, `.cargo/config.toml`,
  `.github/workflows/`) and `~/.local/bin` and `~/.local/share/applications`. `package.json` can be written, but without
  changing `scripts`, `husky`, `simple-git-hooks`, `lint-staged` and `bin` (the content is compared before and after,
  in moves too). **It is not a boundary**: whoever writes a project's source (a `.ts`, a `.py`, a test configuration)
  makes code run at the next `pnpm test` or `git commit` anyway. That is why the project's card says that all its
  monsters write in the folder, and in a job that has read text from third parties every write (`fs_write`, `fs_move`,
  `fs_delete`) in a project's folder is a brake card, even with the terminal, regardless of the “Always ask” rules. A
  relative path counts as inside the folder. It doesn't apply to Claude Code or Codex agents with their own tools: there
  the controls of their hooks remain.
- **Project folders.** A project can't have as its folder the home, a disk's root, a folder that contains them, a hidden
  folder of the home (`~/.ssh`, `~/.config`…), `Library` or `AppData`, nor a folder that contains or sits inside the
  notes, Monsters' data or the folder where the app is installed. It applies to proposals and to creation, on the given
  path and on the real one, and again at the touch of “Confirm”. The draft's card (app and Telegram) says that all the
  project's monsters will be able to read and write there and carries the warning about text from third parties; from
  Telegram, an already existing folder outside `~/Monsters Progetti` is confirmed only in the app.
- **The app's install folder.** The desktop app tells the core where it is installed (`resources/` and the executable's
  folder, `MONSTERS_INSTALL_DIRS` variable): `fs_*` doesn't enter it, even going through a granted folder that contains
  it (on Windows the installation is per user, in the home). The core sits outside the ASAR, in `resources/core`: the
  package carries inside `app.asar` the sha256 list of all its files per platform and architecture
  (`core-manifests/`, generated from the prepared core and rechecked on the finished package), and the app compares it
  with `resources/core` before every core start, even after a crash: a changed, extra or missing file and the core
  doesn't start, the window says so (S-M9; ~60 ms for 150 files and 21 MB). The development core indicated with
  `MONSTERS_DESKTOP_CORE` applies only outside the package. On macOS the native modules (`.node`) are signed after the
  package: their presence is checked, their content is guaranteed by library validation.
  - **No modules from outside (review of 19/10, no. 1).** The optional packages that the code looks for inside a
    try/catch (`bufferutil`, `utf-8-validate`, `supports-color`, `encoding`) are in the bundle as modules that fail like
    an absent package: the core never looks for them on disk. The app starts the core with `MONSTERS_CORE_CONFINE=1`,
    without `NODE_PATH`: a resolution hook (`module.registerHooks`, at the top of every bundle file) refuses every
    `require` or `import()` that ends up outside `resources/core`, so a package put in `resources/node_modules` or higher
    up doesn't run in the core. Static imports (`@node-rs/argon2`) resolve before the hook, but in the nearest
    `node_modules`, that of `resources/core`, covered by the list.
  - **What the list covers, system by system (no. 4).** On macOS and Windows the list is in an `app.asar` covered by the
    integrity fuse (the asar's hash is inside the signed executable). **On Linux Electron doesn't verify the asar**:
    whoever can write in the install folder rewrites `app.asar`, the list and the core together, and the check doesn't
    stop them. On Linux the check therefore applies only where the user can't write: the `.deb` (in `/opt`, root's) and
    the AppImage (read-only); a folder extracted in the home (`--dir`, an archive) is not protected. Tying the list to the
    updates' signature wouldn't change anything: whoever rewrites the asar rewrites the code that checks it too.
  - **Between check and use passes the whole session, not an instant (no. 12).** The check is at core start; afterwards,
    the core reads other files even hours later: `embed-worker.js` and `extract-worker.js` when needed, the UI files
    (`web/`) at every page, argon2's `.node` at first use. Whoever can write in `resources/core` by other means (for
    example a monster with the terminal, on an installation writable by the user) can change them after the check. The
    keychain binary, which runs with the identity of the app's helper, is instead rechecked at every call: the helper
    rereads its sha256 from the list right before loading it (on Linux and Windows; on macOS there is library
    validation), and a different one is not loaded.
- **The app's binary doesn't act as Node.** The desktop app's `RunAsNode` fuse is off (review of 18/10, S-M8): no program
  of the user can start the signed binary as an ordinary Node to inherit its identity (on macOS the Keychain's “Always
  allow” on the secrets' key and the TCC permissions given to the app; on Ubuntu the AppArmor profile that allows it user
  namespaces). The keychain calls run in a process of the app (the helper) whose JavaScript lives entirely in the
  `app.asar`, covered by the integrity fuse on macOS and Windows: of `@napi-rs/keyring` it loads only the platform's
  native binary (`process.dlopen`, fixed file name), never its `index.js` in `resources/core`. The helper (and before it
  the app) accepts only Monsters' entries: service `Monsters`, account `home-` plus 24 hexadecimal digits; every other
  entry, for example one of another app that macOS would show in Monsters' name, is refused. The native binary stays
  outside the asar, in `resources/core` (a `.node` inside the Electron asar would be extracted into a temporary folder,
  writable by the user): on macOS it is protected by the hardened runtime's library validation (it must be signed with
  the app's Team ID), while on Windows (per-user installation) whoever can write in `resources/core` can replace it and
  make it run with the helper's identity, as they can already replace the core (the core's hashes checked from the asar,
  M9, stop it at startup, and the helper rechecks the binary's sha256 right before loading it: only the instant between
  the two remains). On Windows and Linux the keychain doesn't distinguish programs anyway. The core's JavaScript children
  (browser, gallery MCP servers, Codex, npm) use a `node` from the PATH, as they already did to install themselves, and
  don't have the app's identity: the core looks for it once at startup and keeps its absolute path, skipping relative
  PATH entries, the folders where the monsters can write (data folder with their homes, vault, projects folder and
  folders granted for writing), on Windows everything that isn't `node.exe` (no `.cmd` or `.bat`) and Node versions older
  than 20. A `node` put later in a PATH folder doesn't change the children's until restart; a `node` in a PATH folder
  writable by the user by other means (for example with the terminal) can still be hijacked. It remains true that whoever
  runs programs as you can ask the keychain for the secrets' key where the keychain doesn't distinguish programs
  (Secret Service on Linux) and read the data files (see “The terminal is worth as much as your account”).
- **Desktop app updates** (review of 18/10, S-A4 and S-A5; details in `docs/signing.md`). Since the first alpha with
  verification, every channel file of the feed (`alpha*.yml`, with the packages' sha512) has an Ed25519 signature of ours
  (`.sig`), verified by the app with the public keys it carries before downloading; for the deb, root rechecks it, with
  the keys of `/opt/Monsters/resources`, together with the package name and a version higher than the installed one.
  Whoever writes in the R2 bucket or controls the Cloudflare account is no longer enough to have something installed:
  the private key is needed, which is not on Cloudflare. The app reads the channel file and its signature only once,
  from its provider, and gives electron-updater the signed object itself: no second read, no legacy fields (`path`,
  `sha2`) that lead to another download; the downloaded file's sha512 is rechecked against the signed file. The private
  key, in the user that runs core and agents, is only there encrypted (scrypt N=2^20 and AES-256-GCM, with
  `node:crypto`: no other program sees it); the passphrase is typed in the terminal at every publication, never in an
  environment variable. **It is not true that the key is out of the agents' reach:** publishing runs the repo's code with
  the decrypted key in memory, so a tampered commit or `node_modules` in this user can take it away while publishing
  (that is why we publish from a clean checkout of a reviewed commit; a separate signer that doesn't run the repo's code
  doesn't exist yet). The deb's root script verifies with `/usr/bin/openssl` 3.0 or later (Depends and version check). A
  test build (`--test-build`, `test-` keys) can't be published. What remains: the alphas already installed up to
  0.1.0-alpha.13 don't verify (they update once without a signature); a compromised feed can still withhold updates or
  stop at the last signed version; whoever has the private key publishes like us. On the Mac the Apple signing secrets
  must not belong to the CI user (in the `monsters-ci` design, which runs install with the dependencies' scripts, build
  and tests of every commit): the signed build is made by a separate user (`monsters-sign`), via sudo, with a fixed script
  installed by root outside the repo, on a checkout of its own of the commit verified by sha and its own `pnpm install
  --ignore-scripts`, with the non-exportable Developer ID key in its keychain (see `docs/signing.md`, “Mac: the signing
  user”). If the steps of that section haven't been done, the secret files stay readable by the CI user, and the CI
  script says so at every run. It remains true, even with the separation, that signed packaging runs the commit's code
  with the keychain open: a malicious commit can get something else signed, so only commits of `main` that have already
  been reviewed are signed.
- **Special files and races in `fs_*`.** Files are opened without following a link in the last element and without
  blocking (`O_NOFOLLOW|O_NONBLOCK`); on the descriptor it is checked that it is a regular file (a FIFO or a device is
  refused without blocking the core), the real path is reread (`/proc/self/fd` on Linux) and the checks of granted
  folders, instructions and startup files are repeated. A file with several names (hardlink) is not written. Missing
  folders are created one level at a time, and moves and deletions go through the folder that contains the entry: on
  Linux opened as a descriptor (`/proc/self/fd/<n>/<name>`, Node has no `renameat`/`mkdirat`) after checking that it is
  exactly the checked folder, so an intermediate folder replaced with a link after the checks doesn't take the
  operation outside; on macOS and Windows the folder's real path is reread right before (the window narrows, it
  doesn't disappear). A folder moved, replaced or deleted inside a project's folder, or that contains one, is looked
  inside (10,000 entries at most, beyond that it is refused): a project's instructions don't enter, don't leave and
  don't go to the trash, not even inside a folder and not even with the terminal. Without the terminal every moved
  folder is looked inside too, wherever it ends up: no file that launches commands and no instructions reach the
  destination. A big folder far from the projects (a `node_modules`) is deleted, and with the terminal moved, without
  looking inside.

- **The CLI token is not the user in person.** `~/.monsters/cli-token` is a file that every process of your user can
  read, including an agent with the terminal. With the token you can see the status, use the kill switch, resume, write
  in the chat and launch automations; you can't answer the brake cards, change permissions, “Always ask” rules, spending
  cap, the monsters' decisions, Telegram (main bot, pairing, dedicated bots), confirm drafts and projects, add, remove
  or accept MCP servers and connectors, change keys, addresses and models of the providers and the subscriptions, turn
  on a page's scripts, restore an archived monster or project, remove monsters and projects, undo vault changes, nor
  write a monster's memory, the profile or `Privato/` (they would be written without the mark). A test lists all the
  routes that change state: a new unclassified route makes it fail. The same goes for the session the desktop app opens
  by itself with the token (core started from the terminal or reached via SSH): for those actions the app asks for the
  password. The password without the old one (`monsters password`) is changed only with the core stopped. A message
  written with the token still counts as your word: an agent with the terminal can write in the chat in your place. A
  token out of the agents' reach (keychain) is future work.
- **Dedicated bots: whoever isn't you works with fewer tools.** In a dedicated bot's chat (a group, or the private one
  with an admitted person), when someone writes who is not the account paired with the main bot, the monster has no
  terminal (nor that of Claude Code or Codex), doesn't write, move or delete files, uses the other programs (MCP and
  connectors) only after a card to you, even for a read (mail, Notion, calendars) or a draft, and in the vault sees only
  its project's area, its own area and `Inbox/`; `file_read` reads only the files of that chat. The reply that goes into
  the chat, and every question from the monster to the chat, goes through the outgoing-data check (even without text
  from third parties): a key, a private note, repeated memory or a stretch of at least 120 consecutive characters equal
  to a note don't go out; the notes of the bot's project area don't count (they are the group's material). The chat
  receives one line about it, you a notice with “Send anyway” (on Telegram and in Activity), except for a key. The full
  tools are turned back on bot by bot (Settings → Apps and Telegram → Telegram → “Tools for others”), with a warning;
  `Privato/` and the profile stay closed anyway. It is a rule, not a boundary: a summary in one's own words or a split
  reply is not recognized.

## Out of scope

- Actions taken by an agent within the permissions the user granted it, even as a result of prompt injection: it is a
  declared risk of the “no blocks” principle (see `docs/ARCHITECTURE.md` §5.8). With the terminal the perimeter is the
  user's whole account (see above). Do report to us ways to **get out of** those permissions, though.
- Deliberately exposing the core on the network with `--allow-non-loopback`.
- Vulnerabilities of AI providers or of the external services connected.

## Accepted risk: passwordless `sudo` (D-119)
If the user that runs core and monsters has passwordless `sudo`, a monster that can run commands (or Claude Code/Codex with
their system tools) can do anything as root: read the data of Monsters and of other users, change the system, install
programs. Monsters' defenses (protected folders, brake, outgoing data) remain a boundary for the monsters without the
Run commands and a brake for those that have it. On a normal installation the user doesn't have passwordless `sudo` and this
risk doesn't exist: if they do, allowing commands is equivalent to granting root.

## Accepted risk: the update key's passphrase in the keychain (D-126)
To publish releases without anyone at the terminal, whoever publishes can keep the update signing key's passphrase in the
session's keychain (for example with `MONSTERS_UPDATE_SIGNING_PASSPHRASE_CMD` that reads it from there). Whoever controls
that user (even a monster that can run commands) can then sign an update that the apps install. The signature remains a full
defense against a compromised update server (storage, CDN, Worker), no longer against a compromised publishing machine.
To go back to the previous state: remove the passphrase from the keychain and publish by typing it at the terminal; if
the machine were compromised, generate a new key (`update-signing-key.ts generate`) and go through the signing bridge
described in `docs/signing.md`.
