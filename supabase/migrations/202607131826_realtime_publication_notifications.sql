-- The previous realtime-publication migration (202607131300) assumed
-- `notifications` was already in the supabase_realtime publication based on
-- an old code comment claiming it powered the header bell — that claim was
-- never actually verified. Given the bell's unread count still wasn't
-- updating live after that migration ran, add it explicitly here too.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
