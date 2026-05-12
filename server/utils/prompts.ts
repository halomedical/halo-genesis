/**
 * Centralized AI prompt templates for all Gemini interactions.
 */

export const MAX_CONTENT_LENGTH = 5000;

export function summaryPrompt(patientName: string, fileContext: string): string {
  return `
    Patient: ${patientName}
    Patient Records:
    ${fileContext}

    Based on ALL the patient data above (including any file contents provided), generate a concise, clinical 3-bullet point medical summary covering the most important clinical findings, diagnoses, and current status.
    If file contents are provided, use the actual clinical data — not just file names.
    Return ONLY a raw JSON array of strings.
  `;
}

export function labAlertsPrompt(content: string): string {
  const truncated = content.substring(0, MAX_CONTENT_LENGTH);
  return `Analyze this text. Identify "Abnormal" values. Return JSON array of objects with: parameter, value, severity, context. Content: ${truncated}`;
}

export function imageAnalysisPrompt(): string {
  return `Analyze this medical image. Generate a filename (snake_case) ending in .jpg. Return ONLY the filename.`;
}

export function searchPrompt(query: string, context: string): string {
  return `
    You are a medical assistant search engine. Search by patient name, date of birth, file names, AND file contents.
    Match patients whose data relates to the query conceptually (e.g. "mobility" matches patients with notes about mobility, fractures, physiotherapy, walking difficulty, etc.).
    User Query: "${query}"
    Patient Database (includes file names and content snippets):
    ${context}
    Return ONLY a raw JSON array of matching Patient IDs. If no match, return [].
  `;
}

export function chatSystemPrompt(fullContext: string, conversationHistory: string, question: string): string {
  return `You are HALO, an experienced medical assistant integrated into a patient management system. Answer questions using ONLY the patient data provided below. Be concise, clinical, and professional. If the data doesn't contain the answer, say so honestly. Never make up medical information.

Patient Data Context:
${fullContext}

${conversationHistory ? `Previous conversation:\n${conversationHistory}\n` : ''}
User question: ${question}`;
}

export function soapNotePrompt(transcript: string, customTemplate?: string): string {
  if (customTemplate) {
    return `
    You are a medical scribe. Convert this clinical dictation into a clinical note using the EXACT template/format provided below.
    Follow the template's structure, headings, and sections precisely. Use Markdown formatting (## for headings, **bold** for labels).
    Fill in each section of the template with the relevant information from the dictation. If a section has no relevant data, write "N/A" or "Not discussed".

    TEMPLATE TO FOLLOW:
    ${customTemplate}

    Dictation transcript:
    "${transcript}"
    `;
  }
  return `
    You are a medical scribe. Convert this clinical dictation into a properly formatted SOAP note using Markdown.
    
    Dictation transcript:
    "${transcript}"
    
    Format with ## headers for Subjective, Objective, Assessment, Plan.
  `;
}

export function geminiTranscriptionPrompt(customTemplate?: string): string {
  if (customTemplate) {
    return `You are a medical scribe. Transcribe this audio into a clinical note using the EXACT template/format below. Follow the template's structure, headings, and sections precisely. Use Markdown formatting (## for headings, **bold** for labels). Fill in each section with the relevant information. If a section has no data, write "N/A".

TEMPLATE TO FOLLOW:
${customTemplate}`;
  }
  return 'You are a medical scribe. Transcribe this audio into a SOAP note with ## headers for Subjective, Objective, Assessment, Plan.';
}

export function patientStickerExtractionPrompt(): string {
  return `You are a clinical assistant. The attached image is a patient sticker or identification label from a hospital, clinic, or GP folder.

Extract all visible patient information. Return a single JSON object (no markdown fences) with these fields (use null if not found):
{
  "fullName": "...",
  "dob": "YYYY-MM-DD or null",
  "idNumber": "...",
  "folderNumber": "...",
  "gender": "M or F or null",
  "contactNumber": "...",
  "address": "...",
  "medicalAid": "...",
  "medicalAidNumber": "...",
  "medicalAidPlan": "...",
  "email": "...",
  "notes": "any other visible text that looks clinically relevant"
}

Return ONLY the raw JSON. No extra text, no code fences.`;
}

export function fileDescriptionPrompt(fileName: string, extractedText: string): string {
  const truncated = extractedText.substring(0, MAX_CONTENT_LENGTH);
  return `
You are HALO, a clinical assistant helping a doctor understand a newly uploaded document.

File name: ${fileName}

Extracted text (may be partial):
${truncated}

In 2–4 short bullet points, describe clearly what this file contains and why it might be clinically relevant (history, investigations, imaging, lab results, correspondence, etc.).
Avoid speculation and do not invent diagnoses that are not supported by the text.
Return ONLY a raw Markdown string (no JSON).
`;
}

export function patientSummarySourcePrompt(params: {
  patientName: string;
  sourceType: 'file' | 'consultation';
  sourceName: string;
  sourceDate: string;
  content: string;
}): string {
  const truncated = params.content.substring(0, MAX_CONTENT_LENGTH);
  return `
You are HALO, building a persistent longitudinal patient summary for ${params.patientName}.

Source type: ${params.sourceType}
Source name: ${params.sourceName}
Source date: ${params.sourceDate}

Clinical source content:
${truncated}

Extract the clinically meaningful update from this source.
Return ONLY raw JSON in this exact shape:
{
  "title": "short source label",
  "bullets": ["clinical update 1", "clinical update 2", "clinical update 3"]
}

Rules:
- Use 1 to 3 short bullets only.
- Focus on diagnoses, procedures, key findings, treatment changes, and meaningful follow-up context.
- Avoid speculation.
- If the source has little value, still return the single most useful bullet you can support from the text.
`;
}

export function patientSummaryMergePrompt(params: {
  patientName: string;
  currentSnapshot: string[];
  recentTimeline: Array<{ date: string; title: string; bullets: string[] }>;
  newUpdate: { title: string; date: string; bullets: string[] };
}): string {
  const recentTimelineText = params.recentTimeline
    .map((entry) => `- ${entry.date} | ${entry.title}: ${entry.bullets.join(' ')}`)
    .join('\n');
  return `
You are HALO, updating the current longitudinal patient snapshot for ${params.patientName}.

Current snapshot bullets:
${JSON.stringify(params.currentSnapshot)}

Recent timeline context:
${recentTimelineText || '(none)'}

Newest update:
${JSON.stringify(params.newUpdate)}

Return ONLY raw JSON in this exact shape:
{
  "snapshot": ["bullet 1", "bullet 2", "bullet 3", "bullet 4"]
}

Rules:
- Return 3 to 5 concise bullets.
- Keep this as the CURRENT overall picture of the patient, not a full timeline.
- Prefer durable clinically relevant facts over administrative noise.
- Incorporate the newest update when it materially changes the current picture.
`;
}
