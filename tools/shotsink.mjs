// ============================================================
//  A place to put screenshots.
//
//  The browser pane cannot always be displayed, and a WebGL canvas that
//  is not compositing cannot be screenshotted by the host. But the page
//  can read its own framebuffer, so the only thing missing is somewhere
//  to send it. This is that: a two-route server that takes a PNG and
//  writes it to shots/.
//
//      node tools/shotsink.mjs            # then POST to :5199/shot
//
//  It exists for development. Nothing in the game talks to it.
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('shots');
fs.mkdirSync(DIR, { recursive: true });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(404, CORS); return res.end('post a png to /shot?name=x'); }

  const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot')
    .replace(/[^a-z0-9._-]/gi, '_');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const b64 = body.slice(body.indexOf(',') + 1);
    const file = path.join(DIR, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    res.writeHead(200, { ...CORS, 'content-type': 'text/plain' });
    res.end(file);
    console.log(`wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} kB)`);
  });
}).listen(5199, () => console.log('shot sink on http://localhost:5199/shot?name=...'));
