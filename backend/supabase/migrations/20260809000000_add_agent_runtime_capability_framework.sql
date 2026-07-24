create table if not exists public.agent_capabilities (
  capability_version text primary key,
  agent_id text not null,
  agent_version text not null,
  capability_hash text not null unique,
  declaration jsonb not null,
  created_at timestamptz not null default now(),
  constraint agent_capabilities_hash_valid check (capability_hash ~ '^[0-9a-f]{64}$'),
  constraint agent_capabilities_declaration_valid check (
    jsonb_typeof(declaration) = 'object'
    and declaration->>'deterministic' = 'true'
    and declaration->'allowed' @> '["reasoning","retrieval","repository_graph",
      "repository_intelligence","repository_planning"]'::jsonb
    and declaration->'forbidden' @> '["shell","filesystem_mutation","git","network",
      "secrets","process_execution"]'::jsonb
  )
);

create table if not exists public.agent_runtimes (
  tenant_id text not null,
  runtime_id text not null,
  agent_id text not null,
  agent_version text not null,
  capability_version text not null references public.agent_capabilities(capability_version) on delete restrict,
  capability_hash text not null,
  execution_id text not null,
  execution_version text not null,
  work_unit_id text not null,
  work_unit_version text not null,
  repository_id text not null,
  worker_id text,
  status text not null,
  attempt integer not null default 0,
  output_version integer not null default 0,
  superseded_by text,
  recovery_count integer not null default 0,
  context jsonb not null,
  runtime jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  primary key(tenant_id, runtime_id),
  unique(tenant_id, execution_version, work_unit_version, agent_id),
  constraint agent_runtimes_status_valid check (
    status in ('idle','starting','ready','leased','running','waiting','completed',
      'failed','cancelled','unhealthy')
  ),
  constraint agent_runtimes_counters_valid check (
    attempt >= 0 and output_version >= 0 and recovery_count >= 0
  ),
  constraint agent_runtimes_identity_present check (
    btrim(tenant_id) <> '' and btrim(runtime_id) <> '' and btrim(agent_id) <> ''
    and btrim(execution_id) <> '' and btrim(execution_version) <> ''
    and btrim(work_unit_id) <> '' and btrim(work_unit_version) <> ''
    and btrim(repository_id) <> ''
  ),
  constraint agent_runtimes_context_immutable_boundary check (
    jsonb_typeof(context) = 'object'
    and context->'policy'->>'planningOnly' = 'true'
    and context->'policy'->>'repositoryMutation' = 'false'
    and context->'repositorySnapshot'->>'published' = 'true'
    and context->'retrievalBundle'->>'published' = 'true'
    and context->'graphExpansion'->>'published' = 'true'
    and context->'intelligenceSnapshot'->>'published' = 'true'
  )
);

create table if not exists public.agent_runtime_leases (
  tenant_id text not null,
  runtime_id text not null,
  execution_version text not null,
  work_unit_version text not null,
  worker_id text not null,
  claim_token text not null unique,
  attempt integer not null,
  leased_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key(tenant_id, runtime_id),
  foreign key(tenant_id, runtime_id)
    references public.agent_runtimes(tenant_id, runtime_id) on delete cascade,
  constraint agent_runtime_leases_valid check (
    attempt > 0 and btrim(worker_id) <> '' and btrim(claim_token) <> ''
    and expires_at > leased_at
  )
);

create table if not exists public.agent_runtime_outputs (
  tenant_id text not null,
  runtime_id text not null,
  output_version integer not null,
  output_id text not null unique,
  execution_version text not null,
  work_unit_version text not null,
  agent_version text not null,
  capability_version text not null,
  payload_hash text not null,
  output jsonb not null,
  published boolean not null default true,
  orphaned boolean not null default false,
  created_at timestamptz not null default now(),
  primary key(tenant_id, runtime_id, output_version),
  foreign key(tenant_id, runtime_id)
    references public.agent_runtimes(tenant_id, runtime_id) on delete cascade,
  constraint agent_runtime_outputs_version_valid check (output_version > 0),
  constraint agent_runtime_outputs_hash_valid check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint agent_runtime_outputs_publication_valid check (not (published and orphaned)),
  constraint agent_runtime_outputs_contract check (
    jsonb_typeof(output) = 'object'
    and output ?& array['summary','reasoning','findings','risks','assumptions',
      'proposedFiles','proposedSymbols','validation','tests','confidence']
    and jsonb_typeof(output->'reasoning') = 'array'
    and jsonb_typeof(output->'findings') = 'array'
    and jsonb_typeof(output->'risks') = 'array'
    and jsonb_typeof(output->'assumptions') = 'array'
    and jsonb_typeof(output->'proposedFiles') = 'array'
    and jsonb_typeof(output->'proposedSymbols') = 'array'
    and jsonb_typeof(output->'validation') = 'array'
    and jsonb_typeof(output->'tests') = 'array'
    and (output->>'confidence')::double precision between 0 and 1
  )
);

