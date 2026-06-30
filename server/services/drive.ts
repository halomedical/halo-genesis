import mammoth from 'mammoth';
import { config } from '../config';
import { PRACTICE_ADMIN_FOLDER, PDF_DOCUMENTS_FOLDER } from '../../shared/folderStructure';
import {
  PDF_DOCUMENT_TYPE_LABELS,
  type PdfDocumentType,
} from '../../shared/pdfFiller';

// Polyfill browser APIs needed by pdf-parse (set up at module load time)
// These are needed because pdf-parse's dependency pdfjs-dist uses them at module load
const g = globalThis as any;

if (typeof g.DOMMatrix === 'undefined') {
  // Minimal DOMMatrix polyfill for Node.js
  g.DOMMatrix = class DOMMatrix {
    constructor(init?: string | number[]) {
      if (init) {
        if (typeof init === 'string') {
          const values = init.match(/matrix\(([^)]+)\)/)?.[1]?.split(',').map(Number) || [];
          this.a = values[0] ?? 1;
          this.b = values[1] ?? 0;
          this.c = values[2] ?? 0;
          this.d = values[3] ?? 1;
          this.e = values[4] ?? 0;
          this.f = values[5] ?? 0;
        }
      } else {
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
      }
    }
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
  };
}
if (typeof g.ImageData === 'undefined') {
  g.ImageData = class ImageData {
    constructor(public data: Uint8ClampedArray, public width: number, public height?: number) {}
  };
}
if (typeof g.Path2D === 'undefined') {
  g.Path2D = class Path2D {};
}

const { driveApi, uploadApi } = config;

const DRIVE_REQUEST_TIMEOUT_MS = 25_000;

/** fetch with timeout to avoid hanging on slow/hung Drive API */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DRIVE_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- Types ---

export interface DriveResponse {
  files?: DriveFileRaw[];
  nextPageToken?: string;
  id?: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
  createdTime?: string;
  error?: { message: string; code: number };
}

export interface DriveFileRaw {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  thumbnailLink?: string;
  appProperties?: Record<string, string>;
  createdTime?: string;
}

// --- Core Helpers ---

/**
 * Make an authenticated request to the Google Drive API.
 * Throws on non-2xx responses so callers don't silently consume errors.
 */
export async function driveRequest(token: string, path: string, options: RequestInit = {}): Promise<DriveResponse> {
  const res = await fetchWithTimeout(
    `${driveApi}${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
      },
    },
    DRIVE_REQUEST_TIMEOUT_MS
  );

  const data = (await res.json()) as DriveResponse;

  if (!res.ok) {
    const msg = data.error?.message || `Drive API error ${res.status}`;
    throw new Error(`[Drive ${res.status}] ${msg}`);
  }

  return data;
}

/**
 * Find or create the Halo root folder in Google Drive.
 */
export async function getHaloRootFolder(token: string): Promise<string> {
  const searchQuery = encodeURIComponent(
    "mimeType='application/vnd.google-apps.folder' and name='Halo' and trashed=false"
  );
  const data = await driveRequest(token, `/files?q=${searchQuery}`);

  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  const createRes = await fetch(`${driveApi}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Halo',
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createRes.ok) {
    throw new Error(`[Drive ${createRes.status}] Failed to create Halo folder`);
  }

  const folder = (await createRes.json()) as { id: string };
  return folder.id;
}

/**
 * Find or create a "Patient Notes" subfolder inside a patient folder.
 */
export async function getOrCreatePatientNotesFolder(token: string, patientFolderId: string): Promise<string> {
  const searchQuery = encodeURIComponent(
    `'${patientFolderId}' in parents and name='Patient Notes' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const data = await driveRequest(token, `/files?q=${searchQuery}&fields=files(id)`);

  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  const createRes = await fetch(`${driveApi}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Patient Notes',
      parents: [patientFolderId],
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createRes.ok) {
    throw new Error(`[Drive ${createRes.status}] Failed to create Patient Notes folder`);
  }

  const folder = (await createRes.json()) as { id: string };
  return folder.id;
}

/**
 * Find or create a "Billing Claims" subfolder inside a patient folder.
 */
