import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { commandWritesConfig } from '../src/system/command-writes-config.ts';
import { tempDir } from './system-helpers.ts';

// The harness configuration is never written by a monster's terminal (D-079), but reading it is allowed:
// a command is judged on its own, not by the words that happen to be elsewhere on the line (D-166).

const PASS = [
  // Harmless variables and plain git options keep a read a read.
  'LC_ALL=C grep -n foo CLAUDE.md',
  'git -C sub diff CLAUDE.md',
  'git grep -n foo -- CLAUDE.md',
  // Real refusals of the owner's logs (24/10/2026).
  'du -sh .claude',
  'ls .claude',
  'ls settimane/W44 2>&1; wc -l strategia.md CLAUDE.md',
  // Words of a write command used as arguments or in another command of the line.
  'grep -n install CLAUDE.md',
  'grep -n tar AGENTS.md',
  'cat CLAUDE.md | head -5; node -v',
  'cat CLAUDE.md && python3 --version',
  'grep -rn "curl" .claude',
  'echo see CLAUDE.md for the touch rules',
  // Reads of every kind.
  'cat AGENTS.md',
  'cat CLAUDE.md 2>&1 | head',
  'cat AGENTS.md 2>/dev/null | head -50 >&2',
  'cat < CLAUDE.md',
  'less AGENTS.md',
  'head -20 CLAUDE.md',
  'tail -n5 AGENTS.md',
  'rg -n foo .claude',
  'rg -n foo .claude --glob "*.md" | wc -l',
  'wc -l CLAUDE.md AGENTS.md',
  'stat CLAUDE.md',
  'file CLAUDE.md .mcp.json',
  'diff CLAUDE.md AGENTS.md',
  'ls -la && cat AGENTS.md',
  'ls -la .claude',
  'du -sh .claude .codex',
  'find . -name CLAUDE.md',
  'find .claude -type f -name "*.json"',
  'find . -path "*/.claude/*" -print',
  'git diff CLAUDE.md',
  'git log -p -- AGENTS.md',
  'git show HEAD:CLAUDE.md',
  'git status .claude',
  'git -C ../other diff --stat CLAUDE.md',
  'git add CLAUDE.md',
  'git commit -m "Update CLAUDE.md"',
  'sed -n 1,20p CLAUDE.md',
  "sed 's/foo/bar/' CLAUDE.md",
  "awk '{print $1}' CLAUDE.md",
  'sort CLAUDE.md | uniq -c',
  'jq . .claude/settings.json',
  'ls .claude | tee /tmp/listing.txt',
  'cat CLAUDE.md > /tmp/copy.md',
  'cat CLAUDE.md >> notes/log.md',
  'cp CLAUDE.md /tmp/CLAUDE.bak',
  'rsync -a .claude/ /tmp/backup/',
  'tar czf /tmp/backup.tgz CLAUDE.md .claude',
  'tar tf /tmp/backup.tgz',
  'dd if=CLAUDE.md of=/tmp/x',
  'for f in CLAUDE.md AGENTS.md; do wc -l "$f"; done',
  'cd .claude && ls && cat settings.json',
  'sudo cat .claude/settings.json',
  'env LC_ALL=C grep -c x CLAUDE.md',
  'time wc -l CLAUDE.md',
  'timeout 5 cat CLAUDE.md',
  'xargs -n1 cat < /dev/null; ls .claude',
  'test -f CLAUDE.md && echo yes',
  '[ -f .claude/settings.json ] && echo yes',
  'cat CLAUDE.md # touch it later',
  "grep -n '$(' CLAUDE.md",
  // Plain reads the brake refused (review of 25/10, C-22).
  "awk '$1 > 3' CLAUDE.md",
  "awk -F'|' '{print $2}' CLAUDE.md",
  "awk -v n=3 '{ if ($1 > n) print $1 }' CLAUDE.md",
  "awk -F, 'NR > 1 { print $2 }' AGENTS.md",
  'git commit -m "$(cat <<\'EOF\'\nUpdate CLAUDE.md\n\nCo-Authored-By: X <x@example.com>\nEOF\n)"',
  'git add CLAUDE.md && git commit -m "$(cat <<\'EOF\'\nDocs: AGENTS.md > notes\nEOF\n)"',
  'head -n $((N+1)) CLAUDE.md',
  'tail -n $((10 * 2)) AGENTS.md',
  'cat $(git rev-parse --show-toplevel)/CLAUDE.md',
  'cat "$(git rev-parse --show-toplevel)/CLAUDE.md"',
  'ls "$(pwd)/.claude"',
  'cd .claude && node -v',
  'cd .claude && python3 --version',
  'npx prettier --check CLAUDE.md',
  'pnpm exec prettier --check AGENTS.md',
  'npx --yes markdownlint CLAUDE.md',
  'cat CLAUDE.md > /tmp/copy',
  // Copies of the configuration out, into a temporary folder or under another name.
  'cp CLAUDE.md /tmp/',
  'cp -r .claude /tmp/backup/',
  'cp CLAUDE.md backup.md',
  'cp ../template/CLAUDE.md /tmp/review/',
  // Readers whose scripts only print, and globs that name nothing.
  "sed -n '/web/p' CLAUDE.md",
  "sed -n '1,/^## /p' AGENTS.md",
  "sed -ne 's/a/b/p' CLAUDE.md",
  "sed '/^$/d; s/x/y/g' CLAUDE.md",
  'ls *.md',
  'cat .claude/*.json',
  'wc -l {CLAUDE,AGENTS}.md',
  'git show HEAD:CLAUDE.md',
  'fd -e md CLAUDE.md .',
  // Nothing about the configuration at all.
  'npm install && tar xf a.tgz',
  'echo hi > out.txt',
  'node -e "console.log(1)"',
  'echo ' + '7'.repeat(2_000),
  'echo x > {a,b}.txt',
  // A write command of a script that only looks like one, and readers kept to reading.
  "sed -n '/w/p' CLAUDE.md",
  "sed 's/w/x/; s/a/b/g' CLAUDE.md",
  "sed 'y/abcw/xyzv/' AGENTS.md",
  'echo w.claude',
  'less +G CLAUDE.md',
  'less +/Rules CLAUDE.md',
  'more +20 AGENTS.md',
  'view CLAUDE.md',
  'view -R +12 AGENTS.md',
  'bat --paging=never CLAUDE.md',
  'sort -u CLAUDE.md',
  'rg --pretty foo CLAUDE.md',
  'tar -czf /tmp/backup.tgz -C . CLAUDE.md',
];

