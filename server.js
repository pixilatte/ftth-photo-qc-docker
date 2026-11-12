import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Konfigurasi Environment & Direktori
const PORT = parseInt(process.env.PORT || '3137', 10);
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, 'data');
const DIST_DIR = path.resolve(__dirname, 'dist');
const PHOTOS_DIR = path.resolve(DATA_DIR, 'photos');

// Konfigurasi Nextcloud
const NEXTCLOUD_URL = (process.env.NEXTCLOUD_URL || 'https://drive.gciconnect.my.id').replace(/\/+$/, '');
const NEXTCLOUD_USER = process.env.NEXTCLOUD_USER || 'gcibot';
const NEXTCLOUD_PASSWORD = process.env.NEXTCLOUD_PASSWORD || 'Gcidesign#1';
const NEXTCLOUD_DIR = (process.env.NEXTCLOUD_DIR || 'ftth-photo-qc').replace(/^\/+|\/+$/g, '');

// Buat direktori data & foto jika belum ada
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

// Inisialisasi Database SQLite Server untuk Kolaborasi Multi-Device
const db = new DatabaseSync(path.resolve(DATA_DIR, 'qc.db'));
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT,
    doc_type TEXT,
    header TEXT,
    pages TEXT,
    default_watermark INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    document_id TEXT,
    rotation INTEGER DEFAULT 0,
    watermark_enabled INTEGER DEFAULT 0,
    watermark TEXT,
    width INTEGER,
    height INTEGER,
    nextcloud_path TEXT,
    nextcloud_status TEXT,
    has_rendered INTEGER DEFAULT 0,
    has_raw INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    data TEXT
  );

  CREATE TABLE IF NOT EXISTS site_references (
    id TEXT PRIMARY KEY,
    data TEXT
  );
