# Package signing and updates

How the desktop app's packages are built, signed and updated (M3.4, D-040, D-046). The build commands are in
`AGENTS.md`. This document is for whoever maintains a fork or wants to publish their own packages: the identities,
certificates and keys are always yours, there are none here.

## macOS: signing and notarization

You need an Apple Developer account, a **Developer ID Application** certificate (sub-CA G2) and an App Store Connect
API key with **Developer** access (the minimum `notarytool` accepts). The identity is passed through the environment,
for example `MONSTERS_MAC_SIGN_IDENTITY="Developer ID Application: Jane Doe (ABCDE12345)"` and
`MONSTERS_MAC_NOTARY_KEY_ID=<the API key's Key ID>` for the signing user's setup script; the build uses
`MONSTERS_MAC_IDENTITY` (or `CSC_NAME`) and the notarization profile.

`pnpm desktop:dist:mac` builds signed and notarized dmg and zip (arm64 and x64) on a Mac reachable over SSH (the same
one as the CI, `docs/ci.md`) and brings them back to `apps/desktop/release/mac/`. Check on the Mac:
`codesign --verify --deep --strict -vv Monsters.app`, `spctl -a -vv Monsters.app` ("Notarized Developer ID"),
`xcrun stapler validate Monsters-….dmg`.

Without the signing script installed the build is signed **ad-hoc** (file name with `-adhoc`; with the script but
without its `signing.env` the build stops): it only starts on the Mac where it was made or after
`xattr -dr com.apple.quarantine Monsters.app`, and it doesn't update itself. The CI (`pnpm ci:mac`, including its
`package` step) is always ad-hoc.

**Changing identity or account.** The signature can be changed in any version. But Squirrel.Mac only accepts an
update if it satisfies the installed app's designated requirement, which contains the Team ID: with a new Team ID the
automatic update fails once and whoever has the app reinstalls it from the dmg; from there it updates again. The
keychain access prompt (the `safeStorage` entries are tied to the signature) and the Privacy permissions (TCC) may
also reappear. It is avoided by converting the account (for example from individual to organization) instead of
creating a new one: the Team ID stays the same. The same goes for changing the Windows publisher.

**Redoing the certificate.** An RSA 2048 private key generated with `openssl` on the Mac, in the signing user; a
request (`.certSigningRequest`) uploaded to developer.apple.com (only the Account Holder can create the
certificate); the `.cer` downloaded and converted to PEM; a `.p12` with key, certificate and the G2 intermediate
(LibreSSL, 3DES encryption, which `security import` reads); a test in a throwaway keychain (`security find-identity
-v -p codesigning`, `codesign -o runtime --timestamp` on any binary) and `xcrun notarytool history` with the API key.
The plaintext copies are deleted.

### Mac: the signing user

**Where the secrets are.** Never in the CI user. In the design, the user `monsters-ci` runs `pnpm install` with the
dependencies' scripts, the build and the tests of any commit: whatever it can read, the commit's code can read too.
For this reason the signed build is made by a second user, `monsters-sign`, which `monsters-ci` can't read and which
never runs the CI's `node_modules`:

- `pnpm desktop:dist:mac` (`ci-mac.sh --package`) signs in as `monsters-ci`, puts the commit in a git bundle at
  `/Users/Shared/monsters-sign/inbox/<run>.bundle` and runs
  `sudo -n -u monsters-sign -H /usr/local/libexec/monsters/sign-build.sh <sha> <run> [--version <v>] [--feed <feed>]`.
  sudoers lets `monsters-ci` run only that script, as `monsters-sign`; the script checks the arguments before anything
  else (a 40-digit sha, a run of that commit, only `--version` and the official feed) and sudo clears the environment.
- The script is **fixed**: whoever administers the Mac installs, as root, a read copy of it
  (`scripts/mac-sign/sign-build.sh`) in `/usr/local/libexec/monsters/` (root, 755). It doesn't come from the commit,
  and `monsters-ci` can't modify it. Every change in the repo is reinstalled the same way, after reading it: the Mac
  never picks it up by itself.
