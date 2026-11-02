import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, '.qa/source-manifest.json'), 'utf8'));
assert.equal(manifest.sourceFrozen, true, 'This QA snapshot has not been frozen for review.');
assert.ok(Object.keys(manifest.files).length > 50, 'The complete source manifest is required.');
for (const files of [manifest.files, manifest.qaFiles ?? {}]) {
  for (const [relative, expected] of Object.entries(files)) {
    assert.equal(createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex'), expected,
      'The source snapshot changed: ' + relative);
  }
}
const sourceHashes = Object.fromEntries(Object.entries(manifest.files).filter(([name]) => name.startsWith('src/') && name.endsWith('.ts'))
  .map(([name, hash]) => [name.slice(4), hash]).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
assert.equal(createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex'), manifest.sourceFingerprint,
  'The source fingerprint does not match the approved manifest.');
assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, manifest.version);
const output = path.join(root, 'artifacts/windows-platform');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'source-validation.json'), JSON.stringify({
  version: manifest.version, filesVerified: Object.keys(manifest.files).length, qaFilesVerified: Object.keys(manifest.qaFiles ?? {}).length,
  sourceFingerprint: manifest.sourceFingerprint, sourceUnchanged: true,
}, null, 2) + '\n');
console.log('Verified all ' + Object.keys(manifest.files).length + ' frozen source files.');
