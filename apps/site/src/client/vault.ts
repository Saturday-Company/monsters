/*
 * The vault_undo key: the revert lands as a new commit on top of `git log`, the diff window
 * shows the reverse hunk, and a status line says which commit it made. Replay puts it back.
 */
import { dmesg, reducedMotion } from './util.ts';

interface UndoData {
  commit: { sha: string; subject: string };
  undone: { text: string; kind: string }[];
  done: { text: string; kind: string }[];
  said: string;
}

export function initVault(): void {
  const root = document.querySelector<HTMLElement>('[data-vault]');
  if (!root) return;
  let data: UndoData;
  try {
    data = JSON.parse(root.dataset['undo'] ?? '') as UndoData;
  } catch {
    return;
  }
  const log = root.querySelector<HTMLElement>('[data-git-log]');
  const diff = root.querySelector<HTMLElement>('[data-git-diff]');
  const key = root.querySelector<HTMLButtonElement>('[data-undo-key]');
  const replay = root.querySelector<HTMLButtonElement>('[data-undo-replay]');
  const said = root.querySelector<HTMLElement>('[data-undo-said]');
  const title = root.querySelector<HTMLElement>('#vault-diff .win__title');
  if (!log || !diff || !key || !replay) return;
  const firstTitle = title?.textContent ?? '';

  const paintDiff = (lines: UndoData['done']) => {
    diff.replaceChildren(
      ...lines.map((l) => {
        const s = document.createElement('span');
        s.className = `df df--${l.kind}`;
        s.textContent = l.text;
        return s;
      }),
    );
  };

  key.addEventListener('click', () => {
    const c = document.createElement('span');
    c.className = 'git__c is-new';
    const b = document.createElement('b');
    b.textContent = data.commit.sha;
    c.append(b, ` ${data.commit.subject}`);
    log.prepend(c);
    root.classList.add('is-undone');
    if (!reducedMotion()) root.classList.add('glitch-once');
    setTimeout(() => root.classList.remove('glitch-once'), 320);
    paintDiff(data.undone);
    if (title) title.textContent = `git show ${data.commit.sha}`;
    if (said) said.textContent = data.said;
    key.hidden = true;
    replay.hidden = false;
    replay.focus();
    dmesg(`vault: vault_undo -> ${data.commit.sha}`);
  });

  replay.addEventListener('click', () => {
    log.querySelector('.is-new')?.remove();
    root.classList.remove('is-undone');
    paintDiff(data.done);
    if (title) title.textContent = firstTitle;
    if (said) said.textContent = '';
    replay.hidden = true;
    key.hidden = false;
    key.focus();
  });
}
