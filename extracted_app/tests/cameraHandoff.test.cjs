const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('verified lobby check-in is handed off without a second in-app consent gate', () => {
  const lobby = read('src/renderer/pages/waiting.html');
  const proctor = read('src/renderer/scripts/exam-proctor.js');

  assert.match(lobby, /setSession\('cameraCheckin',\{verified:true/);
  assert.match(lobby, /video\.pause\(\); video\.srcObject=null/);
  assert.match(lobby, /await new Promise\(resolve=>setTimeout\(resolve,300\)\)/);
  assert.match(proctor, /getSession\('cameraCheckin'\)/);
  assert.match(proctor, /if \(this\.checkin\?\.verified\)/);
  assert.match(proctor, /setTimeout\(\(\) => this\.prepare\(true\), 350\)/);
});

test('lobby and exam streams use the same conservative video constraints', () => {
  const lobby = read('src/renderer/pages/waiting.html');
  const proctor = read('src/renderer/scripts/exam-proctor.js');
  const profile = /width:\s*\{\s*ideal:\s*640\s*\},\s*height:\s*\{\s*ideal:\s*480\s*\},\s*frameRate:\s*\{\s*ideal:\s*15,\s*max:\s*20\s*\}/;

  assert.match(lobby, profile);
  assert.match(proctor, profile);
  assert.doesNotMatch(proctor, /width: \{ ideal: 960 \}/);
});
