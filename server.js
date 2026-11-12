import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Konfigurasi Environment
const PORT = parseInt(process.env.PORT || '3137', 10);
const NEXTCLOUD_URL = (process.env.NEXTCLOUD_URL || 'https://drive.gciconnect.my.id').replace(/\/+$/, '');
const NEXTCLOUD_USER = process.env.NEXTCLOUD_USER || 'gcibot';
const NEXTCLOUD_PASSWORD = process.env.NEXTCLOUD_PASSWORD || 'Gcidesign#1';
const NEXTCLOUD_DIR = (process.env.NEXTCLOUD_DIR || 'ftth-photo-qc').replace(/^\/+|\/+$/g, '');

const DIST_DIR = path.resolve(__dirname, 'dist');

function getAuthHeader() {
  return 'Basic ' + Buffer.from(`${NEXTCLOUD_USER}:${NEXTCLOUD_PASSWORD}`).toString('base64');
}

function getWebDavBase() {
  return `${NEXTCLOUD_URL}/remote.php/dav/files/${encodeURIComponent(NEXTCLOUD_USER)}`;
}

/**
 * Memastikan folder WebDAV tujuan tersedia (recursive MKCOL)
 */
async function ensureFolder(folderPath) {
  const segments = folderPath.split('/').filter(Boolean);
  let current = '';
  for (const seg of segments) {
    current += '/' + encodeURIComponent(seg);
    const url = `${getWebDavBase()}${current}/`;
    try {
      const check = await fetch(url, {
        method: 'PROPFIND',
        headers: {
          Authorization: getAuthHeader(),
          Depth: '0',
        },
      });

      if (check.status === 404) {
        const mk = await fetch(url, {
          method: 'MKCOL',
          headers: {
            Authorization: getAuthHeader(),
          },
        });
        if (mk.status !== 201 && mk.status !== 405) {
          throw new Error(`Gagal membuat folder "${seg}" di Nextcloud (HTTP ${mk.status})`);
        }
      }
    } catch (err) {
      console.error(`[Nextcloud WebDAV] Error saat verifikasi folder ${url}:`, err.message);
      throw err;
    }
  }
}

/**
 * Handler: Cek status koneksi Nextcloud
 */
async function handleStatus(req, res) {
  try {
    const url = `${getWebDavBase()}/${encodeURIComponent(NEXTCLOUD_DIR)}/`;
    const check = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        Authorization: getAuthHeader(),
        Depth: '0',
      },
    });

    if (check.status === 200 || check.status === 207) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          ok: true,
          user: NEXTCLOUD_USER,
          url: NEXTCLOUD_URL,
          dir: NEXTCLOUD_DIR,
        })
      );
    }

    if (check.status === 404) {
      // Jika folder utama belum ada, coba buatkan
      await ensureFolder(NEXTCLOUD_DIR);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          ok: true,
          user: NEXTCLOUD_USER,
          url: NEXTCLOUD_URL,
          dir: NEXTCLOUD_DIR,
          created: true,
        })
      );
    }

    res.writeHead(502, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        ok: false,
        error: `Nextcloud merespon status ${check.status}`,
      })
    );
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

/**
 * Handler: Upload foto JPEG ke Nextcloud
 */