export async function getOrCreatePatientBillingClaimsFolder(token: string, patientFolderId: string): Promise<string> {
  const searchQuery = encodeURIComponent(
    `'${patientFolderId}' in parents and name='Billing Claims' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const data = await driveRequest(token, `/files?q=${searchQuery}&fields=files(id)`);

  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  const createRes = await fetch(`${driveApi}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Billing Claims',
      parents: [patientFolderId],
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createRes.ok) {
    throw new Error(`[Drive ${createRes.status}] Failed to create Billing Claims folder`);
  }

  const folder = (await createRes.json()) as { id: string };
  return folder.id;
}

/**
 * Find or create a "Billing Eligibility" subfolder inside a patient folder.
 */
export async function getOrCreatePatientBillingEligibilityFolder(token: string, patientFolderId: string): Promise<string> {
  const searchQuery = encodeURIComponent(
    `'${patientFolderId}' in parents and name='Billing Eligibility' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const data = await driveRequest(token, `/files?q=${searchQuery}&fields=files(id)`);

  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  const createRes = await fetch(`${driveApi}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Billing Eligibility',
      parents: [patientFolderId],
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createRes.ok) {
    throw new Error(`[Drive ${createRes.status}] Failed to create Billing Eligibility folder`);
  }

  const folder = (await createRes.json()) as { id: string };
  return folder.id;
}

async function getOrCreateSubfolder(
  token: string,
  parentFolderId: string,
  folderName: string
): Promise<string> {
  const searchQuery = encodeURIComponent(
    `'${parentFolderId}' in parents and name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const data = await driveRequest(token, `/files?q=${searchQuery}&fields=files(id)`);

  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  const createRes = await fetch(`${driveApi}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      parents: [parentFolderId],
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createRes.ok) {
    throw new Error(`[Drive ${createRes.status}] Failed to create folder "${folderName}"`);
  }

  const folder = (await createRes.json()) as { id: string };
  return folder.id;
}

/**
 * Halo/Practice Admin/PDF Documents — practice-wide PDF form templates.
 */
export async function getOrCreatePracticeAdminPdfDocumentsFolder(token: string): Promise<string> {
  const haloRootId = await getHaloRootFolder(token);
  const practiceAdminId = await getOrCreateSubfolder(token, haloRootId, PRACTICE_ADMIN_FOLDER);
  return getOrCreateSubfolder(token, practiceAdminId, PDF_DOCUMENTS_FOLDER);
}

/**
 * PDF Documents / {document type label}/
 */
export async function getOrCreatePracticePdfDocumentTypeFolder(
  token: string,
  documentType: PdfDocumentType
): Promise<string> {
  const pdfRootId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
  const folderName = PDF_DOCUMENT_TYPE_LABELS[documentType];
  return getOrCreateSubfolder(token, pdfRootId, folderName);
}

/**
 * PDF Documents / {document type} / {insurer label}/
 */
export async function getOrCreatePracticePdfInsurerFolder(
  token: string,
  _insuranceCompanyId: string,
  folderLabel: string,
  documentTypeFolderId: string
): Promise<string> {
  const safeName = folderLabel.replace(/[^\w\s.-]/g, ' ').trim().slice(0, 80) || _insuranceCompanyId;
  return getOrCreateSubfolder(token, documentTypeFolderId, safeName);
}

/**
 * @deprecated use getOrCreatePracticePdfInsurerFolder with document type parent
 */
export async function getOrCreatePracticePdfInsurerFolderLegacy(
  token: string,
  insuranceCompanyId: string,
  folderLabel: string
): Promise<string> {
  const pdfRootId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
  const safeName = folderLabel.replace(/[^\w\s.-]/g, ' ').trim().slice(0, 80) || insuranceCompanyId;
  return getOrCreateSubfolder(token, pdfRootId, safeName);
}

/**
 * Move a Drive file to a different parent folder (same shared drive / My Drive tree).
 */
export async function moveDriveFile(
  token: string,
  fileId: string,
  newParentFolderId: string
): Promise<void> {
  const meta = await driveRequest(
    token,
    `/files/${fileId}?fields=parents`
  );
  const parents = (meta as { parents?: string[] }).parents;
  if (!parents?.length) {
    throw new Error(`Drive file ${fileId} has no parents`);
  }
  const removeParents = parents.join(',');
  await driveRequest(
    token,
    `/files/${fileId}?addParents=${encodeURIComponent(newParentFolderId)}&removeParents=${encodeURIComponent(removeParents)}`,
    { method: 'PATCH', body: JSON.stringify({}) }
  );
}

