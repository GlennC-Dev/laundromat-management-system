-- Live floor board: broadcast ticket changes (row-level security still applies per subscriber).
alter publication supabase_realtime add table public.tickets;
