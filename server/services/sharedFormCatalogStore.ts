import { createHash } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import type { PdfDocumentType } from '../../shared/pdfFiller';

export interface SharedFormCatalogRow {
  pdf_hash: string;
  display_name: string;
  document_type: PdfDocumentType;
  insurance_company_id: string | null;
  shared_by: string;
  is_public: boolean;
  schema_version: number;
  extraction_method: string;
  import_count: number;
  created_at: string;
  updated_at: string;
}

export interface SharedFormCatalogAggregate {
  pdf_hash: string;
  display_name: string;
  document_type: PdfDocumentType;
  insurance_company_id: string | null;
  schema_version: number;
  extraction_method: string;
  import_count: number;
  contributor_count: number;
}

let client: SupabaseClient | null = null;

export function isSharedFormCatalogConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

function getClient(): SupabaseClient {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
  }
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function practiceShareKeyFromEmail(email: string): string {
  return createHash('sha256')
    .update(`halo-share:${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

export async function upsertSharedFormCatalogEntry(input: {
  pdfHash: string;
  displayName: string;
  documentType: PdfDocumentType;
  insuranceCompanyId?: string;
  sharedBy: string;
  isPublic: boolean;
  schemaVersion: number;
  extractionMethod: string;
}): Promise<void> {
  if (!isSharedFormCatalogConfigured()) return;

  const sb = getClient();
  const { error } = await sb.from('shared_form_catalog').upsert(
    {
      pdf_hash: input.pdfHash,
      display_name: input.displayName,
      document_type: input.documentType,
      insurance_company_id: input.insuranceCompanyId ?? null,
      shared_by: input.sharedBy,
      is_public: input.isPublic,
      schema_version: input.schemaVersion,
      extraction_method: input.extractionMethod,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'pdf_hash' }
  );

  if (error) {
    console.warn('[sharedFormCatalog] upsert failed (non-fatal):', error.message);
  }
}

export async function listPublicSharedFormCatalog(filters: {
  documentType?: PdfDocumentType;
  insuranceCompanyId?: string;
}): Promise<SharedFormCatalogAggregate[]> {
  if (!isSharedFormCatalogConfigured()) return [];

  const sb = getClient();
  let query = sb.from('shared_form_catalog').select('*').eq('is_public', true);

  if (filters.documentType) {
    query = query.eq('document_type', filters.documentType);
  }
  if (filters.insuranceCompanyId) {
    query = query.eq('insurance_company_id', filters.insuranceCompanyId);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[sharedFormCatalog] list failed:', error.message);
    return [];
  }

  const rows = (data ?? []) as SharedFormCatalogRow[];
  const byHash = new Map<string, SharedFormCatalogAggregate>();

  for (const row of rows) {
    const existing = byHash.get(row.pdf_hash);
    if (!existing) {
      byHash.set(row.pdf_hash, {
        pdf_hash: row.pdf_hash,
        display_name: row.display_name,
        document_type: row.document_type as PdfDocumentType,
        insurance_company_id: row.insurance_company_id,
        schema_version: row.schema_version,
        extraction_method: row.extraction_method,
        import_count: row.import_count,
        contributor_count: 1,
      });
    } else {
      existing.contributor_count += 1;
      existing.import_count = Math.max(existing.import_count, row.import_count);
    }
  }

  return [...byHash.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export async function incrementSharedFormImportCount(pdfHash: string): Promise<void> {
  if (!isSharedFormCatalogConfigured()) return;
  const sb = getClient();
  const { data } = await sb
    .from('shared_form_catalog')
    .select('import_count')
    .eq('pdf_hash', pdfHash)
    .maybeSingle();
  const next = Number((data as { import_count?: number } | null)?.import_count ?? 0) + 1;
  await sb
    .from('shared_form_catalog')
    .update({ import_count: next, updated_at: new Date().toISOString() })
    .eq('pdf_hash', pdfHash);
}

export async function listPublicCatalogForPack(
  documentType: PdfDocumentType,
  insuranceCompanyId: string
): Promise<SharedFormCatalogAggregate[]> {
  return listPublicSharedFormCatalog({ documentType, insuranceCompanyId });
}