const BLOCKED = [
  // A reader told to run a program: git's own config, the pager and diff variables, `git grep -O`.
  `git -c core.pager="sh -c 'echo x > CLAUDE.md'" log`,
  'git --config-env=core.pager=P log -- CLAUDE.md',
  'GIT_EXTERNAL_DIFF=./x.sh git diff CLAUDE.md',
  'export GIT_EXTERNAL_DIFF=./x.sh; git diff CLAUDE.md',
  'D=./x.sh; git diff CLAUDE.md',
  'LESSOPEN="|./x.sh %s" less CLAUDE.md',
  'env PAGER=./x git log -- CLAUDE.md',
  'git grep -Ovim foo -- CLAUDE.md',
  'git diff --ext-diff CLAUDE.md',
  // Redirections.
  'echo x > CLAUDE.md',
  'echo x>CLAUDE.md',
  'echo x >| CLAUDE.md',
  'echo x &> CLAUDE.md',
  '> CLAUDE.md',
  ': > AGENTS.md',
  'cat a >> .claude/settings.json',
  `echo '{"disableAllHooks":true}' > .claude/settings.local.json`,
  'echo {} > ./.mcp.json',
  'echo x >> "notes/CLAUDE.md" 2>&1',
  'F=AGENTS.md; echo x > $F',
  'echo x > `pwd`/CLAUDE.md',
  'cat > CLAUDE.md << EOF\nhi\nEOF',
  // Write verbs naming it.
  'sed -i s/a/b/ AGENTS.md',
  "sed -i 's/a/b/' AGENTS.md",
  "sed -n -e 'w CLAUDE.md' x.txt; cat CLAUDE.md",
  'perl -pi -e s/a/b/ CLAUDE.md',
  'cp x CLAUDE.md',
  'cp -r /tmp/x .claude',
  'cp -t .claude /tmp/x',
  'mv x CLAUDE.md',
  'mv CLAUDE.md /tmp/x',
  'ln -s /tmp/x CLAUDE.md',
  'rm CLAUDE.md',
  'ls; rm .claude/x',
  'rm -rf .claude',
  'rmdir .claude',
  'mkdir -p .claude && cp /tmp/x .claude/settings.json',
  'touch CLAUDE.md',
  'truncate -s0 AGENTS.md',
  'chmod 777 .claude',
  'install -m 644 x CLAUDE.md',
  'tee CLAUDE.md',
  'printf x | tee CLAUDE.md',
  'printf x | tee -a "AGENTS.md"',
  'dd if=/dev/zero of=CLAUDE.md count=1',
  'curl -o CLAUDE.md https://example.com/x',
  'wget -O AGENTS.md https://example.com/x',
  'tar xf a.tgz .claude/settings.json',
  'tar -xzf a.tgz -C .claude',
  'tar cf CLAUDE.md x',
  'unzip a.zip CLAUDE.md',
  'rsync -a /tmp/x/ .claude/',
  'git checkout CLAUDE.md',
  'git restore AGENTS.md',
  'git stash; git apply CLAUDE.md.patch',
  'find . -name CLAUDE.md -delete',
  'find . -name CLAUDE.md -exec rm {} \\;',
  'find . -name x -exec rm {} +; cat CLAUDE.md',
  'Set-Content CLAUDE.md x',
  'Remove-Item -Path .\\.claude\\settings.json',
  'echo x | Out-File AGENTS.md',
  // The command word hides behind a wrapper, a path, a quote or a backslash.
  'sudo rm CLAUDE.md',
  'env FOO=1 rm CLAUDE.md',
  'FOO=1 BAR=2 cp x CLAUDE.md',
  'nice -n 5 rm CLAUDE.md',
  'time cp x CLAUDE.md',
  'command rm CLAUDE.md',
  '/bin/rm CLAUDE.md',
  '\\rm CLAUDE.md',
  '"rm" CLAUDE.md',
  'r""m CLAUDE.md',
  'rm "CLAU"DE.md',
  'rm CLAUDE.m""d',
  'echo CLAUDE.md | xargs rm',
  'echo CLAUDE.md | xargs -I{} mv {} /tmp',
  '(rm CLAUDE.md)',
  '{ rm CLAUDE.md; }',
  'true && rm AGENTS.md',
  'false || rm AGENTS.md',
  'ls\nrm CLAUDE.md',
  'for f in x; do rm CLAUDE.md; done',
  'if true; then rm CLAUDE.md; fi',
  // It does not name the file in the command that writes it.
  'F=AGENTS.md; rm $F',
  'F=AGENTS.md; cp x "$F"',
  'cd .claude && rm settings.json',
  'cd .claude; echo {} > settings.json',
  'cd .claude && node build.js',
  'ls CLAUDE.md; rm *.md',
  'cat CLAUDE.md; find . -delete',
  // Code run inline, or from the input of the shell.
  `node -e "require('fs').writeFileSync('CLAUDE.md','')"`,
  `node -p "require('fs').writeFileSync('AGENTS.md','')"`,
  `python -c "open('CLAUDE.md','w').write('')"`,
  `python3 -c "open('CLAUDE.md','w')"`,
  `ruby -e "File.write('CLAUDE.md','')"`,
  `perl -e 'open F,">CLAUDE.md"'`,
  `deno eval "Deno.writeTextFileSync('CLAUDE.md','')"`,
  'bash -c "echo > CLAUDE.md"',
  'sh -c "rm CLAUDE.md"',
  'bash -lc "rm CLAUDE.md"',
  'cat CLAUDE.md; node -e "x"',
  'echo "rm CLAUDE.md" | sh',
  'echo "rm CLAUDE.md" | bash -',
  `echo "require('fs')" CLAUDE.md | node`,
  'python3 fix.py CLAUDE.md',
  'node fix.js .claude/settings.json',
  'node < CLAUDE.md',
  'eval "rm CLAUDE.md"',
  'source CLAUDE.md',
  // What cannot be followed keeps blocking when the name is there.
  'cat CLAUDE.md; $(echo rm) x',
  'echo $(cat CLAUDE.md)',
  'echo `cat CLAUDE.md`',
  'cat <<EOF\nCLAUDE.md\nEOF',
  'diff <(cat CLAUDE.md) x',
  "cat CLAUDE.md; echo $'\\x72m'",
  'cat CLAUDE.md; echo $(rm x)',
  'cat CLAUDE.md; echo $(( $(rm x) ))',
  "X='a[$(rm CLAUDE.md)]'; echo $((X))",
  'git commit -m "$(cat <<\'EOF\'\nmsg\nEOF\nrm CLAUDE.md\nEOF\n)"',
  'git commit -m "$(cat <<EOF\n$(rm x) CLAUDE.md\nEOF\n)"',
  'echo "$(cat <<\'EOF\'\nCLAUDE.md\nEOF\n)" | xargs rm',
  'cat > "$(git rev-parse --show-toplevel)/CLAUDE.md"',
  // A configuration copied into a folder lands there under its own name (review of 25/10, C-17).
  'cp ../template/CLAUDE.md .',
  'cp ../CLAUDE.md ./',
  'cp -r ~/template/.claude .',
  'cp -a ../t/.claude ~',
  'rsync -a ../t/.claude ./',
  'rsync -av ../t/AGENTS.md sub/',
  'cp CLAUDE.md ../',
  'cp CLAUDE.md sub',
  'cp CLAUDE.md AGENTS.md docs',
  'cp -t . ../t/CLAUDE.md',
  'cp --target-directory=sub ../t/CLAUDE.md',
  'cp ../t/*.md .',
  // Spellings that dodge the name (C-18).
  'cat x > C\\LAUDE.md',
  'cp x CL\\AUDE.md',
  'rm \\.claude/settings.json',
  'curl -oCLAUDE.md https://example.com/x',
  'wget -OCLAUDE.md https://example.com/x',
  'sort -oCLAUDE.md x',
  'cp -t.claude x',
  'tar -C.claude -xf a.tar',
  'unzip -d.claude a.zip',
  'touch {a,CLAUDE.md}',
  'scp host:x CLAUDE.md',
  'scp x host:CLAUDE.md',
  "sed -n '1wCLAUDE.md' x",
  "sed -n 'wCLAUDE.md' x",
  "sed 's/a/b/w CLAUDE.md' x",
  "sed 's/a/b/gw CLAUDE.md' x",
  'sed e CLAUDE.md',
  "sed '1e touch x' CLAUDE.md",
  "sed -e '$!N' -e 'W CLAUDE.md' x",
  'fd CLAUDE.md . -xrm',
  'fd -HIx rm CLAUDE.md',
  'yq --in-place . CLAUDE.md',
  'yq -i . .claude/settings.json',
  'eslint -o CLAUDE.md x.js',
  'eslint --output-file CLAUDE.md x.js',
  'prettier --cache-location CLAUDE.md x.js',
  'awk \'{ print > "CLAUDE.md" }\' x',
  'awk \'{ print | "sh" }\' CLAUDE.md',
  'awk \'BEGIN { system("rm CLAUDE.md") }\'',
  'awk -f prog.awk CLAUDE.md',
  "gawk -i inplace '{ print }' CLAUDE.md",
  'awk \'{ "date" | getline d }\' CLAUDE.md',
  // Inline code for more interpreters and runners (C-20).
  `php -r "file_put_contents('CLAUDE.md', '');"`,
  'php -r "x();"; cat CLAUDE.md',
  'pwsh -Command "Remove-Item x"; cat CLAUDE.md',
  'pwsh -c "x"; cat CLAUDE.md',
  'powershell -EncodedCommand AAAA; cat CLAUDE.md',
  'cmd /c "del x"; cat CLAUDE.md',
  'deno eval "x"; cat CLAUDE.md',
  'tsx -e "x"; cat CLAUDE.md',
  'npx tsx -e "x"; cat CLAUDE.md',
  'pnpm dlx tsx --eval "x"; cat CLAUDE.md',
  'Rscript -e "x"; cat CLAUDE.md',
  'node --eval="x"; cat CLAUDE.md',
  'bun -e "x"; cat CLAUDE.md',
  'npx prettier --write CLAUDE.md',
  'npx -y rimraf CLAUDE.md',
  'npx --foo x; cat CLAUDE.md',
  'cd .claude && node build.js -v',
  // A name the shell expands into the configuration (C-21).
  'echo x > CLAU*',
  'echo x > CLAUDE.m?',
  'echo x > .cl*de/x',
  'echo x > {CLAUDE,x}.md',
  "echo x > $'\\x43LAUDE.md'",
  'echo x > AGENT[S].md',
  'echo x > {A..C}LAUDE.md',
  'rm *.md',
  'mv *.md docs/',
  'rm -rf .c*',
  'touch {x,y}/CLAUDE.md',
  // A last segment of wildcards can be CLAUDE.md: without the folder, the pattern decides.
  'rm -rf dist/*',
  'cd $D && rm *',
  'mv ./* /tmp/old/',
  'rm -f ?????????',
  // The files a `sed` script writes, glued to its command (the leftover of C-18).
  "sed 'w.claude/x' notes.md",
  "sed -n '1w.claude/settings.json' notes.md",
  "sed -n '$W.codex/config.toml' notes.md",
  "sed -n '/x/w.mcp.json' notes.md",
  "sed 's/a/b/w.claude/x' notes.md",
  "sed 's/a/b/gw.claude/x' notes.md",
  "sed 's/a/b/2pw.claude/x' notes.md",
  "sed -e p -e 'w.claude/x' notes.md",
  "sed --expression='w.claude/x' notes.md",
  "sed -n '1{w.claude/x\n}' notes.md",
  "sed -i'.claude/*' s/a/b/ notes.md",
  'sed --in-place=.claude/* s/a/b/ notes.md',
  // Other ways a "reading" program writes a file or runs one (the family of the leftover).
  "ed -s notes.md <<< 'w.claude/x'",
  "vim -es -c 'w!.claude/x' -c q notes.md",
  "view -c 'w! CLAUDE.md' notes.md",
  "view +'w CLAUDE.md' notes.md",
  'view -W .claude/x notes.md',
  "less '+!rm CLAUDE.md' notes.md",
  "less '+|tee CLAUDE.md' notes.md",
  "less '+s CLAUDE.md' notes.md",
  "more '+!touch AGENTS.md' notes.md",
  "bat --pager 'tee CLAUDE.md' notes.md",
  "ag --pager 'tee CLAUDE.md' foo",
  'rg --hostname-bin ./x.sh foo CLAUDE.md',
  'sort --compress-program=./x.sh CLAUDE.md',
  'tar -cf /tmp/x.tar -I ./x.sh CLAUDE.md',
  'tar --use-compress-program=./x.sh -cf /tmp/x.tar CLAUDE.md',
  'tar -cf /tmp/x.tar --checkpoint-action=exec=./x.sh CLAUDE.md',
  'awk \'{ print > ".claude/x" }\' notes.md',
  'awk \'{ printf "%s", $0 >> "CLAUDE.md" }\' notes.md',
  'find . -name x -fprint .claude/x',
  'find . -fls CLAUDE.md',
  'dd if=notes.md of=.claude/x',
  'printf x | tee -a .claude/x',
  "perl -pi'.claude/*' -e 1 notes.md",
  'bash -c "echo x>.claude/x"',
  "sh -c 'cat notes.md >> CLAUDE.md'",
  'git diff --output=.claude/x',
];

