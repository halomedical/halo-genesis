import React, { useState, useEffect, useRef } from 'react';
import type { Patient } from '../../../../shared/types';
import {
  Plus, LogOut, Search, Trash2, ChevronDown,
  Settings, Loader2, Calendar as CalendarIcon, Users, Clock, ChevronsLeft, ChevronsRight, LayoutPanelTop, Bot, Sparkles,
  CreditCard,
} from 'lucide-react';
import { searchPatientsByConcept } from '../services/api';

interface SidebarProps {
  patients: Patient[];
  selectedPatientId: string | null;
  recentPatientIds: string[];
  onSelectPatient: (id: string) => void;
  onCreatePatient: () => void;
  onDeletePatient: (patient: Patient) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  userEmail?: string;
  activeMainView?: 'workspace' | 'calendar' | 'admissions' | 'marketplace' | 'billing';
  onOpenPatients?: () => void;
  onOpenCalendar?: () => void;
  admissionsEnabled?: boolean;
  onOpenAdmissions?: () => void;
  adminAgentEnabled?: boolean;
  adminAgentOpen?: boolean;
  onToggleAdminAgent?: () => void;
  onOpenMarketplace?: () => void;
  onOpenBilling?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  patients,
  selectedPatientId,
  recentPatientIds,
  onSelectPatient,
  onCreatePatient,
  onDeletePatient,
  onLogout,
  onOpenSettings,
  userEmail,
  activeMainView = 'workspace',
  onOpenPatients,
  onOpenCalendar,
  admissionsEnabled = false,
  onOpenAdmissions,
  adminAgentEnabled = false,
  adminAgentOpen = false,
  onToggleAdminAgent,
  onOpenMarketplace,
  onOpenBilling,
  collapsed = false,
  onToggleCollapse,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [aiSearchResults, setAiSearchResults] = useState<string[] | null>(null);
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [patientsExpanded, setPatientsExpanded] = useState(true);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patientsActive = activeMainView === 'workspace';
  const calendarActive = activeMainView === 'calendar';
  const admissionsActive = activeMainView === 'admissions';
  const marketplaceActive = activeMainView === 'marketplace';
  const billingActive = activeMainView === 'billing';

  // Local filter
  const localFiltered = patients.filter(
    p =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.dob.includes(searchTerm),
  );

  // Debounced AI concept search
  useEffect(() => {
    if (!patientsActive) return;
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    setAiSearchResults(null);
    if (!searchTerm.trim() || searchTerm.length < 3) return;
    if (localFiltered.length <= 2) {
      searchTimeoutRef.current = setTimeout(async () => {
        setIsAiSearching(true);
        try {
          const ids = await searchPatientsByConcept(searchTerm, patients, {});
          setAiSearchResults(ids);
        } catch {
          setAiSearchResults(null);
        }
        setIsAiSearching(false);
      }, 600);
    }
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchTerm, patients, patientsActive]);

  const filteredPatients = searchTerm.trim()
    ? patients.filter(p => {
        const localMatch =
          p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.dob.includes(searchTerm);
        const aiMatch = aiSearchResults?.includes(p.id) ?? false;
        return localMatch || aiMatch;
      })
    : patients;

  const recentPatients =
    recentPatientIds.length > 0
      ? recentPatientIds
          .map(id => patients.find(p => p.id === id))
          .filter((p): p is Patient => !!p)
          .slice(0, 3)
      : patients.slice(0, 3);

  const userInitials = userEmail
    ? userEmail.slice(0, 2).toUpperCase()
    : 'AD';

  const renderPatientRow = (patient: Patient, keyPrefix: string) => (
    <div
      key={`${keyPrefix}-${patient.id}`}
      onClick={() => {
        onSelectPatient(patient.id);
        onOpenPatients?.();
      }}
      className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all mb-0.5 ${
        selectedPatientId === patient.id
          ? 'bg-cyan-50 text-cyan-700'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
      }`}
    >
      <div className="flex items-center gap-2.5 overflow-hidden">
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
            selectedPatientId === patient.id
              ? 'bg-cyan-600 text-white'
              : 'bg-slate-200 text-slate-500 group-hover:bg-slate-300'
          }`}
        >
          {patient.name.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate leading-tight">{patient.name}</p>
          <p className="text-[11px] text-slate-400 truncate">{patient.dob}</p>
        </div>
      </div>
      <button
        onClick={e => {
          e.stopPropagation();
          onDeletePatient(patient);
        }}
        className="p-1 rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-100 hover:text-rose-500 text-slate-400"
        title="Delete Folder"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );

