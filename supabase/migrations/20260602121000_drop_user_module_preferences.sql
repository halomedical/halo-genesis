-- Consolidate module source-of-truth to practice_features.
-- Safe if table does not exist.

drop trigger if exists user_module_preferences_set_updated_at on public.user_module_preferences;
drop table if exists public.user_module_preferences;
