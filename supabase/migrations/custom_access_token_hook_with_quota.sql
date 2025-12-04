-- Custom Access Token Hook with Free Tier Quota
-- 
-- This hook runs every time a JWT is issued or refreshed.
-- It adds custom claims to the JWT payload.
--
-- CLAIMS ADDED:
-- - subscription_active (boolean): true if user has active subscription
-- - words_used_this_month (integer): current quota usage (free users only)
-- - quota_limit (integer): monthly word limit (free users only, hardcoded to 2000)
--
-- CRITICAL: Any errors in this function will break authentication!
-- Test thoroughly before deploying.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  has_subscription boolean;
  user_uuid uuid;
  current_words_used integer;
  current_reset_date timestamptz;
  should_reset boolean;
BEGIN
  -- Extract user ID from event
  user_uuid := (event->>'user_id')::uuid;
  
  -- Check if user has active subscription
  SELECT exists(
    SELECT 1 FROM public.subscriptions
    WHERE user_id = user_uuid
    AND status = 'active'
  ) INTO has_subscription;

  -- Get current claims from event
  claims := event->'claims';

  -- Add subscription_active claim to JWT (works for both Pro and Free users)
  claims := jsonb_set(claims, '{subscription_active}', to_jsonb(has_subscription));

  -- For FREE tier users: add quota claims
  IF NOT has_subscription THEN
    -- Read current quota state from profiles table
    SELECT 
      COALESCE(words_used_this_month, 0),
      quota_reset_date
    INTO 
      current_words_used,
      current_reset_date
    FROM public.profiles
    WHERE id = user_uuid;

    -- Lazy monthly reset: if reset_date is null or in the past, reset the counter
    IF current_reset_date IS NULL OR current_reset_date < NOW() THEN
      should_reset := true;
      current_words_used := 0;
      current_reset_date := DATE_TRUNC('month', NOW() + INTERVAL '1 month');
      
      -- Update profiles table with reset values
      UPDATE public.profiles
      SET 
        words_used_this_month = 0,
        quota_reset_date = current_reset_date
      WHERE id = user_uuid;
    ELSE
      should_reset := false;
    END IF;

    -- Add quota claims to JWT
    claims := jsonb_set(claims, '{words_used_this_month}', to_jsonb(current_words_used));
    claims := jsonb_set(claims, '{quota_limit}', to_jsonb(2000)); -- Hardcoded free tier limit
    
    -- Optional: add reset date for debugging
    claims := jsonb_set(claims, '{quota_reset_date}', to_jsonb(current_reset_date));
  END IF;

  -- Update the 'claims' object in the original event
  event := jsonb_set(event, '{claims}', claims);

  RETURN event;
EXCEPTION
  WHEN OTHERS THEN
    -- If anything fails, log the error but don't break auth
    -- Return the event unchanged (with just subscription_active claim)
    RAISE WARNING 'custom_access_token_hook error: %', SQLERRM;
    -- Fallback: just set subscription_active claim
    claims := event->'claims';
    claims := jsonb_set(claims, '{subscription_active}', to_jsonb(has_subscription));
    event := jsonb_set(event, '{claims}', claims);
    RETURN event;
END;
$$;

-- Grant execute permission to supabase_auth_admin (required for hooks)
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

COMMENT ON FUNCTION public.custom_access_token_hook IS 
'Custom Access Token Hook: Adds subscription_active and quota claims to JWT. Runs on every token issuance/refresh.';
