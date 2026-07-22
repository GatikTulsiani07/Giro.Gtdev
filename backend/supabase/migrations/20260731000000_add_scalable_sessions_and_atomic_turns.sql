alter table public.sessions add column if not exists message_count integer not null default 0;
alter table public.sessions add column if not exists session_version bigint not null default 1;

update public.sessions sessions set message_count = counts.message_count
from (
  select session_id, count(*)::integer as message_count
  from public.session_messages group by session_id
) counts where sessions.session_id = counts.session_id;

alter table public.sessions drop constraint if exists sessions_message_count_non_negative;
alter table public.sessions add constraint sessions_message_count_non_negative check (message_count >= 0);
alter table public.sessions drop constraint if exists sessions_version_positive;
alter table public.sessions add constraint sessions_version_positive check (session_version >= 1);

create index if not exists sessions_owner_cursor_idx
  on public.sessions(owner_user_id, updated_at desc, session_id asc)
  include (repository_owner, repository_name, title, created_at, message_count);

create or replace function public.touch_session_after_message()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  update public.sessions set
    updated_at = greatest(updated_at, new.created_at),
    message_count = message_count + 1,
    session_version = session_version + 1
  where session_id = new.session_id;
  return new;
end; $$;

create table if not exists public.session_turn_idempotency (
  session_id text not null references public.sessions(session_id) on delete cascade,
  owner_user_id text not null,
  idempotency_key text not null,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key(session_id, owner_user_id, idempotency_key),
  constraint session_turn_idempotency_owner_non_empty check (btrim(owner_user_id) <> ''),
  constraint session_turn_idempotency_key_length check (length(idempotency_key) between 1 and 200),
  constraint session_turn_idempotency_hash_sha256 check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint session_turn_idempotency_response_object check (jsonb_typeof(response) = 'object'),
  constraint session_turn_idempotency_expiry check (expires_at > created_at)
);

create index if not exists session_turn_idempotency_expiry_idx
  on public.session_turn_idempotency(expires_at);
alter table public.session_turn_idempotency enable row level security;
revoke all on table public.session_turn_idempotency from public, anon, authenticated;
grant select, insert, update, delete on table public.session_turn_idempotency to service_role;

create or replace function public.list_session_summaries(
  input_owner_user_id text,
  input_cursor_updated_at timestamptz,
  input_cursor_session_id text,
  input_page_size integer,
  input_statement_timeout_ms integer default 15000
)
returns table(
  session_id text, owner_user_id text, repository_owner text,
  repository_name text, title text, created_at timestamptz,
  updated_at timestamptz, message_count integer
)
language plpgsql security invoker set search_path = public as $$
begin
  if input_page_size < 1 or input_page_size > 1001 then
    raise check_violation using message = 'invalid_session_page_size';
  end if;
  perform set_config('statement_timeout', input_statement_timeout_ms::text || 'ms', true);
  return query select
    sessions.session_id, sessions.owner_user_id, sessions.repository_owner,
    sessions.repository_name, sessions.title, sessions.created_at,
    sessions.updated_at, sessions.message_count
  from public.sessions sessions
  where sessions.owner_user_id = input_owner_user_id
    and (
      input_cursor_updated_at is null
      or sessions.updated_at < input_cursor_updated_at
      or (
        sessions.updated_at = input_cursor_updated_at
        and sessions.session_id > input_cursor_session_id
      )
    )
  order by sessions.updated_at desc, sessions.session_id asc
  limit input_page_size;
end; $$;

create or replace function public.get_session_turn_idempotency(
  input_session_id text,
  input_owner_user_id text,
  input_idempotency_key text,
  input_payload_hash text,
  input_statement_timeout_ms integer default 15000
)
returns table(response jsonb)
language plpgsql security invoker set search_path = public as $$
declare stored public.session_turn_idempotency%rowtype;
begin
  if length(input_idempotency_key) not between 1 and 200
    or input_payload_hash !~ '^[0-9a-f]{64}$' then
    raise check_violation using message = 'invalid_session_turn_lookup';
  end if;
  perform set_config('statement_timeout', input_statement_timeout_ms::text || 'ms', true);
  if not exists (
    select 1 from public.sessions sessions
    where sessions.session_id = input_session_id
      and sessions.owner_user_id = input_owner_user_id
  ) then return; end if;
  select * into stored from public.session_turn_idempotency turns
    where turns.session_id = input_session_id
      and turns.owner_user_id = input_owner_user_id
      and turns.idempotency_key = input_idempotency_key
      and turns.expires_at > now();
  if not found then return; end if;
  if stored.payload_hash <> input_payload_hash then
    raise unique_violation using message = 'session_turn_idempotency_conflict';
  end if;
  return query select stored.response;
end; $$;

