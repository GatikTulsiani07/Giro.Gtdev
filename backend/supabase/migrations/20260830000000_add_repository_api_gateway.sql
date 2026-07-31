create table if not exists public.repository_api_gateway_cache (
  cache_key text primary key,
  schema_version text not null,
  owner_id text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  ownership_fingerprint text not null,
  service text not null,
  request_fingerprint text not null,
  status text not null,
  payload jsonb not null,
  diagnostics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  last_accessed_at timestamptz not null,
  hit_count bigint not null default 0,
  constraint repository_api_gateway_cache_snapshot_fk
    foreign key(repository_id,repository_revision)
    references public.repository_snapshots(repository_id,revision)
    on delete cascade,
  constraint repository_api_gateway_cache_schema_valid check(
    schema_version='repository-api-gateway-schema-v1'
  ),
  constraint repository_api_gateway_cache_service_valid check(service in(
    'repository-overview','repository-query','repository-insights',
    'feature-navigation','semantic-navigation','change-impact',
    'task-planning','engineering-specification',
    'execution-coordination','repository-evolution'
  )),
  constraint repository_api_gateway_cache_status_valid
    check(status in('ok','partial')),
  constraint repository_api_gateway_cache_values_valid check(
    cache_key<>'' and owner_id<>'' and repository_id<>''
    and repository_revision~'^[0-9a-f]{40}$'
    and ownership_fingerprint<>'' and request_fingerprint<>''
    and jsonb_typeof(diagnostics)='array' and hit_count>=0
  )
);

create index if not exists repository_api_gateway_cache_lookup_idx
  on public.repository_api_gateway_cache(
    owner_id,repository_id,repository_revision,service,request_fingerprint
  );
create index if not exists repository_api_gateway_cache_access_idx
  on public.repository_api_gateway_cache(last_accessed_at);

create table if not exists public.repository_api_gateway_metric_events (
  metric_id bigint generated always as identity primary key,
  owner_id text not null,
  endpoint text not null,
  service text not null,
  latency_ms double precision not null,
  cache_hit boolean not null,
  failed boolean not null,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint repository_api_gateway_metric_endpoint_valid check(endpoint in(
    'repository-overview','repository-query','repository-insights',
    'feature-navigation','semantic-navigation','change-impact',
    'task-planning','engineering-specification',
    'execution-coordination','repository-evolution'
  )),
  constraint repository_api_gateway_metric_service_valid check(service in(
    'repository-overview','repository-query','repository-insights',
    'feature-navigation','semantic-navigation','change-impact',
    'task-planning','engineering-specification',
    'execution-coordination','repository-evolution'
  )),
  constraint repository_api_gateway_metric_values_valid check(
    owner_id<>'' and latency_ms>=0
  )
);

create index if not exists repository_api_gateway_metrics_owner_idx
  on public.repository_api_gateway_metric_events(owner_id,recorded_at);
create index if not exists repository_api_gateway_metrics_service_idx
  on public.repository_api_gateway_metric_events(service,recorded_at);

alter table public.repository_api_gateway_cache enable row level security;
alter table public.repository_api_gateway_metric_events enable row level security;
revoke all on public.repository_api_gateway_cache from anon, authenticated;
revoke all on public.repository_api_gateway_metric_events from anon, authenticated;
grant select,insert,update,delete on public.repository_api_gateway_cache
  to service_role;
grant select,insert,update,delete on public.repository_api_gateway_metric_events
  to service_role;
grant usage,select on sequence
  public.repository_api_gateway_metric_events_metric_id_seq to service_role;

