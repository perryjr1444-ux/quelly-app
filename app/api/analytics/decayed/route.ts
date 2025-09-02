import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withErrorHandling, AuthorizationError } from '@/lib/errors/handler';
import { computeDecayedSum, lambdaFromHalfLife, DecayTerm } from '@/lib/analytics/decay';

// GET /api/analytics/decayed?windowSec=3600&halfLifeSec=600
// Admin-only: Computes C(t) over recent events with exponential decay.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AuthorizationError();

  // Simple admin check: owner/admin membership
  const { data: member } = await supabase
    .from('org_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (member?.role !== 'admin' && member?.role !== 'owner') {
    throw new AuthorizationError('Admin access required');
  }

  const { searchParams } = new URL(req.url);
  const windowSec = Math.max(60, parseInt(searchParams.get('windowSec') || '3600', 10));
  const halfLifeSec = Math.max(60, parseInt(searchParams.get('halfLifeSec') || '600', 10));

  const nowSec = Math.floor(Date.now() / 1000);
  const sinceIso = new Date(Date.now() - windowSec * 1000).toISOString();
  const lambda = lambdaFromHalfLife(halfLifeSec);

  // Fetch recent events across relevant tables
  const [pwdEv, chkEv, secEv] = await Promise.all([
    supabase.from('password_events').select('event, created_at').gte('created_at', sinceIso).limit(1000),
    supabase.from('check_events').select('event, created_at').gte('created_at', sinceIso).limit(1000),
    supabase.from('security_events').select('event_type, created_at').gte('created_at', sinceIso).limit(1000),
  ]);

  // Map events to terms (k, I, dA). Tune weights as needed.
  const terms: DecayTerm[] = [];

  if (pwdEv.data) {
    for (const e of pwdEv.data as any[]) {
      const baseK = e.event === 'rotated' ? 1.5 : e.event === 'used' ? 1.2 : 1.0; // prioritize rotation/use
      terms.push({ weightK: baseK, intensity: 1.0, area: 1.0, occurredAtSec: Math.floor(new Date(e.created_at).getTime() / 1000) });
    }
  }
  if (chkEv.data) {
    for (const e of chkEv.data as any[]) {
      const baseK = e.event === 'failed' ? 2.0 : e.event === 'verified' ? 0.8 : 1.2;
      terms.push({ weightK: baseK, intensity: 1.0, area: 1.0, occurredAtSec: Math.floor(new Date(e.created_at).getTime() / 1000) });
    }
  }
  if (secEv.data) {
    for (const e of secEv.data as any[]) {
      const baseK = e.event_type === 'rate_limit_violation' ? 2.5 : 2.0;
      terms.push({ weightK: baseK, intensity: 1.0, area: 1.0, occurredAtSec: Math.floor(new Date(e.created_at).getTime() / 1000) });
    }
  }

  const C = computeDecayedSum(nowSec, lambda, terms);

  return NextResponse.json({
    ok: true,
    data: {
      nowSec,
      windowSec,
      halfLifeSec,
      lambda,
      terms: terms.length,
      value: C,
    },
  });
}, { action: 'analytics_decayed', resourceType: 'analytics' });
