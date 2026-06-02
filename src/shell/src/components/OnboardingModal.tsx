import React, { useMemo, useState } from 'react';
import type { OnboardingStateResponse } from '../../../../shared/onboarding';
import type { UserModulesSettings } from '../../../../shared/types';
import { Loader2 } from 'lucide-react';

interface Props {
  isOpen: boolean;
  state: OnboardingStateResponse | null;
  submitting: boolean;
  onSubmit: (payload: {
    role: string;
    specialtyKey: string;
    subspecialtyKey: string | null;
    selectedModules: UserModulesSettings;
  }) => Promise<void>;
}

const EMPTY_MODULES: UserModulesSettings = {
  admissions: false,
  adminAgent: false,
  scribe: false,
  billing: false,
};

export const OnboardingModal: React.FC<Props> = ({ isOpen, state, submitting, onSubmit }) => {
  const [role, setRole] = useState('clinician');
  const [specialtyKey, setSpecialtyKey] = useState('');
  const [subspecialtyKey, setSubspecialtyKey] = useState('');
  const [selectedModules, setSelectedModules] = useState<UserModulesSettings>({ ...EMPTY_MODULES });
  const [error, setError] = useState<string | null>(null);

  const availableSubspecialties = useMemo(() => {
    if (!state?.catalog?.subspecialties || !specialtyKey) return [];
    return state.catalog.subspecialties.filter((s) => s.specialtyKey === specialtyKey);
  }, [specialtyKey, state?.catalog?.subspecialties]);

  if (!isOpen) return null;

  const toggleModule = (key: keyof UserModulesSettings) => {
    setSelectedModules((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const submit = async () => {
    setError(null);
    if (!specialtyKey) {
      setError('Please select a specialty.');
      return;
    }
    try {
      await onSubmit({
        role: role.trim() || 'clinician',
        specialtyKey,
        subspecialtyKey: subspecialtyKey || null,
        selectedModules,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete onboarding.');
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-900">Welcome to HALO</h2>
          <p className="text-sm text-slate-500 mt-1">
            Complete onboarding to personalize your workspace. Specialty defaults are auto-applied.
          </p>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Role</span>
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none"
                placeholder="clinician"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Specialty *</span>
              <select
                value={specialtyKey}
                onChange={(e) => {
                  setSpecialtyKey(e.target.value);
                  setSubspecialtyKey('');
                }}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none"
              >
                <option value="">Select specialty</option>
                {(state?.catalog?.specialties || []).map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subspecialty (optional)</span>
            <select
              value={subspecialtyKey}
              onChange={(e) => setSubspecialtyKey(e.target.value)}
              disabled={!specialtyKey}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm disabled:bg-slate-100 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none"
            >
              <option value="">Select subspecialty</option>
              {availableSubspecialties.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </label>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Choose modules</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {([
                ['admissions', 'Admissions'],
                ['adminAgent', 'Admin Agent'],
                ['scribe', 'Scribe'],
                ['billing', 'Billing'],
              ] as Array<[keyof UserModulesSettings, string]>).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleModule(key)}
                  className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                    selectedModules[key]
                      ? 'border-cyan-500 bg-cyan-50 text-cyan-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="font-semibold">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50">
          <button
            onClick={submit}
            disabled={submitting}
            className="w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold py-2.5 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
            {submitting ? 'Saving...' : 'Complete Onboarding'}
          </button>
        </div>
      </div>
    </div>
  );
};

