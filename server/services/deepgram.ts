import { config } from '../config';

interface DeepgramResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
    }>;
  };
}

/**
 * Check if a usable Deepgram API key is configured.
 */
export function isDeepgramAvailable(): boolean {
  return !!config.deepgramApiKey && config.deepgramApiKey !== 'placeholder-for-now';
}

/**
 * Transcribe audio using the Deepgram Nova 3 Medical model.
 * Returns the raw transcript text, or empty string if no speech detected.
 */
export async function transcribeWithDeepgram(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const dgResponse = await fetch(
    'https://api.deepgram.com/v1/listen?model=nova-3-medical&smart_format=true&punctuate=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${config.deepgramApiKey}`,
        'Content-Type': mimeType,
      },
      body: audioBuffer,
    }
  );

  if (!dgResponse.ok) {
    const errText = await dgResponse.text();
    throw new Error(`[Deepgram ${dgResponse.status}] Transcription failed: ${errText}`);
  }

  const dgData = (await dgResponse.json()) as DeepgramResponse;
  return dgData.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
}
