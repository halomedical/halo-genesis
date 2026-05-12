/**
 * Deepgram live streaming transcription.
 * Creates a live connection to Deepgram and forwards audio; emits transcript events.
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { config } from '../config';

export function isDeepgramLiveAvailable(): boolean {
  return !!config.deepgramApiKey && config.deepgramApiKey !== 'placeholder-for-now';
}

/** Transcript chunk from Deepgram (interim or final). */
export interface LiveTranscriptResult {
  transcript: string;
  isFinal: boolean;
}

/**
 * Create a Deepgram live connection and wire it to the given callbacks.
 * - onTranscript: called for each transcript chunk (interim and final).
 * - onOpen: when Deepgram connection is ready.
 * - onClose: when connection closes.
 * - onError: on Deepgram error.
 * Returns an object with send(data), requestClose(), and disconnect().
 */
export function createDeepgramLiveConnection(callbacks: {
  onTranscript: (result: LiveTranscriptResult) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: unknown) => void;
}): { send: (data: Buffer | ArrayBuffer) => void; requestClose: () => void; disconnect: () => void } {
  const deepgram = createClient(config.deepgramApiKey);

  // Nova 3 Medical, smart format, punctuation. Omit encoding for containerized (e.g. WebM) so Deepgram can auto-detect.
  const connection = deepgram.listen.live({
    model: 'nova-3-medical',
    smart_format: true,
    punctuate: true,
    // Client sends WebM/opus chunks from MediaRecorder; Deepgram accepts containerized without encoding param
  });

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log('[deepgram-live] connection opened');
    callbacks.onOpen?.();
  });

  connection.on(
    LiveTranscriptionEvents.Transcript,
    (data: {
      channel?: {
        alternatives?: Array<{
          transcript?: string;
          is_final?: boolean;
          paragraphs?: { transcript?: string };
        }>;
      };
    }) => {
      const alt = data.channel?.alternatives?.[0];
      if (!alt) return;

      const primary = alt.transcript;
      const paragraphs = (alt as any).paragraphs?.transcript as
        | string
        | undefined;

      const transcript = (primary || paragraphs || '').trim();
      if (!transcript) return;

      try {
        console.log('[deepgram-live] transcript chunk', {
          textPreview: transcript.slice(0, 80),
          isFinal: alt.is_final ?? true,
        });
      } catch {
        // ignore logging failure
      }

      callbacks.onTranscript({
        transcript,
        isFinal: alt.is_final ?? true,
      });
    }
  );

  connection.on(LiveTranscriptionEvents.Close, () => {
    console.log('[deepgram-live] connection closed');
    callbacks.onClose?.();
  });

  connection.on(LiveTranscriptionEvents.Error, (err: unknown) => {
    console.error('[deepgram-live] error', err);
    callbacks.onError?.(err);
  });

  return {
    send(data: Buffer | ArrayBuffer) {
      let payload: ArrayBuffer;
      if (data instanceof ArrayBuffer) {
        payload = data;
      } else {
        payload = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      }
      connection.send(payload);
    },
    requestClose() {
      try {
        connection.requestClose();
      } catch {
        // ignore if already closed
      }
    },
    disconnect() {
      try {
        connection.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