/**
 * Find or create a standard patient subfolder (e.g. Letters, Scanned Documents).
 */
export async function getOrCreatePatientSubfolder(
  token: string,
  patientFolderId: string,
  subfolderName: string
): Promise<string> {
  return getOrCreateSubfolder(token, patientFolderId, subfolderName);
}

/**
 * Upload a buffer to Google Drive using multipart upload.
 */
export async function uploadToDrive(
  token: string,
  fileName: string,
  mimeType: string,
  parentFolderId: string,
  buffer: Buffer,
  appProperties?: Record<string, string>
): Promise<string> {
  const metadata: Record<string, unknown> = {
    name: fileName,
    parents: [parentFolderId],
    mimeType,
  };
  if (appProperties) {
    metadata.appProperties = appProperties;
  }

  const boundary = 'halo_upload_boundary';
  const metaPart = JSON.stringify(metadata);

  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const uploadRes = await fetch(`${uploadApi}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`[Drive ${uploadRes.status}] Upload failed for "${fileName}": ${errText}`);
  }

  const data = (await uploadRes.json()) as { id: string };
  return data.id;
}

export async function getOrCreateNamedSubfolder(
  token: string,
  parentFolderId: string,
  folderName: string
): Promise<string> {
  return getOrCreateSubfolder(token, parentFolderId, folderName);
}

export async function uploadFileToDrive(
  token: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer,
  appProperties?: Record<string, string>
): Promise<{ id: string; name: string; url: string }> {
  const id = await uploadToDrive(token, fileName, mimeType, folderId, buffer, appProperties);
  return { id, name: fileName, url: '' };
}

export async function deleteDriveFile(token: string, fileId: string): Promise<void> {
  const res = await fetchWithTimeout(`${driveApi}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`[Drive delete ${res.status}] ${text}`);
  }
}

/**
 * Convert a DOCX buffer into a PDF buffer via a temporary Google Doc import.
 * The temporary Google Doc is always cleaned up before returning.
 */
export async function convertDocxBufferToPdfBuffer(
  token: string,
  docxBuffer: Buffer,
  parentFolderId: string,
  baseName: string
): Promise<Buffer> {
  const importMetadata = JSON.stringify({
    name: `${baseName}_preview_import`,
    parents: [parentFolderId],
    mimeType: 'application/vnd.google-apps.document',
  });

  const boundary = `halo_preview_${crypto.randomUUID()}`;
  const importBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${importMetadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`
    ),
    docxBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const importRes = await fetch(`${uploadApi}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: importBody,
  });

  if (!importRes.ok) {
    const importError = await importRes.text().catch(() => 'Unknown import error');
    throw new Error(`[Drive ${importRes.status}] Failed to import DOCX as Google Doc: ${importError}`);
  }

  const importedDoc = (await importRes.json()) as { id: string };

  try {
    const pdfRes = await fetch(
      `${driveApi}/files/${importedDoc.id}/export?mimeType=application/pdf`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!pdfRes.ok) {
      const exportError = await pdfRes.text().catch(() => 'Unknown export error');
      throw new Error(`[Drive ${pdfRes.status}] Failed to export preview PDF: ${exportError}`);
    }

    return Buffer.from(await pdfRes.arrayBuffer());
  } finally {
    try {
      await fetch(`${driveApi}/files/${importedDoc.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (cleanupErr) {
      console.error(`[Drive] Failed to delete temp preview doc ${importedDoc.id}:`, cleanupErr);
    }
  }
}

/**
 * Download a file's text content from Google Drive.
 */
export async function downloadTextFromDrive(token: string, fileId: string): Promise<string> {
  const res = await fetch(`${driveApi}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`[Drive ${res.status}] Failed to download text for file ${fileId}`);
  }
  return res.text();
}

