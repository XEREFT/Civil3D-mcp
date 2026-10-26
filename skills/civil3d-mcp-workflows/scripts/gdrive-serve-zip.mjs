// Serves delivery zips on 127.0.0.1 only, so a Drive page in Claude in Chrome can fetch them and drop them into a folder.
// Needed because the browser file_upload tool is limited to 10 MB per call and the zips are 25-75 MB.
//   node gdrive-serve-zip.mjs <token> <port> "<zip name 1>" ["<zip name 2>" ...]      (zips are read from %TEMP%)
// URL: http://127.0.0.1:<port>/<token>/<url-encoded zip name>   (only the listed names, only from https://drive.google.com)
// Stop it afterwards by the PID that owns the port (never by process name).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [token, portArg, ...names] = process.argv.slice(2);
if (!token || !portArg || !names.length) {
  console.error('usage: node gdrive-serve-zip.mjs <token> <port> "<zip name>" [...]');
  process.exit(2);
}

http.createServer((req, res) => {
  const h = {
    'Access-Control-Allow-Origin': 'https://drive.google.com',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
  const parts = decodeURIComponent(req.url.split('?')[0]).split('/').filter(Boolean);
  const name = parts[1];
  if (parts[0] !== token || !names.includes(name)) { res.writeHead(404, h); return res.end(); }
  const file = path.join(os.tmpdir(), name);
  const size = fs.statSync(file).size;
  res.writeHead(200, { ...h, 'Content-Type': 'application/zip', 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}).listen(Number(portArg), '127.0.0.1', () => console.log('listening', portArg));
