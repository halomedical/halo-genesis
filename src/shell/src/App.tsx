import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { PatientWorkspace, type WorkspaceNavigationIntent } from './pages/PatientWorkspace';
import { Toast } from './components/Toast';
import { SettingsModal } from './components/SettingsModal';
import { UploadHud } from './components/UploadHud';
import {
  checkAuth, getLoginUrl, logout, fetchAllPatients, warmAndListFiles, createPatient, deletePatient,
  loadSettings, saveSettings, ApiError, extractPatientSticker, fetchEffectiveFeatures, importPatientsJson,
  updatePatientFamily, fetchOnboardingState, completeOnboarding,
} from './services/api';
import { AdminAgentPanel } from './modules/admin-agent/components/AdminAgentPanel';
import { AdminAgentOnboarding } from './modules/admin-agent/components/AdminAgentOnboarding';
import { BillingPage } from './modules/billing/BillingPage';
import type { Patient, UserSettings, CalendarEvent } from '../../../shared/types';
import type { EffectiveFeatureFlags } from '../../../shared/featureFlags';
import type { OnboardingStateResponse } from '../../../shared/onboarding';
import type { StickerExtractedData } from './services/api';
import type { UploadHudState } from './components/UploadHud';
import { LogIn, Loader, X, UserPlus, Calendar, Users, AlertTriangle, Trash2, ScanLine, Loader2 } from 'lucide-react';
import { CalendarPage } from './pages/CalendarPage';
import { AdmissionsPage } from './pages/AdmissionsPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { OnboardingModal } from './components/OnboardingModal';

