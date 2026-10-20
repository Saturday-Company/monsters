# Security policy

## Reporting a vulnerability

Please do **not** open a public issue, pull request or discussion for a security problem.

Use GitHub private vulnerability reporting:

1. Open the **Security** tab of the repository.
2. Click **Report a vulnerability**
   (direct link: <https://github.com/Saturday-Company/monsters/security/advisories/new>).

If you cannot use GitHub, write to **opensource@saturdaycompany.it**. Do not include secrets or exploit details you
are not comfortable sending by mail; we will move the conversation to a private channel.

Please include: the version or commit, how to reproduce the problem, and what an attacker gains.

## What to expect

- Acknowledgement within **3 working days**.
- Initial assessment (valid or not, severity, plan) within **10 working days**.
- Coordinated disclosure: we agree on a date with you, fix first, then publish an advisory.
- Credit in the advisory if you want it (tell us how you would like to be named).

## Supported versions

Monsters is a pre-1.0 alpha. Only the **latest alpha release** (and the `main` branch) receives security fixes.
Older alphas are not patched: update to the newest one.

## Scope

The threat model, what is in and out of scope, and the risks we have knowingly accepted are described in
[docs/security-model.md](docs/security-model.md) (in Italian). Please read it before reporting: for example, an agent
that has the **Terminal** permission runs commands as your system user, so what it can reach is by design the whole
account. Ways to *escape* the permissions a user granted are in scope; actions inside granted permissions are not.

Also in scope: the local core and its API (authentication, sessions, CLI token, `Host`/`Origin` checks), the kill
switch, secrets leaking into logs or into the agents' environment, the granted-folder checks of the file tools, and
the update and packaging chain.

## Update packages

Desktop updates are verified before installation: every channel file of the update feed (`alpha*.yml`, which lists the
SHA-512 of each package) carries an Ed25519 signature (`.sig`), checked by the app against the public keys shipped
inside it. Packages are additionally code-signed where the platform supports it (macOS Developer ID and notarization,
Windows Authenticode when a certificate is configured). Details: [docs/signing.md](docs/signing.md).
