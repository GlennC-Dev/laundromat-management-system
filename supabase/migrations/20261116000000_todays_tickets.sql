-- Staff cannot read completed tickets directly (RLS), but they need to see what was rung up today
-- so mistakes can be caught. This returns today's tickets (shop timezone), voided ones included,
-- to any signed-in, active user.
create function public.todays_tickets()
returns setof public.tickets
language sql stable security definer
set search_path = ''
as $$
  select t.*
  from public.tickets t
  cross join public.settings s
  where (select public.app_role()) is not null
    and (
      (t.started_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date
      or (t.completed_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date
    )
  order by t.started_at desc;
$$;

revoke all on function public.todays_tickets() from public, anon;
grant execute on function public.todays_tickets() to authenticated;