export const App = () => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    () => sessionStorage.getItem('halo_selectedPatientId')
  );
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState<Patient | null>(null);

  const [newPatientName, setNewPatientName] = useState("");
  const [newPatientDob, setNewPatientDob] = useState("");
  const [newPatientSex, setNewPatientSex] = useState<'M' | 'F'>('M');
  // Extended profile fields
  const [newPatientIdNumber, setNewPatientIdNumber] = useState("");
  const [newPatientFolderNumber, setNewPatientFolderNumber] = useState("");
  const [newPatientContact, setNewPatientContact] = useState("");
  const [newPatientEmail, setNewPatientEmail] = useState("");
  const [newPatientAddress, setNewPatientAddress] = useState("");
  const [newPatientMedicalAid, setNewPatientMedicalAid] = useState("");
  const [newPatientMedicalAidNumber, setNewPatientMedicalAidNumber] = useState("");
  const [newPatientMedicalAidPlan, setNewPatientMedicalAidPlan] = useState("");
  // MediKredit billing fields (patient-level)
  const [newPatientSchemeCode, setNewPatientSchemeCode] = useState("");
  const [newPatientPlanCode, setNewPatientPlanCode] = useState("");
  const [newPatientMemberNumber, setNewPatientMemberNumber] = useState("");
  const [newPatientDependantCode, setNewPatientDependantCode] = useState("");
  const [newPatientNotes, setNewPatientNotes] = useState("");
  // Sticker scan state
  const [stickerScanning, setStickerScanning] = useState(false);
  const [stickerPreview, setStickerPreview] = useState<string | null>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);

  // Settings / profile state
  const [showSettings, setShowSettings] = useState(false);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [effectiveFeatures, setEffectiveFeatures] = useState<EffectiveFeatureFlags | null>(null);
  const [practiceInfo, setPracticeInfo] = useState<{ id: string; name: string; slug: string } | null>(null);
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [loginTime] = useState<number>(Date.now());

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Recently opened patients (stored in localStorage)
  const [recentPatientIds, setRecentPatientIds] = useState<string[]>(
    () => {
      try {
        return JSON.parse(localStorage.getItem('halo_recentPatientIds') || '[]');
      } catch { return []; }
    }
  );

  // Calendar / bookings
  const [calendarPrepEvent, setCalendarPrepEvent] = useState<CalendarEvent | null>(null);
  const [activeMainView, setActiveMainView] = useState<'workspace' | 'calendar' | 'admissions' | 'marketplace' | 'billing'>('workspace');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('halo_sidebarCollapsed') === '1';
  });
  const [uploadHudState, setUploadHudState] = useState<UploadHudState | null>(null);
  const [workspaceIntent, setWorkspaceIntent] = useState<WorkspaceNavigationIntent | null>(null);
  const [adminAgentOpen, setAdminAgentOpen] = useState(false);
  const [showAgentOnboarding, setShowAgentOnboarding] = useState(false);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [onboardingState, setOnboardingState] = useState<OnboardingStateResponse | null>(null);
  const [onboardingSubmitting, setOnboardingSubmitting] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('halo_sidebarCollapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!uploadHudState || uploadHudState.phase !== 'success') return;
    const timeoutId = window.setTimeout(() => {
      setUploadHudState((current) =>
        current?.phase === 'success' ? null : current
      );
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [uploadHudState]);

  useEffect(() => {
    if (!effectiveFeatures?.admissions && activeMainView === 'admissions') {
      setActiveMainView('workspace');
    }
  }, [activeMainView, effectiveFeatures?.admissions]);

  useEffect(() => {
    if (!effectiveFeatures?.billing && activeMainView === 'billing') {
      setActiveMainView('workspace');
    }
  }, [activeMainView, effectiveFeatures?.billing]);

  const adminAgentEnabled = effectiveFeatures?.adminAgent ?? false;

  useEffect(() => {
    if (!adminAgentEnabled) {
      setAdminAgentOpen(false);
    } else if (!localStorage.getItem('halo_agent_onboarding_done')) {
      setShowAgentOnboarding(true);
    }
  }, [adminAgentEnabled]);

  // Persist selected patient to sessionStorage so it survives page refresh
  // Also track recently opened patients in localStorage
  const selectPatient = useCallback((id: string | null) => {
    setSelectedPatientId(id);
    if (id) {
      sessionStorage.setItem('halo_selectedPatientId', id);
      // Push to recent list (most recent first, deduped, max 3)
      setRecentPatientIds(prev => {
        const updated = [id, ...prev.filter(pid => pid !== id)].slice(0, 3);
        localStorage.setItem('halo_recentPatientIds', JSON.stringify(updated));
        return updated;
      });
    } else {
      sessionStorage.removeItem('halo_selectedPatientId');
    }
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
  }, []);

  const openPatientWorkspace = useCallback((
    patientId: string,
    options?: { tab?: WorkspaceNavigationIntent['tab']; freshSession?: boolean }
  ) => {
    setActiveMainView('workspace');
    selectPatient(patientId);
    if (options?.tab || options?.freshSession) {
      setWorkspaceIntent({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tab: options?.tab || 'overview',
        freshSession: options?.freshSession,
      });
    } else {
      setWorkspaceIntent(null);
    }
  }, [selectPatient]);

  const getErrorMessage = (err: unknown): string => {
    if (err instanceof ApiError) return err.message;
    if (err instanceof Error) return err.message;
    return 'An unexpected error occurred.';
  };

  const refreshPatients = useCallback(async (): Promise<Patient[]> => {
    const data = await fetchAllPatients();
    setPatients(data);
    return data;
  }, []);

  // Check if user has an active session
  useEffect(() => {
    const checkSession = async () => {
      try {
        // First verify server is reachable
        const healthCheck = await fetch('/api/health', { credentials: 'include' }).catch(() => null);
        if (!healthCheck || !healthCheck.ok) {
          console.warn('Server health check failed - make sure server is running on port 3001');
        }
        
        const auth = await checkAuth();
        if (auth.signedIn) {
          setIsSignedIn(true);
          setUserEmail(auth.email);
          const loadedPatients = await refreshPatients();
          // Validate stored patient selection — clear if patient no longer exists
          const storedId = sessionStorage.getItem('halo_selectedPatientId');
          if (storedId && !loadedPatients.find(p => p.id === storedId)) {
            selectPatient(null);
          }
          // Prefetch file list for the patient most likely to be opened (warms Drive + server cache)
          const prefetchId = storedId && loadedPatients.some(p => p.id === storedId)
            ? storedId
            : loadedPatients[0]?.id;
          if (prefetchId) {
            warmAndListFiles(prefetchId, 24).catch(() => {});
          }
          // Load settings in background
          loadSettings().then(res => {
            if (res.settings) setUserSettings(res.settings);
          }).catch(() => {});

          fetchEffectiveFeatures().then((res) => {
            setEffectiveFeatures(res.effective);
            setPracticeInfo(res.practice);
            setOnboardingRequired(Boolean(res.onboardingRequired));
          }).catch(() => {});

          fetchOnboardingState().then((state) => {
            setOnboardingState(state);
            setOnboardingRequired(Boolean(state.required));
          }).catch((error) => {
            console.error('Load onboarding state error:', error);
            showToast('Onboarding setup could not be loaded. Check specialties in Supabase.', 'error');
          });

        }
      } catch (error) {
        console.error('Session check failed:', error);
      }
      setIsReady(true);
    };
    checkSession();
  }, [refreshPatients, selectPatient, showToast]);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      console.log('Fetching login URL...');
      const { url } = await getLoginUrl();
      console.log('Got login URL:', url);
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('No login URL received from server');
      }
    } catch (error) {
      console.error('Sign in error:', error);
      showToast(getErrorMessage(error), 'error');
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setIsSignedIn(false);
    selectPatient(null);
    setActiveMainView('workspace');
    setOnboardingRequired(false);
    setOnboardingState(null);
    setOnboardingDismissed(false);
  };

  const handleCompleteOnboarding = async (payload: {
    role: string;
    specialtyKey: string;
    subspecialtyKey: string | null;
    selectedModules: { admissions: boolean; adminAgent: boolean; scribe: boolean; billing: boolean };
  }) => {
    setOnboardingSubmitting(true);
    try {
      const completion = await completeOnboarding(payload);

      // Close immediately once backend confirms save; refreshes below are best-effort.
      setOnboardingRequired(Boolean(completion.onboardingRequired));
      setOnboardingDismissed(true);

      const [featuresRes, onboardingRes] = await Promise.allSettled([
        fetchEffectiveFeatures(),
        fetchOnboardingState(),
      ]);

      if (featuresRes.status === 'fulfilled') {
        setEffectiveFeatures(featuresRes.value.effective);
        setPracticeInfo(featuresRes.value.practice);
        setOnboardingRequired(Boolean(featuresRes.value.onboardingRequired));
        if (!featuresRes.value.practice) {
          showToast('Onboarding saved. Ask ops to map your email to a practice for full feature access.', 'info');
        }
      }
      if (onboardingRes.status === 'fulfilled') {
        setOnboardingState(onboardingRes.value);
        setOnboardingRequired(Boolean(onboardingRes.value.required));
      }
      showToast('Onboarding complete.', 'success');
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
      throw error;
    } finally {
      setOnboardingSubmitting(false);
    }
  };

  const resetCreateForm = () => {
    setNewPatientName("");
    setNewPatientDob("");
    setNewPatientSex("M");
    setNewPatientIdNumber("");
    setNewPatientFolderNumber("");
    setNewPatientContact("");
    setNewPatientEmail("");
    setNewPatientAddress("");
    setNewPatientMedicalAid("");
    setNewPatientMedicalAidNumber("");
    setNewPatientMedicalAidPlan("");
    setNewPatientSchemeCode("");
    setNewPatientPlanCode("");
    setNewPatientMemberNumber("");
    setNewPatientDependantCode("");
    setNewPatientNotes("");
    setStickerPreview(null);
    setStickerScanning(false);
  };

  const openCreateModal = () => {
    setLoading(false);
    resetCreateForm();
    setShowCreateModal(true);
  };

  const handleStickerScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    // Show preview
    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      setStickerPreview(dataUrl);
      setStickerScanning(true);
      try {
        const base64 = dataUrl.split(',')[1];
        const result: StickerExtractedData = await extractPatientSticker(base64, file.type || 'image/jpeg');
        // Populate form fields from extraction
        if (result.fullName) setNewPatientName(result.fullName);
        if (result.dob) setNewPatientDob(result.dob);
        if (result.gender === 'M' || result.gender === 'F') setNewPatientSex(result.gender);
        if (result.idNumber) setNewPatientIdNumber(result.idNumber);
        if (result.folderNumber) setNewPatientFolderNumber(result.folderNumber);
        if (result.contactNumber) setNewPatientContact(result.contactNumber);
        if (result.email) setNewPatientEmail(result.email);
        if (result.address) setNewPatientAddress(result.address);
        if (result.medicalAid) setNewPatientMedicalAid(result.medicalAid);
        if (result.medicalAidNumber) setNewPatientMedicalAidNumber(result.medicalAidNumber);
        if (result.medicalAidPlan) setNewPatientMedicalAidPlan(result.medicalAidPlan);
        if (result.notes) setNewPatientNotes(result.notes);
        showToast('Sticker scanned — please review and confirm extracted details.', 'success');
      } catch {
        showToast('Could not extract data from image. Please fill in manually.', 'info');
      }
      setStickerScanning(false);
    };
    reader.readAsDataURL(file);
  };

  const submitCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatientName.trim()) return;

    setLoading(true);
    try {
      const newP = await createPatient(newPatientName, newPatientDob, newPatientSex, {
        medicalAid: newPatientMedicalAid,
        medicalAidNumber: newPatientMedicalAidNumber,
        medicalAidPlan: newPatientMedicalAidPlan,
        folderNumber: newPatientFolderNumber,
        idNumber: newPatientIdNumber,
        schemeCode: newPatientSchemeCode,
        planCode: newPatientPlanCode,
        memberNumber: newPatientMemberNumber,
        dependantCode: newPatientDependantCode,
      });
      if (newP) {
        await refreshPatients();
        setShowCreateModal(false);
        resetCreateForm();
        showToast('Patient folder created successfully.', 'success');
      }
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (settings: UserSettings) => {
    const { modules: _modules, ...profileOnly } = settings;
    await saveSettings(profileOnly);
    setUserSettings(profileOnly);
    showToast('Settings saved.', 'success');
  };

  const handleImportPatientsJson = async (payload: unknown) => {
    const result = await importPatientsJson(payload);
    await refreshPatients();
    return result;
  };

  const handleCreateFamilyFromSelection = async (memberIds: string[], familyName?: string) => {
    const uniqueIds = Array.from(new Set(memberIds.filter(Boolean)));
    if (uniqueIds.length < 2) {
      throw new Error('Select at least two patients to create a family folder.');
    }
    const [anchorId, ...otherIds] = uniqueIds;
    await updatePatientFamily(anchorId, otherIds, familyName);
    await refreshPatients();
  };

  const handleDeleteRequest = (patient: Patient) => {
    setPatientToDelete(patient);
  };

  const confirmDelete = async () => {
    if (!patientToDelete) return;
    setLoading(true);
    try {
      await deletePatient(patientToDelete.id);
      await refreshPatients();
      if (selectedPatientId === patientToDelete.id) selectPatient(null);
      setPatientToDelete(null);
      showToast('Patient folder moved to trash.', 'success');
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!isReady) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <Loader className="animate-spin text-cyan-600" size={28} />
          <p className="text-sm text-slate-400 font-medium">Loading HALO…</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-white">
        <div className="max-w-sm w-full text-center px-6">
          <img
            src="/halo-medical-logo.png"
            alt="HALO Medical"
            className="w-44 h-auto mx-auto mb-6 select-none"
            draggable={false}
          />
          <h1 className="text-3xl font-bold text-slate-800 mb-2">Welcome to HALO</h1>
          <p className="text-slate-500 mb-8 leading-relaxed">Sign in to access your Secure Patient Drive.</p>

          <button
            onClick={handleSignIn}
            className="w-full flex items-center justify-center gap-3 bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-4 rounded-xl transition-all shadow-md font-semibold text-base active:scale-[0.98]"
          >
            {loading ? <Loader className="animate-spin" size={18} /> : <LogIn size={18} />}
            {loading ? 'Connecting…' : 'Sign In with Google'}
          </button>

          <p className="mt-8 text-xs text-slate-400">Secure Environment · POPIA Compliant</p>
        </div>
      </div>
    );
  }

  const activePatient = patients.find(p => p.id === selectedPatientId);
  const admissionsEnabled = effectiveFeatures?.admissions ?? false;
  const billingEnabled = effectiveFeatures?.billing ?? false;
  const scribeEnabled = effectiveFeatures?.scribe ?? false;
  const hideSidebarOnMobile = activeMainView === 'workspace' && Boolean(selectedPatientId);

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-900 overflow-hidden relative">
      <div className={`${hideSidebarOnMobile ? 'hidden md:flex' : 'flex'} h-full shrink-0 z-20`}>
        <Sidebar
          patients={patients}
          selectedPatientId={selectedPatientId}
          recentPatientIds={recentPatientIds}
          onSelectPatient={(id) => {
            setActiveMainView('workspace');
            selectPatient(id);
          }}
          onCreatePatient={openCreateModal}
          onDeletePatient={handleDeleteRequest}
          onCreateFamilyFromSelection={handleCreateFamilyFromSelection}
          onLogout={handleLogout}
          onOpenSettings={() => setShowSettings(true)}
          onToast={showToast}
          userEmail={userEmail}
          activeMainView={activeMainView}
          onOpenPatients={() => setActiveMainView('workspace')}
          onOpenCalendar={() => setActiveMainView('calendar')}
          admissionsEnabled={admissionsEnabled}
          onOpenAdmissions={() => setActiveMainView('admissions')}
          adminAgentEnabled={adminAgentEnabled}
          adminAgentOpen={adminAgentOpen}
          onToggleAdminAgent={() => setAdminAgentOpen(prev => !prev)}
          onOpenMarketplace={() => setActiveMainView('marketplace')}
          billingEnabled={billingEnabled}
          onOpenBilling={() => billingEnabled && setActiveMainView('billing')}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        />
      </div>

      <div className={`flex-1 flex flex-col h-screen relative ${activeMainView === 'workspace' && !selectedPatientId ? 'hidden md:flex' : 'flex'}`}>
        {activeMainView === 'marketplace' ? (
          <MarketplacePage
            adminAgentEnabled={adminAgentEnabled}
            onActivateAdminAgent={() => {
              if (!localStorage.getItem('halo_agent_onboarding_done')) {
                setShowAgentOnboarding(true);
              } else {
                setAdminAgentOpen(true);
                setActiveMainView('workspace');
              }
            }}
            onManageAdminAgent={() => {
              setAdminAgentOpen(true);
              setActiveMainView('workspace');
            }}
          />
        ) : activeMainView === 'calendar' ? (
          <CalendarPage
            patients={patients}
            onSelectPatientFromEvent={(event) => {
              if (!event.patientId) return;
              openPatientWorkspace(event.patientId);
              setCalendarPrepEvent(event);
              setActiveMainView('workspace');
            }}
          />
        ) : activeMainView === 'admissions' && admissionsEnabled ? (
          <AdmissionsPage
            patients={patients}
            onToast={showToast}
            onOpenPatient={(patientId, options) => openPatientWorkspace(patientId, options)}
          />
        ) : activeMainView === 'billing' && billingEnabled ? (
          <BillingPage
            onToast={showToast}
            patients={patients}
            selectedPatientId={selectedPatientId}
            userSettings={userSettings}
          />
        ) : activePatient ? (
          <PatientWorkspace
            key={activePatient.id}
            patient={activePatient}
            allPatients={patients}
            onBack={() => selectPatient(null)}
            onOpenPatient={(patientId) => openPatientWorkspace(patientId)}
            onDataChange={refreshPatients}
            onToast={showToast}
            templateId={userSettings?.templateId || 'clinical_note'}
            onUploadHudChange={setUploadHudState}
            scribeEnabled={scribeEnabled}
            navigationIntent={workspaceIntent}
            onNavigationIntentHandled={(intentId) =>
              setWorkspaceIntent((current) => (current?.id === intentId ? null : current))
            }
            calendarPrepEvent={
              calendarPrepEvent && calendarPrepEvent.patientId === activePatient.id
                ? calendarPrepEvent
                : null
            }
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 relative overflow-hidden">
            {/* Background logo — large watermark */}
            <img
              src="/halo-logo.png"
              alt=""
              aria-hidden="true"
              className="absolute opacity-[0.04] pointer-events-none select-none w-[70vw] max-w-[700px] min-w-[300px] md:w-[55vw] lg:w-[45vw]"
              draggable={false}
            />
            {/* Foreground content */}
            <div className="relative z-10 flex flex-col items-center text-center px-6">
              <img
                src="/halo-logo.png"
                alt="HALO Medical"
                className="w-44 h-44 md:w-56 md:h-56 lg:w-64 lg:h-64 object-contain mb-6 opacity-20"
                draggable={false}
              />
              <p className="text-lg font-medium text-slate-400">Select a patient to begin</p>
            </div>
          </div>
        )}
      </div>

      {/* ADMIN AGENT PANEL */}
      {adminAgentEnabled && adminAgentOpen && (
        <div className="hidden md:flex h-full w-80 xl:w-96 shrink-0 border-l border-slate-200 z-10">
          <AdminAgentPanel
            onClose={() => setAdminAgentOpen(false)}
            onToast={showToast}
          />
        </div>
      )}

      {/* ADMIN AGENT ONBOARDING */}
      {showAgentOnboarding && (
        <AdminAgentOnboarding
          userEmail={userEmail}
          onComplete={() => {
            localStorage.setItem('halo_agent_onboarding_done', '1');
            setShowAgentOnboarding(false);
            setAdminAgentOpen(true);
            setActiveMainView('workspace');
          }}
        />
      )}

      {/* TOAST NOTIFICATIONS */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {uploadHudState && <UploadHud state={uploadHudState} />}

      {/* SETTINGS MODAL */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={userSettings}
        onSave={handleSaveSettings}
        onImportPatientsJson={handleImportPatientsJson}
        userEmail={userEmail}
        loginTime={loginTime}
        onToast={showToast}
        effectiveFeatures={effectiveFeatures}
        practiceName={practiceInfo?.name ?? null}
      />

      {/* CREATE PATIENT MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-600 flex items-center justify-center">
                  <UserPlus size={18} className="text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">New Patient Folder</h2>
                  <p className="text-xs text-slate-400">Scan a sticker or fill in manually</p>
                </div>
              </div>
              <button
                onClick={() => { setShowCreateModal(false); resetCreateForm(); }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scan sticker banner */}
            <div className="px-6 pt-4 shrink-0">
              <div className="flex items-center gap-3 bg-cyan-50 border border-cyan-100 rounded-xl px-4 py-3">
                <div className="w-9 h-9 rounded-lg bg-cyan-600 flex items-center justify-center shrink-0">
                  <ScanLine size={18} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-700">Scan Patient Sticker</p>
                  <p className="text-xs text-slate-500 leading-snug">
                    Upload a photo of the patient label — HALO will extract the details automatically.
                  </p>
                </div>
                <div>
                  {stickerScanning ? (
                    <div className="flex items-center gap-1.5 text-xs text-cyan-600 font-medium">
                      <Loader2 size={14} className="animate-spin" />
                      Scanning…
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => stickerInputRef.current?.click()}
                      className="text-xs font-semibold text-cyan-700 bg-white border border-cyan-200 hover:bg-cyan-50 px-3 py-1.5 rounded-lg transition"
                    >
                      {stickerPreview ? 'Rescan' : 'Scan'}
                    </button>
                  )}
                  <input
                    ref={stickerInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleStickerScan}
                  />
                </div>
              </div>
              {stickerPreview && (
                <div className="mt-2 flex items-center gap-2">
                  <img
                    src={stickerPreview}
                    alt="Scanned sticker"
                    className="h-10 w-auto rounded border border-slate-200 object-contain"
                  />
                  <span className="text-xs text-slate-400">Scanned sticker preview</span>
                </div>
              )}
            </div>

            {/* Form */}
            <form onSubmit={submitCreatePatient} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Core fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Full Name *</label>
                  <input
                    autoFocus
                    type="text"
                    placeholder="e.g. Sarah Connor"
                    value={newPatientName}
                    onChange={e => setNewPatientName(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Date of Birth</label>
                  <input
                    type="date"
                    value={newPatientDob}
                    onChange={e => setNewPatientDob(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Sex</label>
                  <div className="flex bg-slate-100 p-1 rounded-xl h-[42px]">
                    <button
                      type="button"
                      onClick={() => setNewPatientSex('M')}
                      className={`flex-1 rounded-lg text-sm font-bold transition-all ${newPatientSex === 'M' ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >M</button>
                    <button
                      type="button"
                      onClick={() => setNewPatientSex('F')}
                      className={`flex-1 rounded-lg text-sm font-bold transition-all ${newPatientSex === 'F' ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >F</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">ID / Passport</label>
                  <input
                    type="text"
                    value={newPatientIdNumber}
                    onChange={e => setNewPatientIdNumber(e.target.value)}
                    placeholder="ID or passport number"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Folder Number</label>
                  <input
                    type="text"
                    value={newPatientFolderNumber}
                    onChange={e => setNewPatientFolderNumber(e.target.value)}
                    placeholder="Hospital folder #"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Contact Number</label>
                  <input
                    type="tel"
                    value={newPatientContact}
                    onChange={e => setNewPatientContact(e.target.value)}
                    placeholder="Mobile / landline"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Email</label>
                  <input
                    type="email"
                    value={newPatientEmail}
                    onChange={e => setNewPatientEmail(e.target.value)}
                    placeholder="patient@email.com"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Address</label>
                  <input
                    type="text"
                    value={newPatientAddress}
                    onChange={e => setNewPatientAddress(e.target.value)}
                    placeholder="Street, city, postal code"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                  />
                </div>
              </div>

              {/* Medical aid */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Medical Aid</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Scheme</label>
                    <input
                      type="text"
                      value={newPatientMedicalAid}
                      onChange={e => setNewPatientMedicalAid(e.target.value)}
                      placeholder="e.g. Discovery"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Member Number</label>
                    <input
                      type="text"
                      value={newPatientMedicalAidNumber}
                      onChange={e => setNewPatientMedicalAidNumber(e.target.value)}
                      placeholder="Member #"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Plan / Option</label>
                    <input
                      type="text"
                      value={newPatientMedicalAidPlan}
                      onChange={e => setNewPatientMedicalAidPlan(e.target.value)}
                      placeholder="e.g. Comprehensive"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                    />
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Additional Notes</label>
                <textarea
                  value={newPatientNotes}
                  onChange={e => setNewPatientNotes(e.target.value)}
                  rows={2}
                  placeholder="Any other relevant information extracted from the sticker or added manually…"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition resize-none"
                />
              </div>

              {/* Billing (MediKredit) */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Billing (MediKredit)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Scheme Code</label>
                    <input
                      type="text"
                      value={newPatientSchemeCode}
                      onChange={e => setNewPatientSchemeCode(e.target.value.toUpperCase())}
                      placeholder="e.g. DISC"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Plan Code</label>
                    <input
                      type="text"
                      value={newPatientPlanCode}
                      onChange={e => setNewPatientPlanCode(e.target.value)}
                      placeholder="e.g. PLANCODE"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Member Number</label>
                    <input
                      type="text"
                      value={newPatientMemberNumber}
                      onChange={e => setNewPatientMemberNumber(e.target.value)}
                      placeholder="e.g. MK1050533"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Dependant Code</label>
                    <input
                      type="text"
                      value={newPatientDependantCode}
                      onChange={e => setNewPatientDependantCode(e.target.value)}
                      placeholder="e.g. 01"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none transition"
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1 pb-2">
                <button
                  type="button"
                  onClick={() => { setShowCreateModal(false); resetCreateForm(); }}
                  className="flex-1 px-4 py-2.5 rounded-xl font-medium text-sm text-slate-600 hover:bg-slate-100 border border-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newPatientName.trim() || loading}
                  className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-sm shadow-cyan-600/20 disabled:opacity-50 transition flex items-center justify-center gap-2"
                >
                  {loading ? <Loader className="animate-spin" size={16} /> : 'Create Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {patientToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 m-4 border-2 border-rose-100">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mb-4 text-rose-500">
                <AlertTriangle size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Delete Patient Folder?</h2>
              <p className="text-slate-500 mt-2 px-4">
                Are you sure you want to delete <span className="font-bold text-slate-800">{patientToDelete.name}</span>?
                This will move the folder to your Google Drive Trash.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPatientToDelete(null)} className="flex-1 px-4 py-3 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition">Cancel</button>
              <button onClick={confirmDelete} className="flex-1 bg-rose-500 hover:bg-rose-600 text-white px-4 py-3 rounded-xl font-bold shadow-sm shadow-rose-500/20 transition flex items-center justify-center gap-2">
                {loading ? <Loader className="animate-spin" size={18}/> : <Trash2 size={18}/>}
                Delete Folder
              </button>
            </div>
          </div>
        </div>
      )}

      <OnboardingModal
        isOpen={isSignedIn && onboardingRequired && !onboardingDismissed}
        state={onboardingState}
        submitting={onboardingSubmitting}
        onSubmit={handleCompleteOnboarding}
      />
    </div>
  );
};