create table if not exists public.agent_runtime_diagnostics (
  diagnostic_id bigint generated always as identity primary key,
  tenant_id text not null,
  runtime_id text not null,
  code text not null,
  message text not null,
  retryable boolean not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(tenant_id, runtime_id)
    references public.agent_runtimes(tenant_id, runtime_id) on delete cascade,
  constraint agent_runtime_diagnostics_details_valid check (jsonb_typeof(details) = 'object')
);

create table if not exists public.agent_runtime_heartbeats (
  heartbeat_id bigint generated always as identity primary key,
  tenant_id text not null,
  runtime_id text not null,
  worker_id text not null,
  claim_token text not null,
  recorded_at timestamptz not null default now(),
  latency_ms integer not null,
  foreign key(tenant_id, runtime_id)
    references public.agent_runtimes(tenant_id, runtime_id) on delete cascade,
  constraint agent_runtime_heartbeats_latency_valid check (latency_ms >= 0)
);

create table if not exists public.agent_runtime_recovery_state (
  recovery_id bigint generated always as identity primary key,
  tenant_id text not null,
  runtime_id text not null,
  reason text not null,
  previous_status text not null,
  recovered_status text not null,
  attempt integer not null,
  claim_token text,
  recovered_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  foreign key(tenant_id, runtime_id)
    references public.agent_runtimes(tenant_id, runtime_id) on delete cascade
);

create index if not exists agent_runtimes_tenant_status_idx
  on public.agent_runtimes(tenant_id,status,created_at,runtime_id)
  where status not in ('completed','failed','cancelled');
create index if not exists agent_runtimes_execution_fence_idx
  on public.agent_runtimes(tenant_id,execution_version,work_unit_version,agent_id);
create index if not exists agent_runtime_leases_expiry_idx
  on public.agent_runtime_leases(expires_at,tenant_id,runtime_id);
create index if not exists agent_runtime_leases_worker_idx
  on public.agent_runtime_leases(tenant_id,worker_id,expires_at);
create index if not exists agent_runtime_outputs_publication_idx
  on public.agent_runtime_outputs(tenant_id,runtime_id,published,output_version desc);
create index if not exists agent_runtime_diagnostics_runtime_idx
  on public.agent_runtime_diagnostics(tenant_id,runtime_id,created_at);
create index if not exists agent_runtime_heartbeats_runtime_idx
  on public.agent_runtime_heartbeats(tenant_id,runtime_id,recorded_at desc);
create index if not exists agent_runtime_recovery_audit_idx
  on public.agent_runtime_recovery_state(tenant_id,runtime_id,recovered_at desc);

create or replace function public.agent_runtime_hash(input_payload jsonb)
returns text language sql immutable parallel safe as $$
  select md5(input_payload::text) || md5('agent-runtime:' || input_payload::text)
$$;

