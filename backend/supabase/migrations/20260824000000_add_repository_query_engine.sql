create table if not exists public.repository_queries (
  tenant_id text not null,
  query_id text not null,
  user_id text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  workflow_id text,
  session_id text,
  schema_version text not null,
  persistence_version bigint not null,
  original_query text not null,
  normalized_query text not null,
  intents jsonb not null,
  confidence double precision not null,
  lifecycle text not null,
  execution jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key(tenant_id,query_id),
  constraint repository_query_identity_non_empty check(
    tenant_id<>'' and query_id<>'' and user_id<>'' and repository_id<>''
    and original_query<>'' and normalized_query<>''
  ),
  constraint repository_query_revision_valid
    check(repository_revision~'^[0-9a-f]{40}$'),
  constraint repository_query_schema_valid
    check(schema_version='repository-query-schema-v1'),
  constraint repository_query_intents_array
    check(jsonb_typeof(intents)='array' and jsonb_array_length(intents)>0),
  constraint repository_query_confidence_valid check(confidence between 0 and 1),
  constraint repository_query_lifecycle_valid check(lifecycle in(
    'planning','running','completed','partial','failed'
  )),
  constraint repository_query_execution_object check(jsonb_typeof(execution)='object')
);

create table if not exists public.repository_query_plans (
  tenant_id text not null,
  query_id text not null,
  plan_id text not null,
  step_count integer not null,
  plan jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,plan_id),
  unique(tenant_id,query_id),
  constraint repository_query_plan_query_fk foreign key(tenant_id,query_id)
    references public.repository_queries(tenant_id,query_id) on delete cascade,
  constraint repository_query_plan_valid check(
    plan_id<>'' and step_count>=0 and jsonb_typeof(plan)='object'
  )
);

create table if not exists public.repository_query_cached_responses (
  tenant_id text not null,
  query_id text not null,
  plan_id text not null,
  repository_revision text not null,
  owner_id text not null,
  response jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(tenant_id,query_id),
  constraint repository_query_cache_query_fk foreign key(tenant_id,query_id)
    references public.repository_queries(tenant_id,query_id) on delete cascade,
  constraint repository_query_cache_plan_fk foreign key(tenant_id,plan_id)
    references public.repository_query_plans(tenant_id,plan_id) on delete cascade,
  constraint repository_query_cache_revision_valid
    check(repository_revision~'^[0-9a-f]{40}$'),
  constraint repository_query_cache_owner_non_empty check(owner_id<>''),
  constraint repository_query_cache_response_object
    check(jsonb_typeof(response)='object')
);

create table if not exists public.repository_query_diagnostics (
  tenant_id text not null,
  query_id text not null,
  diagnostic_position integer not null,
  code text not null,
  severity text not null,
  engine text,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,query_id,diagnostic_position),
  constraint repository_query_diagnostic_query_fk foreign key(tenant_id,query_id)
    references public.repository_queries(tenant_id,query_id) on delete cascade,
  constraint repository_query_diagnostic_position_valid
    check(diagnostic_position>=0),
  constraint repository_query_diagnostic_severity_valid
    check(severity in('info','warning','error')),
  constraint repository_query_diagnostic_object
    check(jsonb_typeof(diagnostic)='object')
);

create table if not exists public.repository_query_metrics (
  tenant_id text not null,
  query_id text not null,
  cache_hits bigint not null default 0,
  latency_ms double precision not null default 0,
  engine_usage jsonb not null,
  intents jsonb not null,
  confidence double precision not null,
  recovery_count bigint not null default 0,
  updated_at timestamptz not null,
  primary key(tenant_id,query_id),
  constraint repository_query_metric_query_fk foreign key(tenant_id,query_id)
    references public.repository_queries(tenant_id,query_id) on delete cascade,
  constraint repository_query_metric_values_valid check(
    cache_hits>=0 and latency_ms>=0 and confidence between 0 and 1
    and recovery_count>=0
  ),
  constraint repository_query_metric_arrays_valid check(
    jsonb_typeof(engine_usage)='array' and jsonb_typeof(intents)='array'
  )
);

