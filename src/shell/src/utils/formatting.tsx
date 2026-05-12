import React from 'react';

/**
 * Pure utility functions extracted from PatientWorkspace.
 * These have no dependency on component state and are defined at module level
 * to avoid being recreated on every render.
 */

/** Map MIME types to user-friendly labels */
export function getFriendlyFileType(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.form': 'Google Form',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
    'application/vnd.ms-excel': 'Excel',
    'application/msword': 'Word',
    'application/vnd.ms-powerpoint': 'PowerPoint',
    'text/plain': 'Text',
    'text/csv': 'CSV',
    'text/html': 'HTML',
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
    'image/svg+xml': 'SVG',
    'audio/mpeg': 'MP3',
    'audio/webm': 'WebM Audio',
    'video/mp4': 'MP4',
    'application/zip': 'ZIP',
    'application/json': 'JSON',
  };
  if (mimeMap[mimeType]) return mimeMap[mimeType];
  const sub = mimeType.split('/')[1] || 'File';
  const cleaned = sub
    .replace(/^vnd\.(google-apps\.|openxmlformats-officedocument\.|ms-)/i, '')
    .replace(/\.(sheet|document|presentation)/i, '')
    .replace(/^x-/, '');
  return cleaned.length > 12 ? cleaned.slice(0, 12).toUpperCase() : cleaned.toUpperCase();
}

/** Parse inline markdown (bold) to React elements */
export function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

/** Extract error message from any error type */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred.';
}
