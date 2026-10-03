-- Persistent social updates: scoped Postgres Changes, plus private invalidations
-- for deletes and RLS-hidden block effects. Apply after the accounts migration.
begin;
do $$
declare relation text;
begin
    if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
        create publication supabase_realtime;
    end if;
    foreach relation in array array['friend_requests','friendships','blocks','room_invites'] loop
        if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=relation) then
            execute format('alter publication supabase_realtime add table public.%I',relation);
        end if;
    end loop;
end $$;

-- Same ownership/block rules and safe projections as get_my_watchly, but only
-- execute the requested sections. No caller-supplied account ID is accepted.
create or replace function public.get_social_data(sections text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid:=watchly_private.require_profile(); result jsonb:='{}'::jsonb;
begin
    if sections is null or not sections <@ array['friends','requests','invites','blocks']::text[] then
        raise exception 'WATCHLY_INVALID';
    end if;
    if 'friends'=any(sections) then
        result:=result || jsonb_build_object('friends',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url))
            from public.profiles p where p.id in(select public.friend_ids())), '[]'::jsonb));
    end if;
    if 'requests'=any(sections) then
        result:=result || jsonb_build_object('requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'sender',jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url)))
            from public.friend_requests r join public.profiles p on p.id=r.sender_id where r.receiver_id=me and r.status='pending' and not watchly_private.blocked(me,r.sender_id)), '[]'::jsonb));
    end if;
    if 'requests'=any(sections) then
        result:=result || jsonb_build_object('outgoing',coalesce((select jsonb_agg(r.receiver_id) from public.friend_requests r where r.sender_id=me and r.status='pending' and not watchly_private.blocked(me,r.receiver_id)), '[]'::jsonb));
    end if;
    if 'invites'=any(sections) then
        result:=result || jsonb_build_object('invites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'room_code',i.room_code,'expires_at',i.expires_at,'sender',jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url)))
            from public.room_invites i join public.profiles p on p.id=i.sender_id where i.receiver_id=me and i.status='pending' and i.expires_at>now() and not watchly_private.blocked(me,i.sender_id)), '[]'::jsonb));
    end if;
    if 'blocks'=any(sections) then
        result:=result || jsonb_build_object('blocks',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url)) from public.blocks b join public.profiles p on p.id=b.blocked_id where b.blocker_id=me), '[]'::jsonb));
    end if;
    if 'invites'=any(sections) then
        result:=result || jsonb_build_object('sentInvites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'receiver_id',i.receiver_id,'room_code',i.room_code))
            from public.room_invites i where i.sender_id=me and i.status='pending' and i.expires_at>now() and not watchly_private.blocked(me,i.receiver_id)), '[]'::jsonb));
    end if;
    return result;
end $$;
create or replace function public.get_my_watchly() returns jsonb
language sql stable security definer set search_path = '' as $$
    select public.get_social_data(array['friends','requests','invites','blocks']);
$$;
revoke all on function public.get_social_data(text[]) from public,anon;
grant execute on function public.get_social_data(text[]) to authenticated;

-- Postgres Changes cannot safely deliver narrowly scoped private DELETE rows
-- through the existing RLS. Send only a table invalidation, never old row data.
-- A blocked user cannot read the block row either; notify their own topic so
-- they can refetch relationship lists through the existing authorized RPC.
create or replace function watchly_private.social_invalidation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; endpoints uuid[]; account_id uuid;
begin
    row_data:=case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
    if TG_TABLE_NAME='friendships' then
        endpoints:=array[(row_data->>'user_low')::uuid,(row_data->>'user_high')::uuid];
    elsif TG_TABLE_NAME='blocks' then
        endpoints:=case when TG_OP='DELETE' then array[(row_data->>'blocker_id')::uuid,(row_data->>'blocked_id')::uuid]
            else array[(row_data->>'blocked_id')::uuid] end;
    else
        endpoints:=array[(row_data->>'sender_id')::uuid,(row_data->>'receiver_id')::uuid];
    end if;
    foreach account_id in array endpoints loop
        perform realtime.send(jsonb_build_object('table',TG_TABLE_NAME),'social_changed','watchly-social:' || account_id::text,true);
    end loop;
    return null;
end $$;
revoke all on function watchly_private.social_invalidation() from public,anon,authenticated;
drop trigger if exists watchly_social_delete on public.friend_requests;
create trigger watchly_social_delete after delete on public.friend_requests for each row execute function watchly_private.social_invalidation();
drop trigger if exists watchly_social_delete on public.friendships;
create trigger watchly_social_delete after delete on public.friendships for each row execute function watchly_private.social_invalidation();
drop trigger if exists watchly_social_delete on public.room_invites;
create trigger watchly_social_delete after delete on public.room_invites for each row execute function watchly_private.social_invalidation();
drop trigger if exists watchly_social_block on public.blocks;
create trigger watchly_social_block after insert or update or delete on public.blocks for each row execute function watchly_private.social_invalidation();

-- Supabase owns realtime.messages and already enables RLS. Do not ALTER it.
-- Read-only permission for exactly the signed-in account's private topic;
-- clients receive no ability to broadcast forged invalidations.
drop policy if exists watchly_social_receive on realtime.messages;
create policy watchly_social_receive on realtime.messages for select to authenticated
using (extension='broadcast' and (select realtime.topic())='watchly-social:' || (select auth.uid())::text
    and topic='watchly-social:' || (select auth.uid())::text);
-- Keep the namespace private even if another feature installed a broad
-- permissive Broadcast policy. Other topics keep their existing policies.
drop policy if exists watchly_social_receive_guard on realtime.messages;
create policy watchly_social_receive_guard on realtime.messages as restrictive for select to public
using (topic not like 'watchly-social:%' or
    (extension='broadcast' and topic='watchly-social:' || (select auth.uid())::text
     and (select realtime.topic())=topic));
drop policy if exists watchly_social_send_guard on realtime.messages;
create policy watchly_social_send_guard on realtime.messages as restrictive for insert to public
with check (topic not like 'watchly-social:%');
commit;
