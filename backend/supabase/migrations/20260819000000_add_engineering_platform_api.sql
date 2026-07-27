create table if not exists public.engineering_api_idempotency (
  record_id text primary key,
  owner_id text not null,
  route text not null,
  target text not null,
  idempotency_key text not null,
  payload_hash text not null,
  status integer not null,
  response jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  constraint engineering_api_idempotency_identity_unique
    unique(owner_id,route,target,idempotency_key),
  constraint engineering_api_idempotency_hash_valid
    check(payload_hash~'^[0-9a-f]{64}$'),
  constraint engineering_api_idempotency_status_valid
    check(status between 200 and 299),
  constraint engineering_api_idempotency_response_object
    check(jsonb_typeof(response)='object'),
  constraint engineering_api_idempotency_expiry_valid
    check(expires_at>created_at)
);

create index if not exists engineering_api_idempotency_expiry_idx
  on public.engineering_api_idempotency(expires_at,record_id);
create index if not exists engineering_api_idempotency_owner_idx
  on public.engineering_api_idempotency(owner_id,created_at desc,record_id);

create table if not exists public.engineering_api_retention (
  policy_id text primary key,
  idempotency_days integer not null,
  updated_at timestamptz not null,
  constraint engineering_api_retention_days_positive
    check(idempotency_days between 1 and 365)
);
insert into public.engineering_api_retention(
  policy_id,idempotency_days,updated_at
) values('default',30,now())
on conflict(policy_id) do nothing;

create or replace function public.get_engineering_api_idempotency(
  input_owner_id text,
  input_route text,
  input_target text,
  input_idempotency_key text
) returns table(record jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'recordId',candidate.record_id,
    'ownerId',candidate.owner_id,
    'route',candidate.route,
    'target',candidate.target,
    'idempotencyKey',candidate.idempotency_key,
    'payloadHash',candidate.payload_hash,
    'status',candidate.status,
    'response',candidate.response,
    'createdAt',to_char(
      candidate.created_at at time zone 'utc',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'expiresAt',to_char(
      candidate.expires_at at time zone 'utc',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  )
  from public.engineering_api_idempotency candidate
  where candidate.owner_id=input_owner_id
    and candidate.route=input_route
    and candidate.target=input_target
    and candidate.idempotency_key=input_idempotency_key
    and candidate.expires_at>now()
  limit 1
$$;

create or replace function public.put_engineering_api_idempotency(
  input_record jsonb
) returns table(record jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.engineering_api_idempotency%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    (input_record->>'ownerId')||'|'||(input_record->>'route')||'|'||
    (input_record->>'target')||'|'||(input_record->>'idempotencyKey'),0
  ));
  select * into existing
  from public.engineering_api_idempotency candidate
  where candidate.owner_id=input_record->>'ownerId'
    and candidate.route=input_record->>'route'
    and candidate.target=input_record->>'target'
    and candidate.idempotency_key=input_record->>'idempotencyKey'
  for update;
  if found then
    if existing.payload_hash<>input_record->>'payloadHash' then
      raise serialization_failure using message=
        'engineering_api_idempotency_conflict';
    end if;
    return query select jsonb_build_object(
        'recordId',existing.record_id,
        'ownerId',existing.owner_id,
        'route',existing.route,
        'target',existing.target,
        'idempotencyKey',existing.idempotency_key,
        'payloadHash',existing.payload_hash,
        'status',existing.status,
        'response',existing.response,
        'createdAt',existing.created_at,
        'expiresAt',existing.expires_at
      );
    return;
  end if;
  insert into public.engineering_api_idempotency(
    record_id,owner_id,route,target,idempotency_key,payload_hash,
    status,response,created_at,expires_at
  ) values(
    input_record->>'recordId',input_record->>'ownerId',
    input_record->>'route',input_record->>'target',
    input_record->>'idempotencyKey',input_record->>'payloadHash',
    (input_record->>'status')::integer,input_record->'response',
    (input_record->>'createdAt')::timestamptz,
    (input_record->>'expiresAt')::timestamptz
  );
  return query select input_record;
end $$;

create or replace function public.list_autonomous_workflows(
  input_tenant_id text,input_owner_id text
) returns table(workflows jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(candidate.state order by
    candidate.updated_at desc,candidate.workflow_id),'[]'::jsonb)
  from public.autonomous_workflows candidate
  where candidate.tenant_id=input_tenant_id
    and candidate.owner_id=input_owner_id
$$;

create or replace function public.collect_engineering_api_idempotency(
  input_limit integer default 1000
) returns table(removed integer)
language plpgsql security invoker set search_path=public as $$
declare count_removed integer;
begin
  with doomed as (
    select record_id from public.engineering_api_idempotency
    where expires_at<=now()
    order by expires_at,record_id
    limit greatest(1,least(input_limit,10000))
    for update skip locked
  )
  delete from public.engineering_api_idempotency candidate
  using doomed where candidate.record_id=doomed.record_id;
  get diagnostics count_removed=row_count;
  return query select count_removed;
end $$;

create or replace function public.verify_engineering_platform_api_contract()
returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  foreach object_name in array array[
    'engineering_api_idempotency','engineering_api_retention',
    'autonomous_workflows'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity)
    then issues:=issues||to_jsonb(object_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='engineering_api_idempotency_expiry_idx')
    or not exists(select 1 from pg_constraint
      where conname='engineering_api_idempotency_identity_unique')
    or to_regprocedure(
      'public.collect_engineering_api_idempotency(integer)') is null
  then issues:=issues||'"engineering_api_contract_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.engineering_api_idempotency','select')
    or has_table_privilege(
      'anon','public.engineering_api_idempotency','select')
    or not has_function_privilege(
      'service_role',
      'public.put_engineering_api_idempotency(jsonb)','execute')
    or has_function_privilege(
      'anon','public.put_engineering_api_idempotency(jsonb)','execute')
  then issues:=issues||'"engineering_api_grants_invalid"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end $$;

alter table public.engineering_api_idempotency enable row level security;
alter table public.engineering_api_retention enable row level security;
revoke all on table public.engineering_api_idempotency
  from public,anon,authenticated;
revoke all on table public.engineering_api_retention
  from public,anon,authenticated;
grant select,insert,update,delete
  on table public.engineering_api_idempotency to service_role;
grant select,insert,update,delete
  on table public.engineering_api_retention to service_role;

revoke all on function public.get_engineering_api_idempotency(
  text,text,text,text
) from public,anon,authenticated;
revoke all on function public.put_engineering_api_idempotency(jsonb)
  from public,anon,authenticated;
revoke all on function public.list_autonomous_workflows(text,text)
  from public,anon,authenticated;
revoke all on function public.collect_engineering_api_idempotency(integer)
  from public,anon,authenticated;
revoke all on function public.verify_engineering_platform_api_contract()
  from public,anon,authenticated;
grant execute on function public.get_engineering_api_idempotency(
  text,text,text,text
) to service_role;
grant execute on function public.put_engineering_api_idempotency(jsonb)
  to service_role;
grant execute on function public.list_autonomous_workflows(text,text)
  to service_role;
grant execute on function public.collect_engineering_api_idempotency(integer)
  to service_role;
grant execute on function public.verify_engineering_platform_api_contract()
  to service_role;
