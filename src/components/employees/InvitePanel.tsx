'use client';

import { useState, useEffect } from 'react';
import { UserPlus, Copy, Check, X, Link2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

type InviteRole = 'employee' | 'manager' | 'hr';

const ROLE_OPTIONS: { value: InviteRole; label: string; desc: string; color: string }[] = [
  { value: 'employee', label: 'Team Member', desc: 'Tasks, leave, attendance',      color: 'text-cyan-400   border-cyan-500/30   bg-cyan-500/[0.06]'   },
  { value: 'manager',  label: 'Manager',     desc: 'Approve leaves, manage tasks',  color: 'text-amber-400  border-amber-500/30  bg-amber-500/[0.06]'  },
  { value: 'hr',       label: 'HR Staff',    desc: 'Full HR + onboarding access',   color: 'text-violet-400 border-violet-500/30 bg-violet-500/[0.06]' },
];

export default function InvitePanel() {
  const [open,    setOpen]    = useState(false);
  const [role,    setRole]    = useState<InviteRole>('employee');
  const [copied,  setCopied]  = useState(false);
  const [token,   setToken]   = useState('');
  const [loading, setLoading] = useState(false);

  const origin    = typeof window !== 'undefined' ? window.location.origin : '';
  const inviteUrl = token ? `${origin}/join?token=${token}` : '';

  useEffect(() => {
    if (!open) return;
    setToken(''); setLoading(true);
    fetch('/api/organizations/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
      .then(r => r.json())
      .then(d => { if (d.token) setToken(d.token); })
      .finally(() => setLoading(false));
  }, [open, role]);

  async function copy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <>
      {/* Trigger */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg bg-brand-gradient text-white text-sm font-semibold px-4 h-9 shadow-glow-sm transition-all hover:opacity-90 active:scale-[0.98] shrink-0"
      >
        <UserPlus className="h-4 w-4" />
        <span className="hidden sm:inline">Invite Member</span>
        <span className="sm:hidden">Invite</span>
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-surface-100 border border-surface-300 shadow-modal animate-[scaleIn_0.15s_ease-out]">

            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-surface-300">
              <div>
                <h2 className="text-base font-semibold text-surface-950">Invite Team Member</h2>
                <p className="text-xs text-surface-600 mt-0.5">Share this link — they sign up and join automatically</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-surface-600 hover:text-surface-950 hover:bg-surface-300 transition-colors shrink-0 ml-3"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">

              {/* Role select */}
              <div>
                <p className="label">Select role</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {ROLE_OPTIONS.map(opt => {
                    const active = role === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setRole(opt.value)}
                        className={cn(
                          'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all',
                          active
                            ? opt.color
                            : 'border-surface-300 bg-surface-200/50 text-surface-700 hover:border-surface-400 hover:bg-surface-200'
                        )}
                      >
                        <div className={cn(
                          'h-3.5 w-3.5 rounded-full border-2 transition-colors',
                          active ? 'border-current bg-current' : 'border-surface-500'
                        )} />
                        <p className={cn('text-xs font-semibold leading-tight', active ? '' : 'text-surface-800')}>
                          {opt.label}
                        </p>
                        <p className="text-2xs text-surface-600 leading-tight">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Invite link */}
              <div>
                <p className="label">Invite link</p>
                <div className="flex items-center gap-2 rounded-xl bg-surface-200 border border-surface-300 p-2.5">
                  {loading ? <Loader2 className="h-4 w-4 text-surface-500 shrink-0 animate-spin" /> : <Link2 className="h-4 w-4 text-surface-500 shrink-0" />}
                  <p className="flex-1 text-xs text-surface-700 font-mono truncate min-w-0">
                    {loading ? 'Generating link…' : inviteUrl}
                  </p>
                  <button
                    onClick={copy}
                    disabled={!inviteUrl}
                    className={cn(
                      'shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-40',
                      copied ? 'bg-success/10 text-success' : 'bg-brand-500/10 text-brand-400 hover:bg-brand-500/20'
                    )}
                  >
                    {copied ? <><Check className="h-3.5 w-3.5" />Copied!</> : <><Copy className="h-3.5 w-3.5" />Copy</>}
                  </button>
                </div>
              </div>

              {/* Steps */}
              <div className="rounded-xl bg-surface-200/50 border border-surface-300/60 p-3.5">
                <p className="text-xs font-semibold text-surface-700 mb-2">How it works</p>
                <ol className="space-y-1.5">
                  {[
                    'Share the link with your team member',
                    'They sign up with name, email & password',
                    'Auto-joined to your org with selected role',
                    'They can log in immediately',
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-surface-600">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-500/15 text-brand-400 font-bold text-2xs shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-surface-300">
              <button
                onClick={() => setOpen(false)}
                className="px-4 h-9 rounded-lg text-sm font-medium text-surface-700 hover:bg-surface-300 transition-colors"
              >
                Close
              </button>
              <button
                onClick={copy}
                disabled={!inviteUrl}
                className="flex items-center gap-2 px-4 h-9 rounded-lg bg-brand-gradient text-white text-sm font-semibold shadow-glow-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
              >
                {copied ? <><Check className="h-4 w-4" />Copied!</> : <><Copy className="h-4 w-4" />Copy Link</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
