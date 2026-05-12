import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatAttachment, ChatMessage } from '../../../../shared/types';
import {
  Bot,
  Loader2,
  Mic,
  Paperclip,
  Send,
  StopCircle,
  X,
} from 'lucide-react';
import { renderInlineMarkdown } from '../utils/formatting';
import { transcribeAudio } from '../services/api';

interface PatientChatProps {
  chatMessages: ChatMessage[];
  chatInput: string;
  onChatInputChange: React.Dispatch<React.SetStateAction<string>>;
  chatLoading: boolean;
  chatLongWait?: boolean;
  onSendChat: (attachments: ChatAttachment[]) => Promise<void> | void;
  onToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const AGENT_STATUS_STEPS = [
  'Reviewing patient context...',
  'Scanning folder documents...',
  'Analysing clinical data...',
  'Cross-referencing history...',
  'Composing response...',
];

const STARTER_QUESTIONS = [
  'Summarise recent clinical notes',
  'Any abnormal lab results?',
  'What medications are listed?',
  'Summarise the patient history',
];

const MAX_ATTACHMENTS = 3;
const SUPPORTED_FILE_TYPES = new Set([
  'text/plain',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function supportsAttachment(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return (
    SUPPORTED_FILE_TYPES.has(file.type) ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.pdf') ||
    lowerName.endsWith('.doc') ||
    lowerName.endsWith('.docx')
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

export const PatientChat: React.FC<PatientChatProps> = ({
  chatMessages,
  chatInput,
  onChatInputChange,
  chatLoading,
  chatLongWait,
  onSendChat,
  onToast,
}) => {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusStep, setStatusStep] = useState(0);
  const [draftAttachments, setDraftAttachments] = useState<ChatAttachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef('audio/webm');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    if (chatLoading) {
      setStatusStep(0);
      statusIntervalRef.current = setInterval(() => {
        setStatusStep((prev) => (prev + 1) % AGENT_STATUS_STEPS.length);
      }, 1800);
    } else if (statusIntervalRef.current) {
      clearInterval(statusIntervalRef.current);
      statusIntervalRef.current = null;
    }
    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
    };
  }, [chatLoading]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const isStreamingAssistant =
    chatLoading &&
    chatMessages.length > 0 &&
    chatMessages[chatMessages.length - 1]?.role === 'assistant' &&
    !!chatMessages[chatMessages.length - 1]?.content;

  const isWaitingForFirstChunk = chatLoading && !isStreamingAssistant;

  const recordingLabel = useMemo(() => {
    const totalSeconds = Math.floor(recordingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }, [recordingMs]);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const cleanupRecording = () => {
    stopTimer();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setRecordingMs(0);
  };

  const startRecording = async () => {
    if (isRecording || isTranscribing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : 'audio/webm';

      chunksRef.current = [];
      streamRef.current = stream;
      mimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.start(250);
      setRecordingMs(0);
      timerRef.current = setInterval(() => {
        setRecordingMs((prev) => prev + 250);
      }, 250);
      setIsRecording(true);
    } catch (err) {
      onToast(
        err instanceof Error ? err.message : 'Could not access the microphone.',
        'error'
      );
    }
  };

  const stopRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    setIsTranscribing(true);

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    try {
      const audioBlob = new Blob(chunksRef.current, {
        type: mimeTypeRef.current || 'audio/webm',
      });

      const base64 = await fileToBase64(
        new File([audioBlob], 'agent-query.webm', {
          type: mimeTypeRef.current || 'audio/webm',
        })
      );
      const transcript = await transcribeAudio(
        base64,
        mimeTypeRef.current || 'audio/webm'
      );
      const cleanTranscript = transcript.trim();

      if (!cleanTranscript) {
        onToast('No speech detected.', 'info');
      } else {
        onChatInputChange((prev) => {
          const trimmed = prev.trim();
          return trimmed ? `${trimmed} ${cleanTranscript}` : cleanTranscript;
        });
        inputRef.current?.focus();
      }
    } catch (err) {
      onToast(
        err instanceof Error ? err.message : 'Could not transcribe the recording.',
        'error'
      );
    } finally {
      cleanupRecording();
      setIsTranscribing(false);
    }
  };

  const handleAttachmentPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(event.target.files || []);
    event.target.value = '';
    if (!incoming.length) return;

    const remainingSlots = MAX_ATTACHMENTS - draftAttachments.length;
    if (remainingSlots <= 0) {
      onToast(`You can attach up to ${MAX_ATTACHMENTS} files per question.`, 'info');
      return;
    }

    const accepted = incoming.filter(supportsAttachment).slice(0, remainingSlots);
    const rejectedCount = incoming.length - accepted.length;

    if (accepted.length === 0) {
      onToast('Only TXT, PDF, DOC, and DOCX files are supported in Agent attachments.', 'error');
      return;
    }

    try {
      const loaded = await Promise.all(
        accepted.map(async (file) => ({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64Data: await fileToBase64(file),
        }))
      );
      setDraftAttachments((prev) => [...prev, ...loaded]);
      if (rejectedCount > 0) {
        onToast('Some files were skipped because Agent supports only TXT, PDF, DOC, and DOCX.', 'info');
      }
    } catch (err) {
      onToast(
        err instanceof Error ? err.message : 'Could not prepare the selected file.',
        'error'
      );
    }
  };

  const handleSend = async () => {
    if (!chatInput.trim() || chatLoading || isRecording || isTranscribing) return;
    const attachments = draftAttachments;
    await onSendChat(attachments);
    setDraftAttachments([]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,#fbfdff_0%,#f5fbfe_100%)]">
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-5 custom-scrollbar md:px-8">
        {chatMessages.length === 0 && !chatLoading ? (
          <div className="mx-auto flex h-full w-full max-w-5xl justify-end">
            <div className="inline-flex h-fit items-center gap-2 rounded-full border border-[#d8e7ef] bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Patient context live
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-4 pb-4">
            {chatMessages.map((msg, idx) => {
              const isLastAssistantStreaming =
                chatLoading &&
                idx === chatMessages.length - 1 &&
                msg.role === 'assistant';
              return (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="mr-3 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#eaf6fb] text-[#3294c7]">
                      <Bot size={16} />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-[26px] px-5 py-4 shadow-sm ${
                      msg.role === 'user'
                        ? 'bg-[#3f9fcc] text-white'
                        : 'border border-[#d8e7ef] bg-white text-slate-800'
                    }`}
                  >
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      {msg.content.split('\n').map((line, li) => (
                        <span key={li}>
                          {li > 0 && <br />}
                          {renderInlineMarkdown(line)}
                        </span>
                      ))}
                      {isLastAssistantStreaming && (
                        <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-[#3294c7]" />
                      )}
                    </div>
                    {!isLastAssistantStreaming && (
                      <span
                        className={`mt-2 block text-[10px] ${
                          msg.role === 'user' ? 'text-cyan-100' : 'text-slate-400'
                        }`}
                      >
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {isWaitingForFirstChunk && (
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#eaf6fb] text-[#3294c7]">
                  <Bot size={16} />
                </div>
                <div className="max-w-[85%] rounded-[26px] border border-[#d8e7ef] bg-white px-5 py-4 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <div className="flex gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#63b8de]" style={{ animationDelay: '0ms' }} />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#63b8de]" style={{ animationDelay: '160ms' }} />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#63b8de]" style={{ animationDelay: '320ms' }} />
                    </div>
                    <span className="text-sm italic text-slate-500">
                      {AGENT_STATUS_STEPS[statusStep]}
                    </span>
                  </div>
                  {chatLongWait && (
                    <p className="mt-2 text-xs text-slate-400">
                      Complex queries may take 15-60 seconds.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-[#e6eff5] bg-white/92 px-4 py-4 backdrop-blur-sm md:px-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d8e7ef] bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Patient context live
            </div>
            {chatMessages.length === 0 && !chatLoading && (
              <>
                {STARTER_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => {
                      onChatInputChange(question);
                      inputRef.current?.focus();
                    }}
                    className="rounded-full border border-[#d8e7ef] bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-[#a8d5ea] hover:bg-[#f4fbfe] hover:text-[#2f84b4]"
                  >
                    {question}
                  </button>
                ))}
              </>
            )}
          </div>

          {draftAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {draftAttachments.map((attachment, index) => (
                <div
                  key={`${attachment.name}-${index}`}
                  className="inline-flex items-center gap-2 rounded-full border border-[#d8e7ef] bg-[#f7fbfd] px-3 py-1.5 text-xs font-medium text-slate-600"
                >
                  <Paperclip className="h-3.5 w-3.5 text-[#55a9d3]" />
                  <span className="max-w-[220px] truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                    }
                    className="rounded-full p-0.5 text-slate-400 transition hover:bg-white hover:text-slate-600"
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {(isRecording || isTranscribing) && (
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#d8e7ef] bg-[#f8fcfe] px-3 py-1.5 text-xs font-medium text-slate-500">
              {isTranscribing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#55a9d3]" />
                  Transcribing your query...
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                  Recording query... {recordingLabel}
                </>
              )}
            </div>
          )}

          <div className="flex items-end gap-2.5 rounded-[24px] border border-[#d8e7ef] bg-[#f8fbfd] px-3 py-2.5 shadow-sm">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={chatLoading || isRecording || isTranscribing}
                className="flex h-10 w-10 items-center justify-center rounded-[18px] border border-[#d8e7ef] bg-white text-slate-500 transition hover:border-[#a8d5ea] hover:text-[#2f84b4] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Attach a file"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".txt,.pdf,.doc,.docx,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleAttachmentPick}
              />
              <button
                type="button"
                onClick={isRecording ? () => void stopRecording() : () => void startRecording()}
                disabled={chatLoading || isTranscribing}
                className={`flex h-10 w-10 items-center justify-center rounded-[18px] border transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  isRecording
                    ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'
                    : 'border-[#d8e7ef] bg-white text-slate-500 hover:border-[#a8d5ea] hover:text-[#2f84b4]'
                }`}
                aria-label={isRecording ? 'Stop recording' : 'Dictate a query'}
              >
                {isRecording ? <StopCircle className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            </div>

            <textarea
              ref={inputRef}
              value={chatInput}
              onChange={(e) => onChatInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Ask about notes, history, medications, or upload a document and tell HALO what to look for..."
              className="min-h-[44px] flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400"
              disabled={chatLoading || isTranscribing}
            />

            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!chatInput.trim() || chatLoading || isRecording || isTranscribing}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[18px] bg-[#3f9fcc] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2f84b4] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
