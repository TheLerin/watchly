-- Read-only session check: Supabase sign-out deletes auth.sessions; an access JWT can otherwise remain valid until expiry.
-- Returns one boolean for the caller's own verified session, never a session identifier or another user's data.
create or replace function public.watchly_session_active()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions s
    where s.user_id = auth.uid()
      and s.id::text = auth.jwt()->>'session_id'
      and (to_jsonb(s)->>'not_after' is null or (to_jsonb(s)->>'not_after')::timestamptz > now())
  );
$$;
revoke all on function public.watchly_session_active() from public, anon;
grant execute on function public.watchly_session_active() to authenticated;
