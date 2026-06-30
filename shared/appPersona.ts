export type AppPersona = 'clinician' | 'admin_staff';

export interface PersonaCapabilities {
  scribe: boolean;
  haloAgent: boolean;
  pdfFillerPatientTab: boolean;
  pdfFillerHub: boolean;
  calendar: boolean;
  allowDeletePatientFolder: boolean;
}

export function capabilitiesForPersona(persona: AppPersona): PersonaCapabilities {
  if (persona === 'admin_staff') {
    return {
      scribe: false,
      haloAgent: true,
      pdfFillerPatientTab: true,
      pdfFillerHub: true,
      calendar: true,
      allowDeletePatientFolder: false,
    };
  }
  return {
    scribe: true,
    haloAgent: true,
    pdfFillerPatientTab: true,
    pdfFillerHub: false,
    calendar: true,
    allowDeletePatientFolder: true,
  };
}

export function isValidAppPersona(value: unknown): value is AppPersona {
  return value === 'clinician' || value === 'admin_staff';
}