create table if not exists public.repository_query_retention (
  tenant_id text primary key,
  retained_queries integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_query_retention_positive check(retained_queries>0)
);

create index if not exists repository_queries_cache_lookup_idx
  on public.repository_queries(
    tenant_id,user_id,repository_id,repository_revision,normalized_query
  ) where lifecycle='completed';
create index if not exists repository_queries_revision_idx
  on public.repository_queries(tenant_id,repository_id,repository_revision,updated_at desc);
create index if not exists repository_queries_recovery_idx
  on public.repository_queries(lifecycle,updated_at)
  where lifecycle in('planning','running');
create index if not exists repository_query_plans_query_idx
  on public.repository_query_plans(tenant_id,query_id,created_at desc);
create index if not exists repository_query_cache_revision_idx
  on public.repository_query_cached_responses(
    tenant_id,owner_id,repository_revision,updated_at desc
  );
create index if not exists repository_query_diagnostics_code_idx
  on public.repository_query_diagnostics(tenant_id,code,severity,created_at desc);
create index if not exists repository_query_metrics_usage_idx
  on public.repository_query_metrics using gin(engine_usage);

create or replace function public.get_repository_query(
  input_tenant_id text,input_user_id text,input_query_id text
) returns table(execution jsonb)
language sql stable security invoker set search_path=public as $$
  select query.execution
  from public.repository_queries query
  where query.tenant_id=input_tenant_id
    and query.query_id=input_query_id
    and query.user_id=input_user_id
$$;

