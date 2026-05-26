import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square, Radio, Pause, Play, ChevronDown, X } from 'lucide-react';
import { getTranscribeWebSocketUrl, transcribeAudio } from '../../services/api';

export interface LiveScribeProps {
  /** Called when live streaming has started (connection open, mic streaming). */
  onLiveStarted?: () => void;
  /** Called whenever the live transcript is updated (accumulated text). */
  onLiveTranscriptUpdate: (transcript: string) => void;
  /** Called when live streaming is stopped, with the final accumulated transcript. */
  onLiveStopped: (transcript: string) => void;
  /** Called when the live connection ends (e.g. disconnect or error) so UI can clear "live" state. */
  onLiveEnded?: () => void;
  onError?: (message: string) => void;
}

/**
 * Live transcription: streams mic audio to the server via WebSocket;
 * server forwards to Deepgram and streams back transcript chunks.
 * Transcript is accumulated and updated in real time so when the user
 * chooses a template, the text is already ready for note generation.
 */
export const LiveScribe: React.FC<LiveScribeProps> = ({
  onLiveStarted,
  onLiveTranscriptUpdate,
  onLiveStopped,
  onLiveEnded,
  onError,
}) => {
  const [isLive, setIsLive] = useState(false);
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'open' | 'closed'>('idle');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [visibleTranscript, setVisibleTranscript] = useState('');
  const transcriptRef = useRef<string>('');
  const hadLiveTranscriptRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingMimeTypeRef = useRef<string>('audio/webm');

  const stopAudioVisualization = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  };

  const startAudioVisualization = (stream: MediaStream) => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        setAudioLevel(rms);
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Visualization is best-effort only
    }
  };

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send('end');
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    stopAudioVisualization();
    setConnectionState('idle');
    setIsPaused(false);
  }, []);

  const runFallbackTranscription = useCallback(async (): Promise<string> => {
    if (!chunksRef.current.length) return '';
    try {
      const blob = new Blob(chunksRef.current, {
        type: recordingMimeTypeRef.current || 'audio/webm',
      });
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          try {
            const result = reader.result as string;
            const encoded = result.split(',')[1] || '';
            resolve(encoded);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(reader.error || new Error('Failed to read recording.'));
        reader.readAsDataURL(blob);
      });

      if (!base64) return '';

      const transcript = await transcribeAudio(
        base64,
        recordingMimeTypeRef.current || 'audio/webm'
      );
      return transcript?.trim() || '';
    } catch (err) {
      console.error('[LiveScribe] Fallback transcription failed:', err);
      onError?.(
        'Live transcription was unavailable and the backup transcription also failed. Please try again.'
      );
      return '';
    }
  }, [onError]);

  const stopLive = useCallback(async () => {
    const streamedText = transcriptRef.current.trim();
    cleanup();
    setIsLive(false);
    onLiveEnded?.();

    let finalText = streamedText;

    // If no live transcript came back, fall back to full-session recording
    if (!finalText && chunksRef.current.length > 0) {
      finalText = await runFallbackTranscription();
      if (finalText) {
        setVisibleTranscript(finalText);
      }
    }

    if (finalText) {
      onLiveStopped(finalText);
    }

    setIsModalOpen(false);
    setIsMinimized(false);
  }, [cleanup, onLiveEnded, onLiveStopped, runFallbackTranscription]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const startLive = useCallback(async () => {
    if (isLive) {
      setIsModalOpen(true);
      setIsMinimized(false);
      return;
    }
    transcriptRef.current = '';
    hadLiveTranscriptRef.current = false;
    chunksRef.current = [];
    setVisibleTranscript('');
    setConnectionState('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startAudioVisualization(stream);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : 'audio/webm';
      recordingMimeTypeRef.current = mimeType;

      const wsUrl = getTranscribeWebSocketUrl();
      console.log('[LiveScribe] Starting live consultation', { wsUrl, mimeType });
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        console.log('[LiveScribe] WebSocket open');
        setConnectionState('open');
        onLiveStarted?.();
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
            if (ws.readyState === WebSocket.OPEN && !isPaused) {
              ws.send(e.data);
            }
          }
        };
        mediaRecorder.start(250);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as { type: string; transcript?: string; message?: string };
          if (msg.type === 'transcript' && typeof msg.transcript === 'string' && msg.transcript.trim()) {
            const prev = transcriptRef.current;
            const sep = prev ? (prev.endsWith(' ') || msg.transcript.startsWith(' ') ? '' : ' ') : '';
            transcriptRef.current = prev + sep + msg.transcript.trim();
            hadLiveTranscriptRef.current = true;
            onLiveTranscriptUpdate(transcriptRef.current);
            setVisibleTranscript(transcriptRef.current);
          }
          if (msg.type === 'error') {
            console.error('[LiveScribe] WebSocket error message from server:', msg.message);
            onError?.(msg.message || 'Live transcription error');
          }
        } catch {
          // ignore non-JSON
        }
      };

      ws.onclose = () => {
        console.log('[LiveScribe] WebSocket closed');
        onLiveEnded?.();
        setIsLive(false);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current = null;
        }
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        wsRef.current = null;
        stopAudioVisualization();
        setConnectionState('closed');
        setIsModalOpen(false);
        setIsMinimized(false);
      };

      ws.onerror = () => {
        console.error('[LiveScribe] WebSocket network error');
        onError?.('WebSocket connection failed. Check that the server is running and DEEPGRAM_API_KEY is set.');
      };

      setIsLive(true);
      setIsModalOpen(true);
      setIsMinimized(false);
    } catch (err) {
      setConnectionState('idle');
      onError?.(
        err instanceof Error ? err.message : 'Could not access microphone. Please check your browser permissions.'
      );
    }
  }, [isLive, onLiveTranscriptUpdate, onError]);

  const handlePrimaryClick = () => {
    if (isLive) {
      setIsModalOpen(true);
      setIsMinimized(false);
    } else {
      startLive();
    }
  };

  const handlePauseToggle = () => {
    setIsPaused((prev) => !prev);
  };

  const handleMinimize = () => {
    setIsMinimized(true);
    setIsModalOpen(false);
  };

  const handleClose = () => {
    void stopLive();
  };

  const isConnecting = connectionState === 'connecting';

  return (
    <>
      {/* Primary floating button (desktop & mobile) */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {isLive && !isMinimized && (
          <div className="bg-white border border-sky-200 shadow-lg rounded-full px-3 py-1.5 flex items-center gap-2 animate-in fade-in">
            <Radio className="w-3.5 h-3.5 text-sky-500" />
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
              {connectionState === 'connecting' ? 'Connecting…' : isPaused ? 'Paused' : 'Live transcription'}
            </span>
          </div>
        )}

        {isMinimized && (
          <button
            onClick={() => { setIsMinimized(false); setIsModalOpen(true); }}
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-white border border-sky-200 shadow-lg text-xs font-medium text-slate-700 hover:bg-sky-50 transition"
          >
            <Radio className="w-3.5 h-3.5 text-sky-500" />
            <span>{isPaused ? 'Consultation paused' : 'Consultation in progress'}</span>
          </button>
        )}

        <button
          onClick={handlePrimaryClick}
          disabled={isConnecting}
          title={isLive ? 'View consultation controls' : 'Start live consultation'}
          className={`flex items-center justify-center rounded-full shadow-lg transition-all duration-200 ${
            isLive
              ? 'w-12 h-12 bg-sky-600 hover:bg-sky-700 text-white ring-4 ring-sky-200'
              : isConnecting
                ? 'w-12 h-12 bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'w-12 h-12 bg-sky-600 hover:bg-sky-700 text-white hover:scale-110 active:scale-95 hover:shadow-xl'
          }`}
        >
          {isConnecting ? (
            <span className="w-5 h-5 border-2 border-slate-200 border-t-transparent rounded-full animate-spin" />
          ) : isLive ? (
            <Mic className="w-5 h-5" />
          ) : (
            <Mic className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Centered consultation modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-sky-50 flex items-center justify-center">
                  <Mic className="w-4 h-4 text-sky-600" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-slate-800">
                    Live consultation
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    {connectionState === 'connecting'
                      ? 'Connecting to transcription...'
                      : !isLive
                        ? 'Ready to start'
                        : isPaused
                          ? 'Paused — microphone is listening but not sending audio'
                          : 'Microphone is active and streaming audio'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isLive && (
                  <button
                    type="button"
                    onClick={handleMinimize}
                    className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                    title="Minimize consultation"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClose}
                  className="p-1.5 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                  title="Stop consultation"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-5 pt-4 pb-3 space-y-4">
              {/* Audio level visualisation */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-medium">Microphone trace</span>
                  <span className="inline-flex items-center gap-1 text-[11px]">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        audioLevel > 0.01 ? 'bg-sky-500 shadow-[0_0_0_3px_rgba(14,165,233,0.35)]' : 'bg-slate-300'
                      }`}
                    />
                    {audioLevel > 0.01 ? 'We can hear you' : 'Waiting for audio...'}
                  </span>
                </div>
                <div className="relative h-9 rounded-2xl bg-slate-100 overflow-hidden flex items-center">
                  <div className="absolute inset-x-0 h-px bg-slate-200 mx-4" />
                  <div
                    className="mx-4 h-4 rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-sky-600 shadow-[0_0_14px_rgba(14,165,233,0.7)] transition-[width] duration-150 ease-out"
                    style={{ width: `${Math.min(100, Math.max(12, 8 + audioLevel * 260))}%` }}
                  />
                </div>
              </div>

              {/* Live transcript preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-medium">Live transcript (preview)</span>
                  <span className="text-[11px]">Will be used to generate your note</span>
                </div>
                <div className="h-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 overflow-y-auto text-xs text-slate-700 whitespace-pre-wrap">
                  {visibleTranscript || (
                    <span className="text-slate-400">
                      Start speaking to see text appear here in real time.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="px-5 py-4 border-t border-slate-100 flex flex-wrap gap-3 justify-between items-center bg-slate-50/60">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
                <span>
                  {isLive
                    ? isPaused
                      ? 'Consultation is paused'
                      : 'Consultation is in progress'
                    : 'Ready to start a new consultation'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handlePauseToggle}
                  disabled={!isLive}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {isPaused ? (
                    <>
                      <Play className="w-3.5 h-3.5" /> Continue
                    </>
                  ) : (
                    <>
                      <Pause className="w-3.5 h-3.5" /> Pause
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleMinimize}
                  disabled={!isLive}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronDown className="w-3.5 h-3.5" /> Minimize
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold shadow-sm transition"
                >
                  <Square className="w-3.5 h-3.5 fill-current" /> Stop consultation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
