const { protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
function registerProctorAssets() {
  const root = path.resolve(__dirname, '../renderer/vendor/proctor');
  protocol.handle('s360-assets', async request => {
    try {
      const url = new URL(request.url);
      const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (url.hostname !== 'local' || !filename.startsWith(root + path.sep)) return new Response('Denied', { status: 403 });
      const mime = filename.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(filename) ? 'text/javascript' : 'application/octet-stream';
      return new Response(await fs.promises.readFile(filename), { headers: { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' } });
    } catch { return new Response('Asset unavailable', { status: 404 }); }
  });
}
module.exports = { registerProctorAssets };