create or replace function public.save_repository_query(
  input_execution jsonb,input_expected_version text
) returns table(execution jsonb)
language plpgsql security invoker set search_path=public as $$
declare query_value jsonb:=input_execution->'query';
declare plan_value jsonb:=input_execution->'plan';
declare tenant_value text:=query_value->>'tenantId';
declare query_id_value text:=query_value->>'queryId';
declare existing public.repository_queries%rowtype;
declare saved_execution jsonb;
declare diagnostic_value jsonb;
declare diagnostic_position integer:=0;
begin
  if jsonb_typeof(input_execution)<>'object'
    or jsonb_typeof(query_value)<>'object'
    or jsonb_typeof(plan_value)<>'object'
    or jsonb_typeof(input_execution->'diagnostics')<>'array'
    or jsonb_typeof(input_execution->'engineUsage')<>'array'
    or query_value->>'schemaVersion'<>'repository-query-schema-v1' then
    raise check_violation using message='repository_query_state_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=query_value->>'repositoryId'
      and repository.owner_user_id=query_value->>'userId'
      and repository.current_revision=query_value->>'repositoryRevision'
      and repository.indexed_revision=query_value->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation using message='repository_query_ownership_or_revision_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    tenant_value||'|'||query_id_value,0
  ));
  select * into existing from public.repository_queries query
  where query.tenant_id=tenant_value and query.query_id=query_id_value
  for update;
  if found and input_expected_version is not null
    and existing.persistence_version<>input_expected_version::bigint then
    raise serialization_failure using message='repository_query_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure using message='repository_query_version_conflict';
  end if;
  if found and existing.user_id<>query_value->>'userId' then
    raise insufficient_privilege using message='repository_query_access_denied';
  end if;
  saved_execution:=jsonb_set(
    input_execution,'{query,persistenceVersion}',
    to_jsonb(coalesce(existing.persistence_version+1,1))
  );
  insert into public.repository_queries(
    tenant_id,query_id,user_id,repository_id,repository_revision,
    workflow_id,session_id,schema_version,persistence_version,
    original_query,normalized_query,intents,confidence,lifecycle,execution,
    created_at,updated_at,completed_at
  ) values(
    tenant_value,query_id_value,query_value->>'userId',
    query_value->>'repositoryId',query_value->>'repositoryRevision',
    nullif(query_value->>'workflowId',''),nullif(query_value->>'sessionId',''),
    query_value->>'schemaVersion',coalesce(existing.persistence_version+1,1),
    query_value->>'originalQuery',query_value->>'normalizedQuery',
    query_value->'intents',(query_value->>'confidence')::double precision,
    query_value->>'lifecycle',saved_execution,
    (query_value->>'createdAt')::timestamptz,
    (query_value->>'updatedAt')::timestamptz,
    nullif(query_value->>'completedAt','')::timestamptz
  ) on conflict(tenant_id,query_id) do update set
    persistence_version=excluded.persistence_version,
    lifecycle=excluded.lifecycle,execution=excluded.execution,
    updated_at=excluded.updated_at,completed_at=excluded.completed_at;

  insert into public.repository_query_plans(
    tenant_id,query_id,plan_id,step_count,plan,created_at
  ) values(
    tenant_value,query_id_value,plan_value->>'planId',
    jsonb_array_length(plan_value->'steps'),plan_value,
    (query_value->>'createdAt')::timestamptz
  ) on conflict(tenant_id,query_id) do update set
    plan_id=excluded.plan_id,step_count=excluded.step_count,plan=excluded.plan;

  delete from public.repository_query_diagnostics
    where tenant_id=tenant_value and query_id=query_id_value;
  for diagnostic_value in
    select value from jsonb_array_elements(input_execution->'diagnostics')
  loop
    insert into public.repository_query_diagnostics(
      tenant_id,query_id,diagnostic_position,code,severity,engine,
      diagnostic,created_at
    ) values(
      tenant_value,query_id_value,diagnostic_position,
      diagnostic_value->>'code',diagnostic_value->>'severity',
      diagnostic_value->>'engine',diagnostic_value,
      (query_value->>'updatedAt')::timestamptz
    );
    diagnostic_position:=diagnostic_position+1;
  end loop;

  if input_execution->'response' is not null
    and input_execution->'response'<>'null'::jsonb
    and query_value->>'lifecycle' in('completed','partial') then
    insert into public.repository_query_cached_responses(
      tenant_id,query_id,plan_id,repository_revision,owner_id,response,
      created_at,updated_at
    ) values(
      tenant_value,query_id_value,plan_value->>'planId',
      query_value->>'repositoryRevision',query_value->>'userId',
      input_execution->'response',(query_value->>'createdAt')::timestamptz,
      (query_value->>'updatedAt')::timestamptz
    ) on conflict(tenant_id,query_id) do update set
      plan_id=excluded.plan_id,repository_revision=excluded.repository_revision,
      owner_id=excluded.owner_id,response=excluded.response,
      updated_at=excluded.updated_at;
  else
    delete from public.repository_query_cached_responses
      where tenant_id=tenant_value and query_id=query_id_value;
  end if;

  insert into public.repository_query_metrics(
    tenant_id,query_id,cache_hits,latency_ms,engine_usage,intents,
    confidence,recovery_count,updated_at
  ) values(
    tenant_value,query_id_value,coalesce((
      select cache_hits from public.repository_query_metrics
      where tenant_id=tenant_value and query_id=query_id_value
    ),0),coalesce((input_execution->>'latencyMs')::double precision,0),
    input_execution->'engineUsage',query_value->'intents',
    (query_value->>'confidence')::double precision,coalesce((
      select recovery_count from public.repository_query_metrics
      where tenant_id=tenant_value and query_id=query_id_value
    ),0),(query_value->>'updatedAt')::timestamptz
  ) on conflict(tenant_id,query_id) do update set
    latency_ms=excluded.latency_ms,engine_usage=excluded.engine_usage,
    intents=excluded.intents,confidence=excluded.confidence,
    updated_at=excluded.updated_at;
  return query select query.execution from public.repository_queries query
    where query.tenant_id=tenant_value and query.query_id=query_id_value;
end; $$;

