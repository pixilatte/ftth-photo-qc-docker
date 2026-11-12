import Dexie, { type EntityTable } from 'dexie';
import JSZip from 'jszip';
import {
  AppSettings,
  DocumentHeader,
  DocumentPage,
  DocumentType,
  GeoCacheEntry,
  PhotoRecord,
  QcDocument,
  SiteReferenceItem,
} from '../types';
import { DEFAULT_HEADER, generateId } from '../presets/documentPresets';
import {
  DEFAULT_SITE_REFERENCES,
  parseSiteListCsv,
} from '../presets/siteReferences';
import {
  deleteDocumentFromServer,
  pushDocumentToServer,
} from '../services/cloudSync';

class PhotoQcDatabase extends Dexie {
  documents!: EntityTable<QcDocument, 'id'>;
  photos!: EntityTable<PhotoRecord, 'id'>;
  geoCache!: EntityTable<GeoCacheEntry, 'gridKey'>;
  settings!: EntityTable<AppSettings, 'id'>;
  siteReferences!: EntityTable<SiteReferenceItem, 'id'>;

  constructor() {
    super('FtthPhotoQcDB');
    this.version(1).stores({
      documents: 'id, docType, updatedAt, createdAt',
      photos: 'id, documentId, createdAt',
      geoCache: 'gridKey, updatedAt',
      settings: 'id',
    });
    this.version(2).stores({
      documents: 'id, docType, updatedAt, createdAt',
      photos: 'id, documentId, createdAt',
      geoCache: 'gridKey, updatedAt',
      settings: 'id',
      siteReferences: 'id, clusterId, clusterName, fdtId, region, oltName',
    });
  }
}

export const db = new PhotoQcDatabase();

let seedingPromise: Promise<void> | null = null;

export async function ensureSiteReferencesSeeded(): Promise<void> {
  if (!seedingPromise) {
    seedingPromise = (async () => {
      const count = await db.siteReferences.count();
      if (count === 0) {
        await db.siteReferences.bulkPut(DEFAULT_SITE_REFERENCES);
      }
    })().finally(() => {
      seedingPromise = null;
    });
  }
  return seedingPromise;
}

export async function resetSiteReferencesToDefault(): Promise<number> {
  await db.transaction('rw', db.siteReferences, async () => {
    await db.siteReferences.clear();
    await db.siteReferences.bulkPut(DEFAULT_SITE_REFERENCES);
  });
  return DEFAULT_SITE_REFERENCES.length;
}

export async function importSiteReferencesFromCsvText(
  csvText: string,
  mode: 'REPLACE' | 'APPEND' = 'REPLACE'
): Promise<number> {
  const parsed = parseSiteListCsv(csvText);
  if (parsed.length === 0) {
    throw new Error('Tidak ada baris data site yang valid di dalam file CSV.');
  }
  await db.transaction('rw', db.siteReferences, async () => {
    if (mode === 'REPLACE') {
      await db.siteReferences.clear();
    }
    await db.siteReferences.bulkPut(parsed);
  });
  return parsed.length;
}

export async function addSiteReferenceItem(
  item: Omit<SiteReferenceItem, 'id'>
): Promise<SiteReferenceItem> {
  const record: SiteReferenceItem = {
    ...item,
    id: generateId(),
  };
  await db.siteReferences.put(record);
  return record;
}

export async function updateSiteReferenceItem(
  item: SiteReferenceItem
): Promise<void> {
  await db.siteReferences.put(item);
}

export async function deleteSiteReferenceItem(id: string): Promise<void> {
  await db.siteReferences.delete(id);
}


export async function getGlobalSettings(): Promise<AppSettings> {
  const existing = await db.settings.get('global');
  if (existing) return existing;
  const defaults: AppSettings = {
    id: 'global',
    defaultProjectName: DEFAULT_HEADER.projectName,
    defaultLeftLogoDataUrl: null,
    defaultRightLogoDataUrl: null,
    hideRightLogo: false,
  };
  await db.settings.put(defaults);
  return defaults;
}

export async function saveGlobalSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getGlobalSettings();
  const updated: AppSettings = { ...current, ...patch, id: 'global' };
  await db.settings.put(updated);
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updated),
  }).catch(() => {});
  return updated;
}

