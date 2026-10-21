# Changelog

The Italian version is in [`CHANGELOG.it.md`](CHANGELOG.it.md).

## 0.1.0-alpha.19 · 21 October 2026

### What you’ll see
- **Monsters is open source.** The code is on GitHub (github.com/Saturday-Company/monsters) under the Apache-2.0
  license, and the website is getmonsters.dev. From this version the packages can also be downloaded from the GitHub
  Releases.

### More reliable
- **Windows, files and terminal.** If the path of your user folder showed up in Windows’ short form (for example
  `MARIOR~1`), the monsters could find their working folder blocked: files, commands and Telegram stopped. Now the
  folder is recognized in both forms, and a path without a drive letter stays on the right drive.
- **Keys stay safe even with linked folders.** If Monsters’ data folder sits behind a link, the key in the keychain is
  always found again.
- **Reading web pages** is sturdier, and Electron and the other libraries are updated with their security fixes.

## 0.1.0-alpha.18 · 19 October 2026

### What you’ll see
- **Monsters ask for access with one tap.** If a project is missing something (the web for a monster, an already
  connected service like Canva, the browser), the squad lead asks you with a “Yes, allow / No” card, in the app and on
  Telegram. Only the owner can answer.
- **New projects start with your connections.** The services given to the whole squad (Canva, for example) are already
  ticked when you create a project; untick them if you don’t need them.
- **The web follows the permission.** With the web turned on in Permissions, every monster can search and read pages,
  even if searching isn’t part of its job.

### More reliable
- **No more false “the web was denied to me”.** Monsters only see the tools they can really use, and when something
  goes wrong they tell you the real cause: a site that refuses, a setting that’s off, a service not given to the
  project. They blame a “no” on you only if you said it.
- **Publishing always asks for confirmation.** With the browser, clicking Instagram’s “Share” now stops and waits for
  your yes, like the other ways of publishing.
- **Cleaner memories.** Monsters no longer remember wrong conclusions about access, and when you change a permission
  they know it from the next job.

## 0.1.0-alpha.17 · 19 October 2026

### More reliable
- **Telegram, the last step.** After pasting the token the page stayed on “Connecting to Telegram…” even when the bot
  was already connected. Now it updates by itself and shows right away the code to link your account: until you send
  it to the bot, the bot ignores all messages, yours included.

## 0.1.0-alpha.16 · 19 October 2026

### What you’ll see
- **Project monsters can be edited.** In a project’s Squad tab every monster has the same options as in your personal
  squad: you change name, look, role and tasks. The project’s lead changes name and look.

### More reliable
- **Telegram connects from the app.** Linking the bot always failed with “I can’t reach api.telegram.org”, even with
  the network fine: it was a flaw in how the app is built, now fixed.

## 0.1.0-alpha.15 · 19 October 2026

Fixes from the reports of people trying Monsters, and the release notes inside the app.

### What you’ll see
- **What’s new.** Next to “To review” there’s a key that opens this list: what changed with every update. It lights up
  when a new version arrives.
- **Every project has its own monsters.** When you ask your squad lead to create a project, it suggests new monsters,
  with their own names and looks. If you ask it to bring a monster you already have, the copy has its own role and
  rules, but a new name and look: you no longer find the same monster in two projects.
- **Notes.** In the filters the options no longer spill out of the box when the window is narrow.

### More reliable
- **VPNs and company proxies.** Monsters uses the computer’s proxy and certificates, like the browser: Telegram,
  OpenAI and the other services work even behind a company VPN.
- **Clearer errors.** If a service can’t be reached, Monsters says why (address not found, connection intercepted,
  timed out…) and what to try.
- **Telegram token.** You can also paste the whole message from BotFather: Monsters picks out the token by itself.
- **OpenAI after a pause.** When the computer wakes up, Monsters retries by itself for a few seconds before giving an
  error, and a network problem never signs you out of ChatGPT.

## 0.1.0-alpha.14 · 19 October 2026

A consolidation release on the way to the beta: a full review of the platform (features, connectors, interface,
security) and the fixing of what it found.

### What you’ll see
- **Clearer names.** Titan is “your squad lead”, whoever leads a project is the “project lead”. In place of
  “Instinct” there are the “Monsters’ decisions”, and the technical side (CLAUDE.md, cron rules, tokens, model IDs) is
  below, as detail.
- **Cleaner chat.** The greeting of the empty chat is written properly, service lines have a single style and group
  together, and notices no longer cover the writing field or the answers to questions.
- **Monsters not answering?** It now says so in one place (“Not connected”), with “Try again now”, and no longer
  treats a situation as fine when it isn’t.
- **Sidebar and small windows.** At 1024 px projects stay visible, notes open with the list in a drawer, “To review”
  is wider and shows project proposals in full, with the folder they grant.
