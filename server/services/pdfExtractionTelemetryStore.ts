import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

export type PdfExtractionFlow = 'extract_api' | 'template_upload';

export interface PdfExtractionTelemetryRow {
  pdf_hash?: string | null;
  file_size_bytes: number;
  duration_ms: number;
  cache_hit: boolean;
  extraction_method?: string | null;
  flow: PdfExtractionFlow;
  success: boolean;
}

const FALLBACK_BASELINE_MS: Record<PdfExtractionFlow, number> = {
  extract_api: 90_000,
  template_upload: 120_000,
};

const PADDING_MULTIPLIER = 1.5;

let client: SupabaseClient | null = null;

export function isPdfExtractionTelemetryConfigured(): boolean {
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

export async function insertPdfExtractionTelemetry(row: PdfExtractionTelemetryRow): Promise<void> {
  if (!isPdfExtractionTelemetryConfigured()) return;

  try {
    const sb = getClient();
    const { error } = await sb.from('pdf_extraction_telemetry').insert({
      pdf_hash: row.pdf_hash ?? null,
      file_size_bytes: row.file_size_bytes,
      duration_ms: Math.max(0, Math.round(row.duration_ms)),
      cache_hit: row.cache_hit,
      extraction_method: row.extraction_method ?? null,
      flow: row.flow,
      success: row.success,
    });
    if (error) {
      console.warn('[pdfExtractionTelemetry] insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[pdfExtractionTelemetry] insert error:', err);
  }
}

export async function getEstimatedExtractionDurationMs(params: {
  fileSizeBytes: number;
  flow: PdfExtractionFlow;
}): Promise<{ baselineDurationMs: number; paddedDurationMs: number }> {
  const fallback = FALLBACK_BASELINE_MS[params.flow];
  let baseline = fallback;

  if (isPdfExtractionTelemetryConfigured()) {
    try {
      const sb = getClient();
      const { data, error } = await sb.rpc('median_pdf_extraction_duration_ms', {
        p_file_size_bytes: params.fileSizeBytes,
        p_flow: params.flow,
      });
      if (!error && typeof data === 'number' && data > 0) {
        baseline = data;
      }
    } catch (err) {
      console.warn('[pdfExtractionTelemetry] estimate rpc error:', err);
    }
  }

  const paddedDurationMs = Math.round(baseline * PADDING_MULTIPLIER);
  return { baselineDurationMs: baseline, paddedDurationMs };
}
