import React, { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  Building2,
  Camera,
  Copy,
  Database,
  Download,
  FileDown,
  FilePlus2,
  FileText,
  FolderInput,
  HelpCircle,
  RefreshCw,
  Search,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  pushDocumentToServer,
  syncDocumentsWithServer,
  syncGlobalSettings,
} from '../services/cloudSync';
import { DEFAULT_MORA_LOGO, DEFAULT_ZTE_LOGO } from '../assets/defaultLogos';
import {
  createDocument,
  db,
  deleteDocumentCascade,
  exportDocumentToZip,
  importDocumentFromZip,
} from '../db/database';
import { DOCUMENT_TYPES, generateId } from '../presets/documentPresets';
import { DocumentType, QcDocument } from '../types';
import { ExportPdfModal } from './ExportPdfModal';
import { HelpGuideModal } from './HelpGuideModal';
import { NewDocumentModal } from './NewDocumentModal';
import { SiteReferenceModal } from './SiteReferenceModal';
import { VendorSettingsModal } from './VendorSettingsModal';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface DashboardProps {
  onOpenDocument: (docId: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onOpenDocument }) => {
  const docs = useLiveQuery(
    () => db.documents.orderBy('updatedAt').reverse().toArray(),
    [],
    [] as QcDocument[]
  );

  const [filterType, setFilterType] = useState<'ALL' | DocumentType>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showNewModal, setShowNewModal] = useState<boolean>(false);
  const [showGlobalVendorModal, setShowGlobalVendorModal] = useState<boolean>(false);
  const [showSiteModal, setShowSiteModal] = useState<boolean>(false);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [exportTargetDoc, setExportTargetDoc] = useState<QcDocument | null>(null);
  const [importingZip, setImportingZip] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const triggerSync = async () => {
    setIsSyncing(true);
    try {
      await syncDocumentsWithServer();
      await syncGlobalSettings();
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    triggerSync();
    const interval = setInterval(triggerSync, 6000);
    const onFocus = () => triggerSync();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const zipInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const res = await installPrompt.userChoice;
    if (res.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const handleImportZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingZip(true);
    try {
      const imported = await importDocumentFromZip(file);
      pushDocumentToServer(imported).catch(() => {});
      onOpenDocument(imported.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal mengimpor file proyek.');
    } finally {
      setImportingZip(false);
      e.target.value = '';
    }
  };

  const handleDuplicateOutline = async (src: QcDocument) => {
    const copy = await createDocument({
      title: `${src.title} (Salinan)`,
      docType: src.docType,
      header: { ...src.header },
      initialPages: src.pages.map((p) => ({
        ...p,
        id: generateId(),
        slots: p.slots.map((s) => ({ ...s, photoId: null })),
      })),
    });
    onOpenDocument(copy.id);
  };

  const handleExportZip = async (docId: string) => {
    const { blob, filename } = await exportDocumentToZip(docId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleDeleteDoc = async (doc: QcDocument) => {
    if (
      !confirm(
        `Hapus dokumen "${doc.title}" beserta seluruh foto di dalamnya dari perangkat ini?`
      )
    ) {
      return;
    }
    await deleteDocumentCascade(doc.id);
  };

  const filteredDocs = docs.filter((d) => {
    if (filterType !== 'ALL' && d.docType !== filterType) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      d.title.toLowerCase().includes(q) ||
      d.header.clusterName.toLowerCase().includes(q) ||
      d.header.clusterId.toLowerCase().includes(q) ||
      d.header.region.toLowerCase().includes(q) ||
      d.header.oltName.toLowerCase().includes(q)
    );
  });

  const groupedDocs = filteredDocs.reduce<Record<string, { key: string; clusterName: string; clusterId: string; region: string; oltName: string; docs: QcDocument[] }>>(
    (acc, doc) => {
      const clusterName = (doc.header.clusterName || 'Cluster belum diisi').trim();
      const clusterId = (doc.header.clusterId || 'Cluster ID belum diisi').trim();
      const region = (doc.header.region || '—').trim();
      const oltName = (doc.header.oltName || '—').trim();
      const key = `${region.toLowerCase()}|${oltName.toLowerCase()}|${clusterName.toLowerCase()}|${clusterId.toLowerCase()}`;

      if (!acc[key]) {
        acc[key] = {
          key,
          clusterName,
          clusterId,
          region,
          oltName,
          docs: [],
        };
      }

      acc[key].docs.push(doc);
      return acc;
    },
    {}
  );

  const orderedGroups = Object.values(groupedDocs).sort((a, b) => {
    const aLabel = `${a.region} ${a.oltName} ${a.clusterName}`.toLowerCase();
    const bLabel = `${b.region} ${b.oltName} ${b.clusterName}`.toLowerCase();
    return aLabel.localeCompare(bLabel);
  });

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Top Hero Banner */}
      <header className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="h-12 w-12 rounded-2xl bg-blue-600/90 border border-blue-400/30 flex items-center justify-center shadow-lg">
                <Camera className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg sm:text-xl font-extrabold tracking-tight">
                    FTTH Photo QC
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      isOnline
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                        : 'bg-amber-500/20 text-amber-200 border border-amber-400/30'
                    }`}
                  >
                    {isOnline ? (
                      <>
                        <Wifi className="w-3 h-3" /> Online
                      </>
                    ) : (
                      <>
                        <WifiOff className="w-3 h-3" /> Mode Offline Aktif
                      </>
                    )}
                  </span>

                  <button
                    type="button"
                    onClick={triggerSync}
                    className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-blue-200 border border-blue-400/30 hover:bg-blue-500/30 transition"
                    title="Sinkronisasi data dengan server kolaborasi"
                  >
                    <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin text-blue-300' : 'text-blue-300'}`} />
                    <span className="hidden sm:inline">{isSyncing ? 'Sinkronisasi...' : 'Server Terhubung'}</span>
                  </button>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 mt-0.5">
                  Dokumentasi Foto CW (termasuk Implementasi), CW SF, & EL (OPM) • Watermark opsional
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {installPrompt && (
                <button
                  type="button"
                  onClick={handleInstallPwa}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 transition shadow-sm"
                >
                  <Smartphone className="w-4 h-4" />
                  Install di HP
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowHelpModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 border border-white/15 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/20 transition"
                title="Panduan Penggunaan Aplikasi"
              >
                <HelpCircle className="w-4 h-4 text-blue-300" />
                Panduan
              </button>

              <button
                type="button"
                onClick={() => setShowSiteModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 border border-white/15 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/20 transition"
                title="Tabel Referensi Data Site (Sitelist)"
              >
                <Database className="w-4 h-4 text-emerald-300" />
                Data Site
              </button>

              <button
                type="button"
                onClick={() => setShowGlobalVendorModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 border border-white/15 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/20 transition"
              >
                <Building2 className="w-4 h-4" />
                Logo & Proyek
              </button>

              <button
                type="button"
                disabled={importingZip}
                onClick={() => zipInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 border border-white/15 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/20 transition"
              >
                <FolderInput className="w-4 h-4" />
                {importingZip ? 'Mengimpor...' : 'Impor .ZIP'}
              </button>

              <button
                type="button"
                onClick={() => setShowNewModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md hover:bg-blue-500 active:scale-95 transition"
              >
                <FilePlus2 className="w-4 h-4" />
                Buat Dokumen Baru
              </button>

              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip"
                onChange={handleImportZip}
                className="hidden"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 flex-1 space-y-5">
        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: 'ALL' as const, label: `Semua (${docs.length})` },
              {
                id: 'CW' as const,
                label: `FOTO CW (${docs.filter((d) => d.docType === 'CW').length})`,
              },
              { id: 'CW_SF' as const, label: `FOTO CW SF (${docs.filter((d) => d.docType === 'CW_SF').length})` },
              {
                id: 'EL' as const,
                label: `FOTO EL (${docs.filter((d) => d.docType === 'EL').length})`,
              },
              ...(docs.some((d) => d.docType === 'IMPLE')
                ? [
                    {
                      id: 'IMPLE' as const,
                      label: `IMPLEMENTASI (Arsip: ${docs.filter((d) => d.docType === 'IMPLE').length})`,
                    },
                  ]
                : []),
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterType(tab.id)}
                className={`rounded-xl px-3.5 py-2 text-xs font-bold shrink-0 transition ${
                  filterType === tab.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama dokumen / Cluster ID..."
              className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        {/* Document Cards */}
        {filteredDocs.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-10 text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <FileText className="w-7 h-7" />
            </div>
            <div className="max-w-md mx-auto space-y-1">
              <h2 className="text-base font-bold text-slate-900">
                {docs.length === 0
                  ? 'Belum Ada Dokumen Dokumentasi'
                  : 'Tidak Ada Dokumen yang Cocok'}
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Buat dokumen baru untuk memotret atau meng-upload foto. Watermark waktu & GPS
                dapat diaktifkan secara manual dari halaman dokumen.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowNewModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
              >
                <FilePlus2 className="w-4 h-4" />
                Buat Dokumen Pertama
              </button>
              <button
                type="button"
                onClick={() => zipInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="w-4 h-4" />
                Impor Backup (.ZIP)
              </button>
              <button
                type="button"
                onClick={() => setShowHelpModal(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
              >
                <HelpCircle className="w-4 h-4" />
                Baca Panduan Pemakaian
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {orderedGroups.map((group) => (
              <section key={group.key} className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-2xs">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-900 truncate">
                        {group.clusterName}
                      </h2>
                      {group.clusterId && group.clusterId !== 'Cluster ID belum diisi' && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          {group.clusterId}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Region: {group.region} • OLT: {group.oltName} • {group.docs.length} dokumen
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.docs.map((doc) => {
                    const meta = DOCUMENT_TYPES[doc.docType];
                    const totalSlots = doc.pages.reduce((s, p) => s + p.slots.length, 0);
                    const filledSlots = doc.pages.reduce(
                      (s, p) => s + p.slots.filter((sl) => Boolean(sl.photoId)).length,
                      0
                    );
                    const pct = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;

                    return (
                      <div
                        key={doc.id}
                        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs hover:shadow-md transition flex flex-col justify-between gap-4"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <span
                              className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${meta.badgeColor}`}
                            >
                              {meta.shortLabel}
                            </span>
                            <div className="flex items-center gap-1.5 border border-slate-100 rounded-md px-1.5 py-0.5">
                              <img
                                src={doc.header.customLeftLogoDataUrl || DEFAULT_ZTE_LOGO}
                                alt="Vendor 1"
                                className="h-3.5 object-contain"
                              />
                              {!doc.header.hideRightLogo && (
                                <img
                                  src={doc.header.customRightLogoDataUrl || DEFAULT_MORA_LOGO}
                                  alt="Vendor 2"
                                  className="h-3.5 object-contain"
                                />
                              )}
                            </div>
                          </div>

                          <div
                            onClick={() => onOpenDocument(doc.id)}
                            className="cursor-pointer group"
                          >
                            <h3 className="font-bold text-base text-slate-900 group-hover:text-blue-600 transition truncate">
                              {doc.title}
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5 truncate">
                              {doc.header.clusterName || 'Cluster belum diisi'}{' '}
                              {doc.header.clusterId ? `(${doc.header.clusterId})` : ''}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Region: {doc.header.region || '—'} • OLT: {doc.header.oltName || '—'}
                            </p>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-700">
                                {doc.pages.length} Halaman • {filledSlots}/{totalSlots} Foto
                              </span>
                              <span className="font-bold text-slate-900">{pct}%</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className={`h-full transition-all ${
                                  pct === 100 ? 'bg-emerald-500' : 'bg-blue-600'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => onOpenDocument(doc.id)}
                            className="flex-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 transition"
                          >
                            Buka & Edit
                          </button>

                          <button
                            type="button"
                            onClick={() => setExportTargetDoc(doc)}
                            title="Export ke PDF"
                            className="rounded-xl bg-emerald-50 border border-emerald-200 p-2 text-emerald-700 hover:bg-emerald-100"
                          >
                            <FileDown className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleExportZip(doc.id)}
                            title="Simpan paket proyek (.zip)"
                            className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-100"
                          >
                            <Archive className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDuplicateOutline(doc)}
                            title="Salin kerangka dokumen ini (tanpa foto)"
                            className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-100"
                          >
                            <Copy className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteDoc(doc)}
                            title="Hapus Dokumen"
                            className="rounded-xl border border-red-200 p-2 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <footer className="py-4 text-center text-xs text-slate-400 border-t border-slate-200/70 bg-white">
        Data tersimpan 100% lokal di perangkat Anda (Offline-First IndexedDB) • Siap dipakai di HP &
        Laptop
      </footer>

      {showNewModal && (
        <NewDocumentModal
          existingDocs={docs}
          onClose={() => setShowNewModal(false)}
          onCreated={(created) => {
            setShowNewModal(false);
            onOpenDocument(created.id);
          }}
        />
      )}

      {showGlobalVendorModal && (
        <VendorSettingsModal onClose={() => setShowGlobalVendorModal(false)} />
      )}

      {showSiteModal && (
        <SiteReferenceModal onClose={() => setShowSiteModal(false)} />
      )}

      {showHelpModal && (
        <HelpGuideModal onClose={() => setShowHelpModal(false)} />
      )}

      {exportTargetDoc && (
        <ExportPdfModal
          doc={exportTargetDoc}
          onUpdateTitle={() => {}}
          onClose={() => setExportTargetDoc(null)}
        />
      )}
    </div>
  );
};
