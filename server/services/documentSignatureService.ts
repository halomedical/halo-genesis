import crypto from 'crypto';
import PizZip from 'pizzip';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  getSignaturePolicy,
  normalizeSignatureOptions,
  type SignatureAssetMetadata,
  type SignatureOptions,
} from '../../shared/documentSignatures';
import type { UserSettings } from '../../shared/types';
import {
  deleteDriveFile,
  downloadFileBuffer,
  getHaloRootFolder,
  getOrCreateNamedSubfolder,
  uploadFileToDrive,
} from './drive';
import { loadUserSettings, saveUserSettings } from './settingsStore';

const SIGNATURES_FOLDER = 'Signatures';
const PNG_MIME = 'image/png';
const MAX_SIGNATURE_BYTES = 1_000_000;
const EMU_PER_INCH = 914400;
const DEFAULT_SIGNATURE_WIDTH_EMU = Math.round(2.15 * EMU_PER_INCH);
const MAX_SIGNATURE_HEIGHT_EMU = Math.round(0.85 * EMU_PER_INCH);
const LINE_SIGNATURE_WIDTH_EMU = Math.round(1.75 * EMU_PER_INCH);
const LINE_SIGNATURE_HEIGHT_EMU = Math.round(0.42 * EMU_PER_INCH);

export interface ResolvedDocumentSignature {
  mode: 'typed' | 'image';
  signedBy: string;
  signedByEmail: string;
  signedAt: string;
  typedSignature: string;
  mpNumber: string;
  image?: {
    buffer: Buffer;
    mimeType: 'image/png';
    fileId: string;
    widthPx: number;
    heightPx: number;
  };
}

function sanitizeEmailForFile(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 120) || 'clinician';
}

function extractPngBuffer(imageBase64: string, mimeType?: string): Buffer {
  const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
  const resolvedMime = (match?.[1] || mimeType || PNG_MIME).toLowerCase();
  if (resolvedMime !== PNG_MIME) {
    throw Object.assign(new Error('Signature must be a PNG image.'), { status: 400 });
  }

  const payload = match?.[2] || imageBase64;
  const buffer = Buffer.from(payload, 'base64');
  if (!buffer.length || buffer.length > MAX_SIGNATURE_BYTES) {
    throw Object.assign(new Error('Signature image must be smaller than 1MB.'), { status: 400 });
  }
  assertPng(buffer);
  return buffer;
}

function assertPng(buffer: Buffer): void {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(pngHeader)) {
    throw Object.assign(new Error('Signature must be a valid PNG image.'), { status: 400 });
  }
}

function getPngDimensions(buffer: Buffer): { widthPx: number; heightPx: number } {
  assertPng(buffer);
  return {
    widthPx: buffer.readUInt32BE(16),
    heightPx: buffer.readUInt32BE(20),
  };
}

async function getOrCreateSignaturesFolder(token: string): Promise<string> {
  const rootId = await getHaloRootFolder(token);
  const practiceAdminId = await getOrCreateNamedSubfolder(token, rootId, 'Practice Admin');
  return getOrCreateNamedSubfolder(token, practiceAdminId, SIGNATURES_FOLDER);
}

export function getSignatureAssetMetadata(settings: UserSettings): SignatureAssetMetadata | null {
  if (!settings.signatureImageFileId || settings.signatureImageMimeType !== PNG_MIME || !settings.signatureImageUpdatedAt) {
    return null;
  }
  return {
    fileId: settings.signatureImageFileId,
    mimeType: PNG_MIME,
    updatedAt: settings.signatureImageUpdatedAt,
    source: settings.signatureImageSource === 'drawn' ? 'drawn' : 'upload',
  };
}

export async function saveSignatureAsset(params: {
  token: string;
  email: string;
  imageBase64: string;
  source: 'upload' | 'drawn';
  mimeType?: string;
}): Promise<SignatureAssetMetadata> {
  const buffer = extractPngBuffer(params.imageBase64, params.mimeType);
  const folderId = await getOrCreateSignaturesFolder(params.token);
  const settings = loadUserSettings(params.email);
  const updatedAt = new Date().toISOString();
  const fileName = `${sanitizeEmailForFile(params.email)}_signature_${updatedAt.replace(/[:.]/g, '-')}.png`;
  const uploaded = await uploadFileToDrive(
    params.token,
    folderId,
    fileName,
    PNG_MIME,
    buffer,
    {
      haloSystem: 'signature',
      clinicianEmail: params.email.toLowerCase(),
      signatureSource: params.source,
      uploadedAt: updatedAt,
    }
  );

  if (settings.signatureImageFileId && settings.signatureImageFileId !== uploaded.id) {
    await deleteDriveFile(params.token, settings.signatureImageFileId).catch((err) =>
      console.warn('[signature] Could not delete previous signature asset:', err)
    );
  }

  saveUserSettings(params.email, {
    signatureImageFileId: uploaded.id,
    signatureImageMimeType: PNG_MIME,
    signatureImageUpdatedAt: updatedAt,
    signatureImageSource: params.source,
    signatureMode: 'image',
  });

  return {
    fileId: uploaded.id,
    mimeType: PNG_MIME,
    updatedAt,
    source: params.source,
  };
}

