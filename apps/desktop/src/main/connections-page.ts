import { createHash } from 'node:crypto';
import { appLang } from '@monsters/shared';
import { connectionsStrings } from './connections-page.strings.ts';
import { profileStrings } from './profiles.strings.ts';
import { INSTRUMENT_CSS, pageThemeCss, WORDMARK } from './page-theme.ts';
import { TITLE_BAR_HEIGHT, type WindowChrome } from './title-bar.ts';

/*
 * The "Connections" page (M3.3, D-047): choose between "This computer" and the other
 * computers, add, edit, try and remove connection profiles. A self-contained page like the
 * status page (data: URL, strict CSP, script allowed only by hash), shown in its own small
 * window with the preload's `monstersConnections` API and nothing else. The parts of the
 * instrument (page-theme.ts, D-062, D-089) and the same integrated title bar as the main
 * window: the 52 px top rail (wordmark, a seam, the title) is the drag area, with room for the
 * traffic lights (macOS) or the system buttons (Windows, Linux). The computers are a module
 * with a label; the state of the one in use is on a small screen; the form is a module too,
 * with sunk fields, a switch for "Sign in without a password" and the advanced options in a darker
 * drawer. The script builds the DOM with textContent only: names typed by the user never
 * become markup.
 *
 * The form (audit UX 1.4, 1.6, 1.12): "Computer" first, "Name" optional, everything else
 * under "Advanced options" with the values ssh would use as placeholders; a warning when the
 * address looks like a name; "Try" opens and closes a tunnel without changing computer;
 * Enter is "Save and connect"; Esc with unsaved changes asks for a second Esc; the list keeps
 * the focus when it is rebuilt. The words are in the app's language (D-153): the HTML is built
 * with it and the script gets its few texts as JSON, so the page is rebuilt on a change.
 */

/** One row of the list, as the page receives it from the main process. */
export interface ConnectionRow {
  /** `local` or the profile id. */
  choice: string;
  name: string;
  /** `user@computer:port`, or a description for "This computer". */
  address: string;
  /** The form values of a profile (strings), for "Edit". Absent for "This computer". */
  form?: Record<string, string | boolean>;
}

/** The form the page should open now ("Add a computer", "Fix the connection"). */
export interface FormRequest {
  /** A profile id, or null for a new computer. */
  choice: string | null;
  /** Field to focus and highlight. */
  field?: string;
}

export interface ConnectionsView {
  /** `local`, a profile id, or null while nothing is chosen yet (first start). */
  current: string | null;
  /** What the current connection is doing, in the app's language ("Connected", "Reconnecting…"). */
  status: string;
  rows: ConnectionRow[];
  /** Consumed once by the page. */
  form?: FormRequest;
}

