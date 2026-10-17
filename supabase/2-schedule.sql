-- Step 7 of the setup guide. Before running, replace the two placeholders:
--   YOUR-PROJECT     -> the part of your Project URL before .supabase.co
--   YOUR-CRON-SECRET -> the same secret you saved as CRON_SECRET in step 6
-- Then paste into Supabase > SQL Editor and press Run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove an older copy of the schedule if you run this file again.
do $$ begin perform cron.unschedule('todo-tick'); exception when others then null; end $$;

select cron.schedule(
  'todo-tick',
  '* * * * *',  -- every minute
  $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT.supabase.co/functions/v1/tick',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR-CRON-SECRET"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
