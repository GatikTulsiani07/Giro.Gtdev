create table if not exists public.tool_registry (
  tool_id text primary key,
  category text not null,
  description text not null,
  current_version text not null,
  lifecycle text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tool_registry_id_valid check (tool_id ~ '^internal\.[a-z][a-z0-9_.-]*$'),
  constraint tool_registry_category_valid check (category in (
    'Retrieval','Repository Graph','Repository Intelligence','Repository Planning',
    'Execution','Sessions','Search','Diagnostics','Metrics'
  )),
  constraint tool_registry_lifecycle_valid check (lifecycle in (
    'registered','loaded','ready','disabled','deprecated','failed'
  )),
  constraint tool_registry_values_present check (
    btrim(description) <> '' and btrim(current_version) <> ''
  )
);

create table if not exists public.tool_versions (
  tool_id text not null references public.tool_registry(tool_id) on delete cascade,
  tool_version text not null,
  capability_hash text not null,
  input_schema jsonb not null,
  output_schema jsonb not null,
  required_permissions jsonb not null,
  forbidden_capabilities jsonb not null,
  timeout_ms integer not null,
  resource_limits jsonb not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  primary key(tool_id,tool_version),
  constraint tool_versions_version_valid check (tool_version ~ '^[a-z][a-z0-9.-]*-v[1-9][0-9]*$'),
  constraint tool_versions_hash_valid check (capability_hash ~ '^[0-9a-f]{64}$'),
  constraint tool_versions_timeout_valid check (timeout_ms > 0),
  constraint tool_versions_json_valid check (
    jsonb_typeof(input_schema)='object' and jsonb_typeof(output_schema)='object'
    and jsonb_typeof(required_permissions)='array'
    and jsonb_typeof(forbidden_capabilities)='array'
    and jsonb_typeof(resource_limits)='object' and jsonb_typeof(definition)='object'
  ),
  constraint tool_versions_permissions_valid check (
    required_permissions <@ '[
      "retrieval","graph_traversal","intelligence_lookup","planning","diagnostics","metrics"
    ]'::jsonb
  ),
  constraint tool_versions_forbidden_complete check (
    forbidden_capabilities @> '[
      "shell_execution","git","repository_mutation","process_spawning","secrets",
      "arbitrary_filesystem_writes","unrestricted_networking","arbitrary_code"
    ]'::jsonb
  )
);

