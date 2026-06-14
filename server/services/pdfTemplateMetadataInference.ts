import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import { INSURANCE_COMPANIES } from '../../shared/insuranceCompanies';
import {
  isPdfDocumentType,
  PDF_DOCUMENT_TYPES,
  PDF_DOCUMENT_TYPE_LABELS,
  type PdfDocumentType,
} from '../../shared/pdfFiller';
import { humanizeTemplateName } from '../../shared/humanizeTemplateName';
import { isInsuranceCompanyId } from '../../shared/insuranceCompanies';
import { GEMINI_TIMEOUT_MS, safeJsonParse, withRetry } from './gemini';

const INFER_MODEL = 'gemini-2.5-flash';

export interface InferredTemplateMetadata {
  documentType: PdfDocumentType;
  insuranceCompanyId: string | null;
  displayName: string;
  confidence: 'high' | 'medium' | 'low';
}

type RawInference = {
  document_type?: string;
  insurance_company_id?: string | null;
  display_name?: string;
  confidence?: string;
};

function buildPrompt(fileName: string): string {
  const docTypes = PDF_DOCUMENT_TYPES.map(
    (id) => `${id} (${PDF_DOCUMENT_TYPE_LABELS[id]})`
  ).join(', ');
  const insurers = INSURANCE_COMPANIES.map((c) => `${c.id}: ${c.label}`).join('\n');

  return `You are analyzing a blank medical/practice PDF form (attached). Filename: "${fileName}".

Return ONLY JSON (no markdown):
{
  "document_type": one of [${PDF_DOCUMENT_TYPES.map((d) => `"${d}"`).join(', ')}],
  "insurance_company_id": string id from the list below, or null if not an insurance form or unknown,
  "display_name": human-readable form title as printed on the document (no underscores, proper capitalization),
  "confidence": "high" | "medium" | "low"
}

document_type options: ${docTypes}

insurance_company_id options (use exact id):
${insurers}

Rules:
- If the form is clearly from a medical scheme/insurer, set document_type to insurance_form and pick the best matching insurance_company_id.
- display_name should reflect the form title on the page, not the filename.
`;
}

export async function inferTemplateMetadataFromPdf(
  pdfBuffer: Buffer,
  fileName: string
): Promise<InferredTemplateMetadata | null> {
  if (!config.geminiApiKey?.trim()) {
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: INFER_MODEL,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const prompt = buildPrompt(fileName);
    const part = {
      inlineData: {
        data: pdfBuffer.toString('base64'),
        mimeType: 'application/pdf',
      },
    };

    const result = await withRetry(() =>
      model.generateContent([prompt, part], { timeout: GEMINI_TIMEOUT_MS })
    );
    const raw = safeJsonParse<RawInference>(result.response.text(), {});

    let documentType: PdfDocumentType = 'other';
    if (raw.document_type && isPdfDocumentType(raw.document_type)) {
      documentType = raw.document_type;
    }

    let insuranceCompanyId: string | null = null;
    if (raw.insurance_company_id && isInsuranceCompanyId(raw.insurance_company_id)) {
      insuranceCompanyId = raw.insurance_company_id;
    }

    const displayName =
      (raw.display_name?.trim() && raw.display_name.trim()) ||
      humanizeTemplateName(fileName);

    const confRaw = raw.confidence?.toLowerCase();
    const confidence: InferredTemplateMetadata['confidence'] =
      confRaw === 'high' || confRaw === 'medium' || confRaw === 'low' ? confRaw : 'medium';

    return { documentType, insuranceCompanyId, displayName, confidence };
  } catch (err) {
    console.warn('[pdf-filler] template metadata inference failed (non-fatal):', err);
    return null;
  }
}

export function mergeTemplateMetadata(params: {
  fileName: string;
  displayNameInput?: string;
  documentTypeInput: PdfDocumentType;
  insuranceCompanyIdInput?: string;
  inferred: InferredTemplateMetadata | null;
}): {
  documentType: PdfDocumentType;
  insuranceCompanyId?: string;
  displayName: string;
  inferred: InferredTemplateMetadata | null;
} {
  const { fileName, displayNameInput, documentTypeInput, insuranceCompanyIdInput, inferred } =
    params;

  let documentType = documentTypeInput;
  let insuranceCompanyId = insuranceCompanyIdInput;
  let displayName =
    displayNameInput?.trim() || humanizeTemplateName(fileName);

  if (inferred) {
    documentType = inferred.documentType;
    displayName = displayNameInput?.trim() || inferred.displayName;
    if (
      inferred.documentType === 'insurance_form' &&
      inferred.insuranceCompanyId
    ) {
      insuranceCompanyId = inferred.insuranceCompanyId;
    }
  }

  if (documentType !== 'insurance_form') {
    insuranceCompanyId = undefined;
  }

  return {
    documentType,
    insuranceCompanyId,
    displayName,
    inferred,
  };
}
