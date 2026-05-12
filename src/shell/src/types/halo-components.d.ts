declare module 'halo-components/admin-agent-panel' {
  import type { FC } from 'react';
  export const AdminAgentPanel: FC<{
    onClose: () => void;
    onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  }>;
}

declare module 'halo-components/admin-agent-onboarding' {
  import type { FC } from 'react';
  export const AdminAgentOnboarding: FC<{
    userEmail?: string;
    onComplete: () => void;
  }>;
}

declare module 'halo-components/header-consultation-recorder' {
  import type { FC } from 'react';
  export const HeaderConsultationRecorder: FC<{
    onBeforeStart?: () => void;
    onLiveTranscriptUpdate: (transcript: string) => void;
    onLiveStopped: (transcript: string) => void;
    onError?: (message: string) => void;
  }>;
}

declare module 'halo-components/billing-page' {
  import type { FC } from 'react';
  import type { Patient, UserSettings } from '../../../../shared/types';
  export const BillingPage: FC<{
    onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
    patients: Patient[];
    selectedPatientId: string | null;
    userSettings: UserSettings | null;
  }>;
}