create table if not exists public.tool_invocations (
  tenant_id text not null,
  invocation_id text not null,
  execution_id text not null,
  execution_version text not null,
  work_unit_id text not null,
  work_unit_version text not null,
  runtime_id text not null,
  repository_id text not null references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  tool_id text not null,
  tool_version text not null,
  input_hash text not null,
  timeout_ms integer not null,
  status text not null,
  output_hash text,
  duration_ms integer,
  retries integer not null default 0,
  failure jsonb,
  identity jsonb not null,
  invoked_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(tenant_id,invocation_id),
  foreign key(tool_id,tool_version)
    references public.tool_versions(tool_id,tool_version) on delete cascade,
  foreign key(repository_id,repository_revision)
    references public.repository_snapshots(repository_id,revision) on delete cascade,
  constraint tool_invocations_id_valid check (invocation_id ~ '^tool_invocation_[0-9a-f]{24}$'),
  constraint tool_invocations_hash_valid check (
    input_hash ~ '^[0-9a-f]{64}$' and (output_hash is null or output_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint tool_invocations_status_valid check (status in ('pending','running','succeeded','failed')),
  constraint tool_invocations_limits_valid check (
    timeout_ms > 0 and retries >= 0 and (duration_ms is null or duration_ms >= 0)
  ),
  constraint tool_invocations_identity_valid check (jsonb_typeof(identity)='object'),
  constraint tool_invocations_failure_valid check (failure is null or jsonb_typeof(failure)='object'),
  constraint tool_invocations_terminal_valid check (
    (status in ('pending','running') and completed_at is null and output_hash is null)
    or (status='succeeded' and completed_at is not null and output_hash is not null and failure is null)
    or (status='failed' and completed_at is not null and output_hash is null and failure is not null)
  )
);

create table if not exists public.tool_invocation_outputs (
  tenant_id text not null,
  invocation_id text not null,
  output_version text not null,
  output_hash text not null,
  output jsonb not null,
  created_at timestamptz not null default now(),
  primary key(tenant_id,invocation_id,output_version),
  foreign key(tenant_id,invocation_id)
    references public.tool_invocations(tenant_id,invocation_id) on delete cascade,
  constraint tool_invocation_outputs_hash_valid check (output_hash ~ '^[0-9a-f]{64}$'),
  constraint tool_invocation_outputs_structured check (
    jsonb_typeof(output)='object'
    and output ?& array['version','payload','diagnostics','metrics','durationMs','warnings']
    and jsonb_typeof(output->'diagnostics')='array'
    and jsonb_typeof(output->'metrics')='object'
    and jsonb_typeof(output->'warnings')='array'
  )
);

create table if not exists public.tool_invocation_diagnostics (
  diagnostic_id bigint generated always as identity primary key,
  tenant_id text not null,
  invocation_id text not null,
  code text not null,
  message text not null,
  level text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(tenant_id,invocation_id)
    references public.tool_invocations(tenant_id,invocation_id) on delete cascade,
  constraint tool_invocation_diagnostics_level_valid check (level in ('info','warning','error')),
  constraint tool_invocation_diagnostics_present check (btrim(code)<>'' and btrim(message)<>''),
  constraint tool_invocation_diagnostics_details_valid check (jsonb_typeof(details)='object')
);

create table if not exists public.tool_invocation_metrics (
  tenant_id text not null,
  invocation_id text not null,
  usage_count integer not null,
  latency_ms integer not null,
  timeout_count integer not null,
  failure_count integer not null,
  retry_count integer not null,
  payload_bytes integer not null,
  cache_hits integer not null,
  cache_misses integer not null,
  diagnostic_generation integer not null,
  metrics jsonb not null,
  orphaned boolean not null default false,
  created_at timestamptz not null default now(),
  primary key(tenant_id,invocation_id),
  foreign key(tenant_id,invocation_id)
    references public.tool_invocations(tenant_id,invocation_id) on delete cascade,
  constraint tool_invocation_metrics_nonnegative check (
    usage_count>=0 and latency_ms>=0 and timeout_count>=0 and failure_count>=0
    and retry_count>=0 and payload_bytes>=0 and cache_hits>=0 and cache_misses>=0
    and diagnostic_generation>=0
  ),
  constraint tool_invocation_metrics_json_valid check (jsonb_typeof(metrics)='object')
);

create table if not exists public.tool_invocation_retention (
  tenant_id text primary key,
  retention_count integer not null,
  diagnostics_bytes integer not null,
  updated_at timestamptz not null default now(),
  constraint tool_invocation_retention_limits_valid check (
    retention_count > 0 and diagnostics_bytes > 0
  )
);

create index if not exists tool_registry_lifecycle_idx
  on public.tool_registry(lifecycle,tool_id);
create index if not exists tool_versions_capability_idx
  on public.tool_versions(capability_hash,tool_id,tool_version);
create index if not exists tool_invocations_runtime_idx
  on public.tool_invocations(tenant_id,runtime_id,invoked_at desc,invocation_id);
create index if not exists tool_invocations_execution_idx
  on public.tool_invocations(tenant_id,execution_version,work_unit_version,invoked_at);
create index if not exists tool_invocations_active_idx
  on public.tool_invocations(tenant_id,runtime_id,lease_expires_at)
  where status in ('pending','running');
create index if not exists tool_invocations_tool_metrics_idx
  on public.tool_invocations(tool_id,tool_version,status,invoked_at);
create index if not exists tool_invocation_diagnostics_invocation_idx
  on public.tool_invocation_diagnostics(tenant_id,invocation_id,created_at);
create index if not exists tool_invocation_metrics_tool_idx
  on public.tool_invocation_metrics(tenant_id,created_at);

create or replace function public.tool_invocation_hash(input_payload jsonb)
returns text language sql immutable parallel safe as $$
  select md5(input_payload::text)||md5('tool-invocation:'||input_payload::text)
$$;

create or replace function public.tool_invocation_result_json(
  input_tenant_id text,input_invocation_id text,input_replayed boolean default false
) returns jsonb
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'invocation',invocation.identity || jsonb_build_object(
      'status',invocation.status,'outputHash',invocation.output_hash,
      'durationMs',invocation.duration_ms,'diagnostics',coalesce((
        select jsonb_agg(jsonb_build_object(
          'code',diagnostic.code,'message',diagnostic.message,'level',diagnostic.level,
          'details',diagnostic.details,'createdAt',diagnostic.created_at::text)
          order by diagnostic.created_at,diagnostic.diagnostic_id)
        from public.tool_invocation_diagnostics diagnostic
        where diagnostic.tenant_id=invocation.tenant_id
          and diagnostic.invocation_id=invocation.invocation_id
      ),'[]'::jsonb),'metrics',coalesce((
        select metric.metrics from public.tool_invocation_metrics metric
        where metric.tenant_id=invocation.tenant_id
          and metric.invocation_id=invocation.invocation_id
      ),'{"usage":1,"latencyMs":0,"timeouts":0,"failures":0,"retryCount":0,
          "payloadBytes":0,"cacheHits":0,"cacheMisses":1,"diagnosticGeneration":0}'::jsonb),
      'retries',invocation.retries,'startedAt',invocation.started_at,
      'completedAt',invocation.completed_at,'leaseExpiresAt',invocation.lease_expires_at,
      'failure',invocation.failure
    ),
    'output',(
      select output.output from public.tool_invocation_outputs output
      where output.tenant_id=invocation.tenant_id
        and output.invocation_id=invocation.invocation_id
      order by output.created_at desc limit 1
    ),
    'replayed',input_replayed
  )
  from public.tool_invocations invocation
  where invocation.tenant_id=input_tenant_id and invocation.invocation_id=input_invocation_id
$$;

create or replace function public.begin_tool_invocation(
  input_identity jsonb,input_max_invocations integer,input_max_parallel integer
) returns table(state text,invocation jsonb,result jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.tool_invocations%rowtype;
declare empty_metrics jsonb:='{"usage":1,"latencyMs":0,"timeouts":0,"failures":0,
  "retryCount":0,"payloadBytes":0,"cacheHits":0,"cacheMisses":1,
  "diagnosticGeneration":0}'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    (input_identity->>'tenantId')||'|'||(input_identity->>'runtimeId'),0));
  select * into existing from public.tool_invocations candidate
  where candidate.tenant_id=input_identity->>'tenantId'
    and candidate.invocation_id=input_identity->>'invocationId' for update;
  if found then
    if existing.identity - 'timestamp' <> input_identity - 'timestamp' then
      raise unique_violation using message='tool_invocation_conflict';
    end if;
    if existing.status in ('pending','running') then
      raise object_in_use using message='tool_invocation_in_progress';
    end if;
    update public.tool_invocation_metrics metric set
      cache_hits=cache_hits+1,
      metrics=jsonb_set(metrics,'{cacheHits}',to_jsonb(cache_hits+1))
    where metric.tenant_id=existing.tenant_id
      and metric.invocation_id=existing.invocation_id;
    return query select 'replay',null::jsonb,
      public.tool_invocation_result_json(existing.tenant_id,existing.invocation_id,true);
    return;
  end if;
  if (select count(*) from public.tool_invocations candidate
      where candidate.tenant_id=input_identity->>'tenantId'
        and candidate.runtime_id=input_identity->>'runtimeId') >= input_max_invocations then
    raise program_limit_exceeded using message='tool_invocation_quota_exceeded';
  end if;
  if (select count(*) from public.tool_invocations candidate
      where candidate.tenant_id=input_identity->>'tenantId'
        and candidate.runtime_id=input_identity->>'runtimeId'
        and candidate.status in ('pending','running')) >= input_max_parallel then
    raise program_limit_exceeded using message='tool_parallel_quota_exceeded';
  end if;
  insert into public.tool_invocations(
    tenant_id,invocation_id,execution_id,execution_version,work_unit_id,work_unit_version,
    runtime_id,repository_id,repository_revision,tool_id,tool_version,input_hash,
    timeout_ms,status,identity,invoked_at,started_at,lease_expires_at
  ) values(
    input_identity->>'tenantId',input_identity->>'invocationId',
    input_identity->>'executionId',input_identity->>'executionVersion',
    input_identity->>'workUnitId',input_identity->>'workUnitVersion',
    input_identity->>'runtimeId',input_identity->>'repositoryId',
    input_identity->>'repositoryRevision',input_identity->>'toolId',
    input_identity->>'toolVersion',input_identity->>'inputHash',
    (input_identity->>'timeoutMs')::integer,'running',input_identity,
    (input_identity->>'timestamp')::timestamptz,(input_identity->>'timestamp')::timestamptz,
    (input_identity->>'timestamp')::timestamptz
      + make_interval(secs=>(input_identity->>'timeoutMs')::double precision/1000)
  );
  insert into public.tool_invocation_metrics(
    tenant_id,invocation_id,usage_count,latency_ms,timeout_count,failure_count,
    retry_count,payload_bytes,cache_hits,cache_misses,diagnostic_generation,metrics
  ) values(
    input_identity->>'tenantId',input_identity->>'invocationId',1,0,0,0,0,0,0,1,0,empty_metrics
  );
  return query select 'acquired',
    (public.tool_invocation_result_json(
      input_identity->>'tenantId',input_identity->>'invocationId',false)->'invocation'),
    null::jsonb;
end; $$;

create or replace function public.complete_tool_invocation(
  input_tenant_id text,input_invocation_id text,input_output jsonb,
  input_output_hash text,input_duration_ms integer
) returns table(result jsonb)
language plpgsql security invoker set search_path=public as $$
declare invocation public.tool_invocations%rowtype;
declare output_hash_value text;
declare timestamp_value timestamptz;
begin
  select * into invocation from public.tool_invocations candidate
  where candidate.tenant_id=input_tenant_id and candidate.invocation_id=input_invocation_id
  for update;
  if not found or invocation.status<>'running' then
    raise check_violation using message='tool_invocation_not_running';
  end if;
  if input_output_hash !~ '^[0-9a-f]{64}$' then
    raise check_violation using message='tool_output_hash_invalid';
  end if;
  output_hash_value:=input_output_hash;
  timestamp_value:=invocation.invoked_at+make_interval(secs=>input_duration_ms::double precision/1000);
  insert into public.tool_invocation_outputs(
    tenant_id,invocation_id,output_version,output_hash,output,created_at
  ) values(
    input_tenant_id,input_invocation_id,input_output->>'version',output_hash_value,input_output,timestamp_value
  );
  insert into public.tool_invocation_diagnostics(
    tenant_id,invocation_id,code,message,level,details,created_at
  ) select input_tenant_id,input_invocation_id,item->>'code',item->>'message',
    item->>'level',coalesce(item->'details','{}'::jsonb),
    coalesce((item->>'createdAt')::timestamptz,timestamp_value)
    from jsonb_array_elements(input_output->'diagnostics') item;
  update public.tool_invocation_metrics set
    usage_count=(input_output->'metrics'->>'usage')::integer,
    latency_ms=(input_output->'metrics'->>'latencyMs')::integer,
    timeout_count=(input_output->'metrics'->>'timeouts')::integer,
    failure_count=(input_output->'metrics'->>'failures')::integer,
    retry_count=(input_output->'metrics'->>'retryCount')::integer,
    payload_bytes=(input_output->'metrics'->>'payloadBytes')::integer,
    cache_hits=(input_output->'metrics'->>'cacheHits')::integer,
    cache_misses=(input_output->'metrics'->>'cacheMisses')::integer,
    diagnostic_generation=(input_output->'metrics'->>'diagnosticGeneration')::integer,
    metrics=input_output->'metrics'
  where tenant_id=input_tenant_id and invocation_id=input_invocation_id;
  update public.tool_invocations set
    status='succeeded',output_hash=output_hash_value,duration_ms=input_duration_ms,
    retries=(input_output->'metrics'->>'retryCount')::integer,
    completed_at=timestamp_value,lease_expires_at=null,updated_at=timestamp_value
  where tenant_id=input_tenant_id and invocation_id=input_invocation_id;
  return query select public.tool_invocation_result_json(
    input_tenant_id,input_invocation_id,false);
end; $$;

create or replace function public.fail_tool_invocation(
  input_tenant_id text,input_invocation_id text,input_failure jsonb,
  input_diagnostics jsonb,input_metrics jsonb,input_duration_ms integer,input_retries integer
) returns table(result jsonb)
language plpgsql security invoker set search_path=public as $$
declare invocation public.tool_invocations%rowtype;
declare timestamp_value timestamptz;
begin
  select * into invocation from public.tool_invocations candidate
  where candidate.tenant_id=input_tenant_id and candidate.invocation_id=input_invocation_id
  for update;
  if not found or invocation.status<>'running' then
    raise check_violation using message='tool_invocation_not_running';
  end if;
  timestamp_value:=invocation.invoked_at+make_interval(secs=>input_duration_ms::double precision/1000);
  insert into public.tool_invocation_diagnostics(
    tenant_id,invocation_id,code,message,level,details,created_at
  ) select input_tenant_id,input_invocation_id,item->>'code',item->>'message',
    item->>'level',coalesce(item->'details','{}'::jsonb),
    coalesce((item->>'createdAt')::timestamptz,timestamp_value)
    from jsonb_array_elements(input_diagnostics) item;
  update public.tool_invocation_metrics set
    usage_count=(input_metrics->>'usage')::integer,
    latency_ms=(input_metrics->>'latencyMs')::integer,
    timeout_count=(input_metrics->>'timeouts')::integer,
    failure_count=(input_metrics->>'failures')::integer,
    retry_count=(input_metrics->>'retryCount')::integer,
    payload_bytes=(input_metrics->>'payloadBytes')::integer,
    cache_hits=(input_metrics->>'cacheHits')::integer,
    cache_misses=(input_metrics->>'cacheMisses')::integer,
    diagnostic_generation=(input_metrics->>'diagnosticGeneration')::integer,
    metrics=input_metrics
  where tenant_id=input_tenant_id and invocation_id=input_invocation_id;
  update public.tool_invocations set
    status='failed',duration_ms=input_duration_ms,retries=input_retries,
    failure=input_failure,completed_at=timestamp_value,lease_expires_at=null,
    updated_at=timestamp_value
  where tenant_id=input_tenant_id and invocation_id=input_invocation_id;
  return query select public.tool_invocation_result_json(
    input_tenant_id,input_invocation_id,false);
end; $$;

create or replace function public.get_tool_invocation(
  input_tenant_id text,input_invocation_id text
) returns table(result jsonb)
language sql stable security invoker set search_path=public as $$
  select public.tool_invocation_result_json(input_tenant_id,input_invocation_id,false)
  where exists(select 1 from public.tool_invocations invocation
    where invocation.tenant_id=input_tenant_id
      and invocation.invocation_id=input_invocation_id)
$$;

create or replace function public.tool_invocation_metrics(input_tenant_id text default null)
returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'usage',coalesce(sum(usage_count),0),'latencyMs',coalesce(sum(latency_ms),0),
    'timeouts',coalesce(sum(timeout_count),0),'failures',coalesce(sum(failure_count),0),
    'retryCount',coalesce(sum(retry_count),0),'payloadBytes',coalesce(sum(payload_bytes),0),
    'cacheHits',coalesce(sum(cache_hits),0),'cacheMisses',coalesce(sum(cache_misses),0),
    'diagnosticGeneration',coalesce(sum(diagnostic_generation),0)
  ) from public.tool_invocation_metrics metric
  where input_tenant_id is null or metric.tenant_id=input_tenant_id