create or replace function public.commit_session_turn(
  input_session_id text,
  input_owner_user_id text,
  input_idempotency_key text,
  input_payload_hash text,
  input_user_message jsonb,
  input_assistant_message jsonb,
  input_selected_context jsonb,
  input_response jsonb,
  input_updated_at timestamptz,
  input_expected_version bigint,
  input_retention_ms bigint,
  input_statement_timeout_ms integer default 15000
)
returns table(response jsonb, replayed boolean)
language plpgsql security invoker set search_path = public as $$
declare session_row public.sessions%rowtype;
declare stored public.session_turn_idempotency%rowtype;
begin
  if length(input_idempotency_key) not between 1 and 200
    or input_payload_hash !~ '^[0-9a-f]{64}$'
    or input_retention_ms not between 60000 and 2592000000
    or jsonb_typeof(input_user_message) <> 'object'
    or jsonb_typeof(input_assistant_message) <> 'object'
    or jsonb_typeof(input_selected_context) <> 'array'
    or jsonb_typeof(input_response) <> 'object'
  then
    raise check_violation using message = 'invalid_session_turn_input';
  end if;
  perform set_config('statement_timeout', input_statement_timeout_ms::text || 'ms', true);
  perform set_config('lock_timeout', input_statement_timeout_ms::text || 'ms', true);
  select * into session_row from public.sessions sessions
    where sessions.session_id = input_session_id for update;
  if not found or session_row.owner_user_id <> input_owner_user_id then
    raise no_data_found using message = 'session_not_found';
  end if;
  if input_expected_version is not null and session_row.session_version <> input_expected_version then
    raise serialization_failure using message = 'session_concurrency_conflict';
  end if;
  delete from public.session_turn_idempotency turns
    where turns.session_id = input_session_id
      and turns.owner_user_id = input_owner_user_id
      and turns.idempotency_key = input_idempotency_key
      and turns.expires_at <= now();
  select * into stored from public.session_turn_idempotency turns
    where turns.session_id = input_session_id
      and turns.owner_user_id = input_owner_user_id
      and turns.idempotency_key = input_idempotency_key
    for update;
  if found then
    if stored.payload_hash <> input_payload_hash then
      raise unique_violation using message = 'session_turn_idempotency_conflict';
    end if;
    return query select stored.response, true;
    return;
  end if;

  insert into public.session_messages(
    message_id, session_id, role, content, citations,
    evidence, retrieval_metadata, created_at
  ) values (
    input_user_message->>'message_id', input_session_id, 'user',
    input_user_message->>'content', coalesce(input_user_message->'citations', '[]'::jsonb),
    nullif(input_user_message->'evidence', 'null'::jsonb),
    nullif(input_user_message->'retrieval_metadata', 'null'::jsonb),
    (input_user_message->>'created_at')::timestamptz
  );
  insert into public.session_messages(
    message_id, session_id, role, content, citations,
    evidence, retrieval_metadata, created_at
  ) values (
    input_assistant_message->>'message_id', input_session_id, 'assistant',
    input_assistant_message->>'content', coalesce(input_assistant_message->'citations', '[]'::jsonb),
    nullif(input_assistant_message->'evidence', 'null'::jsonb),
    nullif(input_assistant_message->'retrieval_metadata', 'null'::jsonb),
    (input_assistant_message->>'created_at')::timestamptz
  );
  update public.sessions set selected_context = input_selected_context,
    updated_at = greatest(updated_at, input_updated_at),
    session_version = session_version + 1
    where session_id = input_session_id;
  insert into public.session_turn_idempotency(
    session_id, owner_user_id, idempotency_key, payload_hash, response, expires_at
  ) values (
    input_session_id, input_owner_user_id, input_idempotency_key,
    input_payload_hash, input_response,
    now() + make_interval(secs => input_retention_ms::double precision / 1000.0)
  );
  return query select input_response, false;
end; $$;

create or replace function public.cleanup_session_turn_idempotency(
  input_statement_timeout_ms integer default 15000
)
returns bigint language plpgsql security invoker set search_path = public as $$
declare removed bigint;
begin
  perform set_config('statement_timeout', input_statement_timeout_ms::text || 'ms', true);
  with deleted as (
    delete from public.session_turn_idempotency where expires_at <= now() returning 1
  ) select count(*) into removed from deleted;
  return removed;
end; $$;

create or replace function public.verify_session_persistence_contract(
  input_statement_timeout_ms integer default 15000
)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  perform set_config('statement_timeout', input_statement_timeout_ms::text || 'ms', true);
  return to_regclass('public.session_turn_idempotency') is not null
    and to_regprocedure('public.list_session_summaries(text,timestamptz,text,integer,integer)') is not null
    and to_regprocedure('public.commit_session_turn(text,text,text,text,jsonb,jsonb,jsonb,jsonb,timestamptz,bigint,bigint,integer)') is not null
    and to_regprocedure('public.cleanup_session_turn_idempotency(integer)') is not null;
end; $$;

revoke all on function public.list_session_summaries(text,timestamptz,text,integer,integer) from public, anon, authenticated;
revoke all on function public.get_session_turn_idempotency(text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.commit_session_turn(text,text,text,text,jsonb,jsonb,jsonb,jsonb,timestamptz,bigint,bigint,integer) from public, anon, authenticated;
revoke all on function public.cleanup_session_turn_idempotency(integer) from public, anon, authenticated;
revoke all on function public.verify_session_persistence_contract(integer) from public, anon, authenticated;
grant execute on function public.list_session_summaries(text,timestamptz,text,integer,integer) to service_role;
grant execute on function public.get_session_turn_idempotency(text,text,text,text,integer) to service_role;
grant execute on function public.commit_session_turn(text,text,text,text,jsonb,jsonb,jsonb,jsonb,timestamptz,bigint,bigint,integer) to service_role;
grant execute on function public.cleanup_session_turn_idempotency(integer) to service_role;
grant execute on function public.verify_session_persistence_contract(integer) to service_role;
