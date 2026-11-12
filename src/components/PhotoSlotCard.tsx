import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Camera,
  Cloud,
  CloudOff,
  Loader2,
  MapPin,
  Maximize2,
  RotateCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { PhotoRecord, SlotItem } from '../types';

interface PhotoSlotCardProps {
  slot: SlotItem;
  record?: PhotoRecord;
  descriptionStyle: 'white-center' | 'gray-left' | 'white-left';
  descriptionPrefix: string;
  isSwapSource: boolean;
  isSwapModeActive: boolean;
  busy?: boolean;
  onOpenCameraAtSlot: (slotIndex: number) => void;
  onUploadFilesAtSlot: (slotIndex: number, files: FileList) => void;
  onPreview: (slotIndex: number) => void;
  onRotate: (slotIndex: number) => void;
  onEditWatermark: (slotIndex: number) => void;
  onRemovePhoto: (slotIndex: number) => void;
  onSwapClick: (slotIndex: number) => void;
  onDragDropSwap: (fromSlotIndex: number, toSlotIndex: number) => void;
  onChangeDescription: (slotIndex: number, newDescription: string) => void;
}

export const PhotoSlotCard: React.FC<PhotoSlotCardProps> = ({
  slot,
  record,
  descriptionStyle,
  descriptionPrefix,
  isSwapSource,
  isSwapModeActive,
  busy = false,
  onOpenCameraAtSlot,
  onUploadFilesAtSlot,
  onPreview,
  onRotate,
  onEditWatermark,
  onRemovePhoto,
  onSwapClick,
  onDragDropSwap,
  onChangeDescription,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string>('');
  const [dragOver, setDragOver] = useState<boolean>(false);

  useEffect(() => {
    if (!record) {
      setThumbUrl('');
      return;
    }
    const url = URL.createObjectURL(record.renderedBlob);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [record]);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-photoqc-slot', String(slot.slotIndex));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    // Check internal slot swap first
    const fromSlotStr = e.dataTransfer.getData('application/x-photoqc-slot');
    if (fromSlotStr !== '') {
      const fromIdx = Number(fromSlotStr);
      if (!Number.isNaN(fromIdx) && fromIdx !== slot.slotIndex) {
        onDragDropSwap(fromIdx, slot.slotIndex);
      }
      return;
    }

    // Otherwise handle external image files dropped from OS file explorer
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUploadFilesAtSlot(slot.slotIndex, e.dataTransfer.files);
    }
  };

  return (
    <div
      draggable={Boolean(record) && !busy}
      onDragStart={handleDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`group rounded-xl border-2 bg-white overflow-hidden transition-all shadow-xs ${
        isSwapSource
          ? 'border-blue-600 ring-4 ring-blue-500/25'
          : dragOver
            ? 'border-indigo-500 bg-indigo-50/30 ring-2 ring-indigo-500/20'
            : isSwapModeActive
              ? 'border-amber-400 cursor-pointer hover:border-amber-500'
              : 'border-slate-800/85'
      }`}
    >
      {/* Photo Box Area */}
      <div
        onClick={() => {
          if (isSwapModeActive) {
            onSwapClick(slot.slotIndex);
          }
        }}
        className="relative aspect-[3/3.4] sm:aspect-[4/4.2] bg-slate-100 flex flex-col items-center justify-center overflow-hidden"
      >
        {/* Top-left Slot Index Badge */}
        <span className="absolute top-2 left-2 z-10 rounded-md bg-slate-900/75 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur-xs">
          #{slot.slotIndex + 1}
        </span>

        {/* Top-right Nextcloud Sync Status Badge */}
        {record && (
          <div className="absolute top-2 right-2 z-10">
            {record.nextcloudStatus === 'synced' ? (
              <span
                title={`Tersimpan di Nextcloud:\n${record.nextcloudPath || ''}`}
                className="flex items-center gap-1 rounded-md bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-xs backdrop-blur-xs"
              >
                <Cloud className="w-3 h-3 text-emerald-100" />
                <span className="hidden sm:inline">Nextcloud</span>
              </span>
            ) : record.nextcloudStatus === 'uploading' ? (
              <span
                title="Mengunggah ke Nextcloud..."
                className="flex items-center gap-1 rounded-md bg-blue-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-xs backdrop-blur-xs"
              >
                <Loader2 className="w-3 h-3 animate-spin text-white" />
                <span className="hidden sm:inline">Upload...</span>
              </span>
            ) : (
              <span
                title={`Belum tersinkron ke Nextcloud${record.nextcloudError ? `: ${record.nextcloudError}` : ''}`}
                className="flex items-center gap-1 rounded-md bg-amber-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-xs backdrop-blur-xs"
              >
                <CloudOff className="w-3 h-3 text-amber-100" />
                <span className="hidden sm:inline">Pending</span>
              </span>
            )}
          </div>
        )}

        {busy ? (
          <div className="flex flex-col items-center gap-2 text-slate-600">
            <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
            <span className="text-xs font-medium">Memproses foto...</span>
          </div>
        ) : record && thumbUrl ? (
          <>
            <img
              src={thumbUrl}
              alt={slot.description}
              onClick={(e) => {
                if (!isSwapModeActive) {
                  e.stopPropagation();
                  onPreview(slot.slotIndex);
                }
              }}
              className="h-full w-full object-contain bg-white cursor-zoom-in"
            />

            {/* Top-right Watermark + Swap Pills */}
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditWatermark(slot.slotIndex);
                }}
                title="Pengaturan Watermark"
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold shadow-xs backdrop-blur-xs transition ${
                  record.watermarkEnabled
                    ? 'bg-emerald-600/90 text-white hover:bg-emerald-600'
                    : 'bg-slate-700/85 text-slate-100 hover:bg-slate-800'
                }`}
              >
                {record.watermarkEnabled ? 'WM Aktif' : 'Tanpa WM'}
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSwapClick(slot.slotIndex);
                }}
                title="Tukar posisi dengan kotak lain"
                className={`rounded-md p-1 text-xs shadow-xs backdrop-blur-xs transition ${
                  isSwapSource
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-900/75 text-white hover:bg-slate-900'
                }`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Bottom Quick Action Overlay */}
            <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between bg-gradient-to-t from-slate-950/85 via-slate-900/55 to-transparent px-2.5 pt-6 pb-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPreview(slot.slotIndex);
                  }}
                  title="Perbesar Foto"
                  className="rounded-lg bg-white/20 p-1.5 text-white hover:bg-white/30 backdrop-blur-xs"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRotate(slot.slotIndex);
                  }}
                  title="Putar 90°"
                  className="rounded-lg bg-white/20 p-1.5 text-white hover:bg-white/30 backdrop-blur-xs"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditWatermark(slot.slotIndex);
                  }}
                  title="Edit Watermark & Lokasi"
                  className="rounded-lg bg-white/20 p-1.5 text-white hover:bg-white/30 backdrop-blur-xs"
                >
                  <MapPin className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCameraAtSlot(slot.slotIndex);
                  }}
                  title="Foto Ulang dengan Kamera"
                  className="rounded-lg bg-blue-600/90 p-1.5 text-white hover:bg-blue-600"
                >
                  <Camera className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  title="Ganti dari File/Galeri"
                  className="rounded-lg bg-white/20 p-1.5 text-white hover:bg-white/30 backdrop-blur-xs"
                >
                  <Upload className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemovePhoto(slot.slotIndex);
                  }}
                  title="Hapus Foto"
                  className="rounded-lg bg-red-600/85 p-1.5 text-white hover:bg-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Empty Slot Actions */
          <div className="flex flex-col items-center justify-center p-4 text-center space-y-3 w-full">
            {isSwapModeActive ? (
              <button
                type="button"
                onClick={() => onSwapClick(slot.slotIndex)}
                className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-sm"
              >
                Pindahkan Foto ke Kotak #{slot.slotIndex + 1} Ini
              </button>
            ) : (
              <>
                <span className="text-2xl font-extrabold text-slate-300 select-none">
                  {slot.slotIndex + 1}
                </span>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenCameraAtSlot(slot.slotIndex)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 active:scale-95 transition"
                  >
                    <Camera className="w-4 h-4" />
                    Kamera
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-95 transition"
                  >
                    <Upload className="w-4 h-4" />
                    Upload
                  </button>
                </div>
                <span className="text-[11px] text-slate-400 hidden sm:inline">
                  Bisa pilih banyak foto sekaligus atau tarik ke sini
                </span>
              </>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onUploadFilesAtSlot(slot.slotIndex, e.target.files);
            }
            e.target.value = '';
          }}
          className="hidden"
        />
      </div>

      {/* Bottom Description Cell (Matches PDF Style) */}
      <div
        className={`border-t-2 border-slate-800/85 px-2.5 py-1.5 flex items-center gap-1 ${
          descriptionStyle === 'gray-left'
            ? 'bg-neutral-300/80'
            : 'bg-white'
        }`}
      >
        <span className="text-[11px] font-bold text-slate-700 shrink-0 select-none">
          {descriptionPrefix}
        </span>
        <input
          type="text"
          value={slot.description}
          onChange={(e) => onChangeDescription(slot.slotIndex, e.target.value)}
          className={`w-full bg-transparent text-xs font-bold text-slate-900 focus:outline-none focus:bg-blue-50/70 rounded px-1 ${
            descriptionStyle === 'white-center' ? 'text-center' : 'text-left'
          }`}
          title="Klik untuk mengedit teks deskripsi kotak ini"
        />
      </div>
    </div>
  );
};