export async function createDocument(params: {
  title: string;
  docType: DocumentType;
  header?: Partial<DocumentHeader>;
  initialPages?: DocumentPage[];
}): Promise<QcDocument> {
  const settings = await getGlobalSettings();
  const now = Date.now();
  const doc: QcDocument = {
    id: generateId(),
    title: params.title.trim() || `Dokumen ${params.docType}`,
    docType: params.docType,
    header: {
      ...DEFAULT_HEADER,
      projectName: settings.defaultProjectName || DEFAULT_HEADER.projectName,
      customLeftLogoDataUrl: settings.defaultLeftLogoDataUrl ?? null,
      customRightLogoDataUrl: settings.defaultRightLogoDataUrl ?? null,
      hideRightLogo: settings.hideRightLogo ?? false,
      ...params.header,
    },
    pages: params.initialPages ?? [],
    defaultWatermarkOnUpload: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.documents.add(doc);
  pushDocumentToServer(doc).catch(() => {});
  return doc;
}

export async function updateDocument(
  docId: string,
  updater: (doc: QcDocument) => QcDocument
): Promise<QcDocument | undefined> {
  let result: QcDocument | undefined;
  await db.transaction('rw', db.documents, async () => {
    const existing = await db.documents.get(docId);
    if (!existing) return;
    const next = updater(existing);
    next.updatedAt = Date.now();
    await db.documents.put(next);
    result = next;
  });
  if (result) {
    pushDocumentToServer(result).catch(() => {});
  }
  return result;
}

export async function deleteDocumentCascade(docId: string): Promise<void> {
  await db.transaction('rw', db.documents, db.photos, async () => {
    await db.photos.where('documentId').equals(docId).delete();
    await db.documents.delete(docId);
  });
  deleteDocumentFromServer(docId).catch(() => {});
}

export async function deletePhotoIfUnreferenced(docId: string, photoId: string): Promise<void> {
  const doc = await db.documents.get(docId);
  if (!doc) {
    await db.photos.delete(photoId);
    return;
  }
  const stillUsed = doc.pages.some((p) => p.slots.some((s) => s.photoId === photoId));
  if (!stillUsed) {
    await db.photos.delete(photoId);
  }
}

interface ArchiveManifest {
  version: 1;
  exportedAt: number;
  document: QcDocument;
  photos: Array<{
    id: string;
    rotation: PhotoRecord['rotation'];
    watermarkEnabled: boolean;
    watermark: PhotoRecord['watermark'];
    width: number;
    height: number;
    createdAt: number;
    updatedAt: number;
  }>;
}

export async function exportDocumentToZip(docId: string): Promise<{ blob: Blob; filename: string }> {
  const doc = await db.documents.get(docId);
  if (!doc) throw new Error('Dokumen tidak ditemukan');

  const photos = await db.photos.where('documentId').equals(docId).toArray();
  const zip = new JSZip();

  const manifest: ArchiveManifest = {
    version: 1,
    exportedAt: Date.now(),
    document: doc,
    photos: photos.map((p) => ({
      id: p.id,
      rotation: p.rotation,
      watermarkEnabled: p.watermarkEnabled,
      watermark: p.watermark,
      width: p.width,
      height: p.height,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const photoFolder = zip.folder('photos');
  if (photoFolder) {
    for (const p of photos) {
      photoFolder.file(`${p.id}-raw.jpg`, p.rawBlob);
      photoFolder.file(`${p.id}-rendered.jpg`, p.renderedBlob);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const safeName = doc.title.replace(/[^a-zA-Z0-9-_ ]+/g, '').trim() || `Proyek-${doc.docType}`;
  return {
    blob,
    filename: `${safeName}.photoqc.zip`,
  };
}

export async function importDocumentFromZip(file: File): Promise<QcDocument> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('File ZIP bukan paket proyek Photo QC yang valid (manifest.json tidak ditemukan).');
  }

  const manifest: ArchiveManifest = JSON.parse(await manifestFile.async('string'));
  const newDocId = generateId();
  const photoIdMap = new Map<string, string>();

  const photoRecords: PhotoRecord[] = [];
  for (const meta of manifest.photos) {
    const rawEntry = zip.file(`photos/${meta.id}-raw.jpg`);
    const renderedEntry = zip.file(`photos/${meta.id}-rendered.jpg`);
    if (!rawEntry) continue;

    const rawBlob = await rawEntry.async('blob');
    const renderedBlob = renderedEntry ? await renderedEntry.async('blob') : rawBlob;

    const newPhotoId = generateId();
    photoIdMap.set(meta.id, newPhotoId);

    photoRecords.push({
      id: newPhotoId,
      documentId: newDocId,
      rawBlob: new Blob([rawBlob], { type: 'image/jpeg' }),
      renderedBlob: new Blob([renderedBlob], { type: 'image/jpeg' }),
      rotation: meta.rotation,
      watermarkEnabled: meta.watermarkEnabled,
      watermark: meta.watermark,
      width: meta.width,
      height: meta.height,
      createdAt: meta.createdAt,
      updatedAt: Date.now(),
    });
  }

  const now = Date.now();
  const importedDoc: QcDocument = {
    ...manifest.document,
    id: newDocId,
    pages: manifest.document.pages.map((page) => ({
      ...page,
      id: generateId(),
      slots: page.slots.map((slot) => ({
        ...slot,
        photoId: slot.photoId ? photoIdMap.get(slot.photoId) ?? null : null,
      })),
    })),
    updatedAt: now,
  };

  await db.transaction('rw', db.documents, db.photos, async () => {
    if (photoRecords.length > 0) {
      await db.photos.bulkAdd(photoRecords);
    }
    await db.documents.add(importedDoc);
  });

  return importedDoc;
}
