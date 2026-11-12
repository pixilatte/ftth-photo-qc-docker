import { db } from '../db/database';
import { DocumentPage, PhotoRecord, QcDocument, SlotItem } from '../types';
import { getPhotoPathInfo } from './nextcloud';

export interface SyncStatus {
  online: boolean;
  lastSyncedAt: number | null;
  syncing: boolean;
  error?: string;
}

/**
 * Kirim/update dokumen ke server pusat
 */
export async function pushDocumentToServer(doc: QcDocument): Promise<boolean> {
  try {
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    return res.ok;
  } catch (err) {
    console.warn('[CloudSync] Gagal push dokumen ke server:', err);
    return false;
  }
}

/**
 * Hapus dokumen dari server pusat
 */
export async function deleteDocumentFromServer(docId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/documents/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (err) {
    console.warn('[CloudSync] Gagal hapus dokumen dari server:', err);
    return false;
  }
}

/**
 * Sinkronisasi daftar dokumen dua arah (Two-way sync) antara IndexedDB lokal dan Server
 */
export async function syncDocumentsWithServer(): Promise<{
  pulledCount: number;
  pushedCount: number;
}> {
  try {
    const res = await fetch('/api/documents', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Server respon HTTP ${res.status}`);
    }

    const remoteDocs: QcDocument[] = await res.json();
    const localDocs = await db.documents.toArray();

    const localMap = new Map<string, QcDocument>();
    for (const d of localDocs) {
      localMap.set(d.id, d);
    }

    const remoteMap = new Map<string, QcDocument>();
    for (const d of remoteDocs) {
      remoteMap.set(d.id, d);
    }

    let pulledCount = 0;
    let pushedCount = 0;

    // 1. Tarik dokumen dari server yang belum ada di lokal atau yang lebih baru
    for (const remote of remoteDocs) {
      const local = localMap.get(remote.id);
      if (!local) {
        await db.documents.put(remote);
        pulledCount++;
      } else if (remote.updatedAt > local.updatedAt) {
        await db.documents.put(remote);
        pulledCount++;
      } else if (local.updatedAt > remote.updatedAt) {
        // Dokumen lokal lebih baru, push ke server
        await pushDocumentToServer(local);
        pushedCount++;
      }
    }

    // 2. Kirim dokumen lokal yang belum ada di server
    for (const local of localDocs) {
      if (!remoteMap.has(local.id)) {
        await pushDocumentToServer(local);
        pushedCount++;
      }
    }

    return { pulledCount, pushedCount };
  } catch (err) {
    console.warn('[CloudSync] Sinkronisasi dokumen gagal:', err);
    return { pulledCount: 0, pushedCount: 0 };
  }
}

/**
 * Upload file foto + metadata ke server pusat
 */
export async function uploadPhotoToServer(
  record: PhotoRecord,
  doc?: QcDocument,
  page?: DocumentPage,
  slot?: SlotItem
): Promise<boolean> {
  try {
    const form = new FormData();
    form.append('id', record.id);
    form.append('documentId', record.documentId);
    form.append(
      'meta',
      JSON.stringify({
        rotation: record.rotation,
        watermarkEnabled: record.watermarkEnabled,
        watermark: record.watermark,
        width: record.width,
        height: record.height,
        nextcloudPath: record.nextcloudPath,
        nextcloudStatus: record.nextcloudStatus,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      })
    );

    form.append('rendered', record.renderedBlob, `${record.id}.jpg`);
    if (record.rawBlob) {
      form.append('raw', record.rawBlob, `${record.id}-raw.jpg`);
    }

    if (doc && page && slot) {
      const { folderPath, fileName } = getPhotoPathInfo(doc, page, slot);
      form.append('folderPath', folderPath);
      form.append('fileName', fileName);
    }

    const res = await fetch('/api/photos/upload', {
      method: 'POST',
      body: form,
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.nextcloudPath) {
        await db.photos.update(record.id, {
          nextcloudPath: data.nextcloudPath,
          nextcloudStatus: 'synced',
        });
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[CloudSync] Upload foto ke server gagal:', err);
    return false;
  }
}

/**
 * Mengambil foto dari server pusat untuk slot dokumen yang belum tersimpan di memori lokal laptop ini
 */
export async function syncDocumentPhotosFromServer(
  doc: QcDocument,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const photoIdsNeeded: string[] = [];
  for (const page of doc.pages) {
    for (const slot of page.slots) {
      if (slot.photoId) {
        photoIdsNeeded.push(slot.photoId);
      }
    }
  }

  if (photoIdsNeeded.length === 0) return 0;

  let downloadedCount = 0;
  for (let i = 0; i < photoIdsNeeded.length; i++) {
    const photoId = photoIdsNeeded[i];
    const existsLocally = await db.photos.get(photoId);

    if (!existsLocally) {
      try {
        // Ambil metadata & blob foto dari server
        const [metaRes, blobRes] = await Promise.all([
          fetch(`/api/photos/${encodeURIComponent(photoId)}/meta`),
          fetch(`/api/photos/${encodeURIComponent(photoId)}`),
        ]);

        if (metaRes.ok && blobRes.ok) {
          const meta = await metaRes.json();
          const blob = await blobRes.blob();

          const newRecord: PhotoRecord = {
            id: photoId,
            documentId: doc.id,
            rawBlob: blob,
            renderedBlob: blob,
            rotation: meta.rotation || 0,
            watermarkEnabled: Boolean(meta.watermarkEnabled),
            watermark: meta.watermark || {
              timestampText: '',
              coordText: '',
              addressLines: [],
            },
            width: meta.width || 1200,
            height: meta.height || 900,
            createdAt: meta.createdAt || Date.now(),
            updatedAt: meta.updatedAt || Date.now(),
            nextcloudPath: meta.nextcloudPath,
            nextcloudStatus: meta.nextcloudStatus || 'synced',
          };

          await db.photos.put(newRecord);
          downloadedCount++;
        }
      } catch (err) {
        console.warn(`[CloudSync] Gagal mengunduh foto ${photoId}:`, err);
      }
    }

    if (onProgress) {
      onProgress(i + 1, photoIdsNeeded.length);
    }
  }

  return downloadedCount;
}

/**
 * Sinkronisasi Pengaturan Global (Logo Vendor, Nama Proyek) dari Server
 */
export async function syncGlobalSettings(): Promise<void> {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      if (data && data.id === 'global') {
        await db.settings.put(data);
      }
    }
  } catch (err) {
    console.warn('[CloudSync] Sync settings gagal:', err);
  }
}
