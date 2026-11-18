const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../src/renderer/vendor/proctor');
const models = {
  'face_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  'efficientdet_lite0.tflite': 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite',
};
(async () => {
  await fs.mkdir(root, { recursive: true });
  const runtime = path.dirname(require.resolve('@mediapipe/tasks-vision'));
  await fs.copyFile(path.join(runtime, 'vision_bundle.mjs'), path.join(root, 'vision_bundle.mjs'));
  await fs.copyFile(path.join(runtime, 'vision_bundle.cjs'), path.join(root, 'vision_bundle.js'));
  await fs.cp(path.join(runtime, 'wasm'), path.join(root, 'wasm'), { recursive: true });
  const manifest = { runtime: JSON.parse(await fs.readFile(path.join(runtime, 'package.json'), 'utf8')).version, source: 'Google MediaPipe', files: {} };
  for (const [name, url] of Object.entries(models)) {
    const filename = path.join(root, name);
    try { await fs.access(filename); } catch {
      const response = await fetch(url); if (!response.ok) throw new Error(`Model download failed (${response.status}): ${name}`);
      await fs.writeFile(filename, Buffer.from(await response.arrayBuffer()));
    }
    manifest.files[name] = { source: url, sha256: crypto.createHash('sha256').update(await fs.readFile(filename)).digest('hex') };
  }
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Local proctoring runtime and models are ready.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
