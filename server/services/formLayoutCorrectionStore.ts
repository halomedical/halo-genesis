import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import type { FieldChangeRecord, LayoutCorrectionSummary } from '../utils/schemaLayoutDiff';

export interface FormLayoutCorrectionRow {
  pdf_hash: string;
  baseline_extraction_method: string | null;
  baseline_schema_version: number | null;
  field_changes: FieldChangeRecord[];
  summary: LayoutCorrectionSummary;
  saved_by: string | null;
}

let client: SupabaseClient | null = null;

export function isFormLayoutCorrectionStoreConfigured(): boolean {
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

export async function insertLayoutCorrection(row: FormLayoutCorrectionRow): Promise<void> {
  const sb = getClient();
  const { error } = await sb.from('form_layout_corrections').insert({
    pdf_hash: row.pdf_hash,
    baseline_extraction_method: row.baseline_extraction_method,
    baseline_schema_version: row.baseline_schema_version,
    field_changes: row.field_changes,
    summary: row.summary,
    saved_by: row.saved_by,
  });

  if (error) {
    throw new Error(`form_layout_corrections insert failed: ${error.message}`);
  }
}
