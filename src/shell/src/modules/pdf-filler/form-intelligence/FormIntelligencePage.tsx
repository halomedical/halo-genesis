import React, { useCallback, useState } from 'react';
import type { PdfDocumentType } from '../../../../../../shared/pdfFiller';
import {
  ApiError,
  approvePdfMapping,
  extractPdfTemplateSchema,
  fetchPdfTemplates,
  fillPdfFormStream,
  publishPracticePdfTemplate,
} from '../services/api';
import {
  buildPredictionJsonFromExtractSchema,
  buildValidatedFieldsFromSchemas,
} from '../../../../../../shared/mappingFeedback';
import { downloadBlob } from './utils/downloadBlob';
import { fileToBase64 } from './utils/pdfFile';
import { useFormIntelligenceState } from './state/useFormIntelligenceState';
import { usePdfExtractionProgress } from '../hooks/usePdfExtractionProgress';
import { StudioSidebar } from './components/StudioSidebar';
import { IntakeSidebar } from './components/IntakeSidebar';
import { PdfStudioCanvas } from './components/PdfStudioCanvas';
import { PdfPageFooter } from './components/PdfPageFooter';
import type { PendingFieldRect } from './components/FieldEditorPanel';
import type { FieldEditorType } from './utils/schemaLayout';
import { uniqueFieldKey } from './utils/schemaLayout';

type ToastFn = (message: string, type: 'success' | 'error' | 'info') => void;

interface FormIntelligencePageProps {
  onToast?: ToastFn;
}

function defaultDisplayNameFromFile(file: File): string {
  return file.name.replace(/\.pdf$/i, '').trim() || file.name;
}

