import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

export interface FormTemplateRow {
  pdf_hash: string;
  schema_json: Record<string, unknown>;
  extraction_method: string;
  schema_version: number;
}

let client: SupabaseClient | null = null;

export function isFormTemplateCacheConfigured(): boolean {
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

export async function getGlobalSchemaByHash(pdfHash: string): Promise<FormTemplateRow | null> {
  const sb = getClient();
  const { data, error } = await sb
    .from('form_templates')
    .select('pdf_hash, schema_json, extraction_method, schema_version')
    .eq('pdf_hash', pdfHash)
    .maybeSingle();

  if (error) {
    // Missing migration or transient Supabase errors should not block Railway extract.
    console.warn('[formTemplateCache] read skipped:', error.message);
    return null;
  }
  if (!data) return null;

  void sb.rpc('increment_form_template_hit', { p_pdf_hash: pdfHash }).then(({ error: rpcErr }) => {
    if (rpcErr) console.warn('[formTemplateCache] increment_form_template_hit:', rpcErr.message);
  });

  return data as FormTemplateRow;
}

export async function upsertGlobalSchema(row: FormTemplateRow): Promise<void> {
  const sb = getClient();
  const { error } = await sb.from('form_templates').upsert(
    {
      pdf_hash: row.pdf_hash,
      schema_json: row.schema_json,
      extraction_method: row.extraction_method,
      schema_version: row.schema_version,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'pdf_hash' }
  );

  if (error) {
    throw new Error(`form_templates upsert failed: ${error.message}`);
  }
}