create or replace function public.agent_runtime_json(input_tenant_id text,input_runtime_id text)
returns jsonb language sql stable security invoker set search_path=public as $$
  select runtime.runtime || jsonb_build_object(
    'status',runtime.status,'attempt',runtime.attempt,'outputVersion',runtime.output_version,
    'workerId',runtime.worker_id,'supersededBy',runtime.superseded_by,
    'recoveryCount',runtime.recovery_count,'updatedAt',runtime.updated_at::text,
    'startedAt',runtime.started_at,'completedAt',runtime.completed_at,
    'lease',(
      select jsonb_build_object(
        'runtimeId',lease.runtime_id,'workerId',lease.worker_id,'claimToken',lease.claim_token,
        'attempt',lease.attempt,'leasedAt',lease.leased_at::text,
        'heartbeatAt',lease.heartbeat_at::text,'expiresAt',lease.expires_at::text)
      from public.agent_runtime_leases lease
      where lease.tenant_id=runtime.tenant_id and lease.runtime_id=runtime.runtime_id
    ),
    'heartbeat',(
      select jsonb_build_object(
        'runtimeId',heartbeat.runtime_id,'workerId',heartbeat.worker_id,
        'claimToken',heartbeat.claim_token,'recordedAt',heartbeat.recorded_at::text,
        'latencyMs',heartbeat.latency_ms)
      from public.agent_runtime_heartbeats heartbeat
      where heartbeat.tenant_id=runtime.tenant_id and heartbeat.runtime_id=runtime.runtime_id
      order by heartbeat.recorded_at desc,heartbeat.heartbeat_id desc limit 1
    ),
    'diagnostics',coalesce((
      select jsonb_agg(jsonb_build_object(
        'code',diagnostic.code,'message',diagnostic.message,'retryable',diagnostic.retryable,
        'details',diagnostic.details,'createdAt',diagnostic.created_at::text)
        order by diagnostic.created_at,diagnostic.diagnostic_id)
      from public.agent_runtime_diagnostics diagnostic
      where diagnostic.tenant_id=runtime.tenant_id and diagnostic.runtime_id=runtime.runtime_id
    ),'[]'::jsonb)
  )
  from public.agent_runtimes runtime
  where runtime.tenant_id=input_tenant_id and runtime.runtime_id=input_runtime_id
$$;

