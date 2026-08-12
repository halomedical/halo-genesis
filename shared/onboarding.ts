import type { UserModulesSettings } from './types';

export type OnboardingModuleKey = keyof UserModulesSettings;

export interface OnboardingSpecialty {
  key: string;
  label: string;
}

export interface OnboardingSubspecialty {
  key: string;
  specialtyKey: string;
  label: string;
}

export interface OnboardingProfile {
  role: string;
  specialtyKey: string;
  subspecialtyKey: string | null;
  completedAt: string | null;
}

export interface OnboardingCatalog {
  modules: OnboardingModuleKey[];
  specialties: OnboardingSpecialty[];
  subspecialties: OnboardingSubspecialty[];
}

export interface OnboardingStateResponse {
  required: boolean;
  profile: OnboardingProfile | null;
  selectedModules: UserModulesSettings;
  autoModules: UserModulesSettings;
  catalog: OnboardingCatalog;
}

