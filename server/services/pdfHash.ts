import { createHash } from 'crypto';

const MD5_HEX_RE = /^[a-f0-9]{32}$/i;

export function md5HexPdf(buffer: Buffer): string {
  return createHash('md5').update(buffer).digest('hex');
}

export function isValidPdfHash(value: string): boolean {
  return MD5_HEX_RE.test(value);
}