create or replace function public.create_agent_runtime(
  input_runtime_id text,input_agent jsonb,input_context jsonb,input_max_active_runtimes integer
) returns table(runtime jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.agent_runtimes%rowtype;
declare timestamp_value timestamptz:=now();
declare runtime_value jsonb;
begin
  if input_context->'policy'->>'planningOnly'<>'true'
    or input_context->'policy'->>'repositoryMutation'<>'false'
    or input_context->'repositorySnapshot'->>'published'<>'true'
    or input_context->'retrievalBundle'->>'published'<>'true'
    or input_context->'graphExpansion'->>'published'<>'true'
    or input_context->'intelligenceSnapshot'->>'published'<>'true' then
    raise check_violation using message='unpublished_or_mutable_runtime_context';
  end if;
  if (select count(*) from public.agent_runtimes candidate
      where candidate.tenant_id=input_context->>'tenantId'
        and candidate.status not in ('completed','failed','cancelled')) >= input_max_active_runtimes then
    raise program_limit_exceeded using message='active_runtime_quota_exceeded';
  end if;
  insert into public.agent_capabilities(
    capability_version,agent_id,agent_version,capability_hash,declaration
  ) values(
    input_agent->'capability'->>'capabilityVersion',input_agent->>'agentId',
    input_agent->>'version',input_agent->'capability'->>'capabilityHash',
    input_agent->'capability'
  ) on conflict(capability_version) do nothing;
  select * into existing from public.agent_runtimes candidate
    where candidate.tenant_id=input_context->>'tenantId' and candidate.runtime_id=input_runtime_id;
  if found then
    if existing.context<>input_context then raise unique_violation using message='runtime_identity_conflict'; end if;
    return query select public.agent_runtime_json(existing.tenant_id,existing.runtime_id);
    return;
  end if;
  runtime_value:=jsonb_build_object(
    'runtimeId',input_runtime_id,'tenantId',input_context->>'tenantId',
    'agentId',input_agent->>'agentId','agentVersion',input_agent->>'version',
    'capabilityVersion',input_agent->'capability'->>'capabilityVersion',
    'capabilityHash',input_agent->'capability'->>'capabilityHash',
    'executionVersion',input_context->>'executionVersion',
    'workUnitVersion',input_context->>'workUnitVersion','workerId',null,'status','ready',
    'attempt',0,'lease',null,'heartbeat',null,'diagnostics','[]'::jsonb,'context',input_context,
    'outputVersion',0,'supersededBy',null,'recoveryCount',0,
    'createdAt',timestamp_value::text,'updatedAt',timestamp_value::text,
    'startedAt',null,'completedAt',null
  );
  insert into public.agent_runtimes(
    tenant_id,runtime_id,agent_id,agent_version,capability_version,capability_hash,
    execution_id,execution_version,work_unit_id,work_unit_version,repository_id,
    status,context,runtime
  ) values(
    input_context->>'tenantId',input_runtime_id,input_agent->>'agentId',input_agent->>'version',
    input_agent->'capability'->>'capabilityVersion',input_agent->'capability'->>'capabilityHash',
    input_context->>'executionId',input_context->>'executionVersion',
    input_context->>'workUnitId',input_context->>'workUnitVersion',
    input_context->>'repositoryId','ready',input_context,runtime_value
  );
  return query select public.agent_runtime_json(input_context->>'tenantId',input_runtime_id);
end; $$;

create or replace function public.get_agent_runtime(input_tenant_id text,input_runtime_id text)
returns table(runtime jsonb) language sql stable security invoker set search_path=public as $$
  select public.agent_runtime_json(input_tenant_id,input_runtime_id)
  where exists(select 1 from public.agent_runtimes candidate
    where candidate.tenant_id=input_tenant_id and candidate.runtime_id=input_runtime_id)
$$;

create or replace function public.lease_agent_runtime(
  input_tenant_id text,input_worker_id text,input_lease_ms integer,
  input_max_leases integer,input_max_runtime_ms integer
) returns table(lease jsonb)
language plpgsql security invoker set search_path=public as $$
declare selected public.agent_runtimes%rowtype;
declare token text:=gen_random_uuid()::text;
declare timestamp_value timestamptz:=now();
begin
  if (select count(*) from public.agent_runtime_leases current_lease
      where current_lease.tenant_id=input_tenant_id and current_lease.expires_at>timestamp_value)
      >= input_max_leases then
    raise program_limit_exceeded using message='runtime_lease_quota_exceeded';
  end if;
  select * into selected from public.agent_runtimes candidate
    where candidate.tenant_id=input_tenant_id and candidate.status='ready'
      and candidate.superseded_by is null
      and candidate.created_at+make_interval(secs=>input_max_runtime_ms::double precision/1000)>timestamp_value
    order by candidate.created_at,candidate.runtime_id for update skip locked limit 1;
  if not found then return; end if;
  update public.agent_runtimes set status='leased',worker_id=input_worker_id,
    attempt=attempt+1,started_at=coalesce(started_at,timestamp_value),updated_at=timestamp_value
    where tenant_id=selected.tenant_id and runtime_id=selected.runtime_id
    returning * into selected;
  insert into public.agent_runtime_leases(
    tenant_id,runtime_id,execution_version,work_unit_version,worker_id,
    claim_token,attempt,leased_at,heartbeat_at,expires_at
  ) values(
    selected.tenant_id,selected.runtime_id,selected.execution_version,selected.work_unit_version,
    input_worker_id,token,selected.attempt,timestamp_value,timestamp_value,
    timestamp_value+make_interval(secs=>input_lease_ms::double precision/1000)
  );
  return query select jsonb_build_object(
    'runtimeId',selected.runtime_id,'workerId',input_worker_id,'claimToken',token,
    'attempt',selected.attempt,'leasedAt',timestamp_value::text,
    'heartbeatAt',timestamp_value::text,
    'expiresAt',(timestamp_value+make_interval(secs=>input_lease_ms::double precision/1000))::text);
end; $$;

create or replace function public.assert_agent_runtime_fence(
  input_tenant_id text,input_runtime_id text,input_execution_version text,
  input_work_unit_version text,input_worker_id text,input_claim_token text
) returns public.agent_runtimes
language plpgsql stable security invoker set search_path=public as $$
declare result public.agent_runtimes%rowtype;
begin
  select runtime.* into result from public.agent_runtimes runtime
  join public.agent_runtime_leases lease using(tenant_id,runtime_id)
  where runtime.tenant_id=input_tenant_id and runtime.runtime_id=input_runtime_id
    and runtime.execution_version=input_execution_version
    and runtime.work_unit_version=input_work_unit_version
    and runtime.superseded_by is null and lease.worker_id=input_worker_id
    and lease.claim_token=input_claim_token and lease.expires_at>now();
  if not found then raise check_violation using message='stale_runtime_rejected'; end if;
  return result;
end; $$;

create or replace function public.heartbeat_agent_runtime(
  input_tenant_id text,input_runtime_id text,input_execution_version text,
  input_work_unit_version text,input_worker_id text,input_claim_token text,input_lease_ms integer
) returns table(lease jsonb)
language plpgsql security invoker set search_path=public as $$
declare fenced public.agent_runtimes%rowtype;
declare previous timestamptz;
declare timestamp_value timestamptz:=now();
declare latency integer;
begin
  fenced:=public.assert_agent_runtime_fence(input_tenant_id,input_runtime_id,input_execution_version,
    input_work_unit_version,input_worker_id,input_claim_token);
  select current_lease.heartbeat_at into previous
    from public.agent_runtime_leases current_lease
    where current_lease.tenant_id=input_tenant_id and current_lease.runtime_id=input_runtime_id;
  update public.agent_runtime_leases current_lease set heartbeat_at=timestamp_value,
    expires_at=timestamp_value+make_interval(secs=>input_lease_ms::double precision/1000)
    where current_lease.tenant_id=input_tenant_id and current_lease.runtime_id=input_runtime_id
    returning current_lease.heartbeat_at into timestamp_value;
  latency:=greatest(0,(extract(epoch from (timestamp_value-coalesce(previous,timestamp_value)))*1000)::integer);
  insert into public.agent_runtime_heartbeats(
    tenant_id,runtime_id,worker_id,claim_token,recorded_at,latency_ms
  ) values(input_tenant_id,input_runtime_id,input_worker_id,input_claim_token,timestamp_value,latency);
  update public.agent_runtimes set updated_at=timestamp_value
    where tenant_id=input_tenant_id and runtime_id=input_runtime_id;
  return query select jsonb_build_object(
    'runtimeId',input_runtime_id,'workerId',input_worker_id,'claimToken',input_claim_token,
    'attempt',fenced.attempt,'leasedAt',(select leased_at::text from public.agent_runtime_leases
      where tenant_id=input_tenant_id and runtime_id=input_runtime_id),
    'heartbeatAt',timestamp_value::text,
    'expiresAt',(timestamp_value+make_interval(secs=>input_lease_ms::double precision/1000))::text);
end; $$;

create or replace function public.transition_agent_runtime(
  input_tenant_id text,input_runtime_id text,input_execution_version text,
  input_work_unit_version text,input_worker_id text,input_claim_token text,input_status text
) returns table(runtime jsonb)
language plpgsql security invoker set search_path=public as $$
declare fenced public.agent_runtimes%rowtype;
begin
  fenced:=public.assert_agent_runtime_fence(input_tenant_id,input_runtime_id,input_execution_version,
    input_work_unit_version,input_worker_id,input_claim_token);
  if input_status not in ('running','waiting')
    or (input_status='waiting' and fenced.status<>'running')
    or (input_status='running' and fenced.status not in ('leased','waiting','running')) then
    raise check_violation using message='invalid_runtime_transition';
  end if;
  update public.agent_runtimes set status=input_status,updated_at=now()
    where tenant_id=input_tenant_id and runtime_id=input_runtime_id;
  return query select public.agent_runtime_json(input_tenant_id,input_runtime_id);
end; $$;

create or replace function public.publish_agent_runtime_output(
  input_tenant_id text,input_runtime_id text,input_execution_version text,
  input_work_unit_version text,input_worker_id text,input_claim_token text,
  input_output jsonb,input_max_output_bytes integer
) returns table(output jsonb)
language plpgsql security invoker set search_path=public as $$
declare fenced public.agent_runtimes%rowtype;
declare next_version integer;
declare output_hash text:=public.agent_runtime_hash(input_output);
declare output_id text;
declare timestamp_value timestamptz:=now();
declare output_value jsonb;
begin
  if pg_column_size(input_output)>input_max_output_bytes
    or not(input_output ?& array['summary','reasoning','findings','risks','assumptions',
      'proposedFiles','proposedSymbols','validation','tests','confidence']) then
    raise check_violation using message='output_validation_failed';
  end if;
  fenced:=public.assert_agent_runtime_fence(input_tenant_id,input_runtime_id,input_execution_version,
    input_work_unit_version,input_worker_id,input_claim_token);
  if fenced.status not in ('running','waiting') then
    raise check_violation using message='invalid_runtime_transition';
  end if;
  next_version:=fenced.output_version+1;
  output_id:='agent_output_'||substr(public.agent_runtime_hash(jsonb_build_object(
    'runtime',input_runtime_id,'execution',input_execution_version,'unit',input_work_unit_version,
    'agent',fenced.agent_version,'capability',fenced.capability_version,
    'version',next_version,'output',input_output)),1,24);
  output_value:=jsonb_build_object(
    'outputId',output_id,'runtimeId',input_runtime_id,
    'executionVersion',input_execution_version,'workUnitVersion',input_work_unit_version,
    'agentVersion',fenced.agent_version,'capabilityVersion',fenced.capability_version,
    'outputVersion',next_version,'payloadHash',output_hash,'output',input_output,
    'published',true,'orphaned',false,'createdAt',timestamp_value::text
  );
  insert into public.agent_runtime_outputs(
    tenant_id,runtime_id,output_version,output_id,execution_version,work_unit_version,
    agent_version,capability_version,payload_hash,output,created_at
  ) values(
    input_tenant_id,input_runtime_id,next_version,output_id,input_execution_version,
    input_work_unit_version,fenced.agent_version,fenced.capability_version,
    output_hash,input_output,timestamp_value
  );
  delete from public.agent_runtime_leases
    where tenant_id=input_tenant_id and runtime_id=input_runtime_id and claim_token=input_claim_token;
  update public.agent_runtimes set status='completed',worker_id=null,output_version=next_version,
    updated_at=timestamp_value,completed_at=timestamp_value
    where tenant_id=input_tenant_id and runtime_id=input_runtime_id;
  return query select output_value;
end; $$;

create or replace function public.fail_agent_runtime(
  input_tenant_id text,input_runtime_id text,input_execution_version text,
  input_work_unit_version text,input_worker_id text,input_claim_token text,
  input_code text,input_message text,input_max_retries integer
) returns table(runtime jsonb)
language plpgsql security invoker set search_path=public as $$
declare fenced public.agent_runtimes%rowtype;
declare retry boolean;
declare next_status text;
begin
  fenced:=public.assert_agent_runtime_fence(input_tenant_id,input_runtime_id,input_execution_version,
    input_work_unit_version,input_worker_id,input_claim_token);
  retry:=input_code in ('transient_runtime_failure','runtime_timeout','lease_expired')
    and fenced.attempt<=input_max_retries;
  next_status:=case when retry then 'ready'
    when input_code='transient_runtime_failure' then 'unhealthy' else 'failed' end;
  delete from public.agent_runtime_leases
    where tenant_id=input_tenant_id and runtime_id=input_runtime_id;
  update public.agent_runtimes set status=next_status,worker_id=null,updated_at=now(),
    completed_at=case when retry then null else now() end
    where tenant_id=input_tenant_id and runtime_id=input_runtime_id;
  insert into public.agent_runtime_diagnostics(
    tenant_id,runtime_id,code,message,retryable
  ) values(input_tenant_id,input_runtime_id,input_code,input_message,retry);
  return query select public.agent_runtime_json(input_tenant_id,input_runtime_id);
end; $$;

create or replace function public.cancel_agent_runtime(input_tenant_id text,input_runtime_id text)
returns table(runtime jsonb)
language plpgsql security invoker set search_path=public as $$
begin
  if not exists(select 1 from public.agent_runtimes candidate
    where candidate.tenant_id=input_tenant_id and candidate.runtime_id=input_runtime_id) then
    raise insufficient_privilege using message='authorization_failed';
  end if;
  delete from public.agent_runtime_leases where tenant_id=input_tenant_id and runtime_id=input_runtime_id;
  update public.agent_runtimes set status='cancelled',worker_id=null,updated_at=now(),completed_at=now()
    where tenant_id=input_tenant_id and runtime_id=input_runtime_id
      and status not in ('completed','failed','cancelled');
  return query select public.agent_runtime_json(input_tenant_id,input_runtime_id);
end; $$;

create or replace function public.supersede_agent_runtime(
  input_tenant_id text,input_runtime_id text,input_superseded_by text
) returns table(runtime jsonb)
language plpgsql security invoker set search_path=public as $$
begin
  if not exists(select 1 from public.agent_runtimes candidate
    where candidate.tenant_id=input_tenant_id and candidate.runtime_id=input_runtime_id) then
    raise insufficient_privilege using message='authorization_failed';
  end if;
  delete from public.agent_runtime_leases where tenant_id=input_tenant_id and runtime_id=input_runtime_id;
  update public.agent_runtime_outputs set published=false,orphaned=true
    where tenant_id=input_tenant_id and runtime_id=input_runtime_id;
  update public.agent_runtimes set status='cancelled',worker_id=null,
    superseded_by=input_superseded_by,updated_at=now(),completed_at=now()
    where tenant_id=input_tenant_id and runtime_id=input_runtime_id;
  return query select public.agent_runtime_json(input_tenant_id,input_runtime_id);
end; $$;

create or replace function public.recover_agent_runtimes(
  input_now timestamptz,input_max_retries integer,input_max_runtime_ms integer
) returns table(recovered_count integer)
language plpgsql security invoker set search_path=public as $$
declare candidate record;
declare recovered integer:=0;
declare retry boolean;
declare next_status text;
begin
  for candidate in
    select runtime.*,lease.claim_token,lease.expires_at
    from public.agent_runtimes runtime
    left join public.agent_runtime_leases lease using(tenant_id,runtime_id)
    where runtime.status not in ('completed','failed','cancelled')
      and (lease.expires_at<=input_now
        or runtime.created_at+make_interval(secs=>input_max_runtime_ms::double precision/1000)<=input_now)
    order by runtime.updated_at,runtime.runtime_id for update of runtime skip locked
  loop
    retry:=candidate.expires_at is not null and candidate.attempt<=input_max_retries;
    next_status:=case when retry then 'ready' else 'failed' end;
    delete from public.agent_runtime_leases
      where tenant_id=candidate.tenant_id and runtime_id=candidate.runtime_id;
    update public.agent_runtime_outputs set published=false,orphaned=true
      where tenant_id=candidate.tenant_id and runtime_id=candidate.runtime_id and published;
    update public.agent_runtimes set status=next_status,worker_id=null,
      recovery_count=recovery_count+1,updated_at=input_now,
      completed_at=case when retry then null else input_now end
      where tenant_id=candidate.tenant_id and runtime_id=candidate.runtime_id;
    insert into public.agent_runtime_diagnostics(
      tenant_id,runtime_id,code,message,retryable,created_at
    ) values(
      candidate.tenant_id,candidate.runtime_id,
      case when candidate.expires_at is null then 'runtime_timeout' else 'lease_expired' end,
      'Agent runtime recovered.',retry,input_now
    );
    insert into public.agent_runtime_recovery_state(
      tenant_id,runtime_id,reason,previous_status,recovered_status,attempt,claim_token,recovered_at
    ) values(
      candidate.tenant_id,candidate.runtime_id,
      case when candidate.expires_at is null then 'runtime_timeout' else 'lease_expired' end,
      candidate.status,next_status,candidate.attempt,candidate.claim_token,input_now
    );
    recovered:=recovered+1;
  end loop;
  return query select recovered;
end; $$;

create or replace function public.list_agent_runtime_outputs(input_tenant_id text,input_runtime_id text)
returns table(outputs jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'outputId',record.output_id,'runtimeId',record.runtime_id,
    'executionVersion',record.execution_version,'workUnitVersion',record.work_unit_version,
    'agentVersion',record.agent_version,'capabilityVersion',record.capability_version,
    'outputVersion',record.output_version,'payloadHash',record.payload_hash,'output',record.output,
    'published',record.published,'orphaned',record.orphaned,'createdAt',record.created_at::text)
    order by record.output_version),'[]'::jsonb)
  from public.agent_runtime_outputs record
  where record.tenant_id=input_tenant_id and record.runtime_id=input_runtime_id
