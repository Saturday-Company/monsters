# Using Monsters from afar: SSH and Telegram

The Monsters core only listens on `127.0.0.1` of your PC and opens no ports to the outside (D-013). From afar there
are two ways, both clients of the same core, with the same log and the same kill switch (D-002):

- **SSH** (D-014): you get into the PC with your own SSH and use the `monsters` command line, or open the web UI
  through a tunnel, or connect the desktop app of another computer (the app opens the tunnel itself).
- **Telegram** (M2.6): you write to your bot from your phone. Nothing to install, but it goes through Telegram's
  servers.

## SSH

### Connecting with a key
1. On the computer you connect from, create a key (once) and copy it to the Monsters PC:

   ```sh
   ssh-keygen -t ed25519
   ssh-copy-id user@monsters-pc
   ```

2. On the Monsters PC, turn off password access: in `/etc/ssh/sshd_config` set `PasswordAuthentication no` (and
   `PermitRootLogin no`), then `sudo systemctl reload ssh`. First check that the key works from another window, so
   you don't lock yourself out.
3. If the PC isn't reachable from the internet, don't open port 22 on the router: use a VPN such as Tailscale or
   WireGuard and connect to its private address.

### The chat in the terminal
The core has to be running on the PC (`monsters start`, for example inside `tmux`, so it stays up when you close the
session). Then, from the SSH session:

```sh
monsters chat
```

It is an interactive chat, no browser:

- every line is a message to the squad; `@Rhea …` at the start talks to a specific monster (or
  `monsters chat --to Rhea`);
- answers appear while the monster writes them; delegations, notes touched and errors in short lines;
- a question shows numbered options: type the number to choose, `/r <text>` (or `/risposta <text>`) to answer in
  words (open questions too);
- `/stop` stops all the monsters at once (kill switch), `/resume` (`/riprendi`) starts them again after a
  confirmation;
- `/new` (`/nuova`; or `/new @Rhea`) starts a new conversation, `/status` (`/stato`) says what is running, `/help`
  (`/aiuto`) lists the commands, `/exit` (`/esci`, or Ctrl+D) closes the chat: work in progress goes on.

With input from a file or a pipe (`echo "summarize the week" | monsters chat`) the chat waits for the work it started
to finish and then exits. The single commands are still there: `monsters chat "<text>"`, `monsters answer <id>
<n|text>`, `monsters status`, `monsters kill`, `monsters resume`.

The first start (account, squad, permissions) is done in the web UI: from SSH use the tunnel below.

### The web UI through a tunnel
```sh
ssh -N -L 4747:127.0.0.1:4747 user@monsters-pc
```

Then open `http://127.0.0.1:4747` in the browser of the computer you connect from. Use the **same port** on the left
and on the right (`4747:…:4747`, or the one of `monsters start --port`): the core only accepts pages opened from its
own origin and refuses the others. The sign-in is the usual one.

### From the desktop app
With the desktop app you don't need to open the tunnel by hand: add the PC as a connection and the app uses your `ssh`
to connect to the Monsters running there (D-044, D-047).

0. At first start the app asks **Where do your monsters work?**: "On another computer of mine" opens the form below
   directly, and the Monsters of this computer doesn't start.