async function handleUpload(req, res) {
  const folderHeader = req.headers['x-folder-path'] || '';
  const fileNameHeader = req.headers['x-file-name'] || '';
  const decodedFolder = decodeURIComponent(folderHeader);
  const decodedFileName = decodeURIComponent(fileNameHeader);

  if (!decodedFileName) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Header x-file-name wajib diisi' }));
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    try {
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Data foto kosong' }));
      }

      const fullRelativeFolder = `${NEXTCLOUD_DIR}/${decodedFolder}`
        .replace(/\/+/g, '/')
        .replace(/\/+$/, '');

      // Pastikan folder hierarki tersedia
      await ensureFolder(fullRelativeFolder);

      const segments = `${fullRelativeFolder}/${decodedFileName}`.split('/').filter(Boolean);
      const encodedPath = segments.map((s) => encodeURIComponent(s)).join('/');
      const putUrl = `${getWebDavBase()}/${encodedPath}`;

      const putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: {
          Authorization: getAuthHeader(),
          'Content-Type': req.headers['content-type'] || 'image/jpeg',
          'Content-Length': String(buffer.length),
        },
        body: buffer,
      });

      if (putRes.status === 200 || putRes.status === 201 || putRes.status === 204) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            ok: true,
            path: `${fullRelativeFolder}/${decodedFileName}`,
            url: putUrl,
            size: buffer.length,
          })
        );
      }

      const errorText = await putRes.text();
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          ok: false,
          error: `Nextcloud WebDAV error (${putRes.status}): ${errorText.slice(0, 150)}`,
        })
      );
    } catch (err) {
      console.error('[Upload error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

/**
 * Handler: Hapus foto dari Nextcloud
 */
async function handleDelete(req, res) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    try {
      const { path: filePath } = JSON.parse(body || '{}');
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Path file tidak diberikan' }));
      }

      const segments = filePath.split('/').filter(Boolean);
      const encodedPath = segments.map((s) => encodeURIComponent(s)).join('/');
      const targetUrl = `${getWebDavBase()}/${encodedPath}`;

      const delRes = await fetch(targetUrl, {
        method: 'DELETE',
        headers: {
          Authorization: getAuthHeader(),
        },
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, status: delRes.status }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

// MIME types map untuk file statis
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Penyajian file statis dengan Gzip dan SPA Fallback
 */
function serveStatic(req, res, distPath) {
  let parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);
  let filePath = path.join(distPath, pathname);

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      return sendFile(req, res, filePath);
    }
    if (!err && stats.isFile()) {
      return sendFile(req, res, filePath);
    }
    // Fallback ke index.html untuk Single Page Application routing
    const indexPath = path.join(distPath, 'index.html');
    return sendFile(req, res, indexPath);
  });
}

function sendFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  if (
    ext === '.html' ||
    filePath.endsWith('sw.js') ||
    filePath.endsWith('registerSW.js') ||
    ext === '.webmanifest'
  ) {
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
    );
  } else if (filePath.includes('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  const acceptEncoding = req.headers['accept-encoding'] || '';
  const isCompressible =
    contentType.startsWith('text/') ||
    contentType.includes('javascript') ||
    contentType.includes('json') ||
    contentType.includes('svg');

  const rawStream = fs.createReadStream(filePath);
  rawStream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
    }
  });

  if (/\bgzip\b/.test(acceptEncoding) && isCompressible) {
    res.setHeader('Content-Encoding', 'gzip');
    const gzip = zlib.createGzip({ level: 6 });
    rawStream.pipe(gzip).pipe(res);
  } else {
    rawStream.pipe(res);
  }
}

// Inisialisasi HTTP Server
const server = http.createServer((req, res) => {
  // CORS Headers untuk API lokal jika dibutuhkan
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-folder-path, x-file-name, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Routing API Nextcloud
  if (req.url === '/api/nextcloud/status') {
    return handleStatus(req, res);
  }
  if (req.url === '/api/nextcloud/upload' && req.method === 'POST') {
    return handleUpload(req, res);
  }
  if (req.url === '/api/nextcloud/delete' && req.method === 'POST') {
    return handleDelete(req, res);
  }

  // Penyajian static files & SPA
  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, DIST_DIR);
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method Not Allowed');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[FTTH Photo QC] Server berjalan di http://0.0.0.0:${PORT}`);
  console.log(
    `[FTTH Photo QC] Terhubung ke Nextcloud: ${NEXTCLOUD_URL} (User: ${NEXTCLOUD_USER}, Folder: ${NEXTCLOUD_DIR})`
  );
});
