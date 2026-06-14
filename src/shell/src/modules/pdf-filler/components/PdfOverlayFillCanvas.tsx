import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';
import { Loader2, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import '../form-intelligence/pdfWorker';
import {
  fieldMetaFromProperty,
  fieldsOnPage,
  layoutFieldsFromSchema,
} from '../form-intelligence/utils/schemaLayout';

const NATIVE_FALLBACK_WIDTH = 595;
const NATIVE_FALLBACK_HEIGHT = 842;
const MAX_SIDE_OVERFLOW_PT = 140;
const SIDE_PAD_PT = 20;
const ZOOM_STEPS = [50, 70, 85, 100, 115] as const;

function horizontalOverflow(pageFields: ReturnType<typeof layoutFieldsFromSchema>, pageWidthPt: number) {
  let extraLeftPt = 0;
  let extraRightPt = 0;
  for (const f of pageFields) {
    if (f.x < 0) extraLeftPt = Math.max(extraLeftPt, -f.x + SIDE_PAD_PT);
    const right = f.x + f.width;
    if (right > pageWidthPt) extraRightPt = Math.max(extraRightPt, right - pageWidthPt + SIDE_PAD_PT);
  }
  return {
    extraLeftPt: Math.min(extraLeftPt, MAX_SIDE_OVERFLOW_PT),
    extraRightPt: Math.min(extraRightPt, MAX_SIDE_OVERFLOW_PT),
  };
}

function zoomForFit(basePageWidthPx: number, stageWidthPx: number): number {
  if (basePageWidthPx <= 0 || stageWidthPx <= 0) return 100;
  const zoom = (basePageWidthPx / stageWidthPx) * 100;
  return Math.min(100, Math.max(45, Math.round(zoom)));
}

interface PdfOverlayFillCanvasProps {
  pdfFile: File | null;
  schema: Record<string, unknown>;
  values: Record<string, string | boolean>;
  onChange: (key: string, value: string | boolean) => void;
  currentPage: number;
  onDocumentLoad: (numPages: number) => void;
}

export const PdfOverlayFillCanvas: React.FC<PdfOverlayFillCanvasProps> = ({
  pdfFile,
  schema,
  values,
  onChange,
  currentPage,
  onDocumentLoad,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageWrapRef = useRef<HTMLDivElement>(null);
  const [basePageWidthPx, setBasePageWidthPx] = useState(720);
  const [nativeWidth, setNativeWidth] = useState(NATIVE_FALLBACK_WIDTH);
  const [nativeHeight, setNativeHeight] = useState(NATIVE_FALLBACK_HEIGHT);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const fields = useMemo(() => layoutFieldsFromSchema(schema), [schema]);
  const pageFields = useMemo(() => fieldsOnPage(fields, currentPage), [fields, currentPage]);
  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;

  const fileUrl = useMemo(() => (pdfFile ? URL.createObjectURL(pdfFile) : null), [pdfFile]);

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  useEffect(() => {
    const el = pageWrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setBasePageWidthPx(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdfFile, currentPage]);

  const { extraLeftPt, extraRightPt } = useMemo(
    () => horizontalOverflow(pageFields, nativeWidth),
    [nativeWidth, pageFields]
  );

  const renderedPageWidth = Math.max(320, (basePageWidthPx * zoomPercent) / 100);
  const scaleFactor = renderedPageWidth / nativeWidth;
  const stageWidthPx = renderedPageWidth + (extraLeftPt + extraRightPt) * scaleFactor;
  const pageOffsetPx = extraLeftPt * scaleFactor;
  const pageHeightPx = (renderedPageWidth / nativeWidth) * nativeHeight;

  const fieldPositions = useMemo(() => {
    const out = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const field of pageFields) {
      out.set(field.key, {
        x: pageOffsetPx + field.x * scaleFactor,
        y: field.y * scaleFactor,
        width: field.width * scaleFactor,
        height: field.height * scaleFactor,
      });
    }
    return out;
  }, [pageFields, pageOffsetPx, scaleFactor]);

  const handlePageLoadSuccess = useCallback(
    (page: {
      getViewport: (opts: { scale: number }) => { width: number; height: number };
    }) => {
      const viewport = page.getViewport({ scale: 1 });
      setNativeWidth((prev) =>
        Math.abs(prev - viewport.width) < 0.5 ? prev : viewport.width
      );
      setNativeHeight((prev) =>
        Math.abs(prev - viewport.height) < 0.5 ? prev : viewport.height
      );
    },
    []
  );

  const stepZoom = (direction: -1 | 1) => {
    setZoomPercent((current) => {
      const idx = ZOOM_STEPS.findIndex((z) => z >= current);
      const base = idx === -1 ? ZOOM_STEPS.length - 1 : idx;
      const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, base + direction));
      return ZOOM_STEPS[next];
    });
  };

  const fitInView = () => {
    const stageWidth = scrollRef.current?.clientWidth ?? basePageWidthPx;
    setZoomPercent(zoomForFit(basePageWidthPx, Math.max(stageWidth - 48, 320)));
  };

  if (!pdfFile) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500 min-h-[320px]">
        Loading form preview…
      </div>
    );
  }

  const inputClass =
    'h-full w-full min-w-0 rounded-sm border border-cyan-500/35 bg-white/90 px-0.5 text-[11px] leading-tight text-slate-900 shadow-none focus:border-cyan-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-cyan-500/40';

  return (
    <div className="flex min-h-0 flex-1 basis-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
        <button
          type="button"
          title="Zoom out"
          onClick={() => stepZoom(-1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="min-w-[3.5rem] text-center text-xs font-semibold tabular-nums text-slate-600">
          {zoomPercent}%
        </span>
        <button
          type="button"
          title="Zoom in"
          onClick={() => stepZoom(1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Fit page in view"
          onClick={fitInView}
          className="ml-1 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Fit page
        </button>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 basis-0 overflow-x-auto overflow-y-auto p-4 bg-slate-100/60"
      >
        <div ref={pageWrapRef} className="w-full max-w-5xl mx-auto">
          <div className="relative shadow-lg ring-1 ring-slate-200/80 bg-white">
            {pdfLoading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 min-h-[480px]">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-600" />
              </div>
            )}
            {pdfError && (
              <div className="p-8 text-center text-sm text-red-600 min-h-[200px]">{pdfError}</div>
            )}
            {fileUrl && (
              <div
                className="relative"
                style={{ width: stageWidthPx, minHeight: pageHeightPx, maxWidth: 'none' }}
              >
                <div
                  className="relative bg-white"
                  style={{ marginLeft: pageOffsetPx, width: renderedPageWidth }}
                >
                  <Document
                    file={fileUrl}
                    onLoadStart={() => {
                      setPdfLoading(true);
                      setPdfError(null);
                    }}
                    onLoadSuccess={({ numPages }) => {
                      setPdfLoading(false);
                      onDocumentLoad(numPages);
                    }}
                    onLoadError={(err) => {
                      setPdfLoading(false);
                      setPdfError(err?.message || 'Failed to load PDF');
                    }}
                    loading={
                      <div className="flex min-h-[480px] items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-cyan-600" />
                      </div>
                    }
                  >
                    <Page
                      pageNumber={currentPage}
                      width={renderedPageWidth}
                      onLoadSuccess={handlePageLoadSuccess}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  </Document>
                </div>
                <div
                  className="absolute top-0 left-0 pointer-events-none"
                  style={{ width: stageWidthPx, height: pageHeightPx, zIndex: 10 }}
                >
                  {pageFields.map((field) => {
                    const pos = fieldPositions.get(field.key);
                    if (!pos) return null;
                    const prop = properties[field.key] || {};
                    const meta = fieldMetaFromProperty(field.key, prop);
                    const ariaLabel = meta.title;

                    if (meta.fieldType === 'checkbox') {
                      return (
                        <div
                          key={field.key}
                          className="absolute flex items-center justify-center pointer-events-auto"
                          style={{
                            left: pos.x,
                            top: pos.y,
                            width: pos.width,
                            height: pos.height,
                          }}
                        >
                          <input
                            type="checkbox"
                            aria-label={ariaLabel}
                            className="h-4 w-4 rounded border-slate-400 text-cyan-600"
                            checked={Boolean(values[field.key])}
                            onChange={(e) => onChange(field.key, e.target.checked)}
                          />
                        </div>
                      );
                    }

                    const inputType =
                      meta.fieldType === 'date'
                        ? 'date'
                        : meta.fieldType === 'number'
                          ? 'number'
                          : 'text';

                    const rawValue = values[field.key];
                    const textValue = typeof rawValue === 'string' ? rawValue : '';

                    return (
                      <div
                        key={field.key}
                        className="absolute pointer-events-auto"
                        style={{
                          left: pos.x,
                          top: pos.y,
                          width: pos.width,
                          height: pos.height,
                        }}
                      >
                        <input
                          type={inputType}
                          aria-label={ariaLabel}
                          className={inputClass}
                          value={textValue}
                          step={meta.fieldType === 'number' ? '1' : undefined}
                          onChange={(e) => onChange(field.key, e.target.value)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