$$;

create or replace function public.agent_runtime_metrics()
returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'activeAgents',count(*) filter(where status not in ('completed','failed','cancelled')),
    'runningAgents',count(*) filter(where status='running'),
    'leases',(select count(*) from public.agent_runtime_leases where expires_at>now()),
    'retries',(select count(*) from public.agent_runtime_diagnostics where retryable),
    'failures',(select count(*) from public.agent_runtime_diagnostics where not retryable),
    'runtimeDurationMs',coalesce(sum(extract(epoch from (
      coalesce(completed_at,updated_at)-coalesce(started_at,created_at)))*1000),0),
    'heartbeatLatencyMs',(select coalesce(sum(latency_ms),0) from public.agent_runtime_heartbeats),
    'capabilityUsage',count(*),
    'outputBytes',(select coalesce(sum(pg_column_size(output)),0) from public.agent_runtime_outputs),
    'recoveryCount',coalesce(sum(recovery_count),0)
  ) from public.agent_runtimes
$$;

create or replace function public.collect_agent_runtimes(
  input_tenant_id text,input_retention_count integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('agent-runtime|'||input_tenant_id,0));
  with victims as (
    select runtime_id from public.agent_runtimes
    where tenant_id=input_tenant_id and status in ('completed','failed','cancelled')
    order by created_at desc,runtime_id desc offset greatest(1,input_retention_count)
  )
  delete from public.agent_runtimes runtime using victims
    where runtime.tenant_id=input_tenant_id and runtime.runtime_id=victims.runtime_id;
  get diagnostics removed=row_count;
  return query select removed;