export async function deleteSignatureAsset(token: string, email: string): Promise<void> {
  const settings = loadUserSettings(email);
  if (settings.signatureImageFileId) {
    await deleteDriveFile(token, settings.signatureImageFileId).catch((err) =>
      console.warn('[signature] Could not delete signature asset:', err)
    );
  }
  saveUserSettings(email, {
    signatureImageFileId: '',
    signatureImageMimeType: undefined,
    signatureImageUpdatedAt: '',
    signatureImageSource: undefined,
    signatureMode: 'typed',
  });
}

export async function resolveDocumentSignature(params: {
  token: string;
  email: string;
  actorName: string;
  policyKey: string;
  options?: SignatureOptions | null;
}): Promise<ResolvedDocumentSignature | null> {
  const settings = loadUserSettings(params.email);
  const hasImageSignature = Boolean(settings.signatureImageFileId);
  const normalized = normalizeSignatureOptions(
    params.options,
    getSignaturePolicy(params.policyKey),
    hasImageSignature
  );
  if (!normalized.includeSignature || normalized.mode === 'none') return null;

  const typedSignature = settings.signature?.trim() ||
    params.actorName
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .join('')
      .slice(0, 10);

  const base = {
    mode: normalized.mode === 'image' ? 'image' as const : 'typed' as const,
    signedBy: params.actorName,
    signedByEmail: params.email,
    signedAt: new Date().toISOString(),
    typedSignature,
    mpNumber: settings.mpNumber || '',
  };

  if (normalized.mode !== 'image' || !settings.signatureImageFileId) {
    return base;
  }

  const buffer = await downloadFileBuffer(params.token, settings.signatureImageFileId);
  const dimensions = getPngDimensions(buffer);
  return {
    ...base,
    mode: 'image',
    image: {
      buffer,
      mimeType: PNG_MIME,
      fileId: settings.signatureImageFileId,
      ...dimensions,
    },
  };
}

function textParagraphXml(text: string, bold = false): string {
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<w:p><w:r>${bold ? '<w:rPr><w:b/><w:bCs/></w:rPr>' : ''}<w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
}

