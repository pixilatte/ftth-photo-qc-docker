import { db } from '../db/database';
import { DocumentPage, PhotoRecord, QcDocument, SlotItem } from '../types';

export interface NextcloudStatusResponse {
  ok: boolean;
  user?: string;
  dir?: string;
  url?: string;
  error?: string;
}

export interface NextcloudUploadResponse {
  ok: boolean;
  path?: string;
  url?: string;
  size?: number;
  error?: string;
}

/**
 * Memeriksa status koneksi WebDAV Nextcloud melalui backend
 */
export async function checkNextcloudStatus(): Promise<NextcloudStatusResponse> {
  try {
    const res = await fetch('/api/nextcloud/status', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.error || `HTTP ${res.status}` };
    }
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || 'Gagal menghubungi server' };
  }
}

/**
 * Membersihkan nama folder / file agar aman di WebDAV / filesystem
 */
export function sanitizePathSegment(name: string): string {
  return name
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[/\\?%*:|"<>#]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
}

/**
 * Menghasilkan struktur folder dan nama file yang rapi untuk Nextcloud
 * Format: ftth-photo-qc/<Cluster / Judul Dokumen>/<Nama Halaman / FAT>/<No>_<Deskripsi>.jpg
 */
export function getPhotoPathInfo(
  doc: QcDocument,
  page: DocumentPage,
  slot: SlotItem
): { folderPath: string; fileName: string } {
  // Folder Level 1: Cluster / Dokumen
  const clusterSegments = [doc.header.clusterId, doc.header.clusterName].filter(Boolean);
  const clusterLabel = clusterSegments.length > 0 ? clusterSegments.join(' - ') : doc.title;
  const folder1 = sanitizePathSegment(clusterLabel || `Dokumen_${doc.docType}`);

  // Folder Level 2: Halaman / Device (e.g. FAT S01-A01, FDT BLA-CPU-D05, IMPLEMENTASI)
  const pageLabel = page.headerBottomText || page.headerTopText || page.preset;
  const folder2 = sanitizePathSegment(pageLabel.replace(/\n+/g, ' '));

  const folderPath = `${folder1}/${folder2}`;

  // File Name: 01_FAT_Tertutup.jpg
  const slotNum = String(slot.slotIndex + 1).padStart(2, '0');
  const desc = sanitizePathSegment(slot.description || 'Foto');
  const fileName = `${slotNum}_${desc}.jpg`;

  return { folderPath, fileName };
}

/**
 * Upload single foto (renderedBlob dengan watermark) ke Nextcloud
 */
export async function uploadPhotoRecordToNextcloud(
  record: PhotoRecord,
  folderPath: string,
  fileName: string
): Promise<NextcloudUploadResponse> {
  try {
    await db.photos.update(record.id, {
      nextcloudStatus: 'uploading',
      nextcloudError: undefined,
    });

    const res = await fetch('/api/nextcloud/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-folder-path': encodeURIComponent(folderPath),
        'x-file-name': encodeURIComponent(fileName),
      },
      body: record.renderedBlob,
    });

    const data: NextcloudUploadResponse = await res.json().catch(() => ({
      ok: false,
      error: `Server respon HTTP ${res.status}`,
    }));

    if (data.ok && data.path) {
      await db.photos.update(record.id, {
        nextcloudStatus: 'synced',
        nextcloudPath: data.path,
        nextcloudUploadedAt: Date.now(),
        nextcloudError: undefined,
      });
      return data;
    } else {
      const errMsg = data.error || `Upload gagal (HTTP ${res.status})`;
      await db.photos.update(record.id, {
        nextcloudStatus: 'failed',
        nextcloudError: errMsg,
      });
      return { ok: false, error: errMsg };
    }
  } catch (err: any) {
    const errMsg = err.message || 'Koneksi terputus saat upload';
    await db.photos.update(record.id, {
      nextcloudStatus: 'failed',
      nextcloudError: errMsg,
    });
    return { ok: false, error: errMsg };
  }
}

/**
 * Hapus foto dari Nextcloud ketika foto di slot dihapus / dibersihkan
 */
export async function deletePhotoFromNextcloud(nextcloudPath: string): Promise<boolean> {
  try {
    const res = await fetch('/api/nextcloud/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: nextcloudPath }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Sinkronisasi seluruh foto yang ada dalam satu dokumen ke Nextcloud
 */
export async function syncAllDocumentPhotosToNextcloud(
  doc: QcDocument,
  onProgress?: (done: number, total: number, currentItem: string) => void
): Promise<{ successCount: number; failCount: number; errors: string[] }> {
  // Kumpulkan semua slot yang memiliki foto
  const itemsToUpload: Array<{
    page: DocumentPage;
    slot: SlotItem;
    photoId: string;
  }> = [];

  for (const page of doc.pages) {
    for (const slot of page.slots) {
      if (slot.photoId) {
        itemsToUpload.push({ page, slot, photoId: slot.photoId });
      }
    }
  }

  let successCount = 0;
  let failCount = 0;
  const errors: string[] = [];
  const total = itemsToUpload.length;

  for (let i = 0; i < total; i++) {
    const item = itemsToUpload[i];
    const record = await db.photos.get(item.photoId);
    if (!record) continue;

    const { folderPath, fileName } = getPhotoPathInfo(doc, item.page, item.slot);
    if (onProgress) {
      onProgress(i, total, fileName);
    }

    const result = await uploadPhotoRecordToNextcloud(record, folderPath, fileName);
    if (result.ok) {
      successCount++;
    } else {
      failCount++;
      if (result.error) errors.push(`${fileName}: ${result.error}`);
    }
  }

  if (onProgress) {
    onProgress(total, total, 'Selesai');
  }

  return { successCount, failCount, errors };
}