end; $$;

create or replace function public.verify_agent_runtime_contract(
  input_runtime_version text,input_capabilities jsonb
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare table_name text;
begin
  if input_runtime_version<>'agent-runtime-v1' then
    issues:=issues||'"runtime_version_incompatible"'::jsonb;
  end if;
  foreach table_name in array array[
    'agent_capabilities','agent_runtimes','agent_runtime_leases','agent_runtime_outputs',
    'agent_runtime_diagnostics','agent_runtime_heartbeats','agent_runtime_recovery_state'
  ] loop
    if to_regclass('public.'||table_name) is null then
      issues:=issues||to_jsonb(table_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||table_name) and relrowsecurity) then
      issues:=issues||to_jsonb(table_name||'_rls_missing');
    end if;
  end loop;
  if jsonb_array_length(input_capabilities)<>10 then
    issues:=issues||'"capability_registry_incomplete"'::jsonb;
  end if;
  if to_regprocedure('public.lease_agent_runtime(text,text,integer,integer,integer)') is null
    or to_regprocedure('public.publish_agent_runtime_output(text,text,text,text,text,text,jsonb,integer)') is null
    or to_regprocedure('public.recover_agent_runtimes(timestamp with time zone,integer,integer)') is null then
    issues:=issues||'"runtime_rpc_contract_missing"'::jsonb;
  end if;
  if not exists(select 1 from pg_indexes where indexname='agent_runtime_leases_expiry_idx')
    or not exists(select 1 from pg_indexes where indexname='agent_runtimes_execution_fence_idx') then
    issues:=issues||'"runtime_indexes_missing"'::jsonb;
  end if;
  if not has_table_privilege('service_role','public.agent_runtimes','select')
    or has_table_privilege('anon','public.agent_runtimes','select')
    or not has_function_privilege('service_role',
      'public.lease_agent_runtime(text,text,integer,integer,integer)','execute')
    or has_function_privilege('anon',
      'public.lease_agent_runtime(text,text,integer,integer,integer)','execute') then
    issues:=issues||'"runtime_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure('public.collect_agent_runtimes(text,integer)') is null then
    issues:=issues||'"runtime_retention_missing"'::jsonb;
  end if;
  if exists(
    select 1 from public.agent_runtime_leases lease
    left join public.agent_runtimes runtime using(tenant_id,runtime_id)
    where runtime.runtime_id is null or lease.expires_at<=lease.leased_at
  ) then issues:=issues||'"runtime_leases_invalid"'::jsonb; end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'agent_capabilities','agent_runtimes','agent_runtime_leases','agent_runtime_outputs',
    'agent_runtime_diagnostics','agent_runtime_heartbeats','agent_runtime_recovery_state'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
    execute format('grant select,insert,update,delete on table public.%I to service_role',table_name);
  end loop;