create or replace function public.record_repository_query_cache_hit(
  input_tenant_id text,input_user_id text,input_query_id text
) returns void
language plpgsql security invoker set search_path=public as $$
begin
  update public.repository_query_metrics metric set
    cache_hits=cache_hits+1,updated_at=now()
  from public.repository_queries query
  join public.repository_query_cached_responses cache
    using(tenant_id,query_id)
  join public.repositories repository
    on repository.repository_id=query.repository_id
  where metric.tenant_id=input_tenant_id
    and metric.query_id=input_query_id
    and query.tenant_id=metric.tenant_id and query.query_id=metric.query_id
    and query.user_id=input_user_id and cache.owner_id=input_user_id
    and cache.repository_revision=query.repository_revision
    and repository.current_revision=query.repository_revision
    and repository.indexed_revision=query.repository_revision
    and query.lifecycle='completed';
  if not found then
    raise no_data_found using message='repository_query_cache_not_found';
  end if;
end; $$;

create or replace function public.recover_repository_queries()
returns table(recovered_count integer)
language plpgsql security invoker set search_path=public as $$
declare affected integer;
begin
  with invalid as(
    select query.tenant_id,query.query_id
    from public.repository_queries query
    join public.repositories repository
      on repository.repository_id=query.repository_id
    left join public.repository_query_plans plan
      using(tenant_id,query_id)
    left join public.repository_query_cached_responses cache
      using(tenant_id,query_id)
    where query.lifecycle in('planning','running')
      or plan.plan_id is null
      or (cache.query_id is not null and (
        cache.repository_revision<>query.repository_revision
        or cache.owner_id<>query.user_id
        or repository.current_revision<>query.repository_revision
        or repository.indexed_revision<>query.repository_revision
      ))
  ), updated as(
    update public.repository_queries query set
      lifecycle='failed',completed_at=now(),updated_at=now(),
      persistence_version=persistence_version+1,
      execution=jsonb_set(jsonb_set(jsonb_set(
        execution,'{query,lifecycle}','"failed"'::jsonb),
        '{query,completedAt}',to_jsonb(now()::text)),
        '{query,persistenceVersion}',to_jsonb(persistence_version+1))
    from invalid
    where query.tenant_id=invalid.tenant_id
      and query.query_id=invalid.query_id
    returning query.tenant_id,query.query_id
  )
  update public.repository_query_metrics metric set
    recovery_count=recovery_count+1,updated_at=now()
  from updated where metric.tenant_id=updated.tenant_id
    and metric.query_id=updated.query_id;
  get diagnostics affected=row_count;
  delete from public.repository_query_cached_responses cache
  using public.repository_queries query
  where cache.tenant_id=query.tenant_id and cache.query_id=query.query_id
    and query.lifecycle='failed';
  return query select affected;
end; $$;

create or replace function public.repository_query_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  with selected as(
    select * from public.repository_query_metrics metric
    where input_tenant_id is null or metric.tenant_id=input_tenant_id
  ), engines as(
    select engine.value#>>'{}' name,count(*) value
    from selected cross join lateral jsonb_array_elements(engine_usage) engine
    group by engine.value
  ), intents as(
    select intent.value#>>'{}' name,count(*) value
    from selected cross join lateral jsonb_array_elements(intents) intent
    group by intent.value
  )
  select jsonb_build_object(
    'queries',(select count(*) from selected),
    'cacheHits',coalesce((select sum(cache_hits) from selected),0),
    'averageLatencyMs',coalesce((select avg(latency_ms) from selected),0),
    'engineUsage',(select jsonb_object_agg(name,value) from engines),
    'intentDistribution',(select jsonb_object_agg(name,value) from intents),
    'confidenceDistribution',jsonb_build_object(
      'low',(select count(*) from selected where confidence<0.6),
      'medium',(select count(*) from selected where confidence>=0.6 and confidence<0.8),
      'high',(select count(*) from selected where confidence>=0.8)
    ),
    'recoveryCount',coalesce((select sum(recovery_count) from selected),0)
  )