1. **Connections…** (Monsters menu, tray icon or button on the status pages) → **Add a computer**: the computer
   (address, Tailscale name or an alias from `~/.ssh/config`, also `user@computer`) and, if you want, a name ("Home
   PC"; empty = the address). User, port, key, Monsters port and data folder are under **Advanced options**, with the
   values `ssh` would use already written in grey: usually you don't need them. **Try** opens and closes the
   connection without switching computer and tells you whether it works; then **Save and connect** (Enter works
   too). If the address can't be found on the network the app says so at the first "Save"; a second "Save" keeps it
   anyway.
2. The first time the app shows the fingerprint of the PC's key: compare it with the one printed, on the PC, by
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` and press **I trust it, connect** only if they match. The app
   remembers it in its own `known_hosts` (it reads your `~/.ssh/known_hosts` and never touches it); if one day the key
   changes, it won't connect and tells you so.
3. With **Sign in without a password** (on by default in new connections) the app signs in by itself: it reads the PC's
   command-line token over SSH and uses it once to open the session for you. Whoever has your SSH key can already
   command Monsters there, so it grants no new access; turn it off if you'd rather the app didn't touch that token,
   and then you sign in with the email and password of that PC's Monsters (once). If that Monsters has never been
   set up, the app reads the setup code over SSH and you only type an email and a password.

From then on the app reopens that connection at every start. **Use** (menu or tray) switches from "This computer" to
another connection; with a remote connection the Monsters of this computer doesn't run, so if work is in progress
there the app asks before stopping it. The window title and the tray icon tell you where you're connected.

- You need an SSH key that already works (see above), or the SSH agent, and the core running on the PC. Passwords
  aren't supported: if access is refused, `ssh-copy-id user@pc` and, for a key with a passphrase, `ssh-add`. From the
  error page, **Fix the connection** opens the form on the field to change.
- The core's port is found automatically; it doesn't need to be the same on both sides.
- Before showing you the PC's Monsters, the app checks that it really is Monsters: at every start the core writes a
  key in `server.json` and answers a challenge signed with that key. For this the PC needs a Monsters version equal
  to or newer than the app's (otherwise the app asks you to update it), and for now the remote PC has to be Linux or
  macOS.
- If the network drops or the computer goes to sleep, the app reconnects by itself: at the bottom of the window
  "Link to … interrupted. Reconnecting…" appears, then "Connected to …". **Reconnect** in the menu tries right away.
- **Stop everything** and **Resume** in the menu and in the tray act on the Monsters you're looking at, even if it's
  remote.
- Quitting the app closes the tunnel; the Monsters on the PC stays on with its monsters.

#### Apps and services with sign-in (OAuth) from another computer
Connecting a service from the gallery with "Sign in to …" (Notion, Linear, Sentry…) also works when Monsters is on
another PC, without a hand-made tunnel (D-072): the service's page opens in the browser of the computer you work on
and, after the sign-in, comes back to the address where the app (or the browser) sees Monsters, that is the tunnel on
this computer. The tunnel carries it to the PC's Monsters, which checks the `state` and completes the sign-in with its
own PKCE: codes and tokens don't go anywhere else and stay on the PC.

- With the desktop app nothing is needed: the tunnel is its own.
- With the web UI and `ssh -L` the same applies, as long as the tunnel stays open during the sign-in.
- If the return page doesn't open (tunnel dropped, Monsters reached over the network with `--allow-non-loopback`),
  the service's panel has "Return page won't open?": copy the address from the browser bar and paste it there. It
  works once, for 10 minutes, and only for the sign-in you started.

#### From a Mac to a PC with Tailscale (example)
The PC is called `my-desktop` on Tailscale and accepts SSH only with a key, for the user `alice`; on the Mac there is an
alias in `~/.ssh/config`:

```
Host my-desktop
  HostName 100.64.0.1   # the PC's Tailscale address
  User alice
```

1. On the PC the core has to be running (`monsters start`, or the desktop app open on "This computer" and left there).
2. From the Mac, in a terminal, `ssh my-desktop true` must answer without asking for a password (the key is in the
   agent or has no passphrase).
3. In the app on the Mac: **Connections…** → **Add a computer**, computer `my-desktop` (the alias: user, address and
   key come from `~/.ssh/config`), name "My PC", the rest empty → **Try**, then **Save and connect**.
4. Compare the fingerprint with the one printed by the PC (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`),
   confirm, sign in with the PC's Monsters account.
