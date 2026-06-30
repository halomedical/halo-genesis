import React, { useState } from 'react';
import { Loader, Stethoscope, Briefcase } from 'lucide-react';
import { selectAppPersona, type AppPersona } from '../services/api';
import { getErrorMessage } from '../utils/formatting';

interface Props {
  userName?: string;
  onSelected: (persona: AppPersona) => void;
  onError: (message: string) => void;
}

export const PersonaChooserPage: React.FC<Props> = ({ userName, onSelected, onError }) => {
  const [loadingPersona, setLoadingPersona] = useState<AppPersona | null>(null);

  const choose = async (persona: AppPersona) => {
    setLoadingPersona(persona);
    try {
      const res = await selectAppPersona(persona);
      onSelected(res.appPersona);
    } catch (err) {
      onError(getErrorMessage(err));
      setLoadingPersona(null);
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-white">
      <div className="max-w-lg w-full text-center px-6">
        <img
          src="/halo-medical-logo.png"
          alt="HALO Medical"
          className="w-44 h-auto mx-auto mb-6 select-none"
          draggable={false}
        />
        <h1 className="text-2xl font-bold text-slate-800 mb-8">Haasbroek Practice</h1>
        {userName ? (
          <p className="text-sm text-slate-400 mb-6 -mt-4">Signed in as {userName}</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            disabled={Boolean(loadingPersona)}
            onClick={() => choose('clinician')}
            className="flex flex-col items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-cyan-400 hover:shadow-md disabled:opacity-60"
          >
            {loadingPersona === 'clinician' ? (
              <Loader className="h-8 w-8 animate-spin text-cyan-600" />
            ) : (
              <Stethoscope className="h-8 w-8 text-cyan-600" />
            )}
            <span className="text-lg font-bold text-slate-800 w-full text-center">Dr Haasbroek</span>
          </button>

          <button
            type="button"
            disabled={Boolean(loadingPersona)}
            onClick={() => choose('admin_staff')}
            className="flex flex-col items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-cyan-400 hover:shadow-md disabled:opacity-60"
          >
            {loadingPersona === 'admin_staff' ? (
              <Loader className="h-8 w-8 animate-spin text-cyan-600" />
            ) : (
              <Briefcase className="h-8 w-8 text-cyan-600" />
            )}
            <span className="text-lg font-bold text-slate-800 w-full text-center">Admin Staff</span>
          </button>
        </div>

        <p className="mt-8 text-xs text-slate-400">Secure Environment · POPIA Compliant</p>
      </div>
    </div>
  );
};