$$;

create or replace function public.collect_repository_queries(
  input_tenant_id text,input_retained_queries integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.repository_query_retention(tenant_id,retained_queries)
  values(input_tenant_id,greatest(1,input_retained_queries))
  on conflict(tenant_id) do update set
    retained_queries=excluded.retained_queries,updated_at=now();
  with victims as(
    select query_id from public.repository_queries
    where tenant_id=input_tenant_id and lifecycle<>'running'
    order by updated_at desc,query_id desc
    offset greatest(1,input_retained_queries)
  )
  delete from public.repository_queries query using victims
  where query.tenant_id=input_tenant_id and query.query_id=victims.query_id;
  get diagnostics removed=row_count;
  return query select removed;
end; $$;

create or replace function public.verify_repository_query_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
declare engine_table text;
begin
  if input_engine_version<>'repository-query-engine-v1'
    or input_schema_version<>'repository-query-schema-v1' then
    issues:=issues||'"repository_query_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'repository_queries','repository_query_plans',
    'repository_query_cached_responses','repository_query_diagnostics',
    'repository_query_metrics','repository_query_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity) then
      issues:=issues||to_jsonb(object_name||'_rls_missing');
    end if;
  end loop;
  foreach engine_table in array array[
    'repository_intelligence_versions','semantic_graph_versions',
    'feature_graph_versions','change_analyses','repository_knowledge',
    'autonomous_workflows'
  ] loop
    if to_regclass('public.'||engine_table) is null then
      issues:=issues||to_jsonb(engine_table||'_engine_unavailable');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='repository_queries_cache_lookup_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_query_metrics_usage_idx')
    or not exists(select 1 from pg_constraint
      where conname='repository_query_plan_query_fk' and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='repository_query_cache_query_fk' and confdeltype='c') then
    issues:=issues||'"repository_query_indexes_or_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.repository_queries','select')
    or has_table_privilege('anon','public.repository_queries','select')
    or not has_function_privilege(
      'service_role','public.save_repository_query(jsonb,text)','execute')
    or has_function_privilege(
      'anon','public.save_repository_query(jsonb,text)','execute') then
    issues:=issues||'"repository_query_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure('public.collect_repository_queries(text,integer)') is null
    or to_regprocedure('public.recover_repository_queries()') is null then
    issues:=issues||'"repository_query_retention_or_recovery_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$ declare object_name text;
begin
  foreach object_name in array array[
    'repository_queries','repository_query_plans',
    'repository_query_cached_responses','repository_query_diagnostics',
    'repository_query_metrics','repository_query_retention'
  ] loop
    execute format('alter table public.%I enable row level security',object_name);
    execute format(
      'revoke all on table public.%I from public,anon,authenticated',object_name);
    execute format(
      'grant select,insert,update,delete on table public.%I to service_role',
      object_name);
  end loop;
end $$;

revoke all on function public.get_repository_query(text,text,text)
  from public,anon,authenticated;
revoke all on function public.save_repository_query(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.record_repository_query_cache_hit(text,text,text)
  from public,anon,authenticated;
revoke all on function public.recover_repository_queries()
  from public,anon,authenticated;
revoke all on function public.repository_query_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_repository_queries(text,integer)
  from public,anon,authenticated;
revoke all on function public.verify_repository_query_contract(text,text)
  from public,anon,authenticated;
grant execute on function public.get_repository_query(text,text,text)
  to service_role;
grant execute on function public.save_repository_query(jsonb,text)
  to service_role;
grant execute on function public.record_repository_query_cache_hit(text,text,text)
  to service_role;
grant execute on function public.recover_repository_queries()
  to service_role;
grant execute on function public.repository_query_metrics(text)
  to service_role;
grant execute on function public.collect_repository_queries(text,integer)
  to service_role;
grant execute on function public.verify_repository_query_contract(text,text)
  to service_role;
