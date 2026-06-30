import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';
import { Rnd } from 'react-rnd';
import { Loader2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import '../pdfWorker';
import {
  fieldsOnPage,
  FIELD_TYPE_BOX_CLASSES,
  type FieldEditorType,
  type LayoutField,
} from '../utils/schemaLayout';
import type { StudioCanvasMode } from '../state/useFormIntelligenceState';

const NATIVE_FALLBACK_WIDTH = 595;
const NATIVE_FALLBACK_HEIGHT = 842;
const MIN_DRAW_PX = 6;
const MAX_SIDE_OVERFLOW_PT = 140;
const SIDE_PAD_PT = 20;
const ZOOM_STEPS = [50, 70, 85, 100, 115] as const;

interface PdfStudioCanvasProps {
  file: File | null;
  currentPage: number;
  fields: LayoutField[];
  selectedFieldKeys: string[];
  canvasMode: StudioCanvasMode;
  getFieldType: (key: string) => FieldEditorType;
  onCanvasModeChange: (mode: StudioCanvasMode) => void;
  onSelectionChange: (keys: string[], primaryKey?: string | null) => void;
  onFieldLayoutChange: (
    key: string,
    patch: Partial<Pick<LayoutField, 'x' | 'y' | 'width' | 'height'>>
  ) => void;
  onFieldsLayoutChange: (
    updates: Array<{
      key: string;
      patch: Partial<Pick<LayoutField, 'x' | 'y' | 'width' | 'height'>>;
    }>
  ) => void;
  onDrawFieldComplete: (rect: {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onDocumentLoad: (numPages: number) => void;
  onPageNativeWidth: (width: number) => void;
}

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number }
): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function horizontalOverflow(pageFields: LayoutField[], pageWidthPt: number) {
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

function zoomForFitAll(
  basePageWidthPx: number,
  stageWidthPx: number
): number {
  if (basePageWidthPx <= 0 || stageWidthPx <= 0) return 100;
  const zoom = (basePageWidthPx / stageWidthPx) * 100;
  return Math.min(100, Math.max(45, Math.round(zoom)));
}

export const PdfStudioCanvas: React.FC<PdfStudioCanvasProps> = ({
  file,
  currentPage,
  fields,
  selectedFieldKeys,
  canvasMode,
  getFieldType,
  onCanvasModeChange,
  onSelectionChange,
  onFieldLayoutChange,
  onFieldsLayoutChange,
  onDrawFieldComplete,
  onDocumentLoad,
  onPageNativeWidth,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageWrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [basePageWidthPx, setBasePageWidthPx] = useState(720);
  const [nativeWidth, setNativeWidth] = useState(NATIVE_FALLBACK_WIDTH);
  const [nativeHeight, setNativeHeight] = useState(NATIVE_FALLBACK_HEIGHT);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const [drawRect, setDrawRect] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const dragGroupRef = useRef<{
    startPositions: Map<string, { x: number; y: number }>;
  } | null>(null);
  const dragPreviewRef = useRef<Map<string, { x: number; y: number }> | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const [dragFrame, setDragFrame] = useState(0);
  const marqueeAddToSelectionRef = useRef(false);

  const pageOffsetPxRef = useRef(0);
  const scaleFactorRef = useRef(1);

  const selectedSet = useMemo(() => new Set(selectedFieldKeys), [selectedFieldKeys]);
  const multiSelected = selectedFieldKeys.length > 1;

  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

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
  }, [file, currentPage]);

  const pageFields = useMemo(() => fieldsOnPage(fields, currentPage), [fields, currentPage]);
  const { extraLeftPt, extraRightPt } = useMemo(
    () => horizontalOverflow(pageFields, nativeWidth),
    [nativeWidth, pageFields]
  );

  const renderedPageWidth = Math.max(320, (basePageWidthPx * zoomPercent) / 100);
  const scaleFactor = renderedPageWidth / nativeWidth;
  const stageWidthPx = renderedPageWidth + (extraLeftPt + extraRightPt) * scaleFactor;
  const pageOffsetPx = extraLeftPt * scaleFactor;
  const pageHeightPx = (renderedPageWidth / nativeWidth) * nativeHeight;
  pageOffsetPxRef.current = pageOffsetPx;
  scaleFactorRef.current = scaleFactor;

  const rndBounds = useMemo(
    () => ({
      left: pageOffsetPx,
      top: 0,
      right: pageOffsetPx + renderedPageWidth,
      bottom: pageHeightPx,
    }),
    [pageHeightPx, pageOffsetPx, renderedPageWidth]
  );

  const overlayPointFromClient = useCallback((clientX: number, clientY: number) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const fieldPositions = useMemo(() => {
    void dragFrame;
    const preview = dragPreviewRef.current;
    const out = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const field of pageFields) {
      const pdfX = preview?.get(field.key)?.x ?? field.x;
      const pdfY = preview?.get(field.key)?.y ?? field.y;
      out.set(field.key, {
        x: pageOffsetPx + pdfX * scaleFactor,
        y: pdfY * scaleFactor,
        width: field.width * scaleFactor,
        height: field.height * scaleFactor,
      });
    }
    return out;
  }, [dragFrame, extraLeftPt, pageFields, pageOffsetPx, scaleFactor]);

  const screenToPdf = useCallback(
    (screenX: number, screenY: number) => ({
      x: (screenX - pageOffsetPx) / scaleFactor,
      y: screenY / scaleFactor,
    }),
    [pageOffsetPx, scaleFactor]
  );

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
      onPageNativeWidth(viewport.width);
    },
    [onPageNativeWidth]
  );

  const selectField = useCallback(
    (key: string, e: { metaKey: boolean; ctrlKey: boolean }) => {
      if (canvasMode === 'draw') return;
      const toggle = e.metaKey || e.ctrlKey;
      if (toggle) {
        const next = new Set(selectedFieldKeys);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        onSelectionChange([...next], key);
      } else {
        onSelectionChange([key], key);
      }
    },
    [canvasMode, onSelectionChange, selectedFieldKeys]
  );

  const finishMarquee = useCallback(
    (endX: number, endY: number, addToSelection: boolean) => {
      const m = marquee;
      setMarquee(null);
      if (!m) return;
      const left = Math.min(m.startX, endX);
      const right = Math.max(m.startX, endX);
      const top = Math.min(m.startY, endY);
      const bottom = Math.max(m.startY, endY);
      if (right - left < 4 && bottom - top < 4) {
        if (!addToSelection) onSelectionChange([], null);
        return;
      }
      const selRect = { left, top, right, bottom };
      const hitKeys: string[] = [];
      for (const f of pageFields) {
        const pos = fieldPositions.get(f.key);
        if (!pos) continue;
        if (
          rectsIntersect(selRect, {
            left: pos.x,
            top: pos.y,
            right: pos.x + pos.width,
            bottom: pos.y + pos.height,
          })
        ) {
          hitKeys.push(f.key);
        }
      }
      if (addToSelection) {
        const merged = new Set(selectedFieldKeys);
        for (const k of hitKeys) merged.add(k);
        onSelectionChange([...merged], hitKeys[0] ?? null);
      } else {
        onSelectionChange(hitKeys, hitKeys[0] ?? null);
      }
    },
    [fieldPositions, marquee, onSelectionChange, pageFields, selectedFieldKeys]
  );

  const finishDraw = useCallback(
    (endX: number, endY: number) => {
      const d = drawRect;
      setDrawRect(null);
      onCanvasModeChange('select');
      if (!d) return;
      const w = Math.abs(endX - d.startX);
      const h = Math.abs(endY - d.startY);
      if (w < MIN_DRAW_PX || h < MIN_DRAW_PX) return;
      const left = Math.min(d.startX, endX);
      const top = Math.min(d.startY, endY);
      const pdfOrigin = screenToPdf(left, top);
      onDrawFieldComplete({
        page: currentPage,
        x: pdfOrigin.x,
        y: pdfOrigin.y,
        width: w / scaleFactor,
        height: h / scaleFactor,
      });
    },
    [currentPage, drawRect, onCanvasModeChange, onDrawFieldComplete, scaleFactor, screenToPdf]
  );

  const onOverlayMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-field-rnd]')) return;
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (canvasMode === 'draw') {
      setDrawRect({ startX: x, startY: y, endX: x, endY: y });
      return;
    }
    const addToSelection = e.metaKey || e.ctrlKey || e.shiftKey;
    marqueeAddToSelectionRef.current = addToSelection;
    setMarquee({ startX: x, startY: y, endX: x, endY: y });
    if (!addToSelection) onSelectionChange([], null);
  };

  const onOverlayMouseMove = (e: React.MouseEvent) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (drawRect) {
      setDrawRect((d) => (d ? { ...d, endX: x, endY: y } : null));
      return;
    }
    if (marquee) setMarquee((m) => (m ? { ...m, endX: x, endY: y } : null));
  };

  const onOverlayMouseUp = (e: React.MouseEvent) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (drawRect) finishDraw(x, y);
    else if (marquee) {
      finishMarquee(x, y, marqueeAddToSelectionRef.current || e.shiftKey || e.metaKey || e.ctrlKey);
    }
  };

  useEffect(() => {
    if (!marquee && !drawRect) return;
    const onWindowMove = (e: MouseEvent) => {
      const pt = overlayPointFromClient(e.clientX, e.clientY);
      if (!pt) return;
      if (drawRect) {
        setDrawRect((d) => (d ? { ...d, endX: pt.x, endY: pt.y } : null));
      }
      if (marquee) {
        setMarquee((m) => (m ? { ...m, endX: pt.x, endY: pt.y } : null));
      }
    };
    const onWindowUp = (e: MouseEvent) => {
      const pt = overlayPointFromClient(e.clientX, e.clientY);
      if (!pt) return;
      if (drawRect) finishDraw(pt.x, pt.y);
      else if (marquee) {
        finishMarquee(
          pt.x,
          pt.y,
          marqueeAddToSelectionRef.current || e.shiftKey || e.metaKey || e.ctrlKey
        );
      }
    };
    window.addEventListener('mousemove', onWindowMove);
    window.addEventListener('mouseup', onWindowUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMove);
      window.removeEventListener('mouseup', onWindowUp);
    };
  }, [drawRect, finishDraw, finishMarquee, marquee, overlayPointFromClient]);

  const onDragStart = (key: string) => {
    const positions = new Map<string, { x: number; y: number }>();
    const keysToMove =
      selectedSet.has(key) && selectedFieldKeys.length > 1
        ? selectedFieldKeys.filter((k) => pageFields.some((f) => f.key === k))
        : [key];
    for (const k of keysToMove) {
      const f = pageFields.find((pf) => pf.key === k);
      if (f) positions.set(k, { x: f.x, y: f.y });
    }
    dragGroupRef.current = { startPositions: positions };
    dragPreviewRef.current = null;
  };

  const onDragField = (key: string, screenX: number, screenY: number) => {
    const group = dragGroupRef.current;
    if (!group) return;
    const anchorStart = group.startPositions.get(key);
    if (!anchorStart) return;
    const pdf = screenToPdf(screenX, screenY);
    const dx = pdf.x - anchorStart.x;
    const dy = pdf.y - anchorStart.y;
    const preview = new Map<string, { x: number; y: number }>();
    for (const [k, start] of group.startPositions) {
      preview.set(k, { x: start.x + dx, y: start.y + dy });
    }
    dragPreviewRef.current = preview;
    if (dragRafRef.current !== null) return;
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null;
      setDragFrame((n) => n + 1);
    });
  };

  const onDragStopField = (key: string, screenX: number, screenY: number) => {
    const group = dragGroupRef.current;
    dragGroupRef.current = null;
    dragPreviewRef.current = null;
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    setDragFrame((n) => n + 1);

    const pdf = screenToPdf(screenX, screenY);
    if (!group) {
      onFieldLayoutChange(key, { x: pdf.x, y: pdf.y });
      return;
    }
    const anchorStart = group.startPositions.get(key);
    if (!anchorStart) return;
    const dx = pdf.x - anchorStart.x;
    const dy = pdf.y - anchorStart.y;
    const updates: Array<{ key: string; patch: { x: number; y: number } }> = [];
    for (const [k, start] of group.startPositions) {
      updates.push({ key: k, patch: { x: start.x + dx, y: start.y + dy } });
    }
    onFieldsLayoutChange(updates);
  };

  const stepZoom = (direction: -1 | 1) => {
    setZoomPercent((current) => {
      const idx = ZOOM_STEPS.findIndex((z) => z >= current);
      const base = idx === -1 ? ZOOM_STEPS.length - 1 : idx;
      const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, base + direction));
      return ZOOM_STEPS[next];
    });
  };

  const fitAllInView = () => {
    setZoomPercent(zoomForFitAll(basePageWidthPx, stageWidthPx));
  };

  if (!file) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Upload a PDF to open the layout canvas.
      </div>
    );
  }

  const marqueeStyle = marquee
    ? {
        left: Math.min(marquee.startX, marquee.endX),
        top: Math.min(marquee.startY, marquee.endY),
        width: Math.abs(marquee.endX - marquee.startX),
        height: Math.abs(marquee.endY - marquee.startY),
      }
    : null;

  const drawStyle = drawRect
    ? {
        left: Math.min(drawRect.startX, drawRect.endX),
        top: Math.min(drawRect.startY, drawRect.endY),
        width: Math.abs(drawRect.endX - drawRect.startX),
        height: Math.abs(drawRect.endY - drawRect.startY),
      }
    : null;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Zoom out"
            onClick={() => stepZoom(-1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Fit page and field boxes in view"
            onClick={fitAllInView}
            className="ml-1 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Fit all
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-6">
        <div className="w-full max-w-5xl mx-auto">
          <div
            ref={pageWrapRef}
            className="relative w-full shadow-lg ring-1 ring-slate-200/80 bg-white"
          >
            {pdfLoading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 min-h-[480px]">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
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
                        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
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
                  ref={overlayRef}
                  className={`absolute top-0 left-0 ${canvasMode === 'draw' ? 'cursor-crosshair' : 'cursor-default'}`}
                  style={{ width: stageWidthPx, height: pageHeightPx, zIndex: 10 }}
                  onMouseDown={onOverlayMouseDown}
                  onMouseMove={onOverlayMouseMove}
                  onMouseUp={onOverlayMouseUp}
                >
                  {pageFields.map((field) => {
                    const pos = fieldPositions.get(field.key);
                    if (!pos) return null;
                    const selected = selectedSet.has(field.key);
                    const fieldType = getFieldType(field.key);
                    const typeStyles = FIELD_TYPE_BOX_CLASSES[fieldType];
                    return (
                      <Rnd
                        key={field.key}
                        data-field-rnd
                        bounds={rndBounds as unknown as 'parent'}
                        size={{ width: pos.width, height: pos.height }}
                        position={{ x: pos.x, y: pos.y }}
                        enableResizing={selected && !multiSelected}
                        disableDragging={canvasMode === 'draw'}
                        className="pointer-events-auto"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          selectField(field.key, e);
                        }}
                        onDragStart={() => onDragStart(field.key)}
                        onDrag={(_e, d) => onDragField(field.key, d.x, d.y)}
                        onDragStop={(_e, d) => onDragStopField(field.key, d.x, d.y)}
                        onResizeStop={(_e, _dir, ref, _delta, position) => {
                          const pdfPos = screenToPdf(position.x, position.y);
                          onFieldLayoutChange(field.key, {
                            x: pdfPos.x,
                            y: pdfPos.y,
                            width: ref.offsetWidth / scaleFactor,
                            height: ref.offsetHeight / scaleFactor,
                          });
                        }}
                      >
                        <div
                          className={`h-full w-full overflow-hidden rounded border text-xs px-1 flex items-start ${
                            selected ? typeStyles.selected : typeStyles.idle
                          }`}
                        >
                          <span className="truncate font-medium">{field.label}</span>
                        </div>
                      </Rnd>
                    );
                  })}
                  {marqueeStyle && (
                    <div
                      className="absolute border-2 border-indigo-500 bg-indigo-500/10 pointer-events-none"
                      style={marqueeStyle}
                    />
                  )}
                  {drawStyle && (
                    <div
                      className="absolute border-2 border-dashed border-emerald-600 bg-emerald-500/10 pointer-events-none"
                      style={drawStyle}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