  return (
    <div
      className={`bg-white h-full flex flex-col border-r border-slate-200 shadow-sm transition-[width] duration-300 ${
        collapsed ? 'w-[88px]' : 'w-64'
      }`}
    >
      {/* Logo */}
      <div className={`relative border-b border-slate-100 ${collapsed ? 'px-3 py-4' : 'px-5 py-4'}`}>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="w-9 h-9 rounded-xl overflow-hidden shadow-sm shrink-0">
            <img
              src="/halo-icon.png"
              alt="HALO"
              className="w-full h-full object-cover"
              draggable={false}
            />
          </div>
          {!collapsed && (
            <div>
              <h1 className="font-bold text-slate-800 text-base leading-tight">HALO</h1>
              <p className="text-[10px] text-cyan-600 font-semibold tracking-widest uppercase">
                Patient Drive
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={onToggleCollapse}
            className={`hidden md:inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 ${
              collapsed ? 'absolute right-3 top-4' : 'ml-auto'
            }`}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className={`flex-1 overflow-y-auto custom-scrollbar ${collapsed ? 'px-2 py-3' : 'px-3 py-3'}`}>

        {/* ── PATIENTS SECTION ── */}
        <div className="mb-1">
          <button
            type="button"
            onClick={() => {
              if (collapsed) {
                onToggleCollapse?.();
                onOpenPatients?.();
                return;
              }
              setPatientsExpanded(v => !v);
              onOpenPatients?.();
            }}
            title="Patients"
            className={`w-full flex items-center rounded-xl text-sm font-medium transition-all ${
              patientsActive
                ? 'bg-cyan-50 text-cyan-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
            } ${collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5'}`}
          >
            <Users
              size={17}
              className={patientsActive ? 'text-cyan-600' : 'text-slate-400'}
            />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Patients</span>
                <span className="mr-1 text-[11px] text-slate-400">{patients.length}</span>
                <ChevronDown
                  size={14}
                  className={`text-slate-400 transition-transform ${patientsExpanded ? 'rotate-180' : ''}`}
                />
              </>
            )}
          </button>

          {!collapsed && patientsExpanded && (
            <div className="mt-2 space-y-1 pl-1">
              {/* Search */}
              <div className="relative mb-3">
                <Search
                  size={13}
                  className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none"
                />
                <input
                  type="text"
                  placeholder="Search patients..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 text-[13px] pl-8 pr-3 py-2 rounded-lg border border-slate-200 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100 transition-all placeholder:text-slate-400"
                />
                {isAiSearching && (
                  <Loader2
                    size={12}
                    className="absolute right-2.5 top-2.5 text-cyan-500 animate-spin"
                  />
                )}
              </div>

              {!searchTerm && recentPatients.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-2 mb-1.5">
                    <Clock size={11} className="text-slate-400" />
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Recent Activity
                    </p>
                  </div>
                  {recentPatients.map(p => renderPatientRow(p, 'recent'))}
                  <div className="my-3 border-t border-slate-100 mx-1" />
                </>
              )}

              <div className="flex items-center gap-2 px-2 mb-1.5">
                <Users size={11} className="text-slate-400" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {searchTerm ? 'Search Results' : 'All Patients'}
                </p>
              </div>
              {filteredPatients.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4 opacity-60">
                  No patients found
                </p>
              ) : (
                filteredPatients.map(p => renderPatientRow(p, 'all'))
              )}
            </div>
          )}
        </div>

        {/* ── CALENDAR SECTION ── */}
        <div className="mb-1">
          <button
            type="button"
            onClick={() => {
              onOpenCalendar?.();
            }}
            title="Calendar"
            className={`w-full flex items-center rounded-xl text-sm font-medium transition-all ${
              calendarActive
                ? 'bg-cyan-50 text-cyan-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
            } ${collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5'}`}
          >
            <CalendarIcon
              size={17}
              className={calendarActive ? 'text-cyan-600' : 'text-slate-400'}
            />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Calendar</span>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Week
                </span>
              </>
            )}
          </button>
        </div>

        {admissionsEnabled && (
          <div className="mb-1">
            <button
              type="button"
              onClick={() => {
                onOpenAdmissions?.();
              }}
              title="Admissions"
              className={`w-full flex items-center rounded-xl text-sm font-medium transition-all ${
                admissionsActive
                  ? 'bg-cyan-50 text-cyan-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              } ${collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5'}`}
            >
              <LayoutPanelTop
                size={17}
                className={admissionsActive ? 'text-cyan-600' : 'text-slate-400'}
              />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Admissions</span>
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Board
                  </span>
                </>
              )}
            </button>
          </div>
        )}

        {adminAgentEnabled && (
          <div className="mb-1">
            <button
              type="button"
              onClick={onToggleAdminAgent}
              title="Admin Agent"
              className={`w-full flex items-center rounded-xl text-sm font-medium transition-all ${
                adminAgentOpen
                  ? 'bg-cyan-600 text-white shadow-sm shadow-cyan-600/20'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              } ${collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5'}`}
            >
              <Bot
                size={17}
                className={adminAgentOpen ? 'text-white' : 'text-slate-400'}
              />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Admin Agent</span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                    adminAgentOpen ? 'bg-white/20 text-white' : 'border border-slate-200 bg-white text-slate-400'
                  }`}>
                    {adminAgentOpen ? 'Open' : 'AI'}
                  </span>
                </>
              )}
            </button>
          </div>
        )}

        {/* ── MARKETPLACE ── */}
        <div className="mb-1">
          <button
            type="button"
            onClick={() => onOpenMarketplace?.()}
            title="Marketplace"
            className={`w-full flex items-center rounded-xl text-sm font-medium transition-all ${
              marketplaceActive
                ? 'bg-cyan-50 text-cyan-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
            } ${collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5'}`}
          >
            <Sparkles
              size={17}
              className={marketplaceActive ? 'text-cyan-600' : 'text-slate-400'}
            />
            {!collapsed && (
              <span className="flex-1 text-left">Marketplace</span>
            )}
          </button>
        </div>

        <div className="mb-1">
          <button
            type="button"
            onClick={() => onOpenBilling?.()}
            title="Billing"
            className={`w-full flex items-center rounded-xl text-sm font-medium transition-all ${
              billingActive
                ? 'bg-cyan-50 text-cyan-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
            } ${collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5'}`}
          >
            <CreditCard
              size={17}
              className={billingActive ? 'text-cyan-600' : 'text-slate-400'}
            />
            {!collapsed && (
              <span className="flex-1 text-left">Billing</span>
            )}
          </button>
        </div>
      </nav>

      {/* Bottom: Create + User */}
      <div className={`border-t border-slate-100 ${collapsed ? 'p-2 space-y-2' : 'p-3 space-y-3'}`}>
        <button
          onClick={onCreatePatient}
          title="New Patient Folder"
          className={`w-full bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-semibold text-sm transition-all shadow-sm shadow-cyan-600/20 flex items-center justify-center active:scale-[0.98] ${
            collapsed ? 'h-11 px-0' : 'gap-2 py-2.5'
          }`}
        >
          <Plus size={16} />
          {!collapsed && 'New Patient Folder'}
        </button>

        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between px-1'}`}>
          <div className={`flex items-center gap-2 min-w-0 ${collapsed ? 'hidden' : ''}`}>
            <div className="w-7 h-7 rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center text-[11px] font-bold shrink-0">
              {userInitials}
            </div>
            <p className="text-[11px] text-slate-500 truncate">{userEmail || 'admin'}</p>
          </div>
          {collapsed && (
            <div className="mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-cyan-100 text-[11px] font-bold text-cyan-700">
              {userInitials}
            </div>
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={onOpenSettings}
              title="Settings"
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <Settings size={15} />
            </button>
            <button
              onClick={onLogout}
              title="Sign Out"
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
