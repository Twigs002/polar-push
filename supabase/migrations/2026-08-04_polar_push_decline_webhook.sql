-- Operation Polar Push - fire the mandate-declined email on rejection.
-- =================================================================
-- Applied live via the SQL editor; recorded here for repo/prod parity.
--
-- Replaces the dashboard Database Webhook with an equivalent pg_net trigger:
-- when a polar_push_entries row transitions INTO status='rejected', POST the
-- row to the `mandate-declined` Edge Function, which emails the submitter
-- (CC Sheldon + Diego).
--
-- ORDER: deploy the Edge Function first (`supabase functions deploy
-- mandate-declined`). If the function isn't deployed yet the POST just 404s
-- harmlessly and the UPDATE still succeeds (net.http_post is async,
-- fire-and-forget, so a failed call never blocks or rolls back the rejection).
--
-- Auth: the Bearer token below is the PUBLIC anon key (same value shipped in
-- config.js). It only satisfies the Edge Function gateway's JWT check; the
-- function does all privileged work with its own service-role key, and only
-- acts on a genuine rejection transition.

create extension if not exists pg_net;

create or replace function public.polar_notify_decline()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
begin
  if new.status = 'rejected'
     and coalesce(old.status, '') is distinct from 'rejected' then
    perform net.http_post(
      url := 'https://dqszbqiimbfvmmnpgpsb.supabase.co/functions/v1/mandate-declined',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxc3picWlpbWJmdm1tbnBncHNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NDk4OTQsImV4cCI6MjA5NjQyNTg5NH0.M9RQnJEidyIMZAwbELTSPakiSnvuWBdHTjD7nuOdCZY'
      ),
      body := jsonb_build_object(
        'type', 'UPDATE',
        'table', 'polar_push_entries',
        'record', to_jsonb(new),
        'old_record', to_jsonb(old)
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists polar_push_entries_decline on public.polar_push_entries;
create trigger polar_push_entries_decline
  after update on public.polar_push_entries
  for each row
  execute function public.polar_notify_decline();