const SCRIPT_BODY = String.raw`
const api = window.monstersConnections;
const $ = (id) => document.getElementById(id);
const fmt = (s, name) => s.replace('{name}', () => name);
const FIELDS = ['host','name','user','sshPort','identityFile','remotePort','remoteHome'];
const ADVANCED = ['user','sshPort','identityFile','remotePort','remoteHome'];
let view = { current: null, status: '', rows: [] };
let editing = null;
let confirmRemove = null;
let initial = '';
let escArmed = false;
let forceHost = null;
let defaultsTimer = null;

function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'onclick') n.addEventListener('click', v);
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c) n.append(c);
  return n;
}

function render() {
  const list = $('list');
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
  list.replaceChildren();
  for (const row of view.rows) {
    const current = row.choice === view.current;
    const actions = el('div', { class: 'row-actions' });
    if (!current) {
      actions.append(el('button', { type: 'button', class: 'primary', 'data-use': row.choice,
        'data-key': 'use:' + row.choice, 'aria-label': fmt(T.useAria, row.name), text: T.use,
        onclick: () => use(row.choice) }));
    }
    if (row.form) {
      actions.append(el('button', { type: 'button', 'data-key': 'edit:' + row.choice,
        'aria-label': fmt(T.editAria, row.name), text: T.edit, onclick: () => openForm(row) }));
      const confirming = confirmRemove === row.choice;
      actions.append(el('button', { type: 'button', class: confirming ? 'danger' : '',
        'data-key': 'remove:' + row.choice,
        'aria-label': fmt(confirming ? T.confirmAria : T.removeAria, row.name),
        text: confirming ? T.confirm : T.remove, onclick: () => remove(row.choice) }));
    }
    list.append(el('article', { class: 'row' + (current ? ' current' : ''), 'data-choice': row.choice },
      el('div', { class: 'row-text' },
        el('h2', { text: row.name }),
        el('p', { text: row.address }),
        current ? el('p', { class: 'badge', 'data-testid': 'current-status', text: view.status }) : null),
      actions));
  }
  if (focused) {
    const again = list.querySelector('[data-key="' + CSS.escape(focused) + '"]');
    if (again) again.focus();
  }
}

function formValues() {
  const form = { autoLogin: $('autoLogin').checked };
  for (const f of FIELDS) form[f] = $(f).value;
  return form;
}

function openForm(row, field) {
  editing = row ? row.choice : null;
  confirmRemove = null;
  escArmed = false;
  forceHost = null;
  $('form-title').textContent = row ? fmt(T.editTitle, row.name) : T.addTitle;
  for (const f of FIELDS) {
    $(f).value = (row && row.form && row.form[f]) || '';
    $(f).classList.remove('highlight');
  }
  // Automatic login: on for a new computer, as saved for an existing one.
  $('autoLogin').checked = row && row.form ? !!row.form.autoLogin : true;
  clearErrors();
  $('test-result').textContent = '';
  $('test-result').className = 'test-result';
  const advancedSet = ADVANCED.some((f) => $(f).value !== '');
  $('advanced').open = advancedSet || (!!field && ADVANCED.includes(field));
  $('form').hidden = false;
  $('add').hidden = true;
  initial = JSON.stringify(formValues());
  warnHost();
  loadDefaults();
  const target = field && $(field) ? field : 'host';
  if (field) $(target).classList.add('highlight');
  $(target).focus();
}

function closeForm() {
  const wasEditing = editing;
  $('form').hidden = true;
  $('add').hidden = false;
  editing = null;
  escArmed = false;
  const back = wasEditing ? document.querySelector('[data-key="edit:' + CSS.escape(wasEditing) + '"]') : null;
  (back || $('add')).focus();
}

function clearErrors() {
  for (const f of FIELDS) {
    $('err-' + f).textContent = '';
    $(f).removeAttribute('aria-invalid');
  }
  $('form-error').textContent = '';
}

function warnHost() {
  const host = $('host').value.trim();
  const name = $('name').value.trim();
  let text = '';
  if (host && (/\s/.test(host) || (name && host.toLowerCase() === name.toLowerCase()
      && !/[.:]/.test(host) && host.toLowerCase() !== 'localhost'))) {
    text = T.looksLikeName;
  }
  if (forceHost !== null && forceHost !== host) forceHost = null;
  if (!text && forceHost === null) $('warn-host').textContent = '';
  if (text) $('warn-host').textContent = text;
}

function loadDefaults() {
  clearTimeout(defaultsTimer);
  defaultsTimer = setTimeout(async () => {
    const host = $('host').value.trim();
    const d = host ? await api.defaults({ host: host, user: $('user').value, sshPort: $('sshPort').value }) : null;
    $('user').placeholder = d && d.user ? d.user : '';
    $('sshPort').placeholder = d ? String(d.port) : '22';
  }, 350);
}

function showErrors(res) {
  const errors = (res && res.errors) || {};
  let first = null;
  for (const [f, msg] of Object.entries(errors)) {
    if (!$('err-' + f)) continue;
    $('err-' + f).textContent = msg;
    $(f).setAttribute('aria-invalid', 'true');
    if (ADVANCED.includes(f)) $('advanced').open = true;
    first = first || f;
  }
  if (res && res.warnings && res.warnings.host) {
    $('warn-host').textContent = res.warnings.host;
    forceHost = $('host').value.trim();
    first = first || 'host';
  }
  if (first) $(first).focus();
  return first !== null;
}

async function save(connect) {
  clearErrors();
  const form = formValues();
  if (editing) form.id = editing;
  if (forceHost !== null && forceHost === form.host.trim()) form.force = true;
  const res = await api.save(form);
  if (!res || !res.ok) {
    if (!showErrors(res)) $('form-error').textContent = T.saveFailed;
    return;
  }
  closeForm();
  await refresh();
  if (connect) await use(res.id);
}

async function tryIt() {
  clearErrors();
  const out = $('test-result');
  const button = $('test');
  out.className = 'test-result';
  out.textContent = T.trying;
  button.disabled = true;
  try {
    const res = await api.test(formValues());
    if (res && res.errors) {
      out.textContent = '';
      showErrors(res);
      return;
    }
    out.className = 'test-result ' + (res && res.ok ? 'ok' : 'ko');
    out.textContent = (res && res.message) || T.tryFailed;
    if (res && !res.ok && res.field && $(res.field)) {
      if (ADVANCED.includes(res.field)) $('advanced').open = true;
      $(res.field).classList.add('highlight');
    }
  } finally {
    button.disabled = false;
  }
}

async function remove(choice) {
  if (confirmRemove !== choice) {
    confirmRemove = choice;
    render();
    return;
  }
  confirmRemove = null;
  await api.remove(choice);
  await refresh();
  $('add').focus();
}

async function use(choice) {
  await api.use(choice);
  await refresh();
}

async function refresh() {
  view = await api.list();
  render();
  if (view && view.form) {
    const row = view.form.choice ? view.rows.find((r) => r.choice === view.form.choice) : null;
    openForm(row || null, view.form.field);
  }
}

$('add').addEventListener('click', () => openForm(null));
for (const f of FIELDS) {
  $(f).addEventListener('input', () => {
    $('err-' + f).textContent = '';
    $(f).removeAttribute('aria-invalid');
    $(f).classList.remove('highlight');
    escArmed = false;
    if (f === 'host' || f === 'name') warnHost();
    if (f === 'host' || f === 'user' || f === 'sshPort') loadDefaults();
  });
}
$('cancel').addEventListener('click', closeForm);
$('save').addEventListener('click', () => save(false));
$('test').addEventListener('click', tryIt);
$('form').addEventListener('submit', (e) => { e.preventDefault(); save(true); });
$('pick').addEventListener('click', async () => {
  const path = await api.pickKey();
  if (path) $('identityFile').value = path;
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('form').hidden) return;
  e.preventDefault();
  const dirty = JSON.stringify(formValues()) !== initial;
  if (dirty && !escArmed) {
    escArmed = true;
    $('form-error').textContent = T.unsaved;
    return;
  }
  closeForm();
});
api.onChange(refresh);
refresh();
`;