$$;

create or replace function public.recover_tool_invocations(input_now timestamptz)
returns table(recovered_count integer)
language plpgsql security invoker set search_path=public as $$
declare recovered integer;
begin
  with expired as (
    select tenant_id,invocation_id from public.tool_invocations
    where status in ('pending','running') and lease_expires_at<=input_now
    for update skip locked
  ), updated as (
    update public.tool_invocations invocation set
      status='failed',duration_ms=greatest(0,
        floor(extract(epoch from (input_now-invocation.invoked_at))*1000)::integer),
      retries=retries+1,failure='{"kind":"runtime","code":"unfinished_tool_invocation",
        "message":"Unfinished tool invocation recovered.","retryable":true,"details":{}}'::jsonb,
      completed_at=input_now,lease_expires_at=null,updated_at=input_now
    from expired where invocation.tenant_id=expired.tenant_id
      and invocation.invocation_id=expired.invocation_id
    returning invocation.tenant_id,invocation.invocation_id
  )
  insert into public.tool_invocation_diagnostics(
    tenant_id,invocation_id,code,message,level,details,created_at
  ) select tenant_id,invocation_id,'tool_invocation_recovered',
    'Expired unfinished tool invocation recovered.','error','{}'::jsonb,input_now
    from updated;
  get diagnostics recovered=row_count;
  update public.tool_invocation_metrics metric set
    failure_count=1,retry_count=retry_count+1,
    diagnostic_generation=diagnostic_generation+1,
    metrics=jsonb_set(jsonb_set(jsonb_set(metrics,'{failures}','1'::jsonb),
      '{retryCount}',to_jsonb(retry_count+1)),'{diagnosticGeneration}',
      to_jsonb(diagnostic_generation+1))
  where exists(select 1 from public.tool_invocations invocation
    where invocation.tenant_id=metric.tenant_id
      and invocation.invocation_id=metric.invocation_id
      and invocation.completed_at=input_now
      and invocation.failure->>'code'='unfinished_tool_invocation');
  return query select recovered;
