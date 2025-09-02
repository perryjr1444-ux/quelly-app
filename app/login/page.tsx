"use client";

import { useState } from 'react';
import QRCode from 'qrcode';

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [qrSession, setQrSession] = useState<{ id: string; code: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrChecking, setQrChecking] = useState(false);

  const sendMagicLink = async () => {
    setLoading(true);
    const res = await fetch('/api/auth/magic-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    setSent(res.ok);
    setLoading(false);
  };

  const startQr = async () => {
    setQrSession(null);
    setQrChecking(false);
    const res = await fetch('/api/auth/otac/issue', { method: 'POST' });
    if (!res.ok) return;
    const { ok, data } = await res.json();
    if (!ok) return;
    setQrSession({ id: data.session_id, code: data.code });
    const claimUrl = `${window.location.origin}/otac/claim?session_id=${encodeURIComponent(data.session_id)}&code=${encodeURIComponent(data.code)}`;
    const deepLink = claimUrl;
    try {
      const url = await QRCode.toDataURL(deepLink, { margin: 1, width: 256 });
      setQrDataUrl(url);
    } catch {}
    setQrChecking(true);
    // Poll status for simplicity; upgrade to Realtime later
    const interval = setInterval(async () => {
      const statusUrl = `/api/auth/otac/status?session_id=${encodeURIComponent(data.session_id)}`;
      const sres = await fetch(statusUrl);
      const sj = await sres.json().catch(() => null);
      if (sj?.ok && sj.data?.claimed) {
        clearInterval(interval);
        window.location.href = '/dashboard';
      }
      if (sj?.ok && sj.data?.expired) clearInterval(interval);
    }, 1500);
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-gray-600">We’ll email you a magic link to sign in.</p>
        <input className="w-full border rounded px-3 py-2" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="w-full bg-black text-white rounded px-3 py-2" onClick={sendMagicLink} disabled={loading || !email}>
          {loading ? 'Sending…' : 'Email me a link'}
        </button>
        {sent && <p className="text-green-600 text-sm">Check your inbox for the link.</p>}
        <div className="pt-4 border-t">
          <button className="w-full border border-black rounded px-3 py-2" onClick={startQr} disabled={qrChecking}>QR one-time code</button>
          {qrSession && (
            <div className="text-xs text-gray-600 pt-2">
              Session: <span className="font-mono">{qrSession.id}</span>
              <div className="mt-1">Code: <span className="font-mono">{qrSession.code}</span></div>
              <div className="mt-1">Scan code with a trusted device to claim.</div>
              {qrDataUrl && (
                <div className="mt-2 flex items-center justify-center">
                  <img src={qrDataUrl} alt="QR code" className="border rounded" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
