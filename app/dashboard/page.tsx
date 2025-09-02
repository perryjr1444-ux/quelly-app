"use client";

import { useEffect, useState } from 'react';
import { useWebSocket } from '@/lib/hooks/use-websocket';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { AnimatedCard } from '@/components/ui/animated-card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useNotifications } from '@/lib/hooks/use-notifications';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Key, RefreshCw, CreditCard, Copy, Check, AlertCircle } from 'lucide-react';

type ApiResponse<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };
type PasswordRef = { id: string; user_id: string; pointer: string; current_version: number; status: 'active' | 'used'; label?: string | null; created_at: string };
type CheckCred = { id: string; label?: string | null; version?: number };

export default function DashboardPage() {
  const { success, error, warning } = useNotifications();
  const [passwords, setPasswords] = useState<PasswordRef[]>([]);
  const { on, connected } = useWebSocket();
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState('DEV_NEXTAUTH_SECRET');
  const [checkLabel, setCheckLabel] = useState('DEV_CHECK_CRED');
  const [latestCheck, setLatestCheck] = useState<{ id: string; label?: string; secret: string } | null>(null);
  const [events, setEvents] = useState<Record<string, any[]>>({});
  const [plan, setPlan] = useState<'free'|'pro'>('free');
  const [billingEnabled, setBillingEnabled] = useState(true);
  const [credits, setCredits] = useState<number>(0);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/passwords');
    const json: ApiResponse<PasswordRef[]> = await res.json();
    if (json.ok && json.data) setPasswords(json.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
    fetch('/api/billing/status').then(r => r.json()).then((j) => { if (j.ok && j.data) { setPlan(j.data.plan); setBillingEnabled(Boolean(j.data.billingEnabled)); setCredits(j.data.credits ?? 0); } });
    // Monthly reminder toast
    fetch('/api/reminders').then(r => r.json()).then((j) => {
      if (j.ok && Array.isArray(j.data)) {
        for (const rem of j.data) {
          if (rem.kind === 'monthly') {
            toast.info('Reminder', { description: rem.message });
          }
        }
      }
    }).catch(() => {});
    // Realtime password updates
    const unsub1 = on('password:created', () => load());
    const unsub2 = on('password:updated', () => load());
    const unsub3 = on('password:deleted', () => load());
    return () => { unsub1?.(); unsub2?.(); unsub3?.(); };
  }, []);

  const createPassword = async () => {
    setLoading(true);
    const res = await fetch('/api/passwords', { method: 'POST', body: JSON.stringify({ label }), headers: { 'Content-Type': 'application/json' } });
    const json: ApiResponse<PasswordRef> = await res.json();
    if (json.ok && json.data) {
      setPasswords((prev) => [json.data!, ...prev]);
      success('Secret created', `New secret with label "${label}" has been created`);
    } else {
      error('Failed to create secret', json.error?.message);
    }
    setLoading(false);
  };

  const issueCheck = async () => {
    setLoading(true);
    const res = await fetch('/api/check/issue', { method: 'POST', body: JSON.stringify({ label: checkLabel }), headers: { 'Content-Type': 'application/json' } });
    const json: ApiResponse<{ id: string; label?: string; secret: string }> = await res.json();
    if (json.ok && json.data) setLatestCheck(json.data);
    setLoading(false);
  };

  const verifyCheck = async (rotate: boolean) => {
    if (!latestCheck) return;
    setLoading(true);
    const res = await fetch('/api/check/verify', { method: 'POST', body: JSON.stringify({ id: latestCheck.id, secret: latestCheck.secret, rotate }), headers: { 'Content-Type': 'application/json' } });
    const json: ApiResponse<{ ok: true; rotatedSecret?: string }> = await res.json();
    if (json.ok && json.data?.rotatedSecret) setLatestCheck({ ...latestCheck, secret: json.data.rotatedSecret });
    setLoading(false);
  };

  const usePassword = async (id: string) => {
    setLoading(true);
    const res = await fetch(`/api/passwords/${id}`, { method: 'PATCH' });
    const json: ApiResponse<PasswordRef> = await res.json();
    if (json.ok && json.data) {
      setPasswords((prev) => prev.map((p) => (p.id === id ? json.data! : p)));
      // Reload to pick up the rotated new active one (unique index per label)
      await load();
      // Load events for this password
      const evRes = await fetch(`/api/passwords/events?password_id=${id}`);
      const evJson: ApiResponse<any[]> = await evRes.json();
      if (evJson.ok && evJson.data) setEvents((prev) => ({ ...prev, [id]: evJson.data! }));
      // Refresh credits and show low-credits toast if needed
      const bs = await fetch('/api/billing/status').then(r => r.json()).catch(() => ({ ok: false }));
      if (bs.ok && bs.data) {
        setCredits(bs.data.credits ?? 0);
        if (bs.data.credits !== undefined && bs.data.credits <= 3 && plan === 'pro') {
          toast.warning('Low credits', { description: 'You are running low on rotation credits. Buy more to avoid interruptions.' });
        }
      }
    } else if (!json.ok && json.error?.code === 'QUOTA_EXCEEDED') {
      toast.error('Rotation limit reached', { description: 'Free plan allows up to 10 rotations. Upgrade or buy credits to continue.' });
    }
    setLoading(false);
  };

  if (loading && passwords.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" message="Loading your secrets..." />
      </div>
    );
  }

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-6 space-y-6"
    >
      <AnimatedCard delay={0.1} hover={false}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Plan:</span>
              <span className="font-semibold capitalize">{plan}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Credits:</span>
              <span className="font-semibold">{credits}</span>
            </div>
          </div>
          {billingEnabled ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => { window.location.href = '/api/portal'; }} disabled={loading}>
                Manage Subscription
              </Button>
              <Button onClick={() => { window.location.href = '/pricing'; }} disabled={loading}>
                Upgrade
              </Button>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Billing temporarily unavailable</div>
          )}
        </div>
      </AnimatedCard>
      <div className="flex items-end gap-3">
        <div>
          <label className="block text-sm text-gray-500">Label</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. DEV_NEXTAUTH_SECRET" />
        </div>
        <Button onClick={createPassword} disabled={loading}>Create Secret</Button>
        <Button className="border border-black bg-transparent text-black dark:text-white" onClick={load} disabled={loading}>Refresh</Button>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Check Credentials (zero-trust layer)</h2>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-sm text-gray-500">Label</label>
            <Input value={checkLabel} onChange={(e) => setCheckLabel(e.target.value)} placeholder="e.g. DEV_CHECK_CRED" />
          </div>
          <Button onClick={issueCheck} disabled={loading}>Issue</Button>
          <Button className="border border-black bg-transparent text-black dark:text-white" onClick={() => verifyCheck(false)} disabled={loading || !latestCheck}>Verify</Button>
          <Button className="bg-blue-600" onClick={() => verifyCheck(true)} disabled={loading || !latestCheck}>Verify + Rotate</Button>
        </div>
        {latestCheck && (
          <Card>
            <div className="space-y-1 text-sm">
              <div><span className="text-gray-500">ID:</span> {latestCheck.id}</div>
              <div><span className="text-gray-500">Label:</span> {latestCheck.label ?? '-'}</div>
              <div><span className="text-gray-500">Secret:</span> <span className="font-mono">{latestCheck.secret}</span></div>
            </div>
          </Card>
        )}
      </section>

      <table className="w-full text-sm border">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="p-2 border-r">Label</th>
            <th className="p-2 border-r">Pointer</th>
            <th className="p-2 border-r">Version</th>
            <th className="p-2 border-r">Status</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {passwords.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="p-2 border-r">{p.label ?? '-'}</td>
              <td className="p-2 border-r font-mono">{p.pointer}</td>
              <td className="p-2 border-r">{p.current_version}</td>
              <td className="p-2 border-r">{p.status}</td>
              <td className="p-2">
                {p.status === 'active' ? (
                  <Button className="bg-blue-600" onClick={() => usePassword(p.id)} disabled={loading}>Use → Rotate</Button>
                ) : (
                  <span className="text-gray-400">Used</span>
                )}
                {events[p.id]?.length ? (
                  <div className="text-xs text-gray-500 mt-2">
                    {events[p.id].map((e, i) => (
                      <div key={i}>{e.event} • {new Date(e.created_at).toLocaleString()}</div>
                    ))}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </motion.main>
  );
}