end; $$;

create or replace function public.collect_tool_invocations(
  input_tenant_id text,input_retention_count integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.tool_invocation_retention(
    tenant_id,retention_count,diagnostics_bytes
  ) values(input_tenant_id,greatest(1,input_retention_count),65536)
  on conflict(tenant_id) do update set
    retention_count=excluded.retention_count,updated_at=now();
  with victims as (
    select invocation_id from public.tool_invocations
    where tenant_id=input_tenant_id and status in ('succeeded','failed')
    order by invoked_at desc,invocation_id desc offset greatest(1,input_retention_count)
  )
  delete from public.tool_invocations invocation using victims
  where invocation.tenant_id=input_tenant_id
    and invocation.invocation_id=victims.invocation_id;
  get diagnostics removed=row_count;
  return query select removed;
end; $$;

create or replace function public.verify_tool_invocation_contract(
  input_framework_version text,input_registry jsonb
) returns table(valid boolean,problems jsonb)
language plpgsql security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare tool jsonb;
declare table_name text;
begin
  if input_framework_version<>'tool-invocation-v1' then
    issues:=issues||'"framework_version_incompatible"'::jsonb;
  end if;
  for tool in select * from jsonb_array_elements(input_registry) loop
    insert into public.tool_registry(
      tool_id,category,description,current_version,lifecycle
    ) values(
      tool->>'toolId',tool->>'category',tool->>'description',
      tool->>'version',tool->>'lifecycle'
    ) on conflict(tool_id) do update set
      category=excluded.category,description=excluded.description,
      current_version=excluded.current_version,lifecycle=excluded.lifecycle,updated_at=now();
    if exists(select 1 from public.tool_versions version
      where version.tool_id=(tool->>'toolId') and version.tool_version=(tool->>'version')
        and version.capability_hash<>(tool->>'capabilityHash')) then
      issues:=issues||to_jsonb((tool->>'toolId')||'@'||(tool->>'version')||'_capability_conflict');
    end if;
    insert into public.tool_versions(
      tool_id,tool_version,capability_hash,input_schema,output_schema,
      required_permissions,forbidden_capabilities,timeout_ms,resource_limits,definition
    ) values(
      tool->>'toolId',tool->>'version',tool->>'capabilityHash',
      tool->'inputSchema',tool->'outputSchema',tool->'requiredPermissions',
      tool->'forbiddenCapabilities',(tool->>'timeoutMs')::integer,
      tool->'resourceLimits',tool
    ) on conflict(tool_id,tool_version) do nothing;
  end loop;
  if jsonb_array_length(input_registry)<>10 then
    issues:=issues||'"tool_registry_incomplete"'::jsonb;
  end if;
  foreach table_name in array array[
    'tool_registry','tool_versions','tool_invocations','tool_invocation_outputs',
    'tool_invocation_diagnostics','tool_invocation_metrics','tool_invocation_retention'
  ] loop
    if to_regclass('public.'||table_name) is null then
      issues:=issues||to_jsonb(table_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||table_name) and relrowsecurity) then
      issues:=issues||to_jsonb(table_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='tool_invocations_active_idx')
    or not exists(select 1 from pg_indexes
      where indexname='tool_invocations_execution_idx') then
    issues:=issues||'"tool_indexes_missing"'::jsonb;
  end if;
  if not has_table_privilege('service_role','public.tool_invocations','select')
    or has_table_privilege('anon','public.tool_invocations','select')
    or not has_function_privilege('service_role',
      'public.begin_tool_invocation(jsonb,integer,integer)','execute')
    or has_function_privilege('anon',
      'public.begin_tool_invocation(jsonb,integer,integer)','execute') then
    issues:=issues||'"tool_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure('public.collect_tool_invocations(text,integer)') is null then
    issues:=issues||'"tool_retention_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'tool_registry','tool_versions','tool_invocations','tool_invocation_outputs',
    'tool_invocation_diagnostics','tool_invocation_metrics','tool_invocation_retention'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
    execute format('grant select,insert,update,delete on table public.%I to service_role',table_name);
  end loop;
