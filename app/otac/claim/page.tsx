"use client";

import { useEffect, useState } from 'react';

export default function OtacClaimPage() {
  const [status, setStatus] = useState<'idle'|'claiming'|'claimed'|'error'>('idle');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const url = new URL(window.location.href);
    const session_id = url.searchParams.get('session_id');
    const code = url.searchParams.get('code');
    if (!session_id || !code) {
      setStatus('error');
      setMessage('Missing session_id or code.');
      return;
    }
    setStatus('claiming');
    fetch('/api/auth/otac/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id, code }),
    }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok && body?.data?.claimed) {
        setStatus('claimed');
        setMessage('Code claimed successfully. You can close this tab.');
      } else if (body?.error?.message) {
        setStatus('error');
        setMessage(body.error.message);
      } else {
        setStatus('error');
        setMessage('Unable to claim the code.');
      }
    }).catch(() => {
      setStatus('error');
      setMessage('Network error while claiming.');
    });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">One-time Code</h1>
        {status === 'claiming' && <p className="text-sm text-gray-600">Claiming…</p>}
        {status === 'claimed' && <p className="text-green-700 text-sm">{message}</p>}
        {status === 'error' && <p className="text-red-600 text-sm">{message}</p>}
      </div>
    </main>
  );
}


