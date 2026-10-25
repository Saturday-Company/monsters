# Changelog

The Italian version is in [`CHANGELOG.it.md`](CHANGELOG.it.md).

## 0.1.0-alpha.25 · 26 October 2026

### What you’ll see
- **A first start in four screens.** Account, model, your name, then the squad with one “Looks good”: no forced
  pauses. What you do, what to hand off, tone and language come later, in a “Tell me more about you” card in your
  lead’s chat that you can skip.
- **Simpler settings, nothing taken away.** With every row open the settings show less than half the controls of
  before (86 instead of 194); the rest is under “Advanced”. Models are a main model and a fallback; spending is “at
  most € X a day / € Y a month” plus a Careful / Normal / Generous safety net, all in euros; the monsters’ decisions
  are Basic or Smarter; each monster’s permissions are one level (notes, web, run commands) with “Apply to all”.
- **Apps and Telegram.** The Connections tab is now “Apps and Telegram”: your Telegram bot in three steps, group bots
  under Advanced, and a gallery with search that starts from the most common apps.
- **Lighter projects.** A project is created with just its name and has five tabs: Chat, Squad, Notes, Automations,
  Settings. A project shows which monsters can’t search the web and lets you allow them in one tap.
- **Calmer by default.** Technical details are off for everyone (turn them back on in Settings → General →
  Advanced); Usage starts with one sentence in words; notes have a single search box.
- **Nothing gets lost.** Every chat keeps its whole history after a restart, with “Earlier messages”; drafts of
  messages and notes are saved; a sentence starting with A–D no longer answers an open question by mistake; deleted
  files and discarded drafts can be undone for a few seconds.
- **No dead ends.** “To review” and “What’s new” are on every page, every failed load has “Try again”, Activity rows
  that wait for you have their button, and Escape closes one layer at a time.
- **Clearer words and English addresses.** One word per thing across the app (“Run commands”, “plan”, “All
  monsters”, “Stop”); addresses in the bar are in English, and old links still work.
- **Limits that explain themselves.** A job stopped at a limit writes its report first and says which limit and where
  to change it; plans have their own, larger limits.

### More reliable
- **A stronger brake.** The terminal of Claude Code and Monsters’ own terminal share one check against writing the
  monsters’ configuration, with fewer false refusals on everyday commands.
- **Stop leaves a clean log**: every tool call has its result before the job ends, on every system.
- **Numbers as you write them**: “1.000” and “1,000” are read in your language, and an ambiguous number is refused
  instead of guessed.
- **Faster with long sessions**: the app keeps a bounded number of events in memory and the notes graph no longer
  rebuilds on every keystroke.

## 0.1.0-alpha.24 · 24 October 2026

### What you’ll see
- **Simpler settings.** The monsters’ decisions and their scorecard sit under “Advanced”, closed by default. Apps, services,
  the browser and your own apps are one group, and free and paid web search are one. Telegram bots and notifications
  are closed rows with a summary: the Connections tab is about a third shorter.
- **Honest counters.** “Tokens in” no longer counts what is re-read from the cache as new input (it shows “+ N from
  cache” beside it), and the context of a Claude Code chat no longer counts tools that are never sent.
- **Small touches.** The NEWS label is orange only when there is something new; a deleted project offers “Back to the
  chats”.
- **Claude Code and Codex plans last longer.** Each message no longer pays again for 8–17k tokens of fixed
  instructions: the conversation now travels in the message, and the fixed part is read from the cache.
- **Monsters’ own tools are loaded at once** (notes, questions, delegation), without an extra round to find them.
- **The strongest model only when it’s needed.** A job counts as hard only when the lead is fairly sure of it, not on
  a guess.
- **Summaries without extended thinking**, and with your own API keys the prompt cache now holds from one turn to the
  next.

### More reliable
- **Fewer false refusals in the terminal.** Reading Monsters’ configuration files (`ls .claude`, `grep … CLAUDE.md`)
  is no longer blocked, and a refusal no longer marks a finished job as failed. Commands that only look like reads but
  run another program are still stopped.
- **No “write EPIPE” error** when the core’s terminal is closed.