- **Spending.** At the top of every view there’s the chain “Monster ≤ Project ≤ Whole squad”, with a warning if a cap
  is higher than the one containing it. The cost is estimated even where the provider doesn’t report it, and it says
  so.
- **Settings.** All the squads in one place, models chosen by name, paid search in Connections, switches and chosen
  tabs that can be told apart even without colors.

### More reliable
- Automations no longer stay stuck after a pause, and a run interrupted by an update restarts by itself.
- Messages written while a monster is busy are not lost with Stop or a restart.
- Models that think for a long time are no longer cut off after a minute; truncated answers say so (“Write
  ‘continue’ for the rest”); a momentary model limit doesn’t make the job fail.
- Claude Code and Codex no longer hang in silence; on Windows, stopping them also closes their processes.
- Services connected with OAuth (Notion and the others) no longer disconnect by themselves; if access expires, the
  gallery says “Access needed” and a notice arrives.
- Web search moves on to the next engine when one answers empty or refuses.
- Telegram: respects Telegram’s limits, groups that become supergroups, bots removed from groups, changing the token
  of a dedicated bot without losing groups and people.
- The event log no longer grows forever: after 90 days the bulky parts go into compressed monthly archives
  (`monsters log archive`).

### Safer
- App updates are signed with a key of ours: the app only installs genuine updates, even if someone got their hands on
  the update server.
- In Telegram groups, anyone who isn’t the owner can’t use the terminal, edit files, or use connected services
  without confirmation, and replies don’t carry private notes or keys out.
- The check on data leaving the computer applies to all connected services; the monsters’ memory can no longer be
  poisoned by a web page or a group.
- The command-line token can no longer approve the brake or change permissions, caps, passwords or Telegram.
- Project folders can’t be the home folder or system folders; instructions (CLAUDE.md, AGENTS.md) are protected at
  every depth; files that launch commands in a repo are protected.
- In the browser the session is tied to a secret of the tab: another local service can’t use it.
- The app checks at startup that its own core hasn’t been modified; the gallery’s Shopify and Blender install with
  verified dependencies.

### Good to know
- **macOS:** signed and notarized as always. At the first start after the update macOS asks again for keychain access
  for “Monsters Helper”: answer “Always allow”.
- **Windows:** the installer isn’t signed with a certificate yet (it will come after the beta): at the first start
  Windows shows a warning, go on with “More info” → “Run anyway”.
- **Browser:** after the update you need to sign in again; a new tab with no other tabs open asks for the password.
- **Sensitive actions:** in the browser, or with the app connected to another computer’s core, giving a monster the
  terminal or pairing Telegram asks for the password if it wasn’t typed in the last 15 minutes. With the app running
  locally nothing changes.

## 0.1.0-alpha.13 · 18 October 2026

### What you’ll see
- **Monsters suggest the project’s instructions.** Whoever works in a project with a folder can suggest how to change
  the folder’s CLAUDE.md or AGENTS.md: the suggestion arrives in “To review” with the differences, and the file
  changes only if you confirm. Monsters still can’t write them on their own.
- **“Choose…” for folders.** In the new project and in the Folder tab you pick the folder from the system window,
  instead of typing the path by hand (in the desktop app).
- **Touch-ups.** The brand is “monsters” in lowercase; in the spending cap “Per day” and “Per month” are aligned.

## 0.1.0-alpha.12 · 17 October 2026

### What you’ll see
- **How much of your plan is left.** For monsters on the Claude or ChatGPT plan, Monsters shows the real limits
  (session and weekly, with when they reset), like Claude Desktop’s “Usage” panel. The numbers update when a monster
  works on that plan.
- **A saner Automatic.** Ordinary work (posts, mail, research, short analyses) goes to Sonnet with Medium effort, hard
  problems and planning to Opus with High effort. Every delegated task has its own level.
- On the Claude plan, new monsters start in Automatic.

## 0.1.0-alpha.11 · 17 October 2026

### What you’ll see
- **Telegram bots dedicated to a monster.** In Settings → Connections → Telegram you can give a monster a bot of its
  own, to put in a group: whoever is in the group talks to that monster. The main bot stays yours and your squad
  lead’s.
- **On Linux the app installed from the .deb package updates itself** from the menu, asking for the computer’s
  password.

### More reliable
- A monster no longer answers just “OK” at the end of a job: the reply is always the real one.

## 0.1.0-alpha.10 · 17 October 2026

### What you’ll see
- **Projects.** A project is a squad of its own: a project lead, up to four monsters, its own notes, its own folder,
  its own connections and a spending cap. In the sidebar every project has its own squad; the project page has tabs.
- **Your squad lead proposes, you decide.** Your squad lead can propose a whole project or an automation: the proposal
  arrives in “To review” (and on Telegram) and becomes real only with your confirmation.
- **Automations.** Jobs that repeat (every Monday, every evening…) have a menu of their own, with proposals and
  drafts.
- **The top bar** shows the colors of all the monsters at work.
