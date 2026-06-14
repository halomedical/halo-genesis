import type { LucideIcon } from 'lucide-react';
import {
  ClipboardList,
  FileQuestion,
  FileSignature,
  Send,
  Shield,
} from 'lucide-react';
import type { PdfDocumentType } from '../../../../../../shared/pdfFiller';

export const PDF_DOCUMENT_TYPE_ICONS: Record<PdfDocumentType, LucideIcon> = {
  insurance_form: Shield,
  consent: FileSignature,
  referral: Send,
  clinical_form: ClipboardList,
  other: FileQuestion,
};

export function documentTypeIconClass(documentType: PdfDocumentType): string {
  switch (documentType) {
    case 'insurance_form':
      return 'bg-cyan-100 text-cyan-700';
    case 'consent':
      return 'bg-violet-100 text-violet-700';
    case 'referral':
      return 'bg-amber-100 text-amber-800';
    case 'clinical_form':
      return 'bg-emerald-100 text-emerald-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}
