-- Accounts enhance the existing Render rooms; room roles/video/history stay out of this schema.
begin;
create schema if not exists watchly_private;
revoke all on schema watchly_private from public;
grant usage on schema watchly_private to authenticated;

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
    display_name text not null check (length(btrim(display_name)) between 1 and 24),
    avatar_url text check (avatar_url is null or (avatar_url ~ '^https://' and length(avatar_url) <= 2048)),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    last_seen_at timestamptz
);
create table public.friend_requests (
    id uuid primary key default gen_random_uuid(),
    sender_id uuid not null references public.profiles(id) on delete cascade,
    receiver_id uuid not null references public.profiles(id) on delete cascade,
    status text not null default 'pending' check (status in ('pending','accepted','rejected')),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    check (sender_id <> receiver_id)
);
create unique index friend_requests_pending_pair on public.friend_requests
    (least(sender_id, receiver_id), greatest(sender_id, receiver_id)) where status = 'pending';
create index friend_requests_receiver on public.friend_requests(receiver_id, status);
create index friend_requests_sender on public.friend_requests(sender_id, status);
create table public.friendships (
    user_low uuid not null references public.profiles(id) on delete cascade,
    user_high uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now(), primary key (user_low, user_high), check (user_low < user_high)
);
create index friendships_high on public.friendships(user_high);
create table public.blocks (
    blocker_id uuid not null references public.profiles(id) on delete cascade,
    blocked_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now(), primary key (blocker_id, blocked_id), check (blocker_id <> blocked_id)
);
create index blocks_blocked on public.blocks(blocked_id);
create table public.room_invites (
    id uuid primary key default gen_random_uuid(),
    sender_id uuid not null references public.profiles(id) on delete cascade,
    receiver_id uuid not null references public.profiles(id) on delete cascade,
    room_code text not null check (room_code ~ '^[A-Z0-9]{7}$'),
    status text not null default 'pending' check (status in ('pending','accepted','declined')),
    created_at timestamptz not null default now(), expires_at timestamptz not null default (now() + interval '2 hours'),
    check (sender_id <> receiver_id)
);
create unique index room_invites_pending on public.room_invites(sender_id,receiver_id,room_code) where status='pending';
create index room_invites_receiver on public.room_invites(receiver_id,status,expires_at);

create function watchly_private.require_profile() returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
    if me is null or not exists(select 1 from public.profiles where id=me) then raise exception 'WATCHLY_PROFILE_REQUIRED'; end if;
    return me;
end $$;
create function watchly_private.lock_pair(a uuid,b uuid) returns void language sql set search_path = '' as $$
    select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(a,b)::text || greatest(a,b)::text,0));
$$;
create function watchly_private.blocked(a uuid,b uuid) returns boolean language sql stable security definer set search_path = '' as $$
    select exists(select 1 from public.blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a));