`);

console.log(`[FTTH Photo QC] Database SQLite kolaborasi aktif di: ${path.resolve(DATA_DIR, 'qc.db')}`);

// Prepared Statements
const stmtAllDocs = db.prepare('SELECT * FROM documents ORDER BY updated_at DESC');
const stmtGetDoc = db.prepare('SELECT * FROM documents WHERE id = ?');
const stmtUpsertDoc = db.prepare(`
  INSERT INTO documents (id, title, doc_type, header, pages, default_watermark, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    doc_type = excluded.doc_type,
    header = excluded.header,
    pages = excluded.pages,
    default_watermark = excluded.default_watermark,
    updated_at = excluded.updated_at
  WHERE excluded.updated_at >= documents.updated_at
`);
const stmtDeleteDoc = db.prepare('DELETE FROM documents WHERE id = ?');

const stmtGetPhoto = db.prepare('SELECT * FROM photos WHERE id = ?');
const stmtUpsertPhoto = db.prepare(`
  INSERT INTO photos (id, document_id, rotation, watermark_enabled, watermark, width, height, nextcloud_path, nextcloud_status, has_rendered, has_raw, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    document_id = excluded.document_id,
    rotation = excluded.rotation,
    watermark_enabled = excluded.watermark_enabled,
    watermark = excluded.watermark,
    width = excluded.width,
    height = excluded.height,
    nextcloud_path = COALESCE(excluded.nextcloud_path, photos.nextcloud_path),
    nextcloud_status = COALESCE(excluded.nextcloud_status, photos.nextcloud_status),
    has_rendered = MAX(photos.has_rendered, excluded.has_rendered),
    has_raw = MAX(photos.has_raw, excluded.has_raw),
    updated_at = excluded.updated_at
`);
const stmtDeletePhoto = db.prepare('DELETE FROM photos WHERE id = ?');

const stmtGetSettings = db.prepare('SELECT data FROM settings WHERE id = ?');
const stmtUpsertSettings = db.prepare(`
  INSERT INTO settings (id, data) VALUES (?, ?)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data
`);

function getAuthHeader() {
  return 'Basic ' + Buffer.from(`${NEXTCLOUD_USER}:${NEXTCLOUD_PASSWORD}`).toString('base64');
}

function getWebDavBase() {
  return `${NEXTCLOUD_URL}/remote.php/dav/files/${encodeURIComponent(NEXTCLOUD_USER)}`;
}

/**
 * Memastikan folder WebDAV tujuan tersedia (recursive MKCOL)
 */
async function ensureNextcloudFolder(folderPath) {
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
          console.warn(`[Nextcloud MKCOL] Folder "${seg}" status ${mk.status}`);
        }
      }
    } catch (err) {
      console.warn(`[Nextcloud MKCOL Error] ${url}:`, err.message);
    }
  }
}

/**
 * Upload buffer foto ke Nextcloud
 */
async function uploadToNextcloud(folderPath, fileName, buffer) {
  try {
    const fullRelativeFolder = `${NEXTCLOUD_DIR}/${folderPath}`
      .replace(/\/+/g, '/')
      .replace(/\/+$/, '');
    await ensureNextcloudFolder(fullRelativeFolder);

    const segments = `${fullRelativeFolder}/${fileName}`.split('/').filter(Boolean);
    const encodedPath = segments.map((s) => encodeURIComponent(s)).join('/');
    const putUrl = `${getWebDavBase()}/${encodedPath}`;

    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'image/jpeg',
        'Content-Length': String(buffer.length),
      },
      body: buffer,
    });

    if (putRes.status === 200 || putRes.status === 201 || putRes.status === 204) {
      return { ok: true, path: `${fullRelativeFolder}/${fileName}` };
    }
    return { ok: false, error: `HTTP ${putRes.status}` };
  } catch (err) {
    console.warn('[Nextcloud upload error]', err.message);
    return { ok: false, error: err.message };
  }
}

// ==========================================
// Handlers API
// ==========================================

async function handleGetDocuments(req, res) {
  try {
    const rows = stmtAllDocs.all();
    const docs = rows.map((r) => ({
      id: r.id,
      title: r.title,
      docType: r.doc_type,
      header: JSON.parse(r.header || '{}'),
      pages: JSON.parse(r.pages || '[]'),
      defaultWatermarkOnUpload: Boolean(r.default_watermark),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(docs));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

async function handleGetDocumentDetail(req, res, docId) {
  try {
    const row = stmtGetDoc.get(docId);
    if (!row) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Dokumen tidak ditemukan' }));
    }
    const doc = {
      id: row.id,
      title: row.title,
      docType: row.doc_type,
      header: JSON.parse(row.header || '{}'),
      pages: JSON.parse(row.pages || '[]'),
      defaultWatermarkOnUpload: Boolean(row.default_watermark),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(doc));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

async function handleSaveDocument(req, res) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      const doc = JSON.parse(body || '{}');
      if (!doc.id || !doc.docType) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Data dokumen tidak lengkap' }));
      }

      stmtUpsertDoc.run(
        doc.id,
        doc.title || `Dokumen ${doc.docType}`,
        doc.docType,
        JSON.stringify(doc.header || {}),
        JSON.stringify(doc.pages || []),
        doc.defaultWatermarkOnUpload ? 1 : 0,
        Number(doc.createdAt || Date.now()),
        Number(doc.updatedAt || Date.now())
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: doc.id }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

async function handleDeleteDocument(req, res, docId) {
  try {
    stmtDeleteDoc.run(docId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

async function handleUploadPhoto(req, res) {
  try {
    const webReq = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: Readable.toWeb(req),
      duplex: 'half',
    });

    const formData = await webReq.formData();
    const id = formData.get('id');
    const documentId = formData.get('documentId');
    const metaStr = formData.get('meta') || '{}';
    const meta = JSON.parse(metaStr.toString());
    const renderedFile = formData.get('rendered');
    const rawFile = formData.get('raw');

    const folderPath = formData.get('folderPath')?.toString() || '';
    const fileName = formData.get('fileName')?.toString() || `${id}.jpg`;

    if (!id || !documentId || !renderedFile) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Parameter foto tidak lengkap' }));
    }

    const renderedBuffer = Buffer.from(await renderedFile.arrayBuffer());
    const renderedPath = path.resolve(PHOTOS_DIR, `${id}.jpg`);
    fs.writeFileSync(renderedPath, renderedBuffer);

    let hasRaw = 0;
    if (rawFile && typeof rawFile.arrayBuffer === 'function') {
      const rawBuffer = Buffer.from(await rawFile.arrayBuffer());
      fs.writeFileSync(path.resolve(PHOTOS_DIR, `${id}-raw.jpg`), rawBuffer);
      hasRaw = 1;
    }

    // Simpan metadata ke SQLite
    stmtUpsertPhoto.run(
      id,
      documentId,
      Number(meta.rotation || 0),
      meta.watermarkEnabled ? 1 : 0,
      JSON.stringify(meta.watermark || {}),
      Number(meta.width || 0),
      meta.nextcloudPath || null,
      meta.nextcloudStatus || 'synced',
      1,
      hasRaw,
      Number(meta.createdAt || Date.now()),
      Number(meta.updatedAt || Date.now())
    );

    // Upload ke Nextcloud di latar belakang
    let nextcloudPath = meta.nextcloudPath || null;
    if (folderPath && fileName) {
      uploadToNextcloud(folderPath, fileName, renderedBuffer).then((ncRes) => {
        if (ncRes.ok && ncRes.path) {
          try {
            stmtUpsertPhoto.run(
              id,
              documentId,
              Number(meta.rotation || 0),
              meta.watermarkEnabled ? 1 : 0,
              JSON.stringify(meta.watermark || {}),
              Number(meta.width || 0),
              ncRes.path,
              'synced',
              1,
              hasRaw,
              Number(meta.createdAt || Date.now()),
              Date.now()
            );
          } catch (e) {
            console.warn('[Nextcloud update error]', e.message);
          }
        }
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        id,
        path: `/api/photos/${id}`,
        nextcloudPath,
      })
    );
  } catch (err) {
    console.error('[handleUploadPhoto error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

async function handleGetPhotoFile(req, res, photoId, isRaw = false) {
  const filename = isRaw ? `${photoId}-raw.jpg` : `${photoId}.jpg`;
  const filePath = path.resolve(PHOTOS_DIR, filename);

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const stream = fs.createReadStream(filePath);
    return stream.pipe(res);
  }

  // Jika foto belum ada di disk server, coba ambil dari Nextcloud jika punya path
  try {
    const photoRow = stmtGetPhoto.get(photoId);
    if (photoRow && photoRow.nextcloud_path) {
      const segments = photoRow.nextcloud_path.split('/').filter(Boolean);
      const encodedPath = segments.map((s) => encodeURIComponent(s)).join('/');
      const ncUrl = `${getWebDavBase()}/${encodedPath}`;

      const ncRes = await fetch(ncUrl, {
        headers: { Authorization: getAuthHeader() },
      });

      if (ncRes.ok) {
        const buffer = Buffer.from(await ncRes.arrayBuffer());
        fs.writeFileSync(filePath, buffer);
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.end(buffer);
      }
    }
  } catch (e) {
    console.warn('[Fetch from Nextcloud failed]', e.message);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Foto tidak ditemukan');
}

async function handleGetPhotoMeta(req, res, photoId) {
  try {
    const row = stmtGetPhoto.get(photoId);
    if (!row) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Foto tidak ditemukan' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: row.id,
        documentId: row.document_id,
        rotation: Number(row.rotation || 0),
        watermarkEnabled: Boolean(row.watermark_enabled),
        watermark: JSON.parse(row.watermark || '{}'),
        width: Number(row.width || 0),
        height: Number(row.height || 0),
        nextcloudPath: row.nextcloud_path,
        nextcloudStatus: row.nextcloud_status || 'synced',
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      })
    );
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

async function handleGetSettings(req, res) {
  try {
    const row = stmtGetSettings.get('global');
    if (row && row.data) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(row.data);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'global' }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

async function handleSaveSettings(req, res) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      stmtUpsertSettings.run('global', body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

// Nextcloud Direct API Handlers
async function handleNextcloudStatus(req, res) {
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
      await ensureNextcloudFolder(NEXTCLOUD_DIR);
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

async function handleNextcloudUpload(req, res) {
  const folderHeader = req.headers['x-folder-path'] || '';
  const fileNameHeader = req.headers['x-file-name'] || '';
  let decodedFolder = '';
  let decodedFileName = '';
  try {
    decodedFolder = decodeURIComponent(folderHeader);
  } catch {
    decodedFolder = folderHeader;
  }
  try {
    decodedFileName = decodeURIComponent(fileNameHeader);
  } catch {
    decodedFileName = fileNameHeader;
  }

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

      const result = await uploadToNextcloud(decodedFolder, decodedFileName, buffer);
      if (result.ok) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            ok: true,
            path: result.path,
          })
        );
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            ok: false,
            error: result.error || 'Gagal upload ke Nextcloud',
          })
        );
      }
    } catch (err) {
      console.error('[handleNextcloudUpload error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

async function handleNextcloudDelete(req, res) {
  let body = '';
  req.on('data', (c) => (body += c));
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

// Inisialisasi HTTP Server Utama
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE, PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-folder-path, x-file-name, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Documents API
  if (pathname === '/api/documents' && req.method === 'GET') {
    return handleGetDocuments(req, res);
  }
  if (pathname === '/api/documents' && req.method === 'POST') {
    return handleSaveDocument(req, res);
  }
  if (pathname.startsWith('/api/documents/') && req.method === 'GET') {
    const docId = decodeURIComponent(pathname.slice('/api/documents/'.length));
    return handleGetDocumentDetail(req, res, docId);
  }
  if (pathname.startsWith('/api/documents/') && req.method === 'DELETE') {
    const docId = decodeURIComponent(pathname.slice('/api/documents/'.length));
    return handleDeleteDocument(req, res, docId);
  }

  // Photos API
  if (pathname === '/api/photos/upload' && req.method === 'POST') {
    return handleUploadPhoto(req, res);
  }
  if (pathname.startsWith('/api/photos/') && pathname.endsWith('/meta') && req.method === 'GET') {
    const photoId = decodeURIComponent(pathname.replace('/api/photos/', '').replace('/meta', ''));
    return handleGetPhotoMeta(req, res, photoId);
  }
  if (pathname.startsWith('/api/photos/') && pathname.endsWith('/raw') && req.method === 'GET') {
    const photoId = decodeURIComponent(pathname.replace('/api/photos/', '').replace('/raw', ''));
    return handleGetPhotoFile(req, res, photoId, true);
  }
  if (pathname.startsWith('/api/photos/') && req.method === 'GET') {
    const photoId = decodeURIComponent(pathname.slice('/api/photos/'.length));
    return handleGetPhotoFile(req, res, photoId, false);
  }

  // Settings API
  if (pathname === '/api/settings' && req.method === 'GET') {
    return handleGetSettings(req, res);
  }
  if (pathname === '/api/settings' && req.method === 'POST') {
    return handleSaveSettings(req, res);
  }

  // Nextcloud Direct API
  if (pathname === '/api/nextcloud/status' && req.method === 'GET') {
    return handleNextcloudStatus(req, res);
  }
  if (pathname === '/api/nextcloud/upload' && req.method === 'POST') {
    return handleNextcloudUpload(req, res);
  }
  if (pathname === '/api/nextcloud/delete' && req.method === 'POST') {
    return handleNextcloudDelete(req, res);
  }

  // Frontend SPA Static Files
  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, DIST_DIR);
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method Not Allowed');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[FTTH Photo QC] Server kolaborasi berjalan di port ${PORT}`);
});
