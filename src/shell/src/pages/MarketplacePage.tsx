import React from 'react';
import { Bot, Mail, Activity, Tag, Sparkles, Check, Lock } from 'lucide-react';

interface AgentCardProps {
  icon: React.ReactNode;
  iconBg: string;
  name: string;
  description: string;
  tags: string[];
  pricing: string;
  active: boolean;
  comingSoon?: boolean;
  onActivate?: () => void;
  onManage?: () => void;
}

const AgentCard: React.FC<AgentCardProps> = ({
  icon, iconBg, name, description, tags, pricing, active, comingSoon, onActivate, onManage,
}) => {
  return (
    <div className={`relative flex flex-col rounded-2xl border bg-white overflow-hidden transition-all duration-300 group
      ${comingSoon
        ? 'border-slate-200 opacity-70'
        : active
          ? 'border-cyan-200 shadow-md shadow-cyan-100/60 hover:shadow-lg hover:shadow-cyan-100/80 hover:border-cyan-300'
          : 'border-slate-200 hover:border-cyan-200 hover:shadow-md hover:shadow-slate-100/80'
      }`}
    >
      {/* Hover glow overlay */}
      {!comingSoon && (
        <div className={`absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none
          ${active
            ? 'bg-gradient-to-br from-cyan-50/40 to-transparent'
            : 'bg-gradient-to-br from-slate-50/60 to-transparent'
          }`}
        />
      )}

      {/* Frosted glass overlay for coming soon */}
      {comingSoon && (
        <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] rounded-2xl z-10 flex items-center justify-center">
          <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
            <Lock size={12} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Coming Soon</span>
          </div>
        </div>
      )}

      <div className="p-5 flex flex-col flex-1 relative z-0">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className={`w-12 h-12 rounded-xl ${iconBg} flex items-center justify-center shrink-0 shadow-sm`}>
            {icon}
          </div>
          {active && (
            <span className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full agent-live-badge">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Active
            </span>
          )}
        </div>

        {/* Name & Description */}
        <h3 className="text-base font-bold text-slate-800 mb-1.5">{name}</h3>
        <p className="text-sm text-slate-500 leading-relaxed flex-1 mb-4">{description}</p>

        {/* Capability tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {tags.map(tag => (
            <span key={tag} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-semibold">
              <Tag size={9} />
              {tag}
            </span>
          ))}
        </div>

        {/* Pricing */}
        <p className="text-[11px] text-slate-400 mb-4">{pricing}</p>

        {/* Action button */}
        {!comingSoon && (
          active ? (
            <button
              onClick={onManage}
              className="w-full py-2.5 rounded-xl border border-cyan-200 text-cyan-700 text-sm font-semibold hover:bg-cyan-50 transition-colors"
            >
              Manage
            </button>
          ) : (
            <button
              onClick={onActivate}
              className="activate-btn relative w-full py-2.5 rounded-xl bg-cyan-600 text-white text-sm font-semibold overflow-hidden transition-all hover:bg-cyan-500 hover:shadow-md hover:shadow-cyan-600/20 active:scale-[0.98]"
            >
              <span className="relative z-10">Activate</span>
              {/* Shimmer animation */}
              <span className="shimmer-effect absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12 group-hover:translate-x-full transition-transform duration-700" />
            </button>
          )
        )}
      </div>
    </div>
  );
};

interface Props {
  adminAgentEnabled: boolean;
  onActivateAdminAgent: () => void;
  onManageAdminAgent: () => void;
}

export const MarketplacePage: React.FC<Props> = ({
  adminAgentEnabled,
  onActivateAdminAgent,
  onManageAdminAgent,
}) => {
  const agents = [
    {
      icon: <Bot size={24} className="text-cyan-400" />,
      iconBg: 'bg-slate-900',
      name: 'Admin Agent',
      description: 'Your AI medical secretary. Draft letters, manage tasks, triage emails, and run background automations while you consult.',
      tags: ['Email', 'Letters', 'Tasks', 'Automations'],
      pricing: 'Per token · R500/mo default cap',
      active: adminAgentEnabled,
      comingSoon: false,
      onActivate: onActivateAdminAgent,
      onManage: onManageAdminAgent,
    },
    {
      icon: <Activity size={24} className="text-violet-400" />,
      iconBg: 'bg-violet-50',
      name: 'Billing Agent',
      description: 'Automate billing, invoices, and medical aid submissions. Reduce unpaid claims and speed up reimbursement cycles.',
      tags: ['Invoicing', 'Medical Aid', 'Claims', 'Reports'],
      pricing: 'Per submission · Flat monthly plan',
      active: false,
      comingSoon: true,
    },
    {
      icon: <Mail size={24} className="text-blue-400" />,
      iconBg: 'bg-blue-50',
      name: 'Theatre Agent',
      description: 'Build theatre lists, pre-stage op notes, manage bookings and consent forms, and brief your anaesthetist automatically.',
      tags: ['Theatre Lists', 'Op Notes', 'Bookings', 'Consent'],
      pricing: 'Per procedure · Flat monthly plan',
      active: false,
      comingSoon: true,
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center">
            <Sparkles size={18} className="text-cyan-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Halo Marketplace</h1>
        </div>
        <p className="text-sm text-slate-500 ml-12">Extend your practice with AI-powered agents</p>
      </div>

      {/* Grid */}
      <div className="px-8 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Check size={14} className="text-cyan-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Available Now</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {agents.filter(a => !a.comingSoon).map(a => (
              <AgentCard key={a.name} {...a} />
            ))}
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center gap-2 mb-1">
            <Lock size={14} className="text-slate-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Coming Soon</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {agents.filter(a => a.comingSoon).map(a => (
              <AgentCard key={a.name} {...a} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