export async function findFileInFolder(
  token: string,
  parentFolderId: string,
  fileName: string,
  mimeType?: string
): Promise<DriveFileRaw | null> {
  const clauses = [
    `'${parentFolderId}' in parents`,
    `name='${fileName.replace(/'/g, "\\'")}'`,
    'trashed=false',
  ];
  if (mimeType) {
    clauses.push(`mimeType='${mimeType.replace(/'/g, "\\'")}'`);
  }
  const query = encodeURIComponent(clauses.join(' and '));
  const data = await driveRequest(
    token,
    `/files?q=${query}&fields=files(id,name,mimeType,appProperties,createdTime,modifiedTime)`
  );
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

export async function upsertTextFileInFolder(
  token: string,
  parentFolderId: string,
  fileName: string,
  content: string,
  mimeType = 'text/plain',
  appProperties?: Record<string, string>
): Promise<string> {
  const existing = await findFileInFolder(token, parentFolderId, fileName);

  if (existing) {
    const res = await fetch(`${uploadApi}/files/${existing.id}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType,
      },
      body: content,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown update error');
      throw new Error(`[Drive ${res.status}] Failed to update "${fileName}": ${errText}`);
    }

    if (appProperties) {
      await driveRequest(token, `/files/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ appProperties }),
      });
    }

    return existing.id;
  }

  const buffer = Buffer.from(content, 'utf-8');
  return uploadToDrive(token, fileName, mimeType, parentFolderId, buffer, appProperties);
}

export async function upsertJsonFileInFolder(
  token: string,
  parentFolderId: string,
  fileName: string,
  value: unknown,
  appProperties?: Record<string, string>
): Promise<string> {
  return upsertTextFileInFolder(
    token,
    parentFolderId,
    fileName,
    JSON.stringify(value, null, 2),
    'application/json',
    appProperties
  );
}

