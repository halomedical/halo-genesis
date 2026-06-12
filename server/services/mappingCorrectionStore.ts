import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import type { ValidatedMappingField } from '../../shared/mappingFeedback';
import {
  buildValidatedJsonFromFields,
  summarizeMappingActions,
} from '../../shared/mappingFeedback';

export interface MappingApprovalInsert {
  extractionRunId: string;
  pdfSha256: string;
  sourceFilename: string | null;
  predictionJson: Record<string, unknown>;
  validatedFields: ValidatedMappingField[];
  reviewerId: string | null;
  notes?: string | null;
}

let client: SupabaseClient | null = null;

export function isMappingCorrectionStoreConfigured(): boolean {
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

function metaFromPrediction(predictionJson: Record<string, unknown>): {
  pipelineVersion: string | null;
  coordinateSystem: string | null;
  semanticModel: string | null;
  matchmakerModel: string | null;
  physicalTextBlockCount: number | null;
} {
  const pipelineVersion =
    typeof predictionJson.pipeline_version === 'string'
      ? predictionJson.pipeline_version
      : null;
  const coordinateSystem =
    typeof predictionJson.coordinate_system === 'string'
      ? predictionJson.coordinate_system
      : null;
  const semanticModel =
    typeof predictionJson.semantic_model === 'string' ? predictionJson.semantic_model : null;
  const matchmakerModel =
    typeof predictionJson.matchmaker_model === 'string' ? predictionJson.matchmaker_model : null;
  const countRaw = predictionJson.physical_text_block_count;
  const physicalTextBlockCount =
    typeof countRaw === 'number' && Number.isFinite(countRaw) ? Math.round(countRaw) : null;
  return {
    pipelineVersion,
    coordinateSystem,
    semanticModel,
    matchmakerModel,
    physicalTextBlockCount,
  };
}

export async function insertMappingApproval(row: MappingApprovalInsert): Promise<{
  correctionId: string;
}> {
  const sb = getClient();
  const meta = metaFromPrediction(row.predictionJson);
  const validatedJson = buildValidatedJsonFromFields(row.validatedFields);
  const editSummary = summarizeMappingActions(row.validatedFields);

  const { error: runError } = await sb.from('extraction_runs').insert({
    id: row.extractionRunId,
    pdf_sha256: row.pdfSha256,
    source_filename: row.sourceFilename,
    pipeline_version: meta.pipelineVersion,
    coordinate_system: meta.coordinateSystem,
    semantic_model: meta.semanticModel,
    matchmaker_model: meta.matchmakerModel,
    prediction_json: row.predictionJson,
    physical_text_block_count: meta.physicalTextBlockCount,
    created_by: row.reviewerId,
  });

  if (runError) {
    throw new Error(`extraction_runs insert failed: ${runError.message}`);
  }

  const { data: correctionRow, error: correctionError } = await sb
    .from('mapping_corrections')
    .insert({
      extraction_run_id: row.extractionRunId,
      reviewer_id: row.reviewerId,
      pdf_sha256: row.pdfSha256,
      pipeline_version: meta.pipelineVersion,
      validated_json: validatedJson,
      edit_summary: editSummary,
      notes: row.notes ?? null,
    })
    .select('id')
    .single();

  if (correctionError || !correctionRow) {
    await sb.from('extraction_runs').delete().eq('id', row.extractionRunId);
    throw new Error(
      `mapping_corrections insert failed: ${correctionError?.message ?? 'no row returned'}`
    );
  }

  const correctionId = String(correctionRow.id);
  const fieldRows = row.validatedFields.map((f) => ({
    correction_id: correctionId,
    pdf_sha256: row.pdfSha256,
    field_id: f.field_id,
    page: f.page,
    label: f.label ?? null,
    field_type: f.field_type ?? null,
    pred_x: f.pred?.x ?? null,
    pred_y: f.pred?.y ?? null,
    pred_width: f.pred?.width ?? null,
    pred_height: f.pred?.height ?? null,
    valid_x: f.valid.x,
    valid_y: f.valid.y,
    valid_width: f.valid.width,
    valid_height: f.valid.height,
    action: f.action,
  }));

  if (fieldRows.length > 0) {
    const { error: fieldsError } = await sb.from('mapping_correction_fields').insert(fieldRows);
    if (fieldsError) {
      await sb.from('mapping_corrections').delete().eq('id', correctionId);
      await sb.from('extraction_runs').delete().eq('id', row.extractionRunId);
      throw new Error(`mapping_correction_fields insert failed: ${fieldsError.message}`);
    }
  }

  return { correctionId };
}