- As `monsters-sign`, in its home (700): its own Node (official tarball with a pinned sha256), its own repo where it
  fetches the commit from the bundle and checks that it is exactly that sha, a clean checkout, `pnpm install
  --frozen-lockfile --ignore-scripts` with its own store, `package.ts --mac --build-only` with the keychain locked,
  then it unlocks the signing keychain, `package.ts --mac --no-build` with the identity and the notarization profile
  (never the keychain password in the environment), and locks the keychain again even if something fails.
- The packages go to `/Users/Shared/monsters-sign/outbox/<run>/` (readable by `monsters-ci`, which brings them back);
  `~monsters-sign/signed.log` keeps the date, sha, commit subject and sha256 of the dmg and zip of every signed build.
- If `monsters-ci` still has a `secrets/` folder, every run writes it (`WARNING`) and doesn't read it. It is checked by
  `scripts/ci-mac.test.ts`.

**Setup.** `sudo bash scripts/mac-sign/setup-monsters-sign.sh` (with `sign-build.sh` next to it) creates the user (not
an administrator, no SSH access, home 700, root-owned `Library/LaunchAgents` so that no login agents are left), the
shared folders `inbox` (owned by `monsters-ci`) and `outbox` (owned by `monsters-sign`), installs the fixed script and
the sudoers rule (`monsters-ci ALL=(monsters-sign) NOPASSWD: /usr/local/libexec/monsters/sign-build.sh`, 440,
`visudo -c`). It reads the identity from `MONSTERS_MAC_SIGN_IDENTITY` and the API key's id from
`MONSTERS_MAC_NOTARY_KEY_ID`. Then, as `monsters-sign`:

1. a dedicated keychain (`security create-keychain -P …/monsters-signing.keychain-db`, random password, automatic
   lock after 15 minutes with `set-keychain-settings -lut 900`);
2. import the `.p12` with `-x -T /usr/bin/codesign`: the private key **can't be exported**; then
   `set-key-partition-list -S apple-tool:,apple:` and import the G2 intermediate;
3. the notarization profile: `xcrun notarytool store-credentials monsters-notary --key AuthKey_<id>.p8 --key-id <id>
   --issuer <Issuer ID> --keychain …/monsters-signing.keychain-db`;
4. `~/secrets/signing.env` (600, `KEY=value` lines, the script reads it without executing it) with `CSC_NAME`,
   `CSC_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE=monsters-notary` and `MONSTERS_SIGNING_KEYCHAIN_PASSWORD`;
5. tests: `security find-identity -v -p codesigning` shows the identity; `security export -t identities -f pkcs12`
   **fails**; then the imported files are deleted (`rm -P`) and an encrypted copy of the `.p12`, password and `.p8` is
   kept in your password manager, never in plaintext on the Mac;
6. the App Store Connect key has **Developer** access and no other active key has higher roles;
7. clean up `monsters-ci`, right after importing the secrets: `secrets/` deleted, no signing keychain or intermediate
   in its search list. Check: `sudo -u monsters-ci ls /Users/monsters-sign` gives "Permission denied" and the next
   `pnpm ci:mac` no longer writes `WARNING … secrets`.

An interrupted `ci-mac.sh --package` (Ctrl-C) stops `monsters-ci`'s part; `monsters-sign`'s build finishes by itself,
locks the keychain again and releases its lock.

**The risk that remains.** The signed packaging still runs **the commit's code** (`package.ts`, `build-core`,
electron-builder, `after-pack.ts`, the dependencies) as `monsters-sign`, and the `--no-build` step runs it with the
keychain open. The Developer ID key can't be exported and only codesign uses it, but a malicious commit can make
codesign sign something else while the keychain is open, or read the keychain password from `monsters-sign`'s file.
So only already reviewed commits (better a tag) go through `desktop:dist:mac`, and `signed.log` says what was signed.
What the separation removes is the rest: install with scripts, build and tests of any commit run as `monsters-ci`,
which sees none of the secrets.