5. Tests: a chat, "Stop everything" from the menu bar (the PC's core stops), Wi-Fi turned off and on again or the Mac
   put to sleep (banner and reconnection), then **Use → This computer**.

The PC's SSH server allows tunnels (`AllowTcpForwarding` is at its default value): nothing needs changing.

### Security
- Whoever gets into the PC as your user has Monsters in hand: the CLI uses the token in `~/.monsters/cli-token`
  (permissions 600, regenerated at every start of the core). Protect SSH access as you would protect the PC.
- Don't start the core with `--allow-non-loopback` to reach it from outside: always go through SSH or the tunnel.
- Actions done from the terminal end up in the log like those of the UI (the "command line" channel).
- The terminal chat strips control characters from everything it prints (the monsters' text, questions, errors): a
  text can't clear the screen, hide links or write to the clipboard of the computer you connect from.

## Telegram

### Connecting the bot
1. On Telegram open [@BotFather](https://t.me/BotFather), type `/newbot`, pick a name: it gives you a token.
2. In Monsters, **Settings → Connections → Telegram** (Impostazioni → Collegamenti → Telegram), paste the token:
   Monsters checks it with Telegram and saves it in `~/.monsters/secrets/` (encrypted with the system keychain, or a
   600 file where there is none). Alternatively you can use the `TELEGRAM_BOT_TOKEN` variable. The token no longer
   appears in the UI, in API answers or in the log.
3. **Connect an account**: the UI shows a code (valid once, for 10 minutes, 5 attempts for each Telegram account:
   whoever gets it wrong can't burn it for the others). From your phone, write `/start <code>` to the bot or tap
   "Open in Telegram". Your account joins the list of who can command the monsters; you remove it from the same
   page: from then on it receives nothing, not even the answers to jobs it had started.

### What you can do from your phone
- Write a message: it goes to the orchestrator (or to a monster with `@Name` at the start); the answer arrives in
  the chat. With several accounts connected, the answers to a job go to whoever started it; whoever writes while it
  is running adds the message to the job.
- The monsters' questions arrive with buttons; for open questions, reply to the message. If you answer from the UI or
  from the terminal, the message on Telegram updates (and vice versa). After a restart old questions lose their
  buttons, and replying to one of them doesn't send a new message to the squad.
- `/stop` stops everything at once (confirmation in the chat), `/resume` (`/riprendi`) asks for confirmation and
  starts them again, `/new` (`/nuova`) starts a new conversation, `/status` (`/stato`) says what is running,
  `/help` (`/aiuto`) lists the commands. The bot understands both the English and the Italian names.
- Notifications: work finished (for jobs started elsewhere), question waiting, error. Each one can be turned off in
  the settings. With **Quiet at night** notifications wait until the chosen hours end; a question that blocks the
  work arrives anyway, without sound. If you're writing to the bot at that moment, answers arrive right away.
  Pending notifications stay even if Monsters restarts.

### A bot for one monster, in a group (D-107)
Besides the usual bot (yours, in private, talks to the god) you can give a monster a bot of its own, to put in a
group: everyone you admit talks to it. Each bot has its own token and its own monster; you can have more than one.
1. With [@BotFather](https://t.me/BotFather) create a **new** bot (`/newbot`). A token is used by one program at a
   time: if the bot already exists and another program uses it, create a new bot or stop that program first,
   otherwise Telegram gives the error "another program is using this token".
2. Still with BotFather: `/setprivacy`, choose the bot, **Enable**. In groups the bot only receives the messages that
   mention it, the replies to its messages and the commands.
3. In Monsters, **Settings → Connections → Telegram → Bots dedicated to a monster**: paste the token and choose the
   monster (name and project). The god can't: it talks from the main bot. Optional: a limit on messages per day.
4. Add the bot to the group. The group shows up in Monsters "to approve" (the main bot tells you too): **Approve**.
   Whoever wants to talk to the monster types `/join` in the group (or to the bot in private): you approve them on
   the same page, or add them with their Telegram ID. You (the account paired with the main bot) are always there.

In the group the monster answers when you mention it (`@name_of_the_bot`), when you reply to one of its messages or
with a command (`/status`: only that monster; `/join`; `/help`). Each chat has its own conversation with the monster,
separate from the app's chat; in the app you see the messages in the monster's chat with the name of whoever writes
and "from Telegram · <group>". The monster's normal questions arrive in the group and are answered by whoever made
the request. The things only you decide (the brake cards, drafts of monsters, projects and automations, spending over
the cap) are never approved in the group: they reach you on the main bot and in the app, and in the group the monster
writes "Alice's OK is needed: I've asked them".
Other people's words aren't yours: their links don't become known sites and, when they ask for something, the checks on
outgoing data are on, as after a web page. In these chats the monster doesn't have your profile and `Privato/` is
closed. A bot that breaks (token revoked, another program on the same token) stops by itself and says so in the list;
the others and the main bot carry on. With "Stop everything" the bots answer that the monsters are stopped.

### Security
- Only the private chats of the connected accounts reach the monsters (for the dedicated bots: the people and the
  groups you approved, above). Messages from other accounts, from groups and forwarded messages are ignored and end
  up in the log (account id, reason, at most the start of the text).
- The bot uses long polling: it is the core that calls Telegram, no port is open on the PC. If the network drops it
  retries by itself, with growing waits; messages that fail to go out also wait (in order) and go as soon as Telegram
  answers, up to 30 minutes.
- An unknown account sending random codes gets at most one answer and ends up in the log once every 10 seconds.
- Messages with a bot aren't end-to-end encrypted: they go through Telegram's servers. Don't send passwords or keys
  in chat.
- Whoever has your unlocked phone can command the monsters: in that case remove the account in the settings, or press
  "Stop everything" in the UI or `monsters kill` from SSH.
