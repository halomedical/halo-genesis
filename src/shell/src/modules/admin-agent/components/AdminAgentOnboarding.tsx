import React, { useState, useEffect } from 'react';
import {
  Bot, ChevronRight, CheckCircle2, Circle, Loader2, X,
  HardDrive, Mail, DollarSign, Sparkles, CloudOff,
} from 'lucide-react';
import {
  provisionVpsAccount,
  setupDriveFolders,
  getOnedriveAuthUrl,
  getOnedriveStatus,
  setAgentBillingCap,
  markAgentSetupDone,
} from '../services/api';

type Step = 'welcome' | 'storage' | 'email' | 'billing' | 'done';

const STEPS: Step[] = ['welcome', 'storage', 'email', 'billing', 'done'];

interface Props {
  userEmail?: string;
  onComplete: () => void;
}

export const AdminAgentOnboarding: React.FC<Props> = ({ userEmail, onComplete }) => {
  const [step, setStep] = useState<Step>('welcome');
  const [prevStep, setPrevStep] = useState<Step | null>(null);
  const [animating, setAnimating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [driveDone, setDriveDone] = useState(false);
  const [onedriveDone, setOnedriveDone] = useState(false);
  const [onedrivePollActive, setOnedrivePollActive] = useState(false);

  const [billingCap, setBillingCap] = useState(500);

  const stepIndex = STEPS.indexOf(step);

  useEffect(() => {
    if (!onedrivePollActive) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        await new Promise(r => setTimeout(r, 3000));
        if (cancelled) break;
        try {
          const status = await getOnedriveStatus();
          if (status.connected) {
            setOnedriveDone(true);
            setOnedrivePollActive(false);
            break;
          }
        } catch { /* keep polling */ }
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [onedrivePollActive]);

  const goNext = () => {
    const next = STEPS[stepIndex + 1];
    if (!next || animating) return;
    setPrevStep(step);
    setAnimating(true);
    setTimeout(() => {
      setStep(next);
      setAnimating(false);
    }, 220);
  };

  const handleStorageSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      await Promise.all([provisionVpsAccount(), setupDriveFolders()]);
      setDriveDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleConnectOnedrive = async () => {
    try {
      const { authUrl } = await getOnedriveAuthUrl();
      window.open(authUrl, '_blank', 'noopener,noreferrer');
      setOnedrivePollActive(true);
    } catch {
      setError('Could not get OneDrive auth URL. Try again later.');
    }
  };

  const handleBillingNext = async () => {
    setBusy(true);
    setError(null);
    try {
      await setAgentBillingCap(billingCap);
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save billing cap.');
    } finally {
      setBusy(false);
    }
  };

  const handleFinish = async () => {
    setBusy(true);
    try {
      await markAgentSetupDone();
    } catch { /* non-fatal */ }
    localStorage.setItem('halo_agent_onboarding_done', '1');
    setBusy(false);
    onComplete();
  };

  const stepDot = (s: Step) => {
    const idx = STEPS.indexOf(s);
    const current = STEPS.indexOf(step);
    if (idx < current) return (
      <CheckCircle2 size={14} className="text-cyan-500 transition-all duration-300" />
    );
    if (idx === current) return (
      <div className="w-3.5 h-3.5 rounded-full bg-cyan-600 ring-4 ring-cyan-100 transition-all duration-300 scale-110" />
    );
    return <Circle size={14} className="text-slate-200 transition-all duration-300" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 px-6 py-5 flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center shrink-0">
            <Bot size={20} className="text-cyan-400" />
            <span className="absolute inset-0 rounded-xl bg-cyan-400/10 animate-[ping_3s_ease-in-out_infinite]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-white leading-tight">Setup Admin Agent</p>
            <p className="text-xs text-slate-400 mt-0.5">Your AI medical secretary — takes 2 minutes</p>
          </div>
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-3 py-3 border-b border-slate-100 bg-slate-50">
          {STEPS.filter(s => s !== 'done').map((s, i) => (
            <React.Fragment key={s}>
              {stepDot(s)}
              {i < STEPS.length - 2 && (
                <div className={`h-px w-8 transition-all duration-500 ${
                  STEPS.indexOf(s) < stepIndex ? 'bg-cyan-400' : 'bg-slate-200'
                }`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Content — slide transition */}
        <div
          className={`flex-1 px-6 py-6 min-h-[300px] flex flex-col transition-all duration-200 ${
            animating ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'
          }`}
        >
          {step === 'welcome' && (
            <div className="flex flex-col items-center text-center flex-1 justify-center">
              <div className="w-16 h-16 rounded-2xl bg-cyan-50 border border-cyan-100 flex items-center justify-center mb-4 shadow-sm shadow-cyan-100">
                <Sparkles size={28} className="text-cyan-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">Welcome to Admin Agent</h2>
              <p className="text-sm text-slate-500 leading-relaxed max-w-sm">
                I'm your AI medical secretary. I'll help you draft letters, manage tasks, triage emails,
                and handle the admin so you can focus on patients.
              </p>
              <div className="mt-6 space-y-2 w-full text-left">
                {[
                  'Draft referral letters and reports',
                  'Monitor and triage your inbox',
                  "Run tasks while you're consulting",
                ].map(item => (
                  <div key={item} className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-cyan-50 border border-cyan-100 hover:shadow-sm transition-shadow">
                    <CheckCircle2 size={15} className="text-cyan-600 shrink-0" />
                    <span className="text-sm text-slate-700">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'storage' && (
            <div className="flex flex-col flex-1">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                  <HardDrive size={20} className="text-blue-600" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">Connect Storage</h2>
                  <p className="text-xs text-slate-400">Agent folders will be created for you</p>
                </div>
              </div>

              <div className="space-y-3 flex-1">
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${driveDone ? 'border-emerald-200 bg-emerald-50 shadow-sm shadow-emerald-50' : 'border-slate-200 bg-white'}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${driveDone ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                    <HardDrive size={16} className={driveDone ? 'text-emerald-600' : 'text-slate-400'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">Google Drive</p>
                    <p className="text-xs text-slate-500">{driveDone ? 'Folders created: Black Hole, Patients, Review, Billing, Archive' : 'Auto-create Halo folder structure'}</p>
                  </div>
                  {driveDone
                    ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                    : (
                      <button
                        onClick={handleStorageSetup}
                        disabled={busy}
                        className="text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 hover:shadow-sm hover:shadow-cyan-600/20 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                        Setup
                      </button>
                    )
                  }
                </div>

                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${onedriveDone ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${onedriveDone ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                    <CloudOff size={16} className={onedriveDone ? 'text-emerald-600' : 'text-slate-400'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">OneDrive</p>
                    <p className="text-xs text-slate-500">
                      {onedriveDone ? 'Connected' : onedrivePollActive ? 'Waiting for connection…' : 'Optional — connect Microsoft 365'}
                    </p>
                  </div>
                  {onedriveDone
                    ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                    : onedrivePollActive
                      ? <Loader2 size={16} className="animate-spin text-cyan-500 shrink-0" />
                      : (
                        <button
                          onClick={handleConnectOnedrive}
                          className="text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition"
                        >
                          Connect
                        </button>
                      )
                  }
                </div>

                {error && <p className="text-xs text-rose-600 px-1">{error}</p>}

                <p className="text-[11px] text-slate-400 text-center pt-1">
                  OneDrive is optional — you can connect it later in the Connections tab.
                </p>
              </div>
            </div>
          )}

          {step === 'email' && (
            <div className="flex flex-col flex-1">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center">
                  <Mail size={20} className="text-rose-500" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">Connect Email</h2>
                  <p className="text-xs text-slate-400">So the agent can triage and draft for you</p>
                </div>
              </div>

              <div className="space-y-3 flex-1">
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Mail size={16} className="text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">Gmail</p>
                    <p className="text-xs text-slate-500 truncate">{userEmail || 'Connected via Google Sign-In'}</p>
                  </div>
                  <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                </div>

                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 opacity-50">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                    <Mail size={16} className="text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700">Outlook / Microsoft 365</p>
                    <p className="text-xs text-slate-400">Coming soon</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-400">Soon</span>
                </div>

                <p className="text-[11px] text-slate-400 text-center pt-1">
                  Gmail access is already granted through your Google sign-in. No extra steps needed.
                </p>
              </div>
            </div>
          )}

          {step === 'billing' && (
            <div className="flex flex-col flex-1">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center">
                  <DollarSign size={20} className="text-amber-600" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">Monthly Spending Cap</h2>
                  <p className="text-xs text-slate-400">Limit how much the agent can spend per month</p>
                </div>
              </div>

              <div className="flex-1 flex flex-col justify-center space-y-5">
                <div className="text-center">
                  <p className="text-4xl font-bold text-slate-800 tabular-nums transition-all duration-150">
                    R{billingCap.toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">per month</p>
                </div>

                <div className="px-2">
                  <input
                    type="range"
                    min={100}
                    max={5000}
                    step={100}
                    value={billingCap}
                    onChange={e => setBillingCap(Number(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-cyan-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1.5 px-0.5">
                    <span>R100</span>
                    <span>R5,000</span>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {[250, 500, 1000, 2500].map(v => (
                    <button
                      key={v}
                      onClick={() => setBillingCap(v)}
                      className={`py-2 rounded-xl text-xs font-semibold transition-all border ${
                        billingCap === v
                          ? 'bg-cyan-600 text-white border-cyan-600 shadow-sm shadow-cyan-600/20'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-cyan-300 hover:shadow-sm'
                      }`}
                    >
                      R{v}
                    </button>
                  ))}
                </div>

                {error && <p className="text-xs text-rose-600 text-center">{error}</p>}

                <p className="text-[11px] text-slate-400 text-center">
                  You can change this any time in the agent's Memory tab.
                </p>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center text-center flex-1 justify-center">
              <div className="relative w-20 h-20 rounded-2xl bg-cyan-50 flex items-center justify-center mb-5">
                <Bot size={32} className="text-cyan-600" />
                {/* Celebratory pulse rings */}
                <span className="absolute inset-0 rounded-2xl bg-cyan-400/20 animate-[ping_1.5s_ease-out_0.1s_3]" />
                <span className="absolute inset-[-6px] rounded-3xl bg-cyan-400/10 animate-[ping_1.5s_ease-out_0.3s_3]" />
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">All set!</h2>
              <p className="text-sm text-slate-500 leading-relaxed max-w-sm">
                Your Admin Agent is ready. I've set up your Drive folders and connected your email.
                Ask me anything — I'm here to handle the admin.
              </p>
              <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-100 text-left w-full">
                <p className="text-xs text-slate-500 leading-relaxed italic">
                  "Good morning, Doctor. I'm ready to help — just ask me to draft a letter,
                  check your inbox, or add a task. Your monthly cap is set to R{billingCap.toLocaleString()}."
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            Step {Math.min(stepIndex + 1, STEPS.length - 1)} of {STEPS.length - 1}
          </div>
          <div className="flex gap-2">
            {step !== 'welcome' && step !== 'done' && (
              <button
                onClick={goNext}
                className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2 rounded-lg hover:bg-slate-100 transition"
              >
                Skip
              </button>
            )}
            {step === 'welcome' && (
              <button
                onClick={goNext}
                className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 hover:shadow-md hover:shadow-cyan-600/20 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
              >
                Get Started <ChevronRight size={15} />
              </button>
            )}
            {step === 'storage' && (
              <button
                onClick={goNext}
                disabled={!driveDone}
                className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 hover:shadow-md hover:shadow-cyan-600/20 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all disabled:opacity-40"
              >
                Continue <ChevronRight size={15} />
              </button>
            )}
            {step === 'email' && (
              <button
                onClick={goNext}
                className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 hover:shadow-md hover:shadow-cyan-600/20 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
              >
                Continue <ChevronRight size={15} />
              </button>
            )}
            {step === 'billing' && (
              <button
                onClick={handleBillingNext}
                disabled={busy}
                className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 hover:shadow-md hover:shadow-cyan-600/20 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                Continue <ChevronRight size={15} />
              </button>
            )}
            {step === 'done' && (
              <button
                onClick={handleFinish}
                disabled={busy}
                className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 hover:shadow-md hover:shadow-cyan-600/20 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                Open Agent
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