create or replace function public.get_repository_api_gateway_cache(
  input_cache_key text,
  input_ownership_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  item public.repository_api_gateway_cache%rowtype;
begin
  update public.repository_api_gateway_cache cache
  set last_accessed_at=clock_timestamp(),hit_count=cache.hit_count+1
  from public.repositories repository
  where cache.cache_key=input_cache_key
    and cache.ownership_fingerprint=input_ownership_fingerprint
    and repository.repository_id=cache.repository_id
    and repository.owner_user_id=cache.owner_id
    and repository.deletion_state='active'
    and repository.current_revision=cache.repository_revision
    and repository.indexed_revision=cache.repository_revision
  returning cache.* into item;
  if item.cache_key is null then return null; end if;
  return jsonb_build_object(
    'cacheKey',item.cache_key,
    'schemaVersion',item.schema_version,
    'ownerId',item.owner_id,
    'repositoryId',item.repository_id,
    'repositoryRevision',item.repository_revision,
    'ownershipFingerprint',item.ownership_fingerprint,
    'service',item.service,
    'requestFingerprint',item.request_fingerprint,
    'status',item.status,
    'payload',item.payload,
    'diagnostics',item.diagnostics,
    'createdAt',to_jsonb(to_char(item.created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'lastAccessedAt',to_jsonb(to_char(item.last_accessed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'hitCount',item.hit_count
  );
end
$$;

create or replace function public.put_repository_api_gateway_cache(
  input_record jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  saved public.repository_api_gateway_cache%rowtype;
begin
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=input_record->>'repositoryId'
      and repository.owner_user_id=input_record->>'ownerId'
      and repository.deletion_state='active'
      and repository.current_revision=input_record->>'repositoryRevision'
      and repository.indexed_revision=input_record->>'repositoryRevision'
  ) then
    raise exception 'repository_api_gateway_fence_invalid';
  end if;
  insert into public.repository_api_gateway_cache(
    cache_key,schema_version,owner_id,repository_id,repository_revision,
    ownership_fingerprint,service,request_fingerprint,status,payload,
    diagnostics,created_at,last_accessed_at,hit_count
  ) values(
    input_record->>'cacheKey',input_record->>'schemaVersion',
    input_record->>'ownerId',input_record->>'repositoryId',
    input_record->>'repositoryRevision',
    input_record->>'ownershipFingerprint',input_record->>'service',
    input_record->>'requestFingerprint',input_record->>'status',
    input_record->'payload',input_record->'diagnostics',
    (input_record->>'createdAt')::timestamptz,
    (input_record->>'lastAccessedAt')::timestamptz,
    (input_record->>'hitCount')::bigint
  )
  on conflict(cache_key) do nothing;
  select * into saved from public.repository_api_gateway_cache
    where cache_key=input_record->>'cacheKey';
  if saved.owner_id<>input_record->>'ownerId'
      or saved.repository_id<>input_record->>'repositoryId'
      or saved.repository_revision<>input_record->>'repositoryRevision'
      or saved.ownership_fingerprint<>input_record->>'ownershipFingerprint'
      or saved.request_fingerprint<>input_record->>'requestFingerprint' then
    raise exception 'repository_api_gateway_cache_identity_conflict';
  end if;
  return jsonb_build_object(
    'cacheKey',saved.cache_key,
    'schemaVersion',saved.schema_version,
    'ownerId',saved.owner_id,
    'repositoryId',saved.repository_id,
    'repositoryRevision',saved.repository_revision,
    'ownershipFingerprint',saved.ownership_fingerprint,
    'service',saved.service,
    'requestFingerprint',saved.request_fingerprint,
    'status',saved.status,
    'payload',saved.payload,
    'diagnostics',saved.diagnostics,
    'createdAt',to_jsonb(to_char(saved.created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'lastAccessedAt',to_jsonb(to_char(saved.last_accessed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'hitCount',saved.hit_count
  );
end
$$;

create or replace function public.record_repository_api_gateway_metric(
  input_sample jsonb
) returns void
language sql
security definer
set search_path=public,pg_temp
as $$
  insert into public.repository_api_gateway_metric_events(
    owner_id,endpoint,service,latency_ms,cache_hit,failed
  ) values(
    input_sample->>'ownerId',
    input_sample->>'endpoint',
    input_sample->>'service',
    (input_sample->>'latencyMs')::double precision,
    (input_sample->>'cacheHit')::boolean,
    (input_sample->>'failed')::boolean
  )
$$;

create or replace function public.repository_api_gateway_metrics(
  input_owner_id text default null
) returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  with selected as (
    select * from public.repository_api_gateway_metric_events
    where input_owner_id is null or owner_id=input_owner_id
  ), endpoint_usage as (
    select coalesce(jsonb_object_agg(endpoint,total),'{}'::jsonb) value
    from (select endpoint,count(*) total from selected group by endpoint) data
  ), service_distribution as (
    select coalesce(jsonb_object_agg(service,total),'{}'::jsonb) value
    from (select service,count(*) total from selected group by service) data
  )
  select jsonb_build_object(
    'endpointUsage',(select value from endpoint_usage),
    'serviceDistribution',(select value from service_distribution),
    'totalLatencyMs',coalesce(sum(latency_ms),0),
    'cacheHits',count(*) filter(where cache_hit),
    'failures',count(*) filter(where failed)
  ) from selected
$$;

create or replace function public.recover_repository_api_gateway_cache()
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare removed integer;
begin
  delete from public.repository_api_gateway_cache cache
  where cache.schema_version<>'repository-api-gateway-schema-v1'
    or not exists(
      select 1 from public.repositories repository
      where repository.repository_id=cache.repository_id
        and repository.owner_user_id=cache.owner_id
        and repository.deletion_state='active'
        and repository.current_revision=cache.repository_revision
        and repository.indexed_revision=cache.repository_revision
    );
  get diagnostics removed=row_count;
  return removed;
end
$$;

create or replace function public.verify_repository_api_gateway_contract()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  with required_functions(name) as (values
    ('get_repository_api_gateway_cache'),
    ('put_repository_api_gateway_cache'),
    ('record_repository_api_gateway_metric'),
    ('repository_api_gateway_metrics'),
    ('recover_repository_api_gateway_cache'),
    ('verify_repository_api_gateway_contract')
  ), required_indexes(name) as (values
    ('repository_api_gateway_cache_pkey'),
    ('repository_api_gateway_cache_lookup_idx'),
    ('repository_api_gateway_cache_access_idx'),
    ('repository_api_gateway_metric_events_pkey'),
    ('repository_api_gateway_metrics_owner_idx'),
    ('repository_api_gateway_metrics_service_idx')
  ), failures as (
    select 'function:'||name failure from required_functions
    where not exists(
      select 1 from pg_proc procedure
      join pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='public' and procedure.proname=name
    )
    union all
    select 'index:'||name from required_indexes
    where to_regclass('public.'||name) is null
    union all
    select 'table:repository_api_gateway_cache'
    where to_regclass('public.repository_api_gateway_cache') is null
    union all
    select 'table:repository_api_gateway_metric_events'
    where to_regclass('public.repository_api_gateway_metric_events') is null
    union all
    select 'rls:repository_api_gateway_cache'
    where not coalesce((select relrowsecurity from pg_class
      where oid='public.repository_api_gateway_cache'::regclass),false)
    union all
    select 'rls:repository_api_gateway_metric_events'
    where not coalesce((select relrowsecurity from pg_class
      where oid='public.repository_api_gateway_metric_events'::regclass),false)
  )
  select jsonb_build_object(
    'valid',not exists(select 1 from failures),
    'schemaVersion','repository-api-gateway-schema-v1',
    'routes',10,
    'indexes',6,
    'metricsRegistered',true,
    'failures',coalesce((select jsonb_agg(failure order by failure)
      from failures),'[]'::jsonb)
  )
$$;

revoke all on function public.get_repository_api_gateway_cache(text,text)
  from public;
revoke all on function public.put_repository_api_gateway_cache(jsonb)
  from public;
revoke all on function public.record_repository_api_gateway_metric(jsonb)
  from public;
revoke all on function public.repository_api_gateway_metrics(text)
  from public;
revoke all on function public.recover_repository_api_gateway_cache()
  from public;
revoke all on function public.verify_repository_api_gateway_contract()
  from public;
grant execute on function public.get_repository_api_gateway_cache(text,text)
  to service_role;
grant execute on function public.put_repository_api_gateway_cache(jsonb)
  to service_role;
grant execute on function public.record_repository_api_gateway_metric(jsonb)
  to service_role;
grant execute on function public.repository_api_gateway_metrics(text)
  to service_role;
grant execute on function public.recover_repository_api_gateway_cache()
  to service_role;
grant execute on function public.verify_repository_api_gateway_contract()
  to service_role;
