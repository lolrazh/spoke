-- Simple quota sync function for free tier
-- This just updates the words_used_this_month column to the provided value
-- No checking, no locking, no validation - just a simple UPDATE
-- Called by the app to sync local quota cache to database

CREATE OR REPLACE FUNCTION sync_quota_simple(
  p_user_id UUID,
  p_words_used INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Simple update: set the quota to the provided value
  -- The app handles all the logic (incrementing, checking, etc.)
  -- This function just persists the app's local state to the database
  UPDATE profiles
  SET words_used_this_month = p_words_used
  WHERE id = p_user_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION sync_quota_simple(UUID, INTEGER) TO authenticated;

COMMENT ON FUNCTION sync_quota_simple IS 'Simple quota sync function - updates words_used_this_month for a user. Called by app to persist local quota cache.';
