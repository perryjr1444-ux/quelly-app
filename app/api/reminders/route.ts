import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Reminder = { kind: 'monthly'; message: string };

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 });

  const now = new Date();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const { data: row } = await supabase
    .from('user_reminders')
    .select('last_notified_at')
    .eq('user_id', user.id)
    .eq('kind', 'monthly')
    .maybeSingle();

  let shouldNotifyMonthly = false;
  if (!row?.last_notified_at) {
    shouldNotifyMonthly = true;
  } else {
    const last = new Date(row.last_notified_at as unknown as string);
    if (now.getTime() - last.getTime() > thirtyDaysMs) shouldNotifyMonthly = true;
  }

  const reminders: Reminder[] = [];
  if (shouldNotifyMonthly) {
    reminders.push({ kind: 'monthly', message: 'Quick check-in: keep your secrets fresh and rotate regularly.' });
    await supabase
      .from('user_reminders')
      .upsert({ user_id: user.id, kind: 'monthly', last_notified_at: now.toISOString() });
  }

  return NextResponse.json({ ok: true, data: reminders });
}


