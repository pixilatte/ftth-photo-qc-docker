export type DocumentType = 'CW' | 'CW_SF' | 'EL' | 'IMPLE';

export type PagePresetType =
  | 'CW_FDT'
  | 'CW_FAT'
  | 'CW_SF_POLE'
  | 'EL_INPUT_SPLITTER'
  | 'EL_OUTPUT_SPLITTER'
  | 'EL_OPM_FAT'
  | 'IMPLE_STANDARD';

export type PdfQualityPreset = 'light' | 'standard' | 'high';

export type RotationAngle = 0 | 90 | 180 | 270;

export interface WatermarkData {
  /** Formatted string e.g. "30-Dec-2025 15:44" */
  timestampText: string;
  /** Raw ISO timestamp if available */
  isoTimestamp?: string;
  /** Numeric latitude (negative = South) */
  latitude?: number;
  /** Numeric longitude (positive = East) */
  longitude?: number;
  /** Formatted coordinate line e.g. "8.0942S 112.6465E" */
  coordText: string;
  /** Multi-line address from street down to province */
  addressLines: string[];
}

export interface DocumentHeader {
  projectName: string; // Default: "EMR FTTH PROJECT"
  region: string;      // e.g. "BLORA"
  oltName: string;     // e.g. "BALUN" or "CEPU"
  clusterName: string; // e.g. "KELURAHAN KAPUAN BLORA"
  clusterId: string;   // e.g. "CLRMO7-99-021"
  /** Optional custom title shown in the document header banner; falls back to the auto-generated title */
  headerTitle?: string | null;
  /** Optional custom left logo data URL (overrides default ZTE logo) */
  customLeftLogoDataUrl?: string | null;
  /** Optional custom right logo data URL (overrides default MoraRepublic logo) */
  customRightLogoDataUrl?: string | null;
  /** Hide second logo if user uses a single wide vendor logo */
  hideRightLogo?: boolean;
}

export interface SlotItem {
  slotIndex: number; // 0-based index
  /** Label shown after "Description: " e.g. "FAT Tertutup" or "Port 1" */
  description: string;
  /** Reference to PhotoRecord.id in IndexedDB photos table */
  photoId: string | null;
}

export interface DocumentPage {
  id: string;
  preset: PagePresetType;
  /** Top cell of middle header block (usually "PHOTO", or merged "PHOTO\nIMPLEMENTASI") */
  headerTopText: string;
  /** Bottom cell lines of middle header block e.g. "FAT S01-A01" or "FDT\n(BLA-CPU-D05)" */
  headerBottomText: string;
  /** Whether middle header is a single merged cell (true for Foto Imple) */
  mergeMiddleHeader: boolean;
  columns: number; // Always 2 in standard FTTH templates
  rows: number;    // 3 (CW), 2 (EL Input), 4 (EL Output/FAT), 5 (Imple)
  descriptionStyle: 'white-center' | 'gray-left' | 'white-left';
  descriptionPrefix: string; // "Description: " or "Description : "
  showEmptySlotNumber: boolean;
  slots: SlotItem[];
}

export interface QcDocument {
  id: string;
  title: string;
  docType: DocumentType;
  header: DocumentHeader;
  pages: DocumentPage[];
  /** Default camera/upload watermark toggle state remembered per document */
  defaultWatermarkOnUpload: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PhotoRecord {
  id: string;
  documentId: string;
  /** Original normalized image blob (without burned watermark) */
  rawBlob: Blob;
  /** Pre-rendered display blob with rotation + watermark applied (if enabled) */
  renderedBlob: Blob;
  rotation: RotationAngle;
  watermarkEnabled: boolean;
  watermark: WatermarkData;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
  /** Nextcloud storage status and path */
  nextcloudPath?: string;
  nextcloudStatus?: 'synced' | 'pending' | 'failed' | 'uploading';
  nextcloudError?: string;
  nextcloudUploadedAt?: number;
}

export interface GeoCacheEntry {
  /** Rounded lat,lon key (~50m grid) e.g. "-8.094,112.647" */
  gridKey: string;
  latitude: number;
  longitude: number;
  addressLines: string[];
  updatedAt: number;
}

export interface AppSettings {
  id: string; // 'global'
  defaultProjectName: string;
  defaultLeftLogoDataUrl?: string | null;
  defaultRightLogoDataUrl?: string | null;
  hideRightLogo?: boolean;
}

export interface SiteReferenceItem {
  id: string;
  clusterId: string;      // e.g. "CLRM07-99-021"
  clusterName: string;    // e.g. "KELURAHAN KAPUAN BLORA"
  region: string;         // e.g. "BLORA"
  kecamatan: string;      // e.g. "Cepu"
  clusterInitial: string; // e.g. "CPU"
  fdtNo: string;          // e.g. "D05"
  hpDrm: string;          // e.g. "336"
  fdtId: string;          // e.g. "BLA-CPU-D05"
  oltName: string;        // e.g. "BALUN"
}
