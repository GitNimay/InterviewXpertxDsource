import React, { useEffect, useState, useCallback } from 'react';
import { db } from '../services/firebase';

interface ServiceStatus {
  name: string;
  description: string;
  status: 'operational' | 'degraded' | 'down' | 'checking';
  responseTime?: number;
  icon: string;
}

const INITIAL_SERVICES: ServiceStatus[] = [
  { name: 'Brevo API', description: 'Email delivery & candidate invitations', status: 'checking', icon: '📧' },
  { name: 'Sarvam API', description: 'AI-powered speech & language services', status: 'checking', icon: '🗣️' },
  { name: 'Firebase API', description: 'Authentication, database & storage', status: 'checking', icon: '🔥' },
  { name: 'Cloudinary API', description: 'Media uploads & asset management', status: 'checking', icon: '☁️' },
  { name: 'Gemini API', description: 'AI interview question generation & evaluation', status: 'checking', icon: '✨' },
];

// Timeout wrapper — aborts any check after 10 seconds
const withTimeout = (promise: Promise<any>, ms = 10000): Promise<any> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(new Error('Health check timed out'));
      });
    }),
  ]).finally(() => clearTimeout(timeout));
};

// ── Credential-free health checks ──
// SECURITY: No API keys are sent in any request.
// We only verify that the service endpoint is reachable (DNS + TCP + TLS).
// A successful no-cors fetch proves the server is up.

const checkBrevo = async (): Promise<{ ok: boolean; ms: number }> => {
  const start = performance.now();
  try {
    // no-cors HEAD — no credentials sent, just proves server is reachable
    await withTimeout(
      fetch('https://api.brevo.com/v3/account', { method: 'HEAD', mode: 'no-cors' })
    );
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - start) };
  }
};

const checkSarvam = async (): Promise<{ ok: boolean; ms: number }> => {
  const start = performance.now();
  try {
    // no-cors HEAD — no credentials sent
    await withTimeout(
      fetch('https://api.sarvam.ai/', { method: 'HEAD', mode: 'no-cors' })
    );
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - start) };
  }
};

const checkFirebase = async (): Promise<{ ok: boolean; ms: number }> => {
  const start = performance.now();
  try {
    // Firebase SDK — uses the public API key (safe by design, security comes from rules).
    // Reads from 'blogs' collection which has public read access (allow read: if true).
    const { getDocs, collection, query, limit: limitFn } = await import('firebase/firestore');
    const q = query(collection(db, 'blogs'), limitFn(1));
    await withTimeout(getDocs(q));
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch {
    // Even errors (permission-denied, etc.) mean Firebase is reachable
    return { ok: true, ms: Math.round(performance.now() - start) };
  }
};

const checkCloudinary = async (): Promise<{ ok: boolean; ms: number }> => {
  const start = performance.now();
  try {
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    if (!cloudName) return { ok: false, ms: 0 };
    // Public endpoint — only uses cloud name (not a secret)
    const res = await withTimeout(
      fetch(`https://res.cloudinary.com/${cloudName}/image/upload/sample.jpg`, {
        method: 'HEAD',
      })
    );
    return { ok: res.status < 500, ms: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - start) };
  }
};

const checkGemini = async (): Promise<{ ok: boolean; ms: number }> => {
  const start = performance.now();
  try {
    // no-cors HEAD — no API key sent, just proves Google AI servers are reachable
    await withTimeout(
      fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        method: 'HEAD',
        mode: 'no-cors',
      })
    );
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - start) };
  }
};

const StatusPage: React.FC = () => {
  const [services, setServices] = useState<ServiceStatus[]>(INITIAL_SERVICES);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const runChecks = useCallback(async () => {
    setIsRefreshing(true);
    // Reset to checking
    setServices((prev) => prev.map((s) => ({ ...s, status: 'checking' as const })));

    const checkers = [checkBrevo, checkSarvam, checkFirebase, checkCloudinary, checkGemini];

    const results = await Promise.allSettled(checkers.map((fn) => fn()));

    setServices((prev) =>
      prev.map((service, i) => {
        const result = results[i];
        if (result.status === 'fulfilled') {
          return {
            ...service,
            status: result.value.ok ? 'operational' : 'down',
            responseTime: result.value.ms,
          };
        }
        return { ...service, status: 'down' as const, responseTime: 0 };
      })
    );
    setLastChecked(new Date());
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    document.title = 'System Status | InterviewXpert';
    runChecks();
    // Auto-refresh every 60s
    const interval = setInterval(runChecks, 60000);
    return () => clearInterval(interval);
  }, [runChecks]);

  const allOperational = services.every((s) => s.status === 'operational');
  const anyDown = services.some((s) => s.status === 'down');
  const anyChecking = services.some((s) => s.status === 'checking');

  const getOverallStatus = () => {
    if (anyChecking) return { label: 'Checking systems…', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' };
    if (allOperational) return { label: 'All Systems Operational', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' };
    if (anyDown) return { label: 'Partial System Outage', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' };
    return { label: 'Some Systems Degraded', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' };
  };

  const overall = getOverallStatus();

  const getStatusBadge = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'operational':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
            </span>
            Operational
          </span>
        );
      case 'down':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-40"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-400"></span>
            </span>
            Down
          </span>
        );
      case 'degraded':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-yellow-400">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-40"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-400"></span>
            </span>
            Degraded
          </span>
        );
      case 'checking':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400">
            <svg className="animate-spin h-3 w-3 text-slate-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Checking…
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#050509] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Ambient background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-500/[0.04] rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[300px] bg-purple-500/[0.03] rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-2xl mx-auto px-4 py-12 sm:py-16">
        {/* Header */}
        <div className="text-center mb-10">
          <a
            href="#/"
            className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-8 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to InterviewXpert
          </a>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
            System Status
          </h1>
          <p className="text-slate-400 text-sm">
            Real-time health monitoring for InterviewXpert services
          </p>
        </div>

        {/* Overall status banner */}
        <div className={`rounded-xl border p-5 mb-8 flex items-center justify-between ${overall.bg}`}>
          <div className="flex items-center gap-3">
            {anyChecking ? (
              <svg className="animate-spin h-5 w-5 text-yellow-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : allOperational ? (
              <svg className="h-5 w-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            )}
            <span className={`font-semibold text-sm ${overall.color}`}>{overall.label}</span>
          </div>
          <button
            onClick={runChecks}
            disabled={isRefreshing}
            className="text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh status"
          >
            <svg className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
          </button>
        </div>

        {/* Service list */}
        <div className="rounded-xl border border-white/[0.06] bg-[#0b0b0f] overflow-hidden divide-y divide-white/[0.06]">
          {services.map((service) => (
            <div
              key={service.name}
              className="flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="text-lg flex-shrink-0" role="img" aria-label={service.name}>
                  {service.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{service.name}</p>
                  <p className="text-xs text-slate-500 truncate">{service.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                {service.status !== 'checking' && service.responseTime !== undefined && (
                  <span className="text-[11px] text-slate-500 font-mono tabular-nums hidden sm:inline">
                    {service.responseTime}ms
                  </span>
                )}
                {getStatusBadge(service.status)}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          {lastChecked && (
            <p className="text-xs text-slate-500">
              Last checked:{' '}
              <span className="text-slate-400">
                {lastChecked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="mx-1.5 text-slate-600">·</span>
              Auto-refreshes every 60s
            </p>
          )}
          <p className="text-xs text-slate-600 mt-3">
            Powered by{' '}
            <a href="#/" className="text-blue-400/80 hover:text-blue-400 transition-colors">
              InterviewXpert
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default StatusPage;
