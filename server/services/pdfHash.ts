import { createHash } from 'crypto';

const MD5_HEX_RE = /^[a-f0-9]{32}$/i;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

export function md5HexPdf(buffer: Buffer): string {
  return createHash('md5').update(buffer).digest('hex');
}

export function sha256HexPdf(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function isValidPdfHash(value: string): boolean {
  return MD5_HEX_RE.test(value);
}

export function isValidPdfSha256(value: string): boolean {
  return SHA256_HEX_RE.test(value);
}
