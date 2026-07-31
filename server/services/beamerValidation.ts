export class BeamerPayloadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function validateRasterBytes(mimeType: string, bytes: Buffer): void {
  let valid = false;
  if (mimeType === 'image/jpeg') valid = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') valid = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mimeType === 'image/webp') valid = bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    const brand = bytes.length >= 12 ? bytes.subarray(8, 12).toString('ascii') : '';
    valid = bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' && ['heic','heix','hevc','hevx','mif1','msf1'].includes(brand);
  }
  if (!valid) throw new BeamerPayloadError('Image content does not match its declared type.', 415);
}

export function decodeCanonicalBase64(value: string): Buffer {
  if (!value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new BeamerPayloadError('Invalid image data.', 400);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new BeamerPayloadError('Invalid image data.', 400);
  return bytes;
}

export function assertHeartbeatSchemaVersion(value: unknown): 3 {
  if (Number(value) !== 3) {
    throw new BeamerPayloadError('Unsupported Beamer configuration schema version.', 409);
  }
  return 3;
}

export function assertAssetContentAccess(reviewStatus: string, processingStatus: string): void {
  const visibleReviewState = reviewStatus === 'approved' || reviewStatus === 'pending_review';
  if (!visibleReviewState || processingStatus !== 'ready') {
    throw new BeamerPayloadError('Upload was not found.', 404);
  }
}

export function resolveBeamerDeviceStatus(input: {
  lastSeenAt: string | null;
  nowMs: number;
  onlineThresholdMs: number;
  hasActionableWarning: boolean;
}): 'online' | 'offline' | 'attention' {
  if (input.hasActionableWarning) return 'attention';
  const lastSeenMs = input.lastSeenAt ? Date.parse(input.lastSeenAt) : 0;
  return lastSeenMs > 0 && input.nowMs - lastSeenMs <= input.onlineThresholdMs ? 'online' : 'offline';
}

export function isSafeInstallerReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function assertDownloadableRasterMetadata(mimeType: string, byteSize: number, maxBytes: number): void {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
  if (!allowed.has(mimeType) || !Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > maxBytes) {
    throw new BeamerPayloadError('Upload content is unavailable.', 404);
  }
}