function imageRelationshipId(relsXml: string): string {
  let id = `rIdHaloSignature${crypto.randomUUID().replace(/-/g, '')}`;
  while (relsXml.includes(`Id="${id}"`)) {
    id = `rIdHaloSignature${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return id;
}

function signatureImageXml(signature: ResolvedDocumentSignature, relationshipId: string): string {
  return `<w:p>${signatureImageRunXml(signature, relationshipId)}</w:p>`;
}

function signatureImageRunXml(
  signature: ResolvedDocumentSignature,
  relationshipId: string,
  widthEmu = DEFAULT_SIGNATURE_WIDTH_EMU,
  maxHeightEmu = MAX_SIGNATURE_HEIGHT_EMU
): string {
  const image = signature.image;
  if (!image) return '';
  const aspectHeight = image.widthPx > 0
    ? Math.round(widthEmu * (image.heightPx / image.widthPx))
    : maxHeightEmu;
  const heightEmu = Math.min(Math.max(aspectHeight, Math.round(0.22 * EMU_PER_INCH)), maxHeightEmu);

  return `
  <w:r>
    <w:drawing>
      <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="${widthEmu}" cy="${heightEmu}"/>
        <wp:docPr id="1" name="Clinician Signature"/>
        <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:nvPicPr>
                <pic:cNvPr id="0" name="signature.png"/>
                <pic:cNvPicPr/>
              </pic:nvPicPr>
              <pic:blipFill>
                <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relationshipId}"/>
                <a:stretch><a:fillRect/></a:stretch>
              </pic:blipFill>
              <pic:spPr>
                <a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>`.replace(/\n\s*/g, '');
}

function signatureText(signature: ResolvedDocumentSignature): string[] {
  const lines = [
    'Signed electronically',
    `Clinician: ${signature.signedBy}`,
    signature.mpNumber ? `MP number: ${signature.mpNumber}` : '',
    `Signed at: ${signature.signedAt}`,
  ].filter(Boolean);
  if (signature.mode === 'typed') {
    lines.splice(1, 0, `Signature: ${signature.typedSignature}`);
  }
  return lines;
}

export function applySignatureToDocx(buffer: Buffer, signature: ResolvedDocumentSignature | null): Buffer {
  return applySignatureToDocxWithOptions(buffer, signature);
}

export function applySignatureToDocxWithOptions(
  buffer: Buffer,
  signature: ResolvedDocumentSignature | null,
  options: { placement?: 'append' | 'doctor_signature_line' } = {}
): Buffer {
  if (!signature) return buffer;

  const zip = new PizZip(buffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) return buffer;

  let relationshipId = '';
  if (signature.image) {
    const imagePath = `word/media/halo-signature-${crypto.randomUUID()}.png`;
    zip.file(imagePath, signature.image.buffer);

    const relsPath = 'word/_rels/document.xml.rels';
    const relsFile = zip.file(relsPath);
    const relsXml = relsFile?.asText() ||
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    relationshipId = imageRelationshipId(relsXml);
    const nextRelsXml = relsXml.replace(
      '</Relationships>',
      `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${imagePath.split('/').pop()}"/></Relationships>`
    );
    zip.file(relsPath, nextRelsXml);

    const contentTypesPath = '[Content_Types].xml';
    const contentTypes = zip.file(contentTypesPath)?.asText();
    if (contentTypes && !contentTypes.includes('Extension="png"')) {
      zip.file(
        contentTypesPath,
        contentTypes.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')
      );
    }
  }

  const signatureLineXml = signature.image
    ? `<w:p><w:r><w:t xml:space="preserve">Doctor's Signature: </w:t></w:r>${signatureImageRunXml(
        signature,
        relationshipId,
        LINE_SIGNATURE_WIDTH_EMU,
        LINE_SIGNATURE_HEIGHT_EMU
      )}</w:p>`
    : textParagraphXml(`Doctor's Signature: ${signature.typedSignature}`);

  const appendedSignatureXml = [
    textParagraphXml('Signature', true),
    signature.image ? signatureImageXml(signature, relationshipId) : '',
    ...signatureText(signature).map((line) => textParagraphXml(line)),
  ].join('');

  const xml = documentFile.asText();
  if (options.placement === 'doctor_signature_line') {
    let replaced = false;
    const nextXml = xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
      if (replaced) return paragraph;
      const text = paragraph
        .replace(/<[^>]+>/g, '')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
      if (!/doctor'?s\s+signature/i.test(text)) return paragraph;
      replaced = true;
      return signatureLineXml;
    });
    if (replaced) {
      zip.file('word/document.xml', nextXml);
      return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
    }
  }

  const insertAtSectPr = xml.lastIndexOf('<w:sectPr');
  const nextXml = insertAtSectPr >= 0
    ? `${xml.slice(0, insertAtSectPr)}${appendedSignatureXml}${xml.slice(insertAtSectPr)}`
    : xml.replace('</w:body>', `${appendedSignatureXml}</w:body>`);
  zip.file('word/document.xml', nextXml);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}

export async function applySignatureToPdf(buffer: Buffer, signature: ResolvedDocumentSignature | null): Promise<Buffer> {
  if (!signature) return buffer;

  const pdfDoc = await PDFDocument.load(buffer);
  const pages = pdfDoc.getPages();
  const page = pages[pages.length - 1];
  if (!page) return buffer;

  const { width } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let y = 54;

  if (signature.image) {
    const image = await pdfDoc.embedPng(signature.image.buffer);
    const targetWidth = 155;
    const targetHeight = Math.min(62, targetWidth * (signature.image.heightPx / signature.image.widthPx));
    page.drawImage(image, {
      x: 54,
      y,
      width: targetWidth,
      height: targetHeight,
    });
    y -= 14;
  }

  const lines = signatureText(signature);
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: 54,
      y: y - index * 11,
      size: 8,
      font,
      color: rgb(0.15, 0.18, 0.22),
      maxWidth: width - 108,
    });
  });

  return Buffer.from(await pdfDoc.save());
}

export function signatureAppProperties(signature: ResolvedDocumentSignature | null): Record<string, string> {
  if (!signature) return {};
  return {
    signed: 'true',
    signedBy: signature.signedByEmail,
    signedAt: signature.signedAt,
    signatureMode: signature.mode,
    ...(signature.image?.fileId ? { signatureAssetFileId: signature.image.fileId } : {}),
  };
}
