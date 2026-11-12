import React, { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  Building2,
  Camera,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudOff,
  Copy,
  Database,
  Edit3,
  FileDown,
  FolderUp,
  HelpCircle,
  ListFilter,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { DEFAULT_MORA_LOGO, DEFAULT_ZTE_LOGO } from '../assets/defaultLogos';
import {
  db,
  deletePhotoIfUnreferenced,
  ensureSiteReferencesSeeded,
  exportDocumentToZip,
  updateDocument,
} from '../db/database';
import {
  buildHeaderTitle,
  DOCUMENT_TYPES,
  generateId,
  getPageDisplayName,
} from '../presets/documentPresets';
import {
  buildSiteReferenceLookups,
  DEFAULT_SITE_REFERENCES,
} from '../presets/siteReferences';
import {
  createPhotoFromCamera,
  createPhotoFromUpload,
  rotatePhotoRecord,
  updatePhotoWatermark,
} from '../services/photoManager';
import {
  deletePhotoFromNextcloud,
  getPhotoPathInfo,
  syncAllDocumentPhotosToNextcloud,
  uploadPhotoRecordToNextcloud,
} from '../services/nextcloud';
import {
  syncDocumentPhotosFromServer,
  syncDocumentsWithServer,
  uploadPhotoToServer,
} from '../services/cloudSync';
import {
  DocumentHeader,
  DocumentPage,
  PhotoRecord,
  QcDocument,
  WatermarkData,
} from '../types';
import { AddPageModal } from './AddPageModal';
import { BulkUploadModal } from './BulkUploadModal';
import { ExportPdfModal } from './ExportPdfModal';
import { GuidedCameraModal } from './GuidedCameraModal';
import { HelpGuideModal } from './HelpGuideModal';
import { PhotoPreviewModal } from './PhotoPreviewModal';
import { PhotoSlotCard } from './PhotoSlotCard';
import { SiteReferenceModal } from './SiteReferenceModal';
import { VendorSettingsModal } from './VendorSettingsModal';
import { WatermarkEditorModal } from './WatermarkEditorModal';

interface DocumentEditorProps {
  documentId: string;
  onBack: () => void;
}

export const DocumentEditor: React.FC<DocumentEditorProps> = ({
  documentId,
  onBack,
}) => {
  const doc = useLiveQuery(() => db.documents.get(documentId), [documentId]);
  const photos = useLiveQuery(
    () => db.photos.where('documentId').equals(documentId).toArray(),
    [documentId],
    [] as PhotoRecord[]
  );
  const dbSites = useLiveQuery(
    () => db.siteReferences.toArray(),
    [],
    DEFAULT_SITE_REFERENCES
  );
  const siteLookups = buildSiteReferenceLookups(
    dbSites.length > 0 ? dbSites : DEFAULT_SITE_REFERENCES
  );

  const [activePageIdx, setActivePageIdx] = useState<number>(0);
  const [headerExpanded, setHeaderExpanded] = useState<boolean>(false);
  const [manualHeaderInput, setManualHeaderInput] = useState<boolean>(false);
  const [swapSourceSlot, setSwapSourceSlot] = useState<number | null>(null);
  const [busySlots, setBusySlots] = useState<Record<string, boolean>>({});

  // Modals state
  const [showAddPage, setShowAddPage] = useState<boolean>(false);
  const [showBulkUpload, setShowBulkUpload] = useState<boolean>(false);
  const [showExportPdf, setShowExportPdf] = useState<boolean>(false);
  const [showVendorModal, setShowVendorModal] = useState<boolean>(false);
  const [showSiteModal, setShowSiteModal] = useState<boolean>(false);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [cameraModalSlot, setCameraModalSlot] = useState<number | null>(null);
  const [previewSlotIdx, setPreviewSlotIdx] = useState<number | null>(null);
  const [watermarkSlotIdx, setWatermarkSlotIdx] = useState<number | null>(null);
  const [zipExporting, setZipExporting] = useState<boolean>(false);
  const [nextcloudSyncing, setNextcloudSyncing] = useState<boolean>(false);
  const [nextcloudSyncProgress, setNextcloudSyncProgress] = useState<string>('');

  const pageMultiUploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ensureSiteReferencesSeeded();
  }, []);

  useEffect(() => {
    setSwapSourceSlot(null);
  }, [activePageIdx]);

  useEffect(() => {
    if (!doc) return;
    syncDocumentPhotosFromServer(doc);
    const interval = setInterval(() => {
      syncDocumentsWithServer();
      syncDocumentPhotosFromServer(doc);
    }, 7000);
    return () => clearInterval(interval);
  }, [doc?.id]);

  if (!doc) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Memuat dokumen...
      </div>
    );
  }

  const photoMap = new Map<string, PhotoRecord>();
  for (const p of photos) {
    photoMap.set(p.id, p);
  }

  const safePageIdx = Math.min(activePageIdx, Math.max(0, doc.pages.length - 1));
  const activePage: DocumentPage | undefined = doc.pages[safePageIdx];

  const handlePatchHeader = async (patch: Partial<DocumentHeader>) => {
    await updateDocument(doc.id, (curr) => ({
      ...curr,
      header: { ...curr.header, ...patch },
    }));
  };

  const handleUpdateTitle = async (newTitle: string) => {
    await updateDocument(doc.id, (curr) => ({
      ...curr,
      title: newTitle,
    }));
  };

  const handleToggleDefaultWatermark = async () => {
    await updateDocument(doc.id, (curr) => ({
      ...curr,
      defaultWatermarkOnUpload: !curr.defaultWatermarkOnUpload,
    }));
  };

  const handleAddPages = async (newPages: DocumentPage[]) => {
    if (newPages.length === 0) return;
    const prevCount = doc.pages.length;
    await updateDocument(doc.id, (curr) => ({
      ...curr,
      pages: [...curr.pages, ...newPages],
    }));
    setActivePageIdx(prevCount);
  };

  const handleMovePage = async (idx: number, direction: -1 | 1) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= doc.pages.length) return;
    await updateDocument(doc.id, (curr) => {
      const arr = [...curr.pages];
      const [moved] = arr.splice(idx, 1);
      arr.splice(targetIdx, 0, moved);
      return { ...curr, pages: arr };
    });
    setActivePageIdx(targetIdx);
  };

  const handleDuplicatePage = async (idx: number) => {
    const src = doc.pages[idx];
    if (!src) return;
    const copy: DocumentPage = {
      ...src,
      id: generateId(),
      slots: src.slots.map((s) => ({ ...s, photoId: null })),
    };
    await updateDocument(doc.id, (curr) => {
      const arr = [...curr.pages];
      arr.splice(idx + 1, 0, copy);
      return { ...curr, pages: arr };
    });
    setActivePageIdx(idx + 1);
  };

  const handleDeletePage = async (idx: number) => {
    if (doc.pages.length <= 1) {
      alert('Dokumen minimal harus memiliki 1 halaman.');
      return;
    }
    const target = doc.pages[idx];
    if (!confirm(`Hapus halaman "${getPageDisplayName(target, idx)}" beserta fotonya?`)) {
      return;
    }
    const removedPhotoIds = target.slots
      .map((s) => s.photoId)
      .filter((id): id is string => Boolean(id));

    await updateDocument(doc.id, (curr) => ({
      ...curr,
      pages: curr.pages.filter((_, i) => i !== idx),
    }));

    for (const pid of removedPhotoIds) {
      await deletePhotoIfUnreferenced(doc.id, pid);
    }

    if (safePageIdx >= doc.pages.length - 1) {
      setActivePageIdx(Math.max(0, doc.pages.length - 2));
    }
  };

  const handleUpdatePageText = async (
    pageId: string,
    patch: Partial<Pick<DocumentPage, 'headerTopText' | 'headerBottomText'>>
  ) => {
    await updateDocument(doc.id, (curr) => ({
      ...curr,
      pages: curr.pages.map((p) => (p.id === pageId ? { ...p, ...patch } : p)),
    }));
  };

  const handleChangeSlotDescription = async (slotIndex: number, newDesc: string) => {
    if (!activePage) return;
    const pageId = activePage.id;
    await updateDocument(doc.id, (curr) => ({
      ...curr,
      pages: curr.pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              slots: p.slots.map((s) =>
                s.slotIndex === slotIndex ? { ...s, description: newDesc } : s
              ),
            }
          : p
      ),
    }));
  };

  const markSlotBusy = (pageId: string, slotIdx: number, isBusy: boolean) => {
    const key = `${pageId}:${slotIdx}`;
    setBusySlots((prev) => ({ ...prev, [key]: isBusy }));
  };

  // Capture photo from Guided Camera
  const handleCameraCapture = async (
    slotIndex: number,
    captureBlob: Blob,
    watermark: WatermarkData
  ) => {
    if (!activePage) return;
    const pageId = activePage.id;
    markSlotBusy(pageId, slotIndex, true);
    try {
      const oldPhotoId = activePage.slots[slotIndex]?.photoId;
      const record = await createPhotoFromCamera({
        documentId: doc.id,
        captureBlob,
        watermarkEnabled: doc.defaultWatermarkOnUpload,
        watermarkData: watermark,
        fallbackHeader: doc.header,
      });

      await updateDocument(doc.id, (curr) => ({
        ...curr,
        pages: curr.pages.map((p) =>
          p.id === pageId
            ? {
                ...p,
                slots: p.slots.map((s) =>
                  s.slotIndex === slotIndex ? { ...s, photoId: record.id } : s
                ),
              }
            : p
        ),
      }));

      if (oldPhotoId) {
        await deletePhotoIfUnreferenced(doc.id, oldPhotoId);
      }

      // Auto upload ke server kolaborasi & Nextcloud di background
      const targetSlot = activePage.slots[slotIndex];
      if (targetSlot) {
        uploadPhotoToServer(record, doc, activePage, targetSlot).catch(() => {});
        const { folderPath, fileName } = getPhotoPathInfo(doc, activePage, targetSlot);
        uploadPhotoRecordToNextcloud(record, folderPath, fileName).catch((err) =>
          console.warn('Nextcloud background upload:', err)
        );
      }
    } finally {
      markSlotBusy(pageId, slotIndex, false);
    }
  };

  // Upload 1 or multiple files starting from a slot (or filling empty slots across active page)
  const handleUploadFilesToPage = async (
    startSlotIdx: number | 'FIRST_EMPTY',
    fileList: FileList
  ) => {
    if (!activePage) return;
    const pageId = activePage.id;
    const files = Array.from(fileList)
      .filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    if (files.length === 0) return;

    // Determine target slot indices on activePage
    const targetIndices: number[] = [];
    if (startSlotIdx === 'FIRST_EMPTY') {
      // Fill empty slots first, then overwrite remaining if more files selected
      for (const s of activePage.slots) {
        if (!s.photoId) targetIndices.push(s.slotIndex);
      }
      if (targetIndices.length === 0) {
        for (const s of activePage.slots) targetIndices.push(s.slotIndex);
      }
    } else if (files.length === 1) {
      targetIndices.push(startSlotIdx);
    } else {
      // Multiple files dropped/selected on a specific slot -> fill sequentially from startSlotIdx
      for (let i = startSlotIdx; i < activePage.slots.length; i++) {
        targetIndices.push(i);
      }
    }

    const pairsCount = Math.min(files.length, targetIndices.length);
    for (let i = 0; i < pairsCount; i++) {
      const slotIdx = targetIndices[i];
      markSlotBusy(pageId, slotIdx, true);
    }

    try {
      for (let i = 0; i < pairsCount; i++) {
        const slotIdx = targetIndices[i];
        const file = files[i];
        const oldPhotoId = activePage.slots[slotIdx]?.photoId;

        const record = await createPhotoFromUpload({
          documentId: doc.id,
          file,
          watermarkEnabled: doc.defaultWatermarkOnUpload,
          fallbackHeader: doc.header,
        });

        await updateDocument(doc.id, (curr) => ({
          ...curr,
          pages: curr.pages.map((p) =>
            p.id === pageId
              ? {
                  ...p,
                  slots: p.slots.map((s) =>
                    s.slotIndex === slotIdx ? { ...s, photoId: record.id } : s
                  ),
                }
              : p
          ),
        }));

        if (oldPhotoId) {
          await deletePhotoIfUnreferenced(doc.id, oldPhotoId);
        }

        // Auto upload ke server kolaborasi & Nextcloud di background
        const targetSlot = activePage.slots[slotIdx];
        if (targetSlot) {
          uploadPhotoToServer(record, doc, activePage, targetSlot).catch(() => {});
          const { folderPath, fileName } = getPhotoPathInfo(doc, activePage, targetSlot);
          uploadPhotoRecordToNextcloud(record, folderPath, fileName).catch((err) =>
            console.warn('Nextcloud background upload:', err)
          );
        }

        markSlotBusy(pageId, slotIdx, false);
      }
    } finally {
      for (let i = 0; i < pairsCount; i++) {
        markSlotBusy(pageId, targetIndices[i], false);
      }
    }
  };

  const handleSwapSlots = async (fromIdx: number, toIdx: number) => {
    if (!activePage || fromIdx === toIdx) return;
    const pageId = activePage.id;
    await updateDocument(doc.id, (curr) => ({
      ...curr,
      pages: curr.pages.map((p) => {
        if (p.id !== pageId) return p;
        const nextSlots = p.slots.map((s) => ({ ...s }));
        const temp = nextSlots[fromIdx].photoId;
        nextSlots[fromIdx].photoId = nextSlots[toIdx].photoId;
        nextSlots[toIdx].photoId = temp;
        return { ...p, slots: nextSlots };
      }),
    }));
    setSwapSourceSlot(null);
  };

  const handleTapSwap = (slotIdx: number) => {
    if (swapSourceSlot === null) {
      setSwapSourceSlot(slotIdx);
    } else if (swapSourceSlot === slotIdx) {
      setSwapSourceSlot(null);
    } else {
      handleSwapSlots(swapSourceSlot, slotIdx);
    }
  };

  const handleRotateSlot = async (slotIdx: number) => {
    if (!activePage) return;
    const pid = activePage.slots[slotIdx]?.photoId;
    if (!pid) return;
    markSlotBusy(activePage.id, slotIdx, true);
    try {
      const updated = await rotatePhotoRecord(pid);
      if (updated) {
        const slot = activePage.slots[slotIdx];
        if (slot) {
          uploadPhotoToServer(updated, doc, activePage, slot).catch(() => {});
          const { folderPath, fileName } = getPhotoPathInfo(doc, activePage, slot);
          uploadPhotoRecordToNextcloud(updated, folderPath, fileName).catch(() => {});
        }
      }
    } finally {
      markSlotBusy(activePage.id, slotIdx, false);
    }
  };

  const handleRemoveSlotPhoto = async (slotIdx: number) => {
    if (!activePage) return;
    const pageId = activePage.id;
    const oldPhotoId = activePage.slots[slotIdx]?.photoId;
    if (!oldPhotoId) return;

    // Hapus file di Nextcloud jika ada path tersimpan
    const oldPhoto = photoMap.get(oldPhotoId);
    if (oldPhoto?.nextcloudPath) {
      deletePhotoFromNextcloud(oldPhoto.nextcloudPath).catch(() => {});
    }

    await updateDocument(doc.id, (curr) => ({
      ...curr,
      pages: curr.pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              slots: p.slots.map((s) =>
                s.slotIndex === slotIdx ? { ...s, photoId: null } : s
              ),
            }
          : p
      ),
    }));
    await deletePhotoIfUnreferenced(doc.id, oldPhotoId);
  };

  const handleExportZip = async () => {
    setZipExporting(true);
    try {
      const { blob, filename } = await exportDocumentToZip(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setZipExporting(false);
    }
  };

  const handleSyncNextcloud = async () => {
    if (!doc || nextcloudSyncing) return;
    setNextcloudSyncing(true);
    setNextcloudSyncProgress('0%');
    try {
      const res = await syncAllDocumentPhotosToNextcloud(doc, (done, total) => {
        setNextcloudSyncProgress(`${done}/${total}`);
      });
      if (res.failCount > 0) {
        const detail = res.errors.length > 0 ? `\n\nDetail:\n${res.errors.slice(0, 5).join('\n')}` : '';
        alert(`Sinkronisasi selesai: ${res.successCount} berhasil diupload, ${res.failCount} gagal.${detail}`);
      } else {
        alert(`Berhasil! Seluruh foto (${res.successCount}) telah terupload ke Nextcloud.`);
      }
    } catch (err: any) {
      alert(`Gagal sinkronisasi ke Nextcloud: ${err.message}`);
    } finally {
      setNextcloudSyncing(false);
      setNextcloudSyncProgress('');
    }
  };

  const openGuidedCameraForPage = () => {
    if (!activePage) return;
    const firstEmpty = activePage.slots.find((s) => !s.photoId);
    setCameraModalSlot(firstEmpty ? firstEmpty.slotIndex : 0);
  };

  const previewSlot =
    previewSlotIdx !== null && activePage ? activePage.slots[previewSlotIdx] : null;
  const previewRecord =
    previewSlot?.photoId ? photoMap.get(previewSlot.photoId) : undefined;

  const watermarkSlot =
    watermarkSlotIdx !== null && activePage ? activePage.slots[watermarkSlotIdx] : null;
  const watermarkRecord =
    watermarkSlot?.photoId ? photoMap.get(watermarkSlot.photoId) : undefined;

  const docMeta = DOCUMENT_TYPES[doc.docType];
  const docHeaderTitle = buildHeaderTitle(doc.docType, doc.header);
  const totalSlotsCount = doc.pages.reduce((s, p) => s + p.slots.length, 0);
  const totalFilledCount = doc.pages.reduce(
    (s, p) => s + p.slots.filter((sl) => Boolean(sl.photoId)).length,
    0
  );
  const syncedPhotosCount = photos.filter((p) => p.nextcloudStatus === 'synced').length;
  const pendingNextcloudCount = Math.max(0, totalFilledCount - syncedPhotosCount);
  const allNextcloudSynced = totalFilledCount > 0 && pendingNextcloudCount === 0;

  return (
    <div className="min-h-screen flex flex-col bg-slate-100">
      {/* Top Sticky Header Bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-2xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={onBack}
              className="rounded-xl border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 shrink-0"
              title="Kembali ke Daftar Dokumen"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${docMeta.badgeColor}`}
                >
                  {docMeta.shortLabel}
                </span>
                <input
                  type="text"
                  value={doc.title}
                  onChange={(e) => handleUpdateTitle(e.target.value)}
                  className="font-bold text-sm sm:text-base text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-600 focus:outline-none truncate w-full max-w-xs sm:max-w-md"
                />
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                {doc.header.clusterId || `${doc.docType === 'CW_SF' ? 'Subfeeder ID' : 'Cluster ID'} belum diisi`} •{' '}
                {doc.header.clusterName || `Nama ${doc.docType === 'CW_SF' ? 'Subfeeder' : 'Cluster'}`} • Terisi {totalFilledCount}/
                {totalSlotsCount} foto
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              title="Panduan Penggunaan Aplikasi"
            >
              <HelpCircle className="w-4 h-4 text-blue-600" />
              <span className="hidden md:inline">Panduan</span>
            </button>

            <button
              type="button"
              onClick={() => setShowVendorModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              title="Atur Logo & Nama Proyek"
            >
              <Building2 className="w-4 h-4 text-slate-600" />
              <span className="hidden md:inline">Logo</span>
            </button>

            <button
              type="button"
              disabled={zipExporting}
              onClick={handleExportZip}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="Simpan paket proyek (.zip) untuk pindah HP/Laptop"
            >
              <Archive className="w-4 h-4 text-slate-600" />
              <span className="hidden sm:inline">
                {zipExporting ? 'Membuat ZIP...' : 'Backup .ZIP'}
              </span>
            </button>

            <button
              type="button"
              disabled={nextcloudSyncing || totalFilledCount === 0}
              onClick={handleSyncNextcloud}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-semibold shadow-xs transition active:scale-95 disabled:opacity-50 ${
                allNextcloudSynced
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}
              title="Upload & sinkronisasi seluruh foto dokumen ke folder Nextcloud"
            >
              {nextcloudSyncing ? (
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              ) : allNextcloudSynced ? (
                <Cloud className="w-4 h-4 text-emerald-600" />
              ) : (
                <CloudOff className="w-4 h-4 text-blue-600" />
              )}
              <span className="hidden sm:inline">
                {nextcloudSyncing
                  ? `Sync (${nextcloudSyncProgress})...`
                  : allNextcloudSynced
                    ? `Nextcloud (${totalFilledCount})`
                    : `Sync Nextcloud (${pendingNextcloudCount})`}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowExportPdf(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 active:scale-95 transition"
            >
              <FileDown className="w-4 h-4" />
              <span>Preview & Export PDF</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="max-w-7xl w-full mx-auto px-3 sm:px-5 py-4 space-y-4 flex-1">
        {/* Collapsible Header Metadata Card */}
        <div className="rounded-2xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
          <button
            type="button"
            onClick={() => setHeaderExpanded((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition text-left"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2 py-1 bg-white shrink-0">
                <img
                  src={doc.header.customLeftLogoDataUrl || DEFAULT_ZTE_LOGO}
                  alt="Logo 1"
                  className="h-4 object-contain"
                />
                {!doc.header.hideRightLogo && (
                  <img
                    src={doc.header.customRightLogoDataUrl || DEFAULT_MORA_LOGO}
                    alt="Logo 2"
                    className="h-4 object-contain"
                  />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900 truncate">
                {docHeaderTitle}
              </div>
              <div className="text-[11px] text-slate-500">
                Klik untuk {headerExpanded ? 'menyembunyikan' : 'mengubah'} data Region, OLT,
                Cluster Name & Cluster ID
              </div>
              </div>
            </div>
            {headerExpanded ? (
              <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
            )}
          </button>

          {headerExpanded && (
            <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Pilih dari Dropdown Sitelist atau Ketik Manual
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setManualHeaderInput((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {manualHeaderInput ? (
                      <>
                        <ListFilter className="w-3.5 h-3.5 text-blue-600" />
                        Mode Dropdown
                      </>
                    ) : (
                      <>
                        <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                        Ketik Manual
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSiteModal(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                  >
                    <Database className="w-3.5 h-3.5" />
                    Tabel Referensi Site
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Judul Header
                  </label>
                  <input
                    type="text"
                    value={doc.header.headerTitle ?? ''}
                    onChange={(e) => handlePatchHeader({ headerTitle: e.target.value })}
                    placeholder="Kosong = otomatis dari Region / OLT / Cluster"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Region
                  </label>
                  {!manualHeaderInput && siteLookups.regions.length > 0 ? (
                    <select
                      value={doc.header.region}
                      onChange={(e) => handlePatchHeader({ region: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold focus:border-blue-600 focus:outline-none"
                    >
                      <option value="">-- Pilih Region --</option>
                      {siteLookups.regions.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                      {doc.header.region && !siteLookups.regions.includes(doc.header.region) && (
                        <option value={doc.header.region}>{doc.header.region}</option>
                      )}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={doc.header.region}
                      onChange={(e) => handlePatchHeader({ region: e.target.value })}
                      placeholder="BLORA"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold focus:border-blue-600 focus:outline-none"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    OLT Name
                  </label>
                  {!manualHeaderInput && siteLookups.oltNames.length > 0 ? (
                    <select
                      value={doc.header.oltName}
                      onChange={(e) => handlePatchHeader({ oltName: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold focus:border-blue-600 focus:outline-none"
                    >
                      <option value="">-- Pilih OLT --</option>
                      {siteLookups.oltNames.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                      {doc.header.oltName && !siteLookups.oltNames.includes(doc.header.oltName) && (
                        <option value={doc.header.oltName}>{doc.header.oltName}</option>
                      )}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={doc.header.oltName}
                      onChange={(e) => handlePatchHeader({ oltName: e.target.value })}
                      placeholder="BALUN / CEPU"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold focus:border-blue-600 focus:outline-none"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Cluster Name
                  </label>
                  {!manualHeaderInput && siteLookups.clustersByName.length > 0 ? (
                    <select
                      value={doc.header.clusterName}
                      onChange={(e) => {
                        const val = e.target.value;
                        const found = siteLookups.clusters.find((c) => c.clusterName === val);
                        handlePatchHeader({
                          clusterName: val,
                          ...(found
                            ? {
                                clusterId: found.clusterId,
                                region: found.region || doc.header.region,
                                oltName: found.oltName || doc.header.oltName,
                              }
                            : {}),
                        });
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold focus:border-blue-600 focus:outline-none"
                    >
                      <option value="">-- Pilih Cluster Name --</option>
                      {siteLookups.clustersByName.map((c) => (
                        <option key={`${c.clusterId}-${c.clusterName}`} value={c.clusterName}>
                          {c.clusterName} ({c.clusterId})
                        </option>
                      ))}
                      {doc.header.clusterName &&
                        !siteLookups.clustersByName.some(
                          (c) => c.clusterName === doc.header.clusterName
                        ) && (
                          <option value={doc.header.clusterName}>{doc.header.clusterName}</option>
                        )}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={doc.header.clusterName}
                      onChange={(e) => handlePatchHeader({ clusterName: e.target.value })}
                      placeholder="KELURAHAN KAPUAN BLORA"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold focus:border-blue-600 focus:outline-none"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Cluster ID
                  </label>
                  {!manualHeaderInput && siteLookups.clusters.length > 0 ? (
                    <select
                      value={doc.header.clusterId}
                      onChange={(e) => {
                        const val = e.target.value;
                        const found = siteLookups.clusters.find((c) => c.clusterId === val);
                        handlePatchHeader({
                          clusterId: val,
                          ...(found
                            ? {
                                clusterName: found.clusterName,
                                region: found.region || doc.header.region,
                                oltName: found.oltName || doc.header.oltName,
                              }
                            : {}),
                        });
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold focus:border-blue-600 focus:outline-none"
                    >
                      <option value="">-- Pilih Cluster ID --</option>
                      {siteLookups.clusters.map((c) => (
                        <option key={`${c.clusterId}-${c.clusterName}`} value={c.clusterId}>
                          {c.clusterId} — {c.clusterName}
                        </option>
                      ))}
                      {doc.header.clusterId &&
                        !siteLookups.clusters.some(
                          (c) => c.clusterId === doc.header.clusterId
                        ) && <option value={doc.header.clusterId}>{doc.header.clusterId}</option>}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={doc.header.clusterId}
                      onChange={(e) => handlePatchHeader({ clusterId: e.target.value })}
                      placeholder="CLRM07-99-021"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold focus:border-blue-600 focus:outline-none"
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Workspace Split: Left Page List (Desktop) / Horizontal Pills (Mobile) + Right Active Page */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Pages Navigation Panel */}
          <aside className="lg:col-span-3 rounded-2xl bg-white border border-slate-200 p-3 shadow-2xs lg:sticky lg:top-20 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Daftar Halaman ({doc.pages.length})
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowBulkUpload(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
                  title="Upload puluhan foto & otomatis buat halaman"
                >
                  <FolderUp className="w-3.5 h-3.5" />
                  Massal
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddPage(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-blue-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Halaman
                </button>
              </div>
            </div>

            <div className="flex lg:flex-col gap-1.5 overflow-x-auto lg:max-h-[65vh] lg:overflow-y-auto pb-1 lg:pb-0">
              {doc.pages.map((p, idx) => {
                const isSelected = idx === safePageIdx;
                const filled = p.slots.filter((s) => Boolean(s.photoId)).length;
                const complete = filled === p.slots.length;

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActivePageIdx(idx)}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left shrink-0 lg:w-full transition ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50 text-blue-950 ring-1 ring-blue-600/20'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-xs font-bold truncate max-w-44 lg:max-w-none">
                      {getPageDisplayName(p, idx)}
                    </span>
                    <span
                      className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-full shrink-0 ${
                        complete
                          ? 'bg-emerald-100 text-emerald-800'
                          : filled > 0
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {filled}/{p.slots.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Active Page Editor */}
          {activePage && (
            <main className="lg:col-span-9 space-y-3">
              {/* Page Controls & Action Toolbar */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-2xs space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1 min-w-[220px]">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Judul Sel Tengah Halaman {safePageIdx + 1} (Tercetak di Header PDF)
                    </div>
                    {activePage.mergeMiddleHeader ? (
                      <textarea
                        rows={2}
                        value={activePage.headerTopText}
                        onChange={(e) =>
                          handleUpdatePageText(activePage.id, {
                            headerTopText: e.target.value,
                          })
                        }
                        className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    ) : (
                      <div className="flex flex-wrap sm:flex-nowrap gap-2 max-w-lg">
                        <input
                          type="text"
                          value={activePage.headerTopText}
                          onChange={(e) =>
                            handleUpdatePageText(activePage.id, {
                              headerTopText: e.target.value,
                            })
                          }
                          placeholder="PHOTO"
                          className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-center text-slate-900 focus:border-blue-600 focus:outline-none"
                        />
                        <textarea
                          rows={2}
                          value={activePage.headerBottomText}
                          onChange={(e) =>
                            handleUpdatePageText(activePage.id, {
                              headerBottomText: e.target.value,
                            })
                          }
                          placeholder="Contoh: FAT S01-A01"
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-1 text-xs font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
                        />
                      </div>
                    )}
                  </div>

                  {/* Page Move / Duplicate / Delete */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={safePageIdx === 0}
                      onClick={() => handleMovePage(safePageIdx, -1)}
                      title="Geser Halaman ke Atas"
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={safePageIdx === doc.pages.length - 1}
                      onClick={() => handleMovePage(safePageIdx, 1)}
                      title="Geser Halaman ke Bawah"
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDuplicatePage(safePageIdx)}
                      title="Duplikat Kerangka Halaman Ini"
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePage(safePageIdx)}
                      title="Hapus Halaman Ini"
                      className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Primary Capture / Upload Action Strip */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={openGuidedCameraForPage}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700 active:scale-95 transition"
                    >
                      <Camera className="w-4 h-4" />
                      Kamera Beruntun ({activePage.slots.length} Kotak)
                    </button>

                    <button
                      type="button"
                      onClick={() => pageMultiUploadRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 active:scale-95 transition"
                    >
                      <Upload className="w-4 h-4 text-blue-600" />
                      Upload Sekaligus Halaman Ini
                    </button>

                    <input
                      ref={pageMultiUploadRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleUploadFilesToPage('FIRST_EMPTY', e.target.files);
                        }
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </div>

                  {/* Upload Watermark Toggle Switch */}
                  <label className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={doc.defaultWatermarkOnUpload}
                      onChange={handleToggleDefaultWatermark}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    />
                    <span>Watermark Otomatis (Kamera & Upload)</span>
                  </label>
                </div>

                {/* Active Swap Banner */}
                {swapSourceSlot !== null && (
                  <div className="rounded-xl bg-blue-600 text-white px-3.5 py-2 flex items-center justify-between text-xs font-semibold">
                    <div className="flex items-center gap-2">
                      <ArrowLeftRight className="w-4 h-4" />
                      <span>
                        Mode Tukar Posisi Aktif: Pilih kotak tujuan untuk bertukar dengan Kotak #
                        {swapSourceSlot + 1}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSwapSourceSlot(null)}
                      className="underline font-bold"
                    >
                      Batal
                    </button>
                  </div>
                )}
              </div>

              {/* 2-Column Photo Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-w-3xl mx-auto">
                {activePage.slots.map((slot) => {
                  const rec = slot.photoId ? photoMap.get(slot.photoId) : undefined;
                  const isBusy = Boolean(busySlots[`${activePage.id}:${slot.slotIndex}`]);

                  return (
                    <PhotoSlotCard
                      key={slot.slotIndex}
                      slot={slot}
                      record={rec}
                      descriptionStyle={activePage.descriptionStyle}
                      descriptionPrefix={activePage.descriptionPrefix}
                      isSwapSource={swapSourceSlot === slot.slotIndex}
                      isSwapModeActive={swapSourceSlot !== null}
                      busy={isBusy}
                      onOpenCameraAtSlot={(idx) => setCameraModalSlot(idx)}
                      onUploadFilesAtSlot={(idx, files) =>
                        handleUploadFilesToPage(idx, files)
                      }
                      onPreview={(idx) => setPreviewSlotIdx(idx)}
                      onRotate={handleRotateSlot}
                      onEditWatermark={(idx) => setWatermarkSlotIdx(idx)}
                      onRemovePhoto={handleRemoveSlotPhoto}
                      onSwapClick={handleTapSwap}
                      onDragDropSwap={handleSwapSlots}
                      onChangeDescription={handleChangeSlotDescription}
                    />
                  );
                })}
              </div>
            </main>
          )}
        </div>
      </div>

      {/* Modals */}
      {showAddPage && (
        <AddPageModal
          docType={doc.docType}
          existingPagesCount={doc.pages.length}
          clusterId={doc.header.clusterId}
          clusterName={doc.header.clusterName}
          onAddPages={handleAddPages}
          onClose={() => setShowAddPage(false)}
        />
      )}

      {showBulkUpload && (
        <BulkUploadModal
          documentId={doc.id}
          docType={doc.docType}
          header={doc.header}
          pages={doc.pages}
          activePageIndex={safePageIdx}
          defaultWatermarkEnabled={doc.defaultWatermarkOnUpload}
          onComplete={async (updatedPages, lastIdx) => {
            const updated = await updateDocument(doc.id, (curr) => ({
              ...curr,
              pages: updatedPages,
            }));
            setActivePageIdx(lastIdx);
            if (updated) {
              syncAllDocumentPhotosToNextcloud(updated).catch(() => {});
            }
          }}
          onClose={() => setShowBulkUpload(false)}
        />
      )}

      {showExportPdf && (
        <ExportPdfModal
          doc={doc}
          initialPageIdx={safePageIdx}
          onUpdateTitle={handleUpdateTitle}
          onClose={() => setShowExportPdf(false)}
        />
      )}

      {showVendorModal && (
        <VendorSettingsModal
          documentHeader={doc.header}
          onSaveDocumentHeader={handlePatchHeader}
          onClose={() => setShowVendorModal(false)}
        />
      )}

      {showSiteModal && (
        <SiteReferenceModal
          onSelectSite={(site) => {
            handlePatchHeader({
              region: site.region || doc.header.region,
              oltName: site.oltName || doc.header.oltName,
              clusterName: site.clusterName || doc.header.clusterName,
              clusterId: site.clusterId || doc.header.clusterId,
            });
          }}
          onClose={() => setShowSiteModal(false)}
        />
      )}

      {showHelpModal && (
        <HelpGuideModal onClose={() => setShowHelpModal(false)} />
      )}

      {cameraModalSlot !== null && activePage && (
        <GuidedCameraModal
          page={activePage}
          header={doc.header}
          initialSlotIndex={cameraModalSlot}
          onCaptureSlot={handleCameraCapture}
          onClose={() => setCameraModalSlot(null)}
        />
      )}

      {previewRecord && previewSlot && previewSlotIdx !== null && (
        <PhotoPreviewModal
          record={previewRecord}
          slotDescription={previewSlot.description}
          onRotate={() => handleRotateSlot(previewSlotIdx)}
          onEditWatermark={() => {
            const idx = previewSlotIdx;
            setPreviewSlotIdx(null);
            setWatermarkSlotIdx(idx);
          }}
          onRemove={() => handleRemoveSlotPhoto(previewSlotIdx)}
          onClose={() => setPreviewSlotIdx(null)}
        />
      )}

      {watermarkRecord && watermarkSlot && activePage && (
        <WatermarkEditorModal
          record={watermarkRecord}
          slotDescription={watermarkSlot.description}
          pagePhotosCount={
            activePage.slots.filter((s) => s.photoId && photoMap.has(s.photoId)).length
          }
          onSaveSingle={async (wmEnabled, wmData) => {
            const updated = await updatePhotoWatermark(watermarkRecord.id, wmEnabled, wmData);
            if (updated) {
              uploadPhotoToServer(updated, doc, activePage, watermarkSlot).catch(() => {});
              const { folderPath, fileName } = getPhotoPathInfo(doc, activePage, watermarkSlot);
              uploadPhotoRecordToNextcloud(updated, folderPath, fileName).catch(() => {});
            }
          }}
          onSaveAllInPage={async (wmEnabled, wmData, syncTimestamp) => {
            for (const s of activePage.slots) {
              if (!s.photoId) continue;
              const existing = photoMap.get(s.photoId);
              if (!existing) continue;
              const mergedWm: WatermarkData = {
                ...wmData,
                timestampText: syncTimestamp
                  ? wmData.timestampText
                  : existing.watermark.timestampText || wmData.timestampText,
                isoTimestamp: syncTimestamp
                  ? wmData.isoTimestamp
                  : existing.watermark.isoTimestamp || wmData.isoTimestamp,
              };
              const updated = await updatePhotoWatermark(existing.id, wmEnabled, mergedWm);
              if (updated) {
                uploadPhotoToServer(updated, doc, activePage, s).catch(() => {});
                const { folderPath, fileName } = getPhotoPathInfo(doc, activePage, s);
                uploadPhotoRecordToNextcloud(updated, folderPath, fileName).catch(() => {});
              }
            }
          }}
          onClose={() => setWatermarkSlotIdx(null)}
        />
      )}
    </div>
  );
};
