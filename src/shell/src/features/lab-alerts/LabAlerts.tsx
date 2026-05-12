import React from 'react';
import { AlertTriangle, Activity } from 'lucide-react';
import type { LabAlert } from '../../../../../shared/types';

interface Props {
  alerts: LabAlert[];
}

export const LabAlerts: React.FC<Props> = ({ alerts }) => {
  if (alerts.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <Activity className="w-4 h-4 text-amber-600" />
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Trend Spotter: New Alerts</h4>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {alerts.map((alert, idx) => (
          <div key={idx} className="bg-white border-l-4 border-amber-500 shadow-sm rounded-r-md p-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-slate-900 text-sm">
                {alert.parameter}: <span className="text-amber-700 font-bold">{alert.value}</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">{alert.context}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
