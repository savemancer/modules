// Локальный CDN для разработки сайта: отдаёт dist/ с CORS, как cdn.savemancer.com.
//   npm run serve:cdn   →  http://localhost:8081/registry.json
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve('dist');
const PORT = Number(process.env.PORT ?? 8081);
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

createServer((req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' };
  if (!path.startsWith(ROOT) || !existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404, headers).end('not found');
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
}).listen(PORT, () => console.log(`cdn: http://localhost:${PORT}/registry.json`));