$$;
create function watchly_private.blocked_for_me(other_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
    select watchly_private.blocked(auth.uid(),other_id);
$$;
create function watchly_private.updated_timestamp() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger profiles_updated before update on public.profiles for each row execute function watchly_private.updated_timestamp();
create trigger requests_updated before update on public.friend_requests for each row execute function watchly_private.updated_timestamp();

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.room_invites enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (id=auth.uid() or not watchly_private.blocked_for_me(id));
create policy profiles_create on public.profiles for insert to authenticated with check (id=auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy requests_read on public.friend_requests for select to authenticated using
    ((sender_id=auth.uid() or receiver_id=auth.uid()) and not watchly_private.blocked_for_me(case when sender_id=auth.uid() then receiver_id else sender_id end));
create policy friendships_read on public.friendships for select to authenticated using
    ((user_low=auth.uid() or user_high=auth.uid()) and not watchly_private.blocked_for_me(case when user_low=auth.uid() then user_high else user_low end));
create policy blocks_read on public.blocks for select to authenticated using (blocker_id=auth.uid());
create policy invites_read on public.room_invites for select to authenticated using
    ((sender_id=auth.uid() or receiver_id=auth.uid()) and not watchly_private.blocked_for_me(case when sender_id=auth.uid() then receiver_id else sender_id end));

-- Direct social writes are denied, including for authenticated users. RPCs below
-- perform ownership, blocks and friendship checks atomically under a pair lock.
revoke all on public.profiles, public.friend_requests, public.friendships, public.blocks, public.room_invites from anon, authenticated;
grant select(id,username,display_name,avatar_url,created_at,updated_at) on public.profiles to authenticated;
-- PostgREST merge-duplicate upserts include id in their UPDATE list. Ownership
-- remains enforced by both USING and WITH CHECK, including attempted id changes.
grant insert(id,username,display_name,avatar_url), update(id,username,display_name,avatar_url) on public.profiles to authenticated;
grant select on public.friend_requests, public.friendships, public.blocks, public.room_invites to authenticated;

create function public.search_people(query_text text) returns table(id uuid,username text,display_name text,avatar_url text)
language sql stable security definer set search_path = '' as $$
    select p.id,p.username,p.display_name,p.avatar_url from public.profiles p
    where auth.uid() is not null and p.id<>auth.uid() and length(query_text) between 3 and 24
    and query_text ~ '^[a-z0-9_]+$' and p.username like replace(query_text,'_','\_') || '%' escape '\'
    and not watchly_private.blocked(auth.uid(),p.id) order by p.username limit 10;
$$;
create function public.friend_ids() returns setof uuid language sql stable security definer set search_path = '' as $$
    select case when f.user_low=auth.uid() then f.user_high else f.user_low end from public.friendships f
    where auth.uid() in (f.user_low,f.user_high) and not watchly_private.blocked(f.user_low,f.user_high);
$$;
create function public.request_friend(target_id uuid) returns text language plpgsql security definer set search_path = '' as $$
declare me uuid:=watchly_private.require_profile(); existing public.friend_requests;
begin
    if target_id=me then raise exception 'WATCHLY_SELF'; end if;
    perform watchly_private.lock_pair(me,target_id);
    if watchly_private.blocked(me,target_id) then raise exception 'WATCHLY_BLOCKED'; end if;
    if not exists(select 1 from public.profiles where id=target_id) then raise exception 'WATCHLY_NOT_FOUND'; end if;
    if exists(select 1 from public.friendships where user_low=least(me,target_id) and user_high=greatest(me,target_id)) then return 'friends'; end if;
    select * into existing from public.friend_requests where status='pending' and least(sender_id,receiver_id)=least(me,target_id) and greatest(sender_id,receiver_id)=greatest(me,target_id) for update;
    if existing.id is not null then
        if existing.sender_id=me then return 'pending'; end if;
        update public.friend_requests set status='accepted' where id=existing.id;
        insert into public.friendships(user_low,user_high) values(least(me,target_id),greatest(me,target_id)) on conflict do nothing;
        return 'friends';
    end if;
    insert into public.friend_requests(sender_id,receiver_id) values(me,target_id);
    return 'pending';
end $$;
create function public.respond_friend_request(request_id uuid,accept boolean) returns text language plpgsql security definer set search_path = '' as $$
declare me uuid:=watchly_private.require_profile(); request public.friend_requests;
begin
    select * into request from public.friend_requests where id=request_id;
    if request.id is null then raise exception 'WATCHLY_NOT_FOUND'; end if;
    if request.receiver_id<>me then raise exception 'WATCHLY_FORBIDDEN'; end if;
    perform watchly_private.lock_pair(me,request.sender_id);
    select * into request from public.friend_requests where id=request_id for update;
    if watchly_private.blocked(me,request.sender_id) then raise exception 'WATCHLY_BLOCKED'; end if;
    if request.status<>'pending' then return request.status; end if;
    update public.friend_requests set status=case when accept then 'accepted' else 'rejected' end where id=request_id;
    if accept then insert into public.friendships(user_low,user_high) values(least(me,request.sender_id),greatest(me,request.sender_id)) on conflict do nothing; end if;
    return case when accept then 'accepted' else 'rejected' end;
end $$;
create function public.remove_friend(target_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid:=watchly_private.require_profile();
begin
    perform watchly_private.lock_pair(me,target_id);
    delete from public.friendships where user_low=least(me,target_id) and user_high=greatest(me,target_id);
    delete from public.room_invites where status='pending' and least(sender_id,receiver_id)=least(me,target_id) and greatest(sender_id,receiver_id)=greatest(me,target_id);
end $$;
create function public.block_person(target_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid:=watchly_private.require_profile();
begin
    if target_id=me then raise exception 'WATCHLY_SELF'; end if;
    perform watchly_private.lock_pair(me,target_id);
    insert into public.blocks(blocker_id,blocked_id) values(me,target_id) on conflict do nothing;
    delete from public.friendships where user_low=least(me,target_id) and user_high=greatest(me,target_id);
    update public.friend_requests set status='rejected' where status='pending' and least(sender_id,receiver_id)=least(me,target_id) and greatest(sender_id,receiver_id)=greatest(me,target_id);
    delete from public.room_invites where status='pending' and least(sender_id,receiver_id)=least(me,target_id) and greatest(sender_id,receiver_id)=greatest(me,target_id);
end $$;
create function public.unblock_person(target_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin delete from public.blocks where blocker_id=watchly_private.require_profile() and blocked_id=target_id; end $$;
-- Only the Render backend may issue invites after checking current room/role.
create function public.send_room_invite(verified_sender_id uuid,target_id uuid,invite_room_code text) returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid:=verified_sender_id; invite uuid;
begin
    if me is null or not exists(select 1 from public.profiles where id=me) then raise exception 'WATCHLY_PROFILE_REQUIRED'; end if;
    if invite_room_code is null or invite_room_code !~ '^[A-Z0-9]{7}$' then raise exception 'WATCHLY_INVALID'; end if;
    perform watchly_private.lock_pair(me,target_id);
    if watchly_private.blocked(me,target_id) then raise exception 'WATCHLY_BLOCKED'; end if;
    if not exists(select 1 from public.friendships where user_low=least(me,target_id) and user_high=greatest(me,target_id)) then raise exception 'WATCHLY_NOT_FRIENDS'; end if;
    update public.room_invites i set status='declined' where i.sender_id=me and i.receiver_id=target_id and i.status='pending' and i.expires_at<=now();
    insert into public.room_invites(sender_id,receiver_id,room_code) values(me,target_id,invite_room_code)
    on conflict (sender_id,receiver_id,room_code) where status='pending' do update set room_code=excluded.room_code returning id into invite;
    return invite;
end $$;
create function public.respond_room_invite(invite_id uuid,accept boolean) returns text language plpgsql security definer set search_path = '' as $$
declare me uuid:=watchly_private.require_profile(); invite public.room_invites;
begin
    select * into invite from public.room_invites where id=invite_id;
    if invite.id is null then raise exception 'WATCHLY_NOT_FOUND'; end if;
    if invite.receiver_id<>me then raise exception 'WATCHLY_FORBIDDEN'; end if;
    perform watchly_private.lock_pair(me,invite.sender_id);
    select * into invite from public.room_invites where id=invite_id for update;
    if watchly_private.blocked(me,invite.sender_id) then raise exception 'WATCHLY_BLOCKED'; end if;
    if invite.expires_at<=now() then raise exception 'WATCHLY_EXPIRED'; end if;
    if invite.status='pending' then update public.room_invites set status=case when accept then 'accepted' else 'declined' end where id=invite_id; end if;
    return invite.room_code;
end $$;
create function public.touch_profile() returns void language sql security definer set search_path = '' as $$
    update public.profiles set last_seen_at=now() where id=auth.uid();
$$;
create function public.get_my_watchly() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid:=watchly_private.require_profile(); result jsonb;
begin
    select jsonb_build_object(
        'friends',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url))
            from public.profiles p where p.id in(select public.friend_ids())), '[]'::jsonb),
        'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'sender',jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url)))
            from public.friend_requests r join public.profiles p on p.id=r.sender_id where r.receiver_id=me and r.status='pending' and not watchly_private.blocked(me,r.sender_id)), '[]'::jsonb),
        'outgoing',coalesce((select jsonb_agg(r.receiver_id) from public.friend_requests r where r.sender_id=me and r.status='pending' and not watchly_private.blocked(me,r.receiver_id)), '[]'::jsonb),
        'invites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'room_code',i.room_code,'expires_at',i.expires_at,'sender',jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url)))
            from public.room_invites i join public.profiles p on p.id=i.sender_id where i.receiver_id=me and i.status='pending' and i.expires_at>now() and not watchly_private.blocked(me,i.sender_id)), '[]'::jsonb),
        'blocks',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url)) from public.blocks b join public.profiles p on p.id=b.blocked_id where b.blocker_id=me), '[]'::jsonb)
    ) into result;
    return result;
end $$;

revoke all on all functions in schema watchly_private from public, anon, authenticated;
grant execute on function watchly_private.blocked_for_me(uuid) to authenticated;
revoke all on function public.search_people(text),public.friend_ids(),public.request_friend(uuid),public.respond_friend_request(uuid,boolean),
    public.remove_friend(uuid),public.block_person(uuid),public.unblock_person(uuid),public.send_room_invite(uuid,uuid,text),
    public.respond_room_invite(uuid,boolean),public.touch_profile(),public.get_my_watchly() from public, anon;
grant execute on function public.search_people(text),public.friend_ids(),public.request_friend(uuid),public.respond_friend_request(uuid,boolean),
    public.remove_friend(uuid),public.block_person(uuid),public.unblock_person(uuid),
    public.respond_room_invite(uuid,boolean),public.touch_profile(),public.get_my_watchly() to authenticated;
revoke all on function public.send_room_invite(uuid,uuid,text) from authenticated;
grant execute on function public.send_room_invite(uuid,uuid,text) to service_role;
commit;
