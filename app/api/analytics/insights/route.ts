import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withErrorHandling, AuthorizationError } from '@/lib/errors/handler';

export const GET = withErrorHandling(async (req: NextRequest) => {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AuthorizationError();

  // Admin check (simplified)
  const { data: member } = await supabase.from('org_members').select('role').eq('user_id', user.id).maybeSingle();
  if (member?.role !== 'admin' && member?.role !== 'owner') throw new AuthorizationError('Admin access required');

  // Aggregate insights
  const [passwordsRes, checksRes, usersRes] = await Promise.all([
    supabase.from('disposable_passwords').select('*', { count: 'exact', head: true }),
    supabase.from('check_events').select('*', { count: 'exact', head: true }),
    supabase.from('audit_logs').select('user_id', { count: 'exact', head: true })
  ]);

  const insights = {
    totalPasswords: passwordsRes.count || 0,
    totalCheckEvents: checksRes.count || 0,
    activeUsers: usersRes.count || 0,
  };

  return NextResponse.json({ ok: true, data: insights });
}, { action: 'analytics_insights', resourceType: 'analytics' });
