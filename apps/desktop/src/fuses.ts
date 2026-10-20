import { FuseV1Options, FuseVersion, type FuseConfig } from '@electron/fuses';

/*
 * Electron fuses of the packaged app (D-045), flipped on the binary after packing
 * (scripts/after-pack.ts, wired into electron-builder in M3.4). Not used at run time.
 *
 * RunAsNode is OFF (S-M8 of the review of 18/10, D-045): with it on, anything that runs as
 * the user could start the signed binary as a plain Node, with the app's identity (on macOS
 * the keychain's "Consenti sempre" on the secrets' key, the TCC grants) and, on Ubuntu, with
 * the AppArmor profile that lets it create user namespaces. Nothing of the app needs it: the
 * core runs in a utility process, the keychain calls in utility processes the app starts
 * (main/keychain-host.ts), and the other JavaScript children of the core (Playwright MCP, the
 * gallery's MCP servers, Codex, npm) with the `node` on the PATH (`nodeRuntime()` in
 * @monsters/shared/node), the one whose npm installed them.
 */
export const FUSES: FuseConfig = {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  // Cookies (the session) encrypted at rest with the OS keychain key.
  [FuseV1Options.EnableCookieEncryption]: true,
  // No NODE_OPTIONS / --inspect into the app; the children run as Node ignore them too, and
  // the core relies on neither. (Playwright's `_electron` needs --inspect: e2e tests run the
  // unpacked app, M3.5 tests the package by other means.)
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // The app code only from a signed, integrity-checked app.asar (macOS and Windows).
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  // The window never loads file:// pages.
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.WasmTrapHandlers]: true,
};