## 0.1.0-alpha.23 · 24 October 2026

### What you’ll see
- **Connected services just work.** Once an app or service is connected (Anteiku, GitHub, Notion…), your monsters
  know every one of its tools and use the right one straight away: they no longer ask you for addresses, keys or an
  access they already have, and long lists come in a few pieces instead of dozens of reads.
- **Every service reaches every monster.** A service you connect is available to the whole squad and to every
  project, also the ones that already exist. If a project must not use one, turn it off in the project’s Connections
  tab.
- **Fewer confirmations.** Ordinary writes in your own services (creating a task, updating a client) no longer ask
  you first; deleting, sending, publishing and paying still do.
- **Access in one tap.** When a lead asks for a service for its project, your “Yes” is enough: it starts again on its
  own with the new tools, without another message from you.

### More reliable
- **A dropped connection reconnects** instead of leaving the service dead until a restart.
- **Codex monsters reach all the tools** of a connected service, not only the first 40.
- **The free models work again**: the first free model of the chain was removed by its provider and is replaced
  automatically.

## 0.1.0-alpha.22 · 23 October 2026

### What you’ll see
- **Answers you can read at a glance.** When the data reads better drawn, your monsters show it right in the chat:
  key numbers, tables, bar, line and donut charts, side-by-side comparisons with the recommended option, steps,
  checklists and dates. The text around stays as it is, and it works in light and dark mode and on the phone.
- **Suggested replies.** Under some answers you’ll find buttons with the next steps (“Look deeper into Metricool”):
  one tap sends exactly that text as your message. On Telegram they’re keys under the message.
- **Telegram and the terminal** get the same answers as text: aligned tables, values in rows, and a note that the
  chart is in the app.

## 0.1.0-alpha.21 · 23 October 2026

### What you’ll see
- **The terminal is on by default.** Monsters can run commands from the start: an agentic squad without its tools
  makes little sense. If you already use Monsters, the terminal is turned on once; you can turn it off again in
  Settings → Permissions, and that choice then stays.
- **Monsters read the sites you name.** Asked to look at a product or a site, the lead reads it on its own instead of
  asking you for a printout or a presentation. Pages built in JavaScript now give back their description too.
- **ChatGPT plan usage.** With a ChatGPT subscription, the usage of your plan shows up in Settings when OpenAI sends
  it; otherwise the panel says there’s no data instead of showing 0.

### More reliable
- **“Working” means working.** The app no longer shows monsters at work when they’re idle (scrolling up in a chat
  replayed old states).
- **No more stops halfway.** Re-reading the cached context no longer counts against a monster’s token limit, so long
  research isn’t cut short.
- **Fewer false refusals in the terminal.** Read-only commands are no longer blocked; only real writes to the
  configuration files are.
- **Codex monsters reach the network**, asking Monsters first with the same checks as Claude’s terminal, and can use
  all of Monsters’ tools.
- **“The squad’s tools didn’t answer” has a cause.** If Monsters’ tools don’t connect, the job starts again once or
  stops telling you why; a stopped delegation says who stopped it and why.

## 0.1.0-alpha.20 · 21 October 2026

### What you’ll see
- **Monsters speaks English.** The whole app is now in English, with Italian as a choice: the screens, the messages,
  Telegram, the terminal chat and the desktop app’s menus. Pick the language in Settings → General or on the first
  screen. If you already use Monsters, nothing changes: your app stays in Italian.
- **Your monsters write in your language.** When you set up a new squad, the language the monsters write in starts
  from the app’s, and you can still pick another one.
- **English notes for a new install.** A new install in English gets its notes folders in English (`Agents`,
  `Private`, `profile.md`, the `Monsters Notes` folder). Existing notes keep their names: nothing is renamed.
- **Telegram commands in English** (`/stop`, `/resume`, `/new`, `/status`, `/help`); the Italian ones keep working.
- **The Windows installer** speaks English and Italian.

### More reliable
- **Safer notes.** A monster’s memory and the private folder are protected the same way whatever language your notes
  folder is in, and the hidden settings of the notes folder can no longer be changed by the notes tools.

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
