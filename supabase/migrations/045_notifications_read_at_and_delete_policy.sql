-- ============================================================
-- Migration 045: Notifications Read Alignment & Delete Policy
--
-- 1. Adds read_at column to notifications table if missing
-- 2. Backfills read and read_at so both columns are consistent
-- 3. Adds explicit DELETE policy allowing users to delete their alerts
-- 4. Grants UPDATE (read, read_at) and DELETE privileges to authenticated
-- ============================================================

-- 1. Ensure read_at column exists
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- 2. Backfill read_at from resolved_at or created_at for read rows
UPDATE public.notifications
SET read_at = COALESCE(resolved_at, created_at, NOW())
WHERE read = true AND read_at IS NULL;

-- 3. Backfill read boolean from read_at
UPDATE public.notifications
SET read = true
WHERE read_at IS NOT NULL AND (read IS NULL OR read = false);

-- 4. Allow authenticated users to delete their own notifications
DROP POLICY IF EXISTS notifications_delete ON public.notifications;
CREATE POLICY notifications_delete ON public.notifications
  FOR DELETE
  USING (auth.uid() = user_id);

-- 5. Column level permissions
GRANT UPDATE (read, read_at) ON public.notifications TO authenticated;
GRANT DELETE ON public.notifications TO authenticated;
