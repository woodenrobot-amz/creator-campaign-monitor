-- Supabase project defaults can grant functions directly to anon, in addition
-- to PostgreSQL's PUBLIC default. Remove both explicit and inherited access.
revoke all on function public.monitor_publish(uuid,uuid,jsonb) from public, anon;
grant execute on function public.monitor_publish(uuid,uuid,jsonb) to authenticated;
