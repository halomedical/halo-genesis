import { useCallback, useMemo, useState } from 'react';
import {
  addFieldToSchema,
  applyLayoutDeltaToSchema,
  applyLayoutToSchema,
  applyLayoutsToSchema,
  cloneSchema,
  fieldMetaFromProperty,
  initialFormDataFromSchema,
  layoutFieldsFromSchema,
  removeFieldsFromSchema,
  type FieldEditorType,
  type LayoutField,
  uniqueFieldKey,
  updateFieldMeta,
} from '../utils/schemaLayout';

export type FormIntelligenceMode = 'studio' | 'intake';
export type StudioCanvasMode = 'select' | 'draw';

export function useFormIntelligenceState() {
  const [currentMode, setCurrentMode] = useState<FormIntelligenceMode>('studio');
  const [studioCanvasMode, setStudioCanvasMode] = useState<StudioCanvasMode>('select');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [pdfHash, setPdfHash] = useState('');
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [baselineSchema, setBaselineSchema] = useState<Record<string, unknown> | null>(null);
  const [extractionRunId, setExtractionRunId] = useState('');
  const [pdfSha256, setPdfSha256] = useState('');
  const [predictionJson, setPredictionJson] = useState<Record<string, unknown> | null>(null);
  const [formData, setFormData] = useState<Record<string, string | boolean>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [cacheHit, setCacheHit] = useState<boolean | null>(null);
  const [extractionMethod, setExtractionMethod] = useState('');

  const fields = useMemo(() => layoutFieldsFromSchema(schema), [schema]);

  const resetForNewFile = useCallback((file: File) => {
    setUploadedFile(file);
    setPdfHash('');
    setSchema(null);
    setBaselineSchema(null);
    setExtractionRunId('');
    setPdfSha256('');
    setPredictionJson(null);
    setFormData({});
    setCurrentPage(1);
    setNumPages(0);
    setExtractError(null);
    setCacheHit(null);
    setExtractionMethod('');
    setStudioCanvasMode('select');
  }, []);

  const applyExtractResult = useCallback(
    (result: {
      pdfHash: string;
      pdfSha256: string;
      schema: Record<string, unknown>;
      cacheHit: boolean;
      extractionMethod: string;
      schemaVersion?: number;
      extractionRunId: string;
      predictionJson: Record<string, unknown>;
    }) => {
      setPdfHash(result.pdfHash);
      setPdfSha256(result.pdfSha256);
      setExtractionRunId(result.extractionRunId);
      setPredictionJson(result.predictionJson);
      setSchema(result.schema);
      setBaselineSchema(cloneSchema(result.schema));
      setFormData(initialFormDataFromSchema(result.schema));
      setCacheHit(result.cacheHit);
      setExtractionMethod(result.extractionMethod);
      setCurrentPage(1);
      setExtractError(null);
    },
    []
  );

  const updateFieldLayout = useCallback(
    (key: string, patch: Partial<Pick<LayoutField, 'page' | 'x' | 'y' | 'width' | 'height'>>) => {
      setSchema((prev) => (prev ? applyLayoutToSchema(prev, key, patch) : prev));
    },
    []
  );

  const updateFieldsLayout = useCallback(
    (
      updates: Array<{
        key: string;
        patch: Partial<Pick<LayoutField, 'page' | 'x' | 'y' | 'width' | 'height'>>;
      }>
    ) => {
      setSchema((prev) => (prev ? applyLayoutsToSchema(prev, updates) : prev));
    },
    []
  );

  const nudgeSelectedFields = useCallback((keys: string[], dx: number, dy: number) => {
    setSchema((prev) => (prev ? applyLayoutDeltaToSchema(prev, keys, { dx, dy }) : prev));
  }, []);

  const addField = useCallback(
    (params: {
      title: string;
      key?: string;
      fieldType: FieldEditorType;
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }): string | null => {
      let newKey: string | null = null;
      setSchema((prev) => {
        if (!prev) return prev;
        const key = params.key
          ? uniqueFieldKey(prev, params.key)
          : uniqueFieldKey(prev, params.title);
        newKey = key;
        return addFieldToSchema(prev, { ...params, key });
      });
      if (newKey) {
        setFormData((fd) => ({
          ...fd,
          [newKey!]: params.fieldType === 'checkbox' ? false : '',
        }));
      }
      return newKey;
    },
    []
  );

  const updateFieldMetaAction = useCallback(
    (oldKey: string, params: { key: string; title: string; fieldType: FieldEditorType }) => {
      setSchema((prev) => {
        if (!prev) return prev;
        const next = updateFieldMeta(prev, oldKey, params);
        if (oldKey !== params.key) {
          setFormData((fd) => {
            const copy = { ...fd };
            const val = copy[oldKey];
            delete copy[oldKey];
            if (val !== undefined) copy[params.key] = val;
            else if (params.fieldType === 'checkbox') copy[params.key] = false;
            else copy[params.key] = '';
            return copy;
          });
        }
        return next;
      });
    },
    []
  );

  const removeFields = useCallback((keys: string[]) => {
    setSchema((prev) => (prev ? removeFieldsFromSchema(prev, keys) : prev));
    setFormData((fd) => {
      const copy = { ...fd };
      for (const k of keys) delete copy[k];
      return copy;
    });
  }, []);

  const getFieldMeta = useCallback(
    (key: string) => {
      if (!schema) return null;
      const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
      const prop = properties[key];
      if (!prop) return null;
      return fieldMetaFromProperty(key, prop);
    },
    [schema]
  );

  return {
    currentMode,
    setCurrentMode,
    studioCanvasMode,
    setStudioCanvasMode,
    uploadedFile,
    setUploadedFile,
    pdfHash,
    schema,
    baselineSchema,
    extractionRunId,
    pdfSha256,
    predictionJson,
    setExtractionRunId,
    setSchema,
    formData,
    setFormData,
    currentPage,
    setCurrentPage,
    numPages,
    setNumPages,
    extracting,
    setExtracting,
    saving,
    setSaving,
    compiling,
    setCompiling,
    extractError,
    setExtractError,
    cacheHit,
    extractionMethod,
    fields,
    resetForNewFile,
    applyExtractResult,
    updateFieldLayout,
    updateFieldsLayout,
    nudgeSelectedFields,
    addField,
    updateFieldMeta: updateFieldMetaAction,
    removeFields,
    getFieldMeta,
  };
}