end $$;

revoke all on function public.tool_invocation_hash(jsonb) from public,anon,authenticated;
revoke all on function public.tool_invocation_result_json(text,text,boolean) from public,anon,authenticated;
revoke all on function public.begin_tool_invocation(jsonb,integer,integer) from public,anon,authenticated;
revoke all on function public.complete_tool_invocation(text,text,jsonb,text,integer) from public,anon,authenticated;
revoke all on function public.fail_tool_invocation(text,text,jsonb,jsonb,jsonb,integer,integer) from public,anon,authenticated;
revoke all on function public.get_tool_invocation(text,text) from public,anon,authenticated;
revoke all on function public.tool_invocation_metrics(text) from public,anon,authenticated;
revoke all on function public.recover_tool_invocations(timestamptz) from public,anon,authenticated;
revoke all on function public.collect_tool_invocations(text,integer) from public,anon,authenticated;
revoke all on function public.verify_tool_invocation_contract(text,jsonb) from public,anon,authenticated;

grant execute on function public.tool_invocation_hash(jsonb) to service_role;
grant execute on function public.tool_invocation_result_json(text,text,boolean) to service_role;
grant execute on function public.begin_tool_invocation(jsonb,integer,integer) to service_role;
grant execute on function public.complete_tool_invocation(text,text,jsonb,text,integer) to service_role;
grant execute on function public.fail_tool_invocation(text,text,jsonb,jsonb,jsonb,integer,integer) to service_role;
grant execute on function public.get_tool_invocation(text,text) to service_role;
grant execute on function public.tool_invocation_metrics(text) to service_role;
grant execute on function public.recover_tool_invocations(timestamptz) to service_role;
grant execute on function public.collect_tool_invocations(text,integer) to service_role;
grant execute on function public.verify_tool_invocation_contract(text,jsonb) to service_role;
