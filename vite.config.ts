import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

function nextcloudDevPlugin() {
  const NEXTCLOUD_URL = (process.env.NEXTCLOUD_URL || 'https://drive.gciconnect.my.id').replace(/\/+$/, '');
  const NEXTCLOUD_USER = process.env.NEXTCLOUD_USER || 'gcibot';
  const NEXTCLOUD_PASSWORD = process.env.NEXTCLOUD_PASSWORD || 'Gcidesign#1';
  const NEXTCLOUD_DIR = (process.env.NEXTCLOUD_DIR || 'ftth-photo-qc').replace(/^\/+|\/+$/g, '');

  const authHeader = 'Basic ' + Buffer.from(`${NEXTCLOUD_USER}:${NEXTCLOUD_PASSWORD}`).toString('base64');
  const webDavBase = `${NEXTCLOUD_URL}/remote.php/dav/files/${encodeURIComponent(NEXTCLOUD_USER)}`;

  async function ensureFolder(folderPath: string) {
    const segments = folderPath.split('/').filter(Boolean);
    let current = '';
    for (const seg of segments) {
      current += '/' + encodeURIComponent(seg);
      const url = `${webDavBase}${current}/`;
      const check = await fetch(url, {
        method: 'PROPFIND',
        headers: { Authorization: authHeader, Depth: '0' },
      });
      if (check.status === 404) {
        await fetch(url, {
          method: 'MKCOL',
          headers: { Authorization: authHeader },
        });
      }
    }
  }

  return {
    name: 'nextcloud-dev-middleware',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url === '/api/nextcloud/status') {
          try {
            const check = await fetch(`${webDavBase}/${encodeURIComponent(NEXTCLOUD_DIR)}/`, {
              method: 'PROPFIND',
              headers: { Authorization: authHeader, Depth: '0' },
            });
            if (check.status === 200 || check.status === 207) {
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ ok: true, user: NEXTCLOUD_USER, dir: NEXTCLOUD_DIR }));
            }
            if (check.status === 404) {
              await ensureFolder(NEXTCLOUD_DIR);
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ ok: true, user: NEXTCLOUD_USER, dir: NEXTCLOUD_DIR }));
            }
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ ok: false, error: `HTTP ${check.status}` }));
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        }

        if (req.url === '/api/nextcloud/upload' && req.method === 'POST') {
          const folderHeader = req.headers['x-folder-path'] || '';
          const fileNameHeader = req.headers['x-file-name'] || '';
          const decodedFolder = decodeURIComponent(folderHeader);
          const decodedFileName = decodeURIComponent(fileNameHeader);
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', async () => {
            try {
              const buffer = Buffer.concat(chunks);
              const fullRelativeFolder = `${NEXTCLOUD_DIR}/${decodedFolder}`.replace(/\/+/g, '/').replace(/\/+$/, '');
              await ensureFolder(fullRelativeFolder);
              const segments = `${fullRelativeFolder}/${decodedFileName}`.split('/').filter(Boolean);
              const encodedPath = segments.map((s) => encodeURIComponent(s)).join('/');
              const putUrl = `${webDavBase}/${encodedPath}`;
              const putRes = await fetch(putUrl, {
                method: 'PUT',
                headers: {
                  Authorization: authHeader,
                  'Content-Type': req.headers['content-type'] || 'image/jpeg',
                  'Content-Length': String(buffer.length),
                },
                body: buffer,
              });
              if (putRes.status === 200 || putRes.status === 201 || putRes.status === 204) {
                res.setHeader('Content-Type', 'application/json');
                return res.end(
                  JSON.stringify({ ok: true, path: `${fullRelativeFolder}/${decodedFileName}`, url: putUrl })
                );
              }
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ ok: false, error: `Upload error (${putRes.status})` }));
            } catch (e: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ ok: false, error: e.message }));
            }
          });
          return;
        }

        if (req.url === '/api/nextcloud/delete' && req.method === 'POST') {
          let body = '';
          req.on('data', (c: any) => (body += c));
          req.on('end', async () => {
            try {
              const { path: filePath } = JSON.parse(body || '{}');
              const segments = (filePath || '').split('/').filter(Boolean);
              const encodedPath = segments.map((s: string) => encodeURIComponent(s)).join('/');
              const targetUrl = `${webDavBase}/${encodedPath}`;
              const delRes = await fetch(targetUrl, { method: 'DELETE', headers: { Authorization: authHeader } });
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ ok: true, status: delRes.status }));
            } catch (e: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ ok: false, error: e.message }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    nextcloudDevPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-icon.svg'],
      manifest: {
        name: 'FTTH Photo QC — Dokumentasi Proyek',
        short_name: 'Photo QC',
        description: 'Aplikasi pengambilan & penyusunan foto dokumentasi proyek FTTH (CW, EL, Implementasi) dengan opsi watermark timestamp & geolokasi',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          {
            src: 'pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'pdf-engine': ['jspdf'],
          'storage-zip': ['dexie', 'dexie-react-hooks', 'jszip', 'exifr']
        }
      }
    }
  }
});