export const FormIntelligencePage: React.FC<FormIntelligencePageProps> = ({ onToast }) => {
  const state = useFormIntelligenceState();
  const { progress: extractionProgress, runWithFile: runExtractionWithProgress } =
    usePdfExtractionProgress('extract_api');
  const [documentType, setDocumentType] = useState<PdfDocumentType>('insurance_form');
  const [displayName, setDisplayName] = useState('');
  const [practiceTemplateId, setPracticeTemplateId] = useState<string | undefined>();
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<string[]>([]);
  const [primaryFieldKey, setPrimaryFieldKey] = useState<string | null>(null);
  const [pendingDrawRect, setPendingDrawRect] = useState<PendingFieldRect | null>(null);
  const [fieldEditorOpen, setFieldEditorOpen] = useState(false);

  const handleSelectionChange = useCallback((keys: string[], primary?: string | null) => {
    setSelectedFieldKeys(keys);
    setPrimaryFieldKey(primary ?? keys[0] ?? null);
    setFieldEditorOpen(false);
  }, []);

  const handleSelectFields = useCallback(
    (keys: string[], primary?: string | null, _toggle?: boolean) => {
      setSelectedFieldKeys(keys);
      setPrimaryFieldKey(primary ?? keys[0] ?? null);
      if (keys.length === 1) setFieldEditorOpen(true);
    },
    []
  );

  const syncPracticeTemplateMeta = useCallback(async (pdfHash: string, file: File) => {
    setDisplayName(defaultDisplayNameFromFile(file));
    setPracticeTemplateId(undefined);
    try {
      const { templates } = await fetchPdfTemplates();
      const existing = templates.find((t) => t.pdfHash === pdfHash);
      if (existing) {
        setPracticeTemplateId(existing.templateId);
        setDocumentType(existing.documentType);
        setDisplayName(existing.displayName);
      }
    } catch {
      // Non-fatal — user can still publish with defaults
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      state.resetForNewFile(file);
      setSelectedFieldKeys([]);
      setPrimaryFieldKey(null);
      setPendingDrawRect(null);
      setFieldEditorOpen(false);
      setDisplayName(defaultDisplayNameFromFile(file));
      setPracticeTemplateId(undefined);
      state.setExtracting(true);
      state.setExtractError(null);
      try {
        const result = await runExtractionWithProgress(file, (fileData) =>
          extractPdfTemplateSchema({ fileName: file.name, fileData })
        );
        const extractionRunId = crypto.randomUUID();
        const predictionJson = buildPredictionJsonFromExtractSchema(result.schema, {
          sourceFilename: file.name,
          extractionMethod: result.extractionMethod,
          schemaVersion: result.schemaVersion,
        });
        predictionJson.pdf_sha256 = result.pdfSha256;
        state.applyExtractResult({
          ...result,
          extractionRunId,
          predictionJson,
        });
        void syncPracticeTemplateMeta(result.pdfHash, file);
        const fieldCount = Object.keys(
          (result.schema.properties || {}) as Record<string, unknown>
        ).length;
        if (fieldCount === 0) {
          onToast?.('Extraction finished but no fields were found in the schema.', 'error');
        } else {
          onToast?.(
            result.cacheHit
              ? `Layout loaded from global cache (${fieldCount} fields).`
              : `Field schema extracted (${fieldCount} fields).`,
            'success'
          );
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Extraction failed';
        state.setExtractError(message);
        onToast?.(message, 'error');
      } finally {
        state.setExtracting(false);
      }
    },
    [onToast, runExtractionWithProgress, state, syncPracticeTemplateMeta]
  );

  const handleSaveTemplate = useCallback(async () => {
    if (!state.pdfHash || !state.schema || !state.uploadedFile) return;
    state.setSaving(true);
    let mappingFieldCount: number | null = null;
    try {
      if (
        state.baselineSchema &&
        state.predictionJson &&
        state.extractionRunId &&
        state.pdfSha256
      ) {
        const validated_fields = buildValidatedFieldsFromSchemas(
          state.baselineSchema,
          state.schema
        );
        if (validated_fields.length > 0) {
          try {
            const approval = await approvePdfMapping({
              extraction_run_id: state.extractionRunId,
              pdf_sha256: state.pdfSha256,
              source_filename: state.uploadedFile.name,
              prediction_json: state.predictionJson,
              validated_fields,
            });
            mappingFieldCount = approval.field_count;
            state.setExtractionRunId(crypto.randomUUID());
          } catch (approveErr) {
            const skip =
              approveErr instanceof ApiError &&
              (approveErr.status === 503 || approveErr.status === 409);
            if (!skip) {
              const msg =
                approveErr instanceof Error ? approveErr.message : 'Approve mapping failed';
              onToast?.(`Layout training record failed: ${msg}`, 'error');
            }
          }
        }
      }

      const fileData = await fileToBase64(state.uploadedFile);
      const result = await publishPracticePdfTemplate({
        fileName: state.uploadedFile.name,
        fileData,
        pdfHash: state.pdfHash,
        schema: state.schema,
        documentType,
        displayName: displayName.trim() || defaultDisplayNameFromFile(state.uploadedFile),
        templateId: practiceTemplateId,
        extractionMethod: 'human_corrected',
        baselineSchema: state.baselineSchema ?? undefined,
        baselineExtractionMethod: state.extractionMethod || undefined,
      });
      setPracticeTemplateId(result.template.templateId);
      const trainingNote =
        mappingFieldCount != null
          ? ` Layout corrections (${mappingFieldCount} fields) recorded for training.`
          : '';
      onToast?.(
        `Form "${result.template.displayName}" saved to Practice Admin — available on patient Form Intelligence.${trainingNote}`,
        'success'
      );
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      state.setSaving(false);
    }
  }, [displayName, documentType, onToast, practiceTemplateId, state]);

  const handleCompile = useCallback(async () => {
    if (!state.uploadedFile || !state.schema) return;
    state.setCompiling(true);
    try {
      const fileData = await fileToBase64(state.uploadedFile);
      const blob = await fillPdfFormStream({
        fileName: state.uploadedFile.name,
        fileData,
        schema: state.schema,
        answers: { ...state.formData },
      });
      const outName = `filled-${state.uploadedFile.name.replace(/\.pdf$/i, '')}.pdf`;
      downloadBlob(blob, outName);
      onToast?.('Filled PDF downloaded.', 'success');
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Compile failed', 'error');
    } finally {
      state.setCompiling(false);
    }
  }, [onToast, state]);

  const handleDrawComplete = useCallback((rect: PendingFieldRect) => {
    setPendingDrawRect(rect);
    setFieldEditorOpen(false);
  }, []);

  const handlePendingFieldSave = useCallback(
    (params: { title: string; key: string; fieldType: FieldEditorType }) => {
      if (!pendingDrawRect || !state.schema) return;
      const key = uniqueFieldKey(state.schema, params.key);
      const added = state.addField({
        ...pendingDrawRect,
        title: params.title,
        key,
        fieldType: params.fieldType,
      });
      setPendingDrawRect(null);
      if (added) {
        setSelectedFieldKeys([added]);
        setPrimaryFieldKey(added);
        setFieldEditorOpen(false);
      }
    },
    [pendingDrawRect, state]
  );

  const handleEditFieldSave = useCallback(
    (params: { title: string; key: string; fieldType: FieldEditorType }) => {
      if (!primaryFieldKey) return;
      const key =
        state.schema && params.key !== primaryFieldKey
          ? uniqueFieldKey(state.schema, params.key, primaryFieldKey)
          : params.key;
      state.updateFieldMeta(primaryFieldKey, {
        title: params.title,
        key,
        fieldType: params.fieldType,
      });
      setSelectedFieldKeys([key]);
      setPrimaryFieldKey(key);
      setFieldEditorOpen(false);
    },
    [primaryFieldKey, state]
  );

  const modeToggle = (
    <div className="flex shrink-0 gap-1 p-1 m-4 mb-0 rounded-xl bg-slate-200/60 border border-slate-200">
      {(['studio', 'intake'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => state.setCurrentMode(mode)}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
            state.currentMode === mode
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          {mode === 'studio' ? 'Template Studio' : 'Data Intake'}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100">
      <div className="flex flex-1 min-h-0">
        <aside className="w-[400px] shrink-0 border-r border-slate-200 bg-slate-50/50 flex flex-col min-h-0">
          {modeToggle}
          <div className="flex-1 min-h-0 overflow-hidden">
            {state.currentMode === 'studio' ? (
              <StudioSidebar
                uploadedFile={state.uploadedFile}
                extracting={state.extracting}
                extractionProgress={extractionProgress}
                extractError={state.extractError}
                pdfHash={state.pdfHash}
                cacheHit={state.cacheHit}
                extractionMethod={state.extractionMethod}
                currentPage={state.currentPage}
                fields={state.fields}
                selectedFieldKeys={selectedFieldKeys}
                primaryFieldKey={primaryFieldKey}
                canvasMode={state.studioCanvasMode}
                pendingDrawRect={pendingDrawRect}
                editorOpen={fieldEditorOpen}
                onSelectFields={handleSelectFields}
                onCanvasModeChange={state.setStudioCanvasMode}
                onFile={(file) => void handleFile(file)}
                saving={state.saving}
                documentType={documentType}
                displayName={displayName}
                onDocumentTypeChange={setDocumentType}
                onDisplayNameChange={setDisplayName}
                practiceTemplateId={practiceTemplateId}
                onSaveTemplate={() => void handleSaveTemplate()}
                canSave={Boolean(state.pdfHash && state.schema && state.uploadedFile)}
                onNudge={(dx, dy) => state.nudgeSelectedFields(selectedFieldKeys, dx, dy)}
                onDeleteSelected={() => {
                  state.removeFields(selectedFieldKeys);
                  setSelectedFieldKeys([]);
                  setPrimaryFieldKey(null);
                  setFieldEditorOpen(false);
                }}
                onPendingFieldSave={handlePendingFieldSave}
                onPendingFieldCancel={() => {
                  setPendingDrawRect(null);
                  state.setStudioCanvasMode('select');
                }}
                onEditFieldSave={handleEditFieldSave}
                onEditFieldCancel={() => setFieldEditorOpen(false)}
                onOpenFieldEditor={() => setFieldEditorOpen(true)}
                getFieldMeta={state.getFieldMeta}
              />
            ) : (
              <IntakeSidebar
                hasSchema={Boolean(state.schema)}
                schema={state.schema}
                formData={state.formData}
                onFormChange={(key, value) =>
                  state.setFormData((prev) => ({ ...prev, [key]: value }))
                }
                compiling={state.compiling}
                onCompile={() => void handleCompile()}
                canCompile={Boolean(state.uploadedFile && state.schema)}
              />
            )}
          </div>
        </aside>

        <main className="flex flex-1 flex-col min-h-0 min-w-0">
          {state.currentMode === 'studio' ? (
            <>
              <PdfStudioCanvas
                file={state.uploadedFile}
                currentPage={state.currentPage}
                fields={state.fields}
                selectedFieldKeys={selectedFieldKeys}
                canvasMode={state.studioCanvasMode}
                getFieldType={(key) => state.getFieldMeta(key)?.fieldType ?? 'text'}
                onCanvasModeChange={state.setStudioCanvasMode}
                onSelectionChange={handleSelectionChange}
                onFieldLayoutChange={state.updateFieldLayout}
                onFieldsLayoutChange={state.updateFieldsLayout}
                onDrawFieldComplete={handleDrawComplete}
                onDocumentLoad={state.setNumPages}
                onPageNativeWidth={() => {}}
              />
              <PdfPageFooter
                currentPage={state.currentPage}
                numPages={state.numPages}
                onPageChange={state.setCurrentPage}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="max-w-md text-center space-y-2">
                <p className="text-lg font-semibold text-slate-800">Data Intake</p>
                <p className="text-sm text-slate-500">
                  Complete the form in the left panel, then compile to download a filled PDF. Use
                  Template Studio to verify field boxes on the document.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
