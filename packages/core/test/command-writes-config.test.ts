import { describe, expect, it } from 'vitest';
import { commandWritesConfig } from '../src/agents/command-writes-config.ts';

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
  // Nothing about the configuration at all.
  'npm install && tar xf a.tgz',
  'echo hi > out.txt',
  'node -e "console.log(1)"',
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
];

describe('commandWritesConfig (D-079, D-166)', () => {
  it.each(PASS)('lets %j through', (command) => {
    expect(commandWritesConfig(command), command).toBe(false);
  });

  it.each(BLOCKED)('blocks %j', (command) => {
    expect(commandWritesConfig(command), command).toBe(true);
  });

  it('only looks at lines that name the configuration', () => {
    for (const c of [
      'rm -rf build',
      'node -e "1"',
      'echo x > out.txt',
      'eval "$X"',
      'cd $D && rm *',
    ]) {
      expect(commandWritesConfig(c), c).toBe(false);
    }
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