describe('commandWritesConfig (D-079, D-166)', () => {
  it.each(PASS)('lets %j through', (command) => {
    expect(commandWritesConfig(command), command).toBe(false);
  });

  it.each(BLOCKED)('blocks %j', (command) => {
    expect(commandWritesConfig(command), command).toBe(true);
  });

  it('only looks at lines that name the configuration', () => {
    for (const c of ['rm -rf build', 'node -e "1"', 'echo x > out.txt', 'eval "$X"']) {
      expect(commandWritesConfig(c), c).toBe(false);
    }
  });

  it('stays linear on long lines: digits, nested substitutions, globs, braces (C-19)', () => {
    const shapes = [
      'echo ' + '7'.repeat(100_000),
      'echo ' + '7'.repeat(100_000) + ' > CLAUDE.md',
      'cat CLAUDE.md; echo ' + '1>'.repeat(50_000),
      'cat CLAUDE.md; echo ' + '$('.repeat(50_000),
      'cat CLAUDE.md; echo ' + '$(('.repeat(33_000),
      'echo x > ' + '*a'.repeat(50_000),
      'echo x > ' + '{a,'.repeat(25_000),
      'echo x > ' + '['.repeat(100_000),
      "sed -n '" + '/a/,'.repeat(25_000) + "p' CLAUDE.md",
      "awk '" + 'print '.repeat(16_000) + "' CLAUDE.md",
      "git commit -m \"$(cat <<'EOF'\n".repeat(8_000) + 'CLAUDE.md',
      '-o'.repeat(50_000) + 'CLAUDE.md',
    ];
    for (const s of shapes) {
      // Also with the globs expanded in a real folder.
      for (const options of [{}, { cwd: process.cwd() }]) {
        const t0 = performance.now();
        commandWritesConfig(s, options);
        expect(performance.now() - t0, s.slice(0, 40)).toBeLessThan(500);
      }
    }
    expect(commandWritesConfig('echo ' + '7'.repeat(100_000) + ' > CLAUDE.md')).toBe(true);
  });

  // The leftover of C-21: a glob is judged by what the shell expands it to in the folder the line runs
  // in. A segment of wildcards only is no longer let through by its pattern: `dist/*` passes while
  // `dist` holds no configuration, `*` does not pass next to a CLAUDE.md.
  describe('globs expanded in the folder (the leftover of C-21)', () => {
    let root = '';
    beforeEach(() => {
      root = tempDir();
      for (const path of [
        'CLAUDE.md',
        '.claude/settings.json',
        'dist/a.js',
        'dist/b.css',
        'src/x.ts',
        'sub/AGENTS.md',
        'sub/notes.txt',
        'build/out.js',
        'node_modules/x/index.js',
        'bare/notes.txt',
        'bare/x/y.txt',
        'public/index.html',
        'docs/CLAUDE.md',
      ]) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), '');
      }
      mkdirSync(join(root, 'empty'));
      // A link to the configuration folder under another name.
      symlinkSync('.claude', join(root, 'cfg'), 'dir');
      // `d -> ../docs` inside `sub`: `sub/d/..` is the root on disk, `sub` on paper.
      symlinkSync('../docs', join(root, 'sub', 'd'), 'dir');
    });
    it.each([
      // [command, folder it runs in (under the root), writes]
      ['rm -rf dist/*', '.', false],
      ['rm -f dist/*.js', '.', false],
      ['rm -rf empty/*', '.', false],
      ['cd dist && rm -rf *', '.', false],
      // The false refusals the review checked: they stay reads or plain writes.
      ['rm -rf node_modules dist/*', '.', false],
      ['cp -r src/* dist/', '.', false],
      ['mv build/* out/', '.', false],
      ['sed -n 1p CLAUDE.md', '.', false],
      ['git diff -- *', '.', false],
      ['ls *', '.', false],
      ['shopt -s dotglob; ls -a *', '.', false],
      ['find dist -name "*.js" -delete', '.', false],
      ['find . -name "*.txt" -delete', 'bare', false],
      // Narrowed after the second review: a writer dates only the folders it names.
      ['mkdir -p out && cp -r public/* out/', '.', false],
      ['mkdir -p out && cp src/*.ts out/', '.', false],
      ['touch dist/x && rm -f public/*', '.', false],
      ['cd dist && rm -f *.js', '.', false],
      ['find . -name "*.log" -delete', '.', false],
      ['find . -name .DS_Store -delete', '.', false],
      ['find . -name node_modules -prune -o -name "*.log" -delete', '.', false],
      ['find dist -name "*.map" -delete', '.', false],
      ['find dist -name "*.json" -delete', '.', false],
      ['sed -i s/a/b/ src/*.ts', '.', false],
      ['echo CLAUDE.md | wc -l', '.', false],
      // A folder that is not there yet, or a `cd` that may fail and leave the line here: the pattern.
      ['rm -rf missing/*', '.', true],
      ['cd ./dist; rm -rf ./*', '.', true],
      ['cd nope; rm -f *', '.', true],
      ['cd /nonexistent; rm -f *', '.', true],
      ['cd nope || true; rm -f *', '.', true],
      ['export CDPATH=/; cd x; rm *', '.', true],
      // Made earlier on the line: the disk is out of date.
      ['git worktree add t HEAD && cp t/* .', '.', true],
      ['unzip -o x.zip -d t && cp -f t/* .', '.', true],
      ['npm run build && rm -rf dist/*', '.', true],
      // Brace ranges make names that do not exist yet; `**` goes to any depth.
      ['echo x | tee sub/{A..Z}LAUDE.md', '.', true],
      ['echo x > {A..A}GENTS.md', 'bare', true],
      ['mkdir -p .{c..c}laude && echo x > .{c..c}laude/settings.json', 'bare', true],
      ['echo "{}" > .{a..c}laude/settings.json', 'bare', true],
      ['rm -rf **/*.md', '.', true],
      // Glob options and qualifiers change what a glob matches.
      ['shopt -s dotglob; rm -rf *', 'bare', true],
      ['GLOBIGNORE=.; rm -rf *', 'bare', true],
      ['rm -rf *(D)', 'bare', true],
      ['setopt globdots; rm -rf *', 'bare', true],
      // Bracket expressions, POSIX classes included.
      ['rm -f [[:upper:]]LAUDE.md', '.', true],
      ['rm -f ./[[:upper:]]LAUDE.md', '.', true],
      ['rm -f ./[]C]LAUDE.md', '.', true],
      ['rm -f [!x]LAUDE.md', '.', true],
      // A search that deletes or runs commands walks into the configuration.
      ['find . -name "*.md" -delete', '.', true],
      ['find . -name settings.json -delete', '.', true],
      ['find . -type f -exec rm {} +', '.', true],
      ['fd -e json -x rm', '.', true],
      // Links followed, and Windows' short names.
      ['rm cfg/*', '.', true],
      ['cd cfg && rm *', '.', true],
      ['cd cfg && echo x > settings.json', '.', true],
      ['rm -f CLAUDE~1.MD', '.', true],
      // `..` after a link is the real folder's parent.
      ['rm -f sub/d/../*', '.', true],
      ['cd sub && rm -f d/../*', '.', true],
      ['cd -P sub/d/.. && rm -f *', '.', true],
      // A writer that names the folder, or one that may change anything, dates the glob after it.
      ['mkdir -p sub && rm -f sub/*', '.', true],
      ['echo x > t; rm -f *', '.', true],
      ['tar -xf a.tar -C bare && rm -f bare/*', '.', true],
      ['git clone u bare && rm -f bare/*', '.', true],
      ['npm run build && rm -rf dist/*', '.', true],
      // A list fed to a runner on its input, and the lines a shell runs.
      ['echo CLAUDE.md | parallel rm', '.', true],
      ['ls *.md | parallel rm', '.', true],
      ['ls *.md | rush rm', '.', true],
      ['find sub -maxdepth 0 -exec sh -c "cd ..; rm C*" \\;', '.', true],
      ['bash -c "rm -f C*"', 'bare', true],
      ['find . -name "*.json" -delete', '.', true],
      ['cd sub & rm -f *', '.', true],
      ['cd sub | rm -f *', '.', true],
      ['rm -rf CLAUDE~1', '.', true],
      ['cp -r src/* out/', '.', false],
      ['mv dist/* /tmp/old/', '.', false],
      ['rm *.ts', '.', false],
      ['grep -l x src/* | xargs sed -i s/a/b/', '.', false],
      ['rm -rf *', 'dist', false],
      ['rm -rf *', '.', true],
      ['rm *.md', '.', true],
      ['rm -rf .*', '.', true],
      ['rm -rf .c*/*', '.', true],
      ['mv * /tmp/x/', '.', true],
      ['rm -rf ?????????', '.', true],
      ['rm -rf sub/*', '.', true],
      ['cp -r sub/* out/', '.', true],
      ['cd sub && rm *', '.', true],
      ['(cd dist && ls); rm *', '.', true],
      ['cd $D && rm *', '.', true],
      ['cd - && rm *', '.', true],
      ['grep -l x * | xargs sed -i s/a/b/', '.', true],
      ['rm -rf ../*', 'dist', true],
      ['rm -rf */AGENTS.md', '.', true],
    ] as const)('%j in %s writes: %s', (command, dir, writes) => {
      expect(commandWritesConfig(command, { cwd: join(root, dir) }), command).toBe(writes);
    });

    it('the folder the line runs in counts only as the caller says (`inConfig`)', () => {
      // A path above that holds `.claude` is not the glob's: only what the pattern adds is judged.
      const inside = join(root, '.claude');
      expect(commandWritesConfig('rm -f *.bak', { cwd: inside })).toBe(false);
      // A terminal left inside the configuration folder: any write is one, reads pass.
      for (const c of ['rm -f *.bak', 'rm settings.json', 'echo {} > settings.json', 'node x.js']) {
        expect(commandWritesConfig(c, { cwd: inside, inConfig: true }), c).toBe(true);
      }
      for (const c of ['ls', 'cat settings.json', 'grep -n x *']) {
        expect(commandWritesConfig(c, { cwd: inside, inConfig: true }), c).toBe(false);
      }
    });
  });

  // The native `shell` tool on Windows runs PowerShell: a backslash is a separator, `*` also matches
  // `.claude`. No glob is expanded on disk and every glob of a writer is a write.
  it.each([
    ['Remove-Item -Force .\\*', true],
    ['Remove-Item -Recurse .\\.c*', true],
    ['Remove-Item .\\*.md', true],
    ['Set-Content .\\CLAUDE.md x', true],
    ['"x" | Out-File .\\.claude\\settings.json', true],
    ['Copy-Item x .\\.claude\\', true],
    ['Move-Item x CLAUDE.md', true],
    ['New-Item -ItemType File .\\.claude\\x', true],
    ['echo x > .\\CLAUDE.md', true],
    ['Remove-Item -Recurse -Force .\\dist\\*', true],
    ['Get-ChildItem *', false],
    ['Get-Content .\\CLAUDE.md', false],
    ['Remove-Item .\\dist\\a.js', false],
    ['Get-ChildItem -Recurse -Filter CLAUDE.md | Remove-Item', true],
    ['Get-ChildItem -Recurse -Filter *.md | Remove-Item -Force', true],
    ['Get-ChildItem *.log | Remove-Item', true],
    ['Get-ChildItem dist | Measure-Object', false],
  ] as const)('Windows (PowerShell): %j writes: %s', (command, writes) => {
    expect(commandWritesConfig(command, { cwd: process.cwd(), windows: true }), command).toBe(
      writes,
    );
  });

  it('a big folder is read on a budget, once per line (C-19 for the disk)', () => {
    const root = tempDir();
    mkdirSync(join(root, 'big'));
    for (let i = 0; i < 6000; i++) writeFileSync(join(root, 'big', `f${i}`), '');
    for (const line of [
      'rm ' + Array.from({ length: 200 }, () => 'big/*').join(' '),
      'find big -delete',
      'rm ' + Array.from({ length: 2000 }, () => '*').join(' '),
    ]) {
      const t0 = performance.now();
      // Past the budget the pattern decides: `big/*` could be a CLAUDE.md.
      expect(commandWritesConfig(line, { cwd: root }), line.slice(0, 30)).toBe(true);
      expect(performance.now() - t0, line.slice(0, 30)).toBeLessThan(500);
    }
  });

  describe('here-documents (26/10/2026): the body of a file being written is text, not a line to run', () => {
    // The Python script a monster wrote with `cat > scripts/x.py <<'EOF'`: `*(`, apostrophes, braces and
    // brackets were read as globs, groups and quotes, and the write was refused as one to CLAUDE.md.
    const script = [
      'import json, math, random',
      'def ix(xv): return lambda a, b: (xv, a[1] + (b[1]-a[1])*(xv-a[0])/(b[0]-a[0]))',
      'for ins, it in ((lambda p: p[0] >= x0, ix(x0)), (lambda p: p[0] <= x1, ix(x1))):',
      "    print(f\"{v:.1f}\".rstrip('0'))  # it's a {set} of [shapes]",
      "dots = 'M{0} {1}a{2} {2} 0 1 0'  # * ? [a-z] $x `y`",
    ].join('\n');
    const cwd = tempDir();
    writeFileSync(join(cwd, 'CLAUDE.md'), '');
    mkdirSync(join(cwd, 'scripts'));
    const run = (line: string) => commandWritesConfig(line, { cwd });

    it.each([
      `cat > scripts/forme.py <<'EOF'\n${script}\nEOF`,
      `cat > ${join(cwd, 'scripts', 'forme.py')} <<'EOF'\n${script}\nEOF\npython3 scripts/forme.py > out.json`,
      `mkdir -p scripts && cat > scripts/forme.py <<'EOF'\n${script}\nEOF`,
      `cd scripts && cat >> forme.py <<"EOF"\n${script}\nEOF`,
      `cat > scripts/forme.py <<\\EOF\n${script}\nEOF`,
      `cat > scripts/forme.py <<E"O"F\n${script}\nEOF`,
      `tee scripts/forme.py > /dev/null <<'EOF'\n${script}\nEOF`,
      `cat > scripts/forme.py <<-'EOF'\n\t${script.replace(/\n/g, '\n\t')}\n\tEOF`,
      // Several in a row, and commands after the last one.
      `cat > a.txt <<'A'\nx *(y\nA\ncat > b.txt <<'B'\nit's {z\nB\nls scripts`,
      `cat - <<'A' > a.txt && cat - <<'B' > b.txt\n*(a\nA\n*(b\nB`,
      // Not quoted: variables are harmless, a substitution is not (blocked below).
      "cat > scripts/a.txt <<EOF\nhome $HOME * (x) {y} it's\nEOF",
      'cat <<EOF | grep -n x\n*(x)\nEOF',
      'jq . <<\'EOF\'\n{"a": [1, 2], "b": "it\'s"}\nEOF',
    ])('lets %j through', (line) => {
      expect(run(line), line).toBe(false);
      expect(commandWritesConfig(line), line).toBe(false);
    });

    it.each([
      // The names in the body still count: a script that spells a configuration is refused as before.
      "cat > scripts/x.py <<'EOF'\nopen('CLAUDE.md', 'w').write('')\nEOF",
      "cat > scripts/x.sh <<'EOF'\nrm .claude/settings.json\nEOF",
      'cat <<EOF\nCLAUDE.md\nEOF',
      // The target and the rest of the line are judged as always.
      "cat > CLAUDE.md <<'EOF'\nhello\nEOF",
      "cat >> .claude/settings.json <<'EOF'\n{}\nEOF",
      "cat <<'EOF' | tee AGENTS.md\nhello\nEOF",
      "cat > a.txt <<'EOF'\nx\nEOF\nrm -rf *",
      "cat > a.txt <<'EOF'\nx\nEOF\necho x > CLAUDE.md",
      // An apostrophe in the body no longer swallows the lines after it (they were not judged).
      "cat > a.txt <<'EOF'\nit's\nEOF\nrm -rf *",
      "cat > a.txt <<'EOF'\nit's\nEOF\nrm -rf *\ncat > b.txt <<'EOF'\nit's\nEOF",
      // The body is code: a shell, an interpreter, a pipe into one, a list for xargs.
      "bash <<'EOF'\nrm -rf *\nEOF",
      'sh <<EOF\nrm -rf *\nEOF',
      "cat <<'EOF' | bash\nrm -rf *\nEOF",
      "cat <<'EOF' | sh -s\nrm -rf *\nEOF",
      "cat > x.sh <<'EOF' && bash x.sh\nrm -rf *\nEOF",
      "xargs rm <<'EOF'\n*\nEOF",
      "env bash <<'EOF'\nrm -rf *\nEOF",
      // An unquoted body runs its substitutions.
      'cat > a.txt <<EOF\n$(rm -rf *)\nEOF',
      'cat > a.txt <<EOF\n${X:-$(rm -rf *)}\nEOF',
      // A delimiter that cannot be followed, and one that never closes: lexed as it stands.
      'cat > a.txt <<$D\n*(x\nEOF\nrm -rf *',
      "cat > a.txt <<'EOF'\n*(x\nrm -rf *",
    ])('blocks %j', (line) => {
      expect(run(line), line).toBe(true);
    });

    it('only a line that is exactly the delimiter closes it (with the tabs of <<-, not without)', () => {
      // `EOF ` and `\tEOF` do not close a plain one: the rest is still body, as the shell reads it.
      expect(run("cat > a.txt <<'EOF'\nx *(y\nEOF \n\tEOF\nrm -rf *\nEOF")).toBe(false);
      expect(run("cat > a.txt <<-'EOF'\n\tx *(y\n\t\tEOF")).toBe(false);
      expect(run("cat > a.txt <<-'EOF'\n\tx *(y\n\t\tEOF\nrm -rf *")).toBe(true);
      expect(run("cat > a.txt <<'EOF'\nx *(y\nEOF\nrm -rf *")).toBe(true);
    });

    it('stays linear on many here-documents and long bodies', () => {
      const many = "cat > a.txt <<'EOF'\n*(x\nEOF\n".repeat(20_000) + 'rm -rf *';
      const long = `cat > a.txt <<'EOF'\n${"*(it's {\n".repeat(100_000)}EOF\nls`;
      for (const line of [many, long, "cat <<'A'\n".repeat(50_000)]) {
        const t0 = performance.now();
        run(line);
        expect(performance.now() - t0, line.slice(0, 30)).toBeLessThan(1000);
      }
    });
  });

  it('knows the names at any depth and in either case', () => {
    for (const c of [
      'rm ../x/CLAUDE.md',
      'rm claude.MD',
      'rm sub/.codex/config.toml',
      'echo > CLAUDE.local.md',
    ]) {
      expect(commandWritesConfig(c), c).toBe(true);
    }
  });
});