### The install test on macOS (`ci:mac`, `package` step)
The CI user signs in over SSH and usually has no graphical session. In that situation macOS **doesn't finish starting
an app with an interface**: Electron never reaches `ready` and the app doesn't start the core. `install-test.ts`
notices within 30 s (no "Monsters desktop … (Electron …)" line in `desktop.log`), writes it down, closes the app and
tries what can be tried of the installed package: the core in `Contents/Resources/core` started with the CI's Node
(Node 24: the same N-API as the package's native modules), version, first start and registration through the API. The
step stays green, but the note says "app and window NOT verified". If instead the user has a graphical session and the
app doesn't reach `ready`, the step fails right away. Before starting anything the step rereads the installed
binary's fuses (`RunAsNode` off).

### `RunAsNode` fuse off and the keychain (S-M8)
The app's signed binary never starts as Node (`ELECTRON_RUN_AS_NODE` does nothing): no program of the user can use it
to inherit the keychain's "Always allow" or the app's TCC permissions. `after-pack.ts` rereads the fuses after writing
them and stops the build if they aren't those of `src/fuses.ts`. The core's keychain calls run in an utility process
of the app (`Monsters Helper.app`, `dist/keychain-helper.cjs` inside the signed `app.asar`); the core's other
JavaScript children (Playwright MCP, the gallery's MCP servers, Codex, npm) use the `node` from the PATH. After an
update the first read of the secrets key may ask for permission again, because the identity that reads the entry is
the helper and not `Contents/MacOS/Monsters`.

## Windows

- **Unsigned (default, D-040).** `MONSTERS_WIN_SIGN=off`. File `Monsters-Setup-<v>-x64-unsigned.exe`; Windows shows
  "Windows protected your PC" → *More info* → *Run anyway*.
- **Testing the signing chain.** `bash apps/desktop/scripts/setup-signing.sh --test-cert` (jsign and Java in
  `~/.local/opt/monsters-signing`, pinned checksums; test CA and certificate in `apps/desktop/.signing/`, ignored by
  git), then `MONSTERS_WIN_SIGN=test pnpm desktop:dist --win`. `signtool verify /pa` and Windows don't trust it: for
  `Get-AuthenticodeSignature` the status is `UnknownError` (untrusted chain). A present and intact signature is
  verified with `osslsigncode verify -CAfile apps/desktop/.signing/test-ca.crt` ("Succeeded") or in the CI VM, where
  `test-windows.sh` adds the test CA to the roots: the status becomes `Valid`.
- **Real certificate.** `MONSTERS_WIN_SIGN=jsign` with any keystore jsign supports (PKCS#12 file, token or cloud
  service through PKCS#11):
  - `MONSTERS_JSIGN_STORETYPE` (for example `PKCS12`, `PKCS11`);
  - `MONSTERS_JSIGN_KEYSTORE` (file or PKCS#11 configuration);
  - `MONSTERS_JSIGN_STOREPASS` (password or PIN, passed to jsign as a variable, never on the command line);
  - `MONSTERS_JSIGN_ALIAS` and `MONSTERS_JSIGN_CERTFILE` (optional);
  - `MONSTERS_JSIGN_TSAURL` (timestamp server; it has a default you can change);
  - `MONSTERS_WIN_PUBLISHER_NAME` (the certificate's CN, used by the update to recognize the publisher).

  Tools: `MONSTERS_JSIGN_JAR` and `MONSTERS_JAVA`, by default the ones installed by `setup-signing.sh`.

## Linux

No package signing: AppImage and deb have no mechanism the user can really check. Updates, instead, are signed by us
(below, "Update signing"). The deb installs the AppArmor profile that keeps Chromium's sandbox on in Ubuntu 24.04+;
the AppImage can't have it and says so at startup.

## Updates: what is verified

The app downloads from a generic feed (`--feed <url>` at build time, `alpha` channel, `alpha*.yml` files). On every
system the downloaded file must have the **sha512** written in the `.yml`, and the `.yml` must have a valid
**Ed25519 signature** (`alpha*.yml.sig`), verified with the public keys inside the app before downloading anything.
In addition:

| System | Signature checked by the update | With unsigned or test packages |
|---|---|---|
| All | the `.yml`'s signature (S-A4) before the download, the package's sha512 after | a test key, for running the e2e only |
| Linux (AppImage) | nothing else (signed sha512) | same |
| Linux (deb) | the `.yml`'s signature rechecked as root with the keys in `/opt/Monsters/resources/update-keys`, the sha512 of root's copy in the signed `.yml`, a `monsters` package of a higher version (`dpkg-deb -f`); asks for the computer's password (D-105) | same |
| Windows | Authenticode and the publisher's name (`publisherName`) | unsigned: only the signed sha512; test signature: passes only where the test CA is trusted |
| macOS | Squirrel.Mac: the new app must have the same signature (designated requirement) | ad-hoc: **doesn't update** (the requirement is the binary's hash) |

**The deb (D-105).** The app installed from the `.deb` updates itself:
- electron-updater (DebUpdater) downloads the `.deb` listed in `alpha-linux.yml` from the feed written into the build
  (or from `MONSTERS_UPDATE_URL`, with the same https rule) and checks its sha512. The download is always complete.
- "Restart to update" first opens a dialog saying that the computer's password will be asked. Then a single
  `pkexec --disable-internal-agent /bin/sh -c <script>`: the desktop's polkit agent asks for the password. The script,
  as root, copies the package, the `.yml` verified by the app and its signature into a folder of its own
  (`/var/tmp/monsters-update.*`, 0700), rechecks on the copy the sha512, the signature (openssl, root's keys in
  `/opt/Monsters/resources/update-keys`), that the sha512 is in the signed `.yml`, that the package is `monsters` and
  that the version is higher than the installed one (`dpkg --compare-versions`); then it says "ready" and waits.
  Wrong signature or package: no "ready", and the dialog says it may be a tampered package.
- Only then does the app stop its core and give the go-ahead: `dpkg -i` of the copy, then the app restarts into the
  new version.
- Never `apt` or `apt-get install -f` as root, never `--allow-unauthenticated`: the installation doesn't go through
  electron-updater's `doInstall` (which falls back to apt), which doesn't even install on quit
  (`autoInstallOnAppQuit` off).
- Password cancelled or refused, no polkit agent (SSH or remote session), pkexec missing, a package that doesn't
  match: the core doesn't stop, the app stays as it is and a dialog says what happened with the command to copy
  (`sudo apt install <downloaded package>`). Everything is also in `desktop.log` (`updates: …`).
- Test: `pnpm desktop:update-e2e --deb` (clean Ubuntu 24.04 chroot, `apps/desktop/scripts/test-deb-update.sh`).

## Update signing

**Why.** The sha512 is in the `alpha*.yml` of the same bucket as the packages: whoever can write to the bucket would
publish a package that every app installs (and the deb installs it as root). That is why a private signing key is
also needed, which isn't on the service that hosts the feed.

**What is signed.** Every channel file (`alpha-linux.yml`, `alpha-linux-arm64.yml`, `alpha-mac.yml`, `alpha.yml`): it
lists every package with its sha512, so the signature covers the packages too. The signature is `<file>.sig` next to
the file, published with it:

```
monsters-update-signature-v1
key <key id> <Ed25519 signature in base64>
```

The signed message is `monsters-update-signature-v1\n<file name>\n<file bytes>`: the real signature of
`beta-linux.yml` or `alpha-mac.yml` is not valid as the signature of `alpha-linux.yml`. Several `key` lines are
allowed (key change). Code in `apps/desktop/src/main/update-signature.ts`.

**What the app does (a single read).** electron-updater reads the feed only through the provider
`src/main/signed-provider.ts` (provider `custom`): it downloads `<channel>.yml` and `.sig` **once**, verifies the
signature with the keys in `resources/update-keys/` and hands electron-updater the very signed object, already
parsed. The parse is strict: it refuses a `.yml` without `files` or with empty `files`, an entry without a sha512,
`sha2` anywhere, `packages`, a top-level `path`/`sha512` that isn't an entry of `files`. electron-updater doesn't
download by itself (`autoDownload` off): the app accepts the `update-available` info only if it is that same object,
then downloads. When the download is done it computes the downloaded file's sha512 and looks it up in the signed
`.yml`: if it isn't there it doesn't offer it. Signature missing, wrong, from another key or for another file: no
download, the menu says "Update failed: try again" and `desktop.log` has `updates: version … refused: <reason>`; an
`invalid` or `mismatch` is retried once after a minute. A broken `.pem` in `resources/update-keys` is skipped (and
written to the log): the other keys are still valid.

**The keys.** The public ones the builds trust are in `apps/desktop/build-resources/update-keys/*.pem` (in the repo,
public only: a test checks that no private one is there). `package.ts` puts them in `resources/update-keys/` and
writes their ids in `build-info.json`; **a build with the feed and no key refuses to build**, because it could never
accept an update. The e2e builds (`--test-build`) additionally trust `--update-test-key <pem>`: the e2e generates a
new pair at every run and signs with it. A published build can't trust a test key (`--update-test-key` without
`--test-build` is refused). In a fork the folder starts from the project's keys: replace them with your own before
publishing.

**Generating the key.**
1. Choose where the private key lives: never in plaintext in the user that runs core and agents, nor in the repo. The
   simple way is a file encrypted with a passphrase only you know (in your password manager, at least 12 characters,
   better 4-5 words), which you type at every publication:
   `pnpm desktop:update-key generate --out <path>/monsters-update.key --install`. The passphrase is asked twice on the
   terminal (`/dev/tty`, no echo; never from an environment variable or stdin) and the encryption is done by
   `node:crypto`: no other program sees the key. Even better outside the development machine (another user, another
   computer): run the script there and copy only the `.pub` here.

   The file's format (`scripts/signing-key-file.ts`) is JSON: `format: monsters-update-key-v1`, `kdf: scrypt` with
   `N` = 2^20, `r` = 8, `p` = 1 (1 GiB of memory and a few seconds per attempt), `salt` (16 bytes), `cipher:
   aes-256-gcm`, `iv` (12 bytes), `ciphertext` (the PKCS#8 DER private key) and `tag`. Key = scrypt(NFC passphrase,
   salt); GCM's AAD is the JSON of the fields before `ciphertext`, so no parameter can be changed without the tag
   failing. A file with a cost lower than that of a new file doesn't open. An existing plaintext key is encrypted with
   `pnpm desktop:update-key encrypt --in <private.pem> --out <file>` (then the plaintext file is destroyed).
2. A second **backup** pair, generated the same way and kept offline: its public key goes into
   `build-resources/update-keys/` too. If the first one is lost or compromised, you sign with the backup and the apps
   already installed accept it.
3. `--install` copies the public key to `apps/desktop/build-resources/update-keys/<id>.pem`: commit it.
4. Check: `MONSTERS_UPDATE_SIGNING_KEY_FILE=<file> pnpm desktop:update-key public` asks for the passphrase and tells
   you the id and whether it is among the repo's keys.

**Publishing signed.** `publish-update.ts` (`pnpm desktop:publish`) reads the private key from
`MONSTERS_UPDATE_SIGNING_KEY_FILE` (the encrypted file above, readable only by the owner: it asks for the passphrase
on the terminal; a plaintext file is refused) or from `MONSTERS_UPDATE_SIGNING_KEY_CMD`, a command that prints the
key, as PEM or as an encrypted file (then it asks for the passphrase itself): for example `/usr/bin/ssh
signer@other-pc cat …` or `/usr/bin/security find-generic-password -w …`. The command runs with `/bin/sh` and a fixed
PATH of system folders (`/usr/bin:/bin:/usr/sbin:/sbin`): an `ssh` or an `openssl` placed in `~/.local/bin` aren't the
ones that run. The key isn't written anywhere. The script stops if it's missing, if it isn't Ed25519, if the build
doesn't trust that key (id in `build-info.json`), if it's a test build (`testBuild` or a `test-` key) or if the app
would refuse the `.yml` (the same strict parse). It signs every `.yml` and verifies the signature it has just made.
Then, for each `.yml`: it uploads a "bridge" `.sig` with the signature of the `.yml` the feed has now (the `key` lines
of the current `.sig`, only if they verify it: the script never signs what it finds on the feed) plus the new one,
rereads it from the feed's server (one that doesn't serve `.sig` files stops everything here, before touching a
`.yml`), uploads the `.yml`, then the `.sig` with the new signature only. At the end it rereads files and signatures
from the server and verifies them again. During the upload the bridge `.sig` is valid for both the old and the new
`.yml`, so a check that lands there always finds a valid pair.

The passphrase can also be given with `MONSTERS_UPDATE_SIGNING_PASSPHRASE_CMD`, a command that prints it (for example
`secret-tool lookup …`): handy for publishing without someone at the terminal, but then whoever controls that user can
sign (see «Accepted risk» D-126 in `docs/security-model.md`).

**Risks that remain.**
- Whoever has the private key (or the passphrase and the file) publishes as you: keep it like the Developer ID key.
- Publishing runs the repo's code (`publish-update.ts`, `yaml`, `node_modules`) with the decrypted key in memory: a
  tampered commit or `node_modules` in the publishing user can take it away. Encryption protects the file at rest,
  not this. Publish only from a clean checkout of an already reviewed commit (`pnpm install --frozen-lockfile`); the
  real solution is a minimal signer on another user or another machine, which receives only the `alpha*.yml`, shows
  version and sha512, signs and returns the `.sig` files without running the repo's code: it doesn't exist yet.
- The passphrase is typed in a terminal of the user: whoever controls that user while you type it (a program that
  reads the graphical session's keyboard, a tampered terminal) can read it.
- A compromised feed can still withhold updates, or serve the last signed version forever (signatures don't
  expire): it can't make an older version install (electron-updater doesn't go back, the deb checks it as root) or an
  unsigned one.
- On unsigned Windows and on AppImage the update signature is the only check; with a Windows certificate Authenticode
  is added.
- The deb's root script comes from the app (which is root's in `/opt/Monsters`), the keys from
  `/opt/Monsters/resources`: whoever can already write there is already root.
- The root script verifies with `/usr/bin/openssl` (absolute path, fixed PATH), which must be 3.0 or newer: Ed25519
  with `pkeyutl -rawin` doesn't exist in 1.1.1. The deb asks for it in Depends (`openssl (>= 3.0.0)`) and the script
  checks `openssl version` before anything else: with an old version it exits with a code of its own (96) and the
  dialog says OpenSSL 3 is needed, not that the package is tampered.

**Test builds in the CI.** `pnpm ci:local` builds the `install-test` packages as test builds with the feed
(`--feed http://127.0.0.1:9/ --test-build --update-test-key <public key of a run's key>`): it checks that
`resources/update-keys` gets into the AppImage and into the deb's `/opt/Monsters`. Then the `update-e2e` step
(`pnpm desktop:update-e2e --scenario ok,badsig`, Linux only): a real 0.0.1 → 0.0.2 update from a local feed signed
with an ephemeral key, and a refusal with another key's signature. Test builds live in `.package/` and
`publish-update.ts` refuses them.

## Publishing an update (D-050)

The feed is an HTTP server that serves the release files read-only. In the reference setup (`apps/update-server`) it
is a Cloudflare Worker in front of a private R2 bucket, with the multiple ranges that differential download needs; the
bucket has no direct public access. A fork can use any static hosting that also serves the `.sig` files and range
requests, and point to it with `--feed`.

1. A new version in `apps/desktop/package.json` (always higher: `0.1.0-alpha.N`).
2. Build with the feed: `pnpm desktop:dist --linux --win --feed <feed url>/desktop/` (macOS: `pnpm
   desktop:dist:mac`, packages in `apps/desktop/release/mac`). You need at least one key in
   `apps/desktop/build-resources/update-keys/`.
3. `MONSTERS_UPDATE_SIGNING_KEY_FILE=<encrypted key>` (or `…_KEY_CMD`), then `pnpm desktop:publish --dry-run` and
   `pnpm desktop:publish` (`--dir apps/desktop/release/mac` for macOS).

`desktop:publish` stops if: a file doesn't have the size or sha512 written in the `.yml`, the build points to another
feed (or to none), the version isn't higher than the one already published (`--force` to republish the same one),
there is a build with a test or ad-hoc signature or a test build (`--test-build`, never publishable), or an
unsigned/unnotarized one without `--allow-unsigned`, the signing key is missing or the build doesn't trust it. It signs
the `.yml` files (`.sig` next to them, also with `--dry-run`), uploads packages and blockmaps first, then for each
`alpha*.yml` the bridge `.sig`, the `.yml` and the final `.sig`, and rereads everything from the server verifying the
signatures. With the reference setup it needs the Cloudflare CLI with a valid login; the Worker is republished with
`pnpm --filter @monsters/update-server deploy:worker` (`--dry-run` to try it) and **must be republished first**, before
the first signed version, so that it serves the `.sig` files.
