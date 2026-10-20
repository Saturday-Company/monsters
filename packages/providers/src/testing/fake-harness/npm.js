// A fake `npm install` for the tests: records its arguments and writes the
// record npm keeps of an install (node_modules/.package-lock.json).
//   FAKE_NPM_RECORD=<file> FAKE_NPM_SCENARIO=<ok|tampered|foreign> node npm.js install --prefix <dir> … <spec>
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (process.env.FAKE_NPM_RECORD) {
  appendFileSync(process.env.FAKE_NPM_RECORD, `${JSON.stringify({ argv: args })}\n`);
}
const dir = args[args.indexOf('--prefix') + 1];
const spec = args.at(-1);
const name = spec.slice(0, spec.lastIndexOf('@'));
const version = spec.slice(spec.lastIndexOf('@') + 1);
const scenario = process.env.FAKE_NPM_SCENARIO ?? 'ok';
const registry = 'https://registry.npmjs.org/';
const tarball = (n, v) => `${registry}${n}/-/${n.split('/').pop()}-${v}.tgz`;
const packages = {
  '': { name: 'install' },
  [`node_modules/${name}`]: {
    version,
    resolved: tarball(name, version),
    integrity: scenario === 'tampered' ? 'sha512-tampered' : process.env.FAKE_NPM_INTEGRITY,
  },
  [`node_modules/${name}-linux-x64`]: {
    version,
    resolved:
      scenario === 'foreign'
        ? `https://evil.example/${name}-linux-x64.tgz`
        : tarball(`${name}-linux-x64`, version),
    integrity: 'sha512-platform',
  },
};
mkdirSync(join(dir, 'node_modules', name), { recursive: true });
writeFileSync(
  join(dir, 'node_modules', '.package-lock.json'),
  JSON.stringify({ lockfileVersion: 3, requires: true, packages }),
);