end $$;

revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.agent_runtime_hash(jsonb) to service_role;
grant execute on function public.agent_runtime_json(text,text) to service_role;
grant execute on function public.create_agent_runtime(text,jsonb,jsonb,integer) to service_role;
grant execute on function public.get_agent_runtime(text,text) to service_role;
grant execute on function public.lease_agent_runtime(text,text,integer,integer,integer) to service_role;
grant execute on function public.assert_agent_runtime_fence(text,text,text,text,text,text) to service_role;
grant execute on function public.heartbeat_agent_runtime(text,text,text,text,text,text,integer) to service_role;
grant execute on function public.transition_agent_runtime(text,text,text,text,text,text,text) to service_role;
grant execute on function public.publish_agent_runtime_output(text,text,text,text,text,text,jsonb,integer) to service_role;
grant execute on function public.fail_agent_runtime(text,text,text,text,text,text,text,text,integer) to service_role;
grant execute on function public.cancel_agent_runtime(text,text) to service_role;
grant execute on function public.supersede_agent_runtime(text,text,text) to service_role;
grant execute on function public.recover_agent_runtimes(timestamptz,integer,integer) to service_role;
grant execute on function public.list_agent_runtime_outputs(text,text) to service_role;
grant execute on function public.agent_runtime_metrics() to service_role;
grant execute on function public.collect_agent_runtimes(text,integer) to service_role;
grant execute on function public.verify_agent_runtime_contract(text,jsonb) to service_role;
