import React from 'react';
import type { AdmissionsCard } from '../../../../../shared/types';
import {
  Calendar,
  CheckCircle2,
  Clock3,
  FolderOpen,
  Loader2,
  MessageCircle,
  Stethoscope,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { formatTimeInStage } from './admissionsUtils';

interface Props {
  now: number;
  drawerDraft: AdmissionsCard;
  idNumber?: string;
  saving: boolean;
  taskInput: string;
  tagInput: string;
  doctorInput: string;
  onClose: () => void;
  onSave: () => void;
  setDrawerDraft: React.Dispatch<React.SetStateAction<AdmissionsCard | null>>;
  setTaskInput: (v: string) => void;
  setTagInput: (v: string) => void;
  setDoctorInput: (v: string) => void;
  onOpenPatient: (
    patientId: string,
    options?: { tab?: 'overview' | 'notes' | 'chat' | 'sessions'; freshSession?: boolean }
  ) => void;
}

export const AdmissionsCardDrawer: React.FC<Props> = ({
  now,
  drawerDraft,
  idNumber,
  saving,
  taskInput,
  tagInput,
  doctorInput,
  onClose,
  onSave,
  setDrawerDraft,
  setTaskInput,
  setTagInput,
  setDoctorInput,
  onOpenPatient,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/35 backdrop-blur-[2px]">
      <button
        type="button"
        className="flex-1 cursor-default"
        onClick={onClose}
        aria-label="Close admissions card"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="admissions-drawer-title"
        className="flex h-full w-full max-w-[520px] flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Admissions card</p>
              <h2
                id="admissions-drawer-title"
                className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900 md:text-2xl"
              >
                {drawerDraft.patientName}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-0.5 font-medium text-cyan-700">
                  <Clock3 className="h-3 w-3" />
                  {formatTimeInStage(drawerDraft.enteredColumnAt, now)}
                </span>
                {drawerDraft.folderNumber && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                    Folder {drawerDraft.folderNumber}
                  </span>
                )}
                {idNumber && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-600">ID {idNumber}</span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-100 hover:text-slate-500"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => onOpenPatient(drawerDraft.patientId, { tab: 'overview' })}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
            >
              <FolderOpen className="h-4 w-4" />
              Open folder
            </button>
            <button
              type="button"
              onClick={() => onOpenPatient(drawerDraft.patientId, { tab: 'notes', freshSession: true })}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
            >
              <Stethoscope className="h-4 w-4" />
              Start consultation
            </button>
            <button
              type="button"
              onClick={() => onOpenPatient(drawerDraft.patientId, { tab: 'chat' })}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
            >
              <MessageCircle className="h-4 w-4" />
              Ask Agent
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-6">
            <section>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Admitting diagnosis
              </label>
              <input
                value={drawerDraft.diagnosis}
                onChange={(event) =>
                  setDrawerDraft((prev) => (prev ? { ...prev, diagnosis: event.target.value } : prev))
                }
                placeholder="#CAP"
                className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-cyan-300 focus:bg-white"
              />
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-300" />
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Co-managing doctors</p>
              </div>
              <div className="mb-2 flex flex-wrap gap-2">
                {drawerDraft.coManagingDoctors.map((doctor) => (
                  <button
                    key={doctor}
                    type="button"
                    onClick={() =>
                      setDrawerDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              coManagingDoctors: prev.coManagingDoctors.filter((item) => item !== doctor),
                            }
                          : prev
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                  >
                    {doctor}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={doctorInput}
                  onChange={(event) => setDoctorInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && doctorInput.trim()) {
                      event.preventDefault();
                      setDrawerDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              coManagingDoctors: [...prev.coManagingDoctors, doctorInput.trim()],
                            }
                          : prev
                      );
                      setDoctorInput('');
                    }
                  }}
                  placeholder="Add co-managing doctor"
                  className="h-10 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-cyan-300 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!doctorInput.trim()) return;
                    setDrawerDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            coManagingDoctors: [...prev.coManagingDoctors, doctorInput.trim()],
                          }
                        : prev
                    );
                    setDoctorInput('');
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
                >
                  Add
                </button>
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-slate-300" />
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Tags</p>
              </div>
              <div className="mb-2 flex flex-wrap gap-2">
                {drawerDraft.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setDrawerDraft((prev) =>
                        prev ? { ...prev, tags: prev.tags.filter((item) => item !== tag) } : prev
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                  >
                    {tag}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && tagInput.trim()) {
                      event.preventDefault();
                      setDrawerDraft((prev) =>
                        prev ? { ...prev, tags: [...prev.tags, tagInput.trim()] } : prev
                      );
                      setTagInput('');
                    }
                  }}
                  placeholder="Add tag"
                  className="h-10 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-cyan-300 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!tagInput.trim()) return;
                    setDrawerDraft((prev) =>
                      prev ? { ...prev, tags: [...prev.tags, tagInput.trim()] } : prev
                    );
                    setTagInput('');
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
                >
                  Add
                </button>
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-slate-300" />
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Tasks</p>
              </div>
              <div className="space-y-2">
                {drawerDraft.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      checked={task.done}
                      onChange={(event) =>
                        setDrawerDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                tasks: prev.tasks.map((item) =>
                                  item.id === task.id ? { ...item, done: event.target.checked } : item
                                ),
                              }
                            : prev
                        )
                      }
                      className="h-4 w-4 rounded border-slate-300 text-cyan-500"
                    />
                    <p className={`flex-1 text-sm ${task.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                      {task.title}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setDrawerDraft((prev) =>
                          prev ? { ...prev, tasks: prev.tasks.filter((item) => item.id !== task.id) } : prev
                        )
                      }
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-300 transition hover:bg-white hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  value={taskInput}
                  onChange={(event) => setTaskInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && taskInput.trim()) {
                      event.preventDefault();
                      setDrawerDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              tasks: [
                                ...prev.tasks,
                                {
                                  id: crypto.randomUUID(),
                                  title: taskInput.trim(),
                                  done: false,
                                  createdAt: new Date().toISOString(),
                                },
                              ],
                            }
                          : prev
                      );
                      setTaskInput('');
                    }
                  }}
                  placeholder="Add task"
                  className="h-10 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-cyan-300 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!taskInput.trim()) return;
                    setDrawerDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            tasks: [
                              ...prev.tasks,
                              {
                                id: crypto.randomUUID(),
                                title: taskInput.trim(),
                                done: false,
                                createdAt: new Date().toISOString(),
                              },
                            ],
                          }
                        : prev
                    );
                    setTaskInput('');
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
                >
                  Add
                </button>
              </div>
            </section>
          </div>
        </div>

        <div className="border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onSave}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 text-sm font-semibold text-white transition hover:bg-cyan-600"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save changes
          </button>
        </div>
      </aside>
    </div>
  );
};