export async function readJsonFileFromDrive<T>(
  token: string,
  fileId: string,
  fallback: T
): Promise<T> {
  try {
    const text = await downloadTextFromDrive(token, fileId);
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * Download a file as a binary buffer from Google Drive.
 */
export async function downloadFileBuffer(token: string, fileId: string): Promise<Buffer> {
  const res = await fetch(`${driveApi}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`[Drive ${res.status}] Failed to download file ${fileId}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function extractTextFromBuffer(
  file: { name: string; mimeType: string },
  buffer: Buffer,
  maxChars = 2000
): Promise<string> {
  try {
    if (file.mimeType === 'text/plain' || file.name.endsWith('.txt')) {
      return buffer.toString('utf-8').substring(0, maxChars);
    }

    if (file.mimeType === 'application/pdf' || file.name.endsWith('.pdf')) {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      await parser.destroy();
      return (result.text || '').substring(0, maxChars);
    }

    if (
      file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimeType === 'application/msword' ||
      file.name.endsWith('.docx') ||
      file.name.endsWith('.doc')
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return (result.value || '').substring(0, maxChars);
    }

    return '';
  } catch (err) {
    console.error(`[extractTextFromBuffer] Failed for ${file.name}:`, err);
    return '';
  }
}

/**
 * Extract readable text from a Drive file based on its MIME type.
 * Supports: text/plain, Google Docs, PDF, DOCX, and Word.
 */
export async function extractTextFromFile(
  token: string,
  file: { id: string; name: string; mimeType: string },
  maxChars = 2000
): Promise<string> {
  try {
    if (file.mimeType === 'application/vnd.google-apps.document') {
      const exportRes = await fetch(
        `${driveApi}/files/${file.id}/export?mimeType=text/plain`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!exportRes.ok) {
        throw new Error(`[Drive ${exportRes.status}] Failed to export Google Doc ${file.id}`);
      }
      return (await exportRes.text()).substring(0, maxChars);
    }

    if (file.mimeType === 'text/plain' || file.name.endsWith('.txt')) {
      const text = await downloadTextFromDrive(token, file.id);
      return text.substring(0, maxChars);
    }

    if (
      file.mimeType === 'application/pdf' ||
      file.name.endsWith('.pdf') ||
      file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimeType === 'application/msword' ||
      file.name.endsWith('.docx') ||
      file.name.endsWith('.doc')
    ) {
      const buffer = await downloadFileBuffer(token, file.id);
      return extractTextFromBuffer(file, buffer, maxChars);
    }

    return '';
  } catch (err) {
    console.error(`[extractTextFromFile] Failed for ${file.name}:`, err);
    return '';
  }
}

/**
 * Recursively fetch all files in a Drive folder.
 */
export async function fetchAllFilesInFolder(
  token: string,
  folderId: string
): Promise<Array<{
  id: string;
  name: string;
  mimeType: string;
  appProperties?: Record<string, string>;
  createdTime?: string;
  modifiedTime?: string;
}>> {
  const allFiles: Array<{
    id: string;
    name: string;
    mimeType: string;
    appProperties?: Record<string, string>;
    createdTime?: string;
    modifiedTime?: string;
  }> = [];
  const searchQuery = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const filesRes = await fetch(
    `${driveApi}/files?q=${searchQuery}&fields=files(id,name,mimeType,appProperties,createdTime,modifiedTime)&pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!filesRes.ok) {
    throw new Error(`[Drive ${filesRes.status}] Failed to list files in folder ${folderId}`);
  }

  const data = (await filesRes.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      appProperties?: Record<string, string>;
      createdTime?: string;
      modifiedTime?: string;
    }>;
  };
  const files = data.files || [];

  for (const file of files) {
    allFiles.push(file);
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      const subFiles = await fetchAllFilesInFolder(token, file.id);
      allFiles.push(...subFiles);
    }
  }
  return allFiles;
}

// --- Validation Helpers ---

export function sanitizeString(value: unknown, maxLength = 200): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[<>]/g, '').slice(0, maxLength);
}

export function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

export function isValidSex(sex: string): sex is 'M' | 'F' {
  return sex === 'M' || sex === 'F';
}

// --- Patient Folder Parsing ---

export function parseFolderString(folderName: string): { pName: string; pDob: string; pSex: string } | null {
  if (!folderName.includes('__')) return null;
  const parts = folderName.split('__');
  if (parts.length < 3) return null;

  let pName = parts[0];
  let pDob = parts[1];
  const pSex = parts[2];

  if (parts[0].includes('_')) {
    const nameParts = parts[0].split('_');
    if (nameParts.length > 1) {
      pName = `${nameParts[1]} ${nameParts[0]}`;
    } else {
      pName = parts[0].replace('_', ' ');
    }
    if (parts[1].includes('-')) {
      const d = parts[1].split('-');
      if (d[0].length === 2 && d[2]?.length === 4) {
        pDob = `${d[2]}-${d[1]}-${d[0]}`;
      }
    }
  }

  return { pName, pDob, pSex };
}

export function parsePatientFolder(f: DriveFileRaw) {
  const familyMemberIds = (f.appProperties?.familyMemberIds || '')
    .split(',')
    .map((value) => sanitizeString(value, 128))
    .filter(Boolean);

  let pName = f.appProperties?.patientName;
  let pDob = f.appProperties?.patientDob;
  let pSex = f.appProperties?.patientSex;

  if (f.name.includes('__')) {
    const parsed = parseFolderString(f.name);
    if (parsed) {
      const folderNameChanged = pName && pName !== 'Unknown' && parsed.pName !== pName;
      if (!pName || pName === 'Unknown' || pName.includes('_') || folderNameChanged) {
        pName = parsed.pName;
        pDob = parsed.pDob;
        pSex = parsed.pSex;
      }
    }
  } else {
    if (!pName || pName === 'Unknown') {
      pName = f.name;
    }
  }

  return {
    id: f.id,
    name: pName || f.name,
    dob: pDob || 'Unknown',
    sex: pSex || 'M',
    lastVisit: f.appProperties?.lastNoteDate || f.createdTime?.split('T')[0] || '',
    alerts: [] as string[],
    medicalAid: f.appProperties?.medicalAid || undefined,
    medicalAidPlan: f.appProperties?.medicalAidPlan || undefined,
    medicalAidNumber: f.appProperties?.medicalAidNumber || undefined,
    folderNumber: f.appProperties?.folderNumber || undefined,
    idNumber: f.appProperties?.idNumber || undefined,
    schemeCode: f.appProperties?.schemeCode || undefined,
    planCode: f.appProperties?.planCode || undefined,
    memberNumber: f.appProperties?.memberNumber || undefined,
    dependantCode: f.appProperties?.dependantCode || undefined,
    initials: f.appProperties?.initials || undefined,
    statusIndicator: f.appProperties?.statusIndicator || undefined,
    familyGroupId: f.appProperties?.familyGroupId || undefined,
    familyName: f.appProperties?.familyName || undefined,
    familyMemberIds: familyMemberIds.length ? Array.from(new Set(familyMemberIds)) : undefined,
  };
}