/** The page's script with its texts (JSON, `<` escaped: it sits inside a <script>). */
function connectionsScript(): string {
  const texts = JSON.stringify({
    ...connectionsStrings().script,
    looksLikeName: profileStrings().hostLooksLikeName,
  }).replace(/</g, '\\u003c');
  return `const T = ${texts};\n${SCRIPT_BODY}`;
}

interface Field {
  id: string;
  label: string;
  hint?: string;
  placeholder?: string;
  inputmode?: string;
  extra?: string;
  /** A warning line under the field (not an error). */
  warn?: boolean;
}

function mainFields(): Field[] {
  const f = connectionsStrings().fields;
  return [
    { id: 'host', ...f.host, warn: true },
    { id: 'name', ...f.name },
  ];
}

function advancedFields(): Field[] {
  const f = connectionsStrings().fields;
  return [
    { id: 'user', ...f.user },
    { id: 'sshPort', ...f.sshPort, inputmode: 'numeric' },
    {
      id: 'identityFile',
      label: f.identityFile.label,
      hint: f.identityFile.hint,
      placeholder: f.identityFile.placeholder,
      extra: `<button type="button" id="pick">${escape(f.identityFile.pick)}</button>`,
    },
    { id: 'remotePort', ...f.remotePort, inputmode: 'numeric' },
    { id: 'remoteHome', ...f.remoteHome },
  ];
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function fieldHtml(f: Field): string {
  const describedBy = [f.hint ? `hint-${f.id}` : '', f.warn ? `warn-${f.id}` : '', `err-${f.id}`]
    .filter(Boolean)
    .join(' ');
  return `<div class="field">
<label for="${f.id}">${escape(f.label)}</label>
<div class="input-row"><input id="${f.id}" name="${f.id}" autocomplete="off" spellcheck="false" aria-describedby="${describedBy}"${f.placeholder ? ` placeholder="${escape(f.placeholder)}"` : ''}${f.inputmode ? ` inputmode="${f.inputmode}"` : ''}>${f.extra ?? ''}</div>
${f.hint ? `<p class="hint" id="hint-${f.id}">${escape(f.hint)}</p>` : ''}
${f.warn ? `<p class="warn" id="warn-${f.id}" aria-live="polite"></p>` : ''}
<p class="error" id="err-${f.id}" aria-live="polite"></p>
</div>`;
}

const LIGHT =
  "content:'';flex:none;width:8px;height:8px;border-radius:50%;transform:translateY(-1px);background:var(--led);box-shadow:inset 0 -1px 1px rgba(0,0,0,.25),inset 0 1px 1px rgba(255,255,255,.5),0 0 7px 1px color-mix(in oklab,var(--led),transparent 45%)";

/*
 * The parts come from INSTRUMENT_CSS; here the layout. The rail stays on top while the page
 * scrolls. "Use" is a plain key: the one orange key is "Save and connect". The state of the
 * computer in use is a small screen, like the display of the main window; a test, a warning,
 * an error each have their light.
 */
const STYLE = `
.titlebar{position:sticky;top:0;z-index:2;height:${TITLE_BAR_HEIGHT}px;-webkit-app-region:drag}
.titlebar h1{min-width:0;margin:0;font-size:17px;line-height:22px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
main{max-width:560px;margin:0 auto;padding:22px 20px 32px;display:flex;flex-direction:column;gap:18px}
.intro{margin:0;color:var(--ink-muted)}
.group{display:flex;flex-direction:column;gap:8px}
.group-label{margin:0 4px;color:var(--ink-muted)}
#list{display:flex;flex-direction:column}
.row{display:flex;align-items:center;gap:14px;min-height:68px;padding:12px 14px 12px 18px}
.row+.row{box-shadow:inset 0 1px 0 var(--seam),inset 0 2px 0 var(--seam-light)}
.row-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.row h2{margin:0;font-size:16px;line-height:22px;font-weight:600;overflow-wrap:anywhere}
.row p{margin:0;font-size:14px;line-height:20px;color:var(--ink-muted);overflow-wrap:anywhere}
.row:not([data-choice=local]) .row-text>p:not(.badge){font-family:var(--font-mono);font-size:12px;letter-spacing:.01em}
.row .badge{align-self:flex-start;margin-top:6px;padding:3px 9px;border-radius:7px;background:var(--screen);color:var(--screen-ink);font-family:var(--font-mono);font-size:11px;line-height:16px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 0 0 1px var(--seam),0 1px 0 1px var(--seam-light)}
.row-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.row-actions button{min-height:36px;padding:0 14px;font-size:14px}
.row-actions button.primary{--cap:var(--raised);--cap-hover:color-mix(in oklab,var(--raised),var(--ink) 4%);--edge:var(--key-edge);--hi-cap:var(--hi);color:var(--ink)}
#add{align-self:flex-start}
form{display:flex;flex-direction:column;gap:16px;padding:20px 20px 22px}
form h2{margin:0;font-size:18px;line-height:24px;font-weight:600}
.field{display:flex;flex-direction:column;gap:6px}
.field label{font-size:14px;line-height:20px;font-weight:500}
.input-row{display:flex;gap:8px;align-items:flex-start}
.input-row button{flex:none}
.hint,.warn,.error{margin:0;font-size:13px;line-height:18px}
.hint{color:var(--ink-faint)}
.warn{--led:var(--signal);display:flex;align-items:baseline;gap:10px;padding:9px 12px;border-radius:10px;color:var(--ink);background:var(--panel);box-shadow:0 0 0 1px var(--seam)}
.warn::before{${LIGHT}}
.error{color:var(--stop-ink)}
.warn:empty,.error:empty{display:none}
.check{flex-direction:row;align-items:center;gap:0}
.check-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;margin-right:16px}
details.advanced{margin:0 -10px;padding:8px 10px;border-radius:12px}
details.advanced[open]{padding-bottom:16px;background:var(--panel);box-shadow:inset 0 1px 0 var(--seam),inset 0 0 0 1px color-mix(in oklab,var(--seam),transparent 60%)}
details.advanced .field{margin-top:14px}
details>summary{padding:2px 4px;font-size:14px;line-height:20px;font-weight:500;color:var(--ink-muted)}
@media (hover:hover){details>summary:hover{color:var(--ink)}}
.test-result{--led:color-mix(in oklab,var(--ink),transparent 80%);margin:0;display:flex;align-items:baseline;gap:10px;font-size:14px;line-height:20px;color:var(--ink-muted)}
.test-result::before{${LIGHT}}
.test-result:not(.ok,.ko)::before{width:17px;height:10px;border-radius:0;transform:none;box-shadow:none;background:repeating-linear-gradient(to right,var(--signal-ink) 0 3px,transparent 3px 5px)}
.test-result.ok{--led:var(--ok);color:var(--ink)}
.test-result.ko{--led:var(--stop);color:var(--stop-ink)}
.test-result:empty{display:none}
.form-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:4px}
#form button[type=submit]{--cap:var(--signal);--cap-hover:color-mix(in oklab,var(--signal),white 7%);--edge:var(--signal-edge);--hi-cap:var(--hi-signal);color:var(--on-signal)}
#cancel{margin-left:auto;background:transparent;box-shadow:none;color:var(--ink-muted);margin-bottom:0}
@media (hover:hover){#cancel:hover{background:color-mix(in oklab,var(--ink),transparent 93%);color:var(--ink)}}
#cancel:active{transform:translateY(1px);box-shadow:none}
details.before{padding:12px 14px;border-radius:14px;background:var(--panel);box-shadow:0 0 0 1px var(--seam)}
details.before ol{margin:10px 0 2px;padding-left:22px;display:flex;flex-direction:column;gap:8px;color:var(--ink-muted);font-size:14px;line-height:20px}
details.before b{color:var(--ink);font-weight:600}
`;

export function connectionsPageHtml(chrome: WindowChrome = 'frame'): string {
  const t = connectionsStrings();
  const script = connectionsScript();
  const scriptHash = createHash('sha256').update(script).digest('base64');
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'sha256-${scriptHash}'`,
    'font-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<!doctype html>
<html lang="${appLang()}" data-chrome="${chrome}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="color-scheme" content="light dark">
<title>${escape(t.pageTitle)}</title>
<style>
${pageThemeCss()}
${INSTRUMENT_CSS}
${STYLE}
</style>
</head>
<body>
<header class="titlebar rail">${WORDMARK}<span class="rail-seam" aria-hidden="true"></span><h1>${escape(t.windowTitle)}</h1></header>
<main>
<p class="intro">${escape(t.intro)}</p>
<div class="group">
<p class="label group-label" aria-hidden="true">${escape(t.computersLabel)}</p>
<section id="list" class="card" aria-label="${escape(t.listLabel)}"></section>
</div>
<button id="add" type="button">${escape(t.add)}</button>
<form id="form" class="card" hidden novalidate>
<h2 id="form-title">${escape(t.add)}</h2>
${mainFields().map(fieldHtml).join('\n')}
<div class="field check"><div class="check-text"><label for="autoLogin">${escape(t.autoLogin)}</label>
<p class="hint" id="hint-autoLogin">${escape(t.autoLoginHint)}</p></div><input type="checkbox" class="switch" id="autoLogin" aria-describedby="hint-autoLogin"><span class="led" aria-hidden="true"></span></div>
<details class="advanced" id="advanced"><summary>${escape(t.advanced)}</summary>
${advancedFields().map(fieldHtml).join('\n')}
</details>
<p class="test-result" id="test-result" role="status" aria-live="polite"></p>
<p class="error" id="form-error" aria-live="polite"></p>
<div class="form-actions">
<button type="submit" id="save-connect">${escape(t.saveAndConnect)}</button>
<button type="button" id="test">${escape(t.test)}</button>
<button type="button" id="save">${escape(t.save)}</button>
<button type="button" id="cancel">${escape(t.cancel)}</button>
</div>
</form>
<details class="before"><summary>${escape(t.before)}</summary>
<ol>
<li><b>${escape(t.beforeOther)}</b> ${escape(t.beforeRunning)}</li>
<li><b>${escape(t.beforeOther)}</b> ${escape(t.beforeSsh)}</li>
<li><b>${escape(t.beforeThis)}</b> ${escape(t.beforeKey)}</li>
</ol>
</details>
</main>
<script>${script}</script>
</body>
</html>
`;
}

export function connectionsPageUrl(chrome: WindowChrome = 'frame'): string {
  return `data:text/html;charset=utf-8;base64,${Buffer.from(connectionsPageHtml(chrome)).toString('base64')}`;
}
