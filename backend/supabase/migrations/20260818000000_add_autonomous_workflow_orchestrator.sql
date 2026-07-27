create table if not exists public.autonomous_workflows (
  tenant_id text not null,
  workflow_id text not null,
  schema_version text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  execution_id text not null,
  owner_id text not null,
  workflow_version integer not null,
  lifecycle text not null,
  current_stage text,
  state jsonb not null,
  stage_lease_expires_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key(tenant_id,workflow_id),
  constraint autonomous_workflow_schema_version_valid
    check(schema_version='autonomous-workflow-schema-v1'),
  constraint autonomous_workflow_lifecycle_valid check(lifecycle in(
    'created','analysing','planning','awaiting_approval','executing',
    'reviewing','assembling','preparing_apply','completed','cancelled','failed'
  )),
  constraint autonomous_workflow_stage_valid check(
    current_stage is null or current_stage in(
      'intelligence','planning','execution','agent_runtime','tool_invocation',
      'collaboration','workspace','patch','artifact','review','proposal',
      'apply','knowledge'
    )
  ),
  constraint autonomous_workflow_version_positive check(workflow_version>0),
  constraint autonomous_workflow_state_object
    check(jsonb_typeof(state)='object'),
  constraint autonomous_workflow_identity_fenced
    unique(tenant_id,repository_id,execution_id,owner_id)
);

create table if not exists public.autonomous_workflow_versions (
  tenant_id text not null,
  workflow_id text not null,
  workflow_version integer not null,
  lifecycle text not null,
  current_stage text,
  state_hash text not null,
  reason text not null,
  version jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,workflow_id,workflow_version),
  constraint autonomous_workflow_versions_workflow_fk
    foreign key(tenant_id,workflow_id)
    references public.autonomous_workflows(tenant_id,workflow_id)
    on delete cascade,
  constraint autonomous_workflow_versions_number_positive
    check(workflow_version>0),
  constraint autonomous_workflow_versions_hash_valid
    check(state_hash~'^[a-f0-9]{64}$'),
  constraint autonomous_workflow_versions_object
    check(jsonb_typeof(version)='object')
);

create table if not exists public.autonomous_workflow_checkpoints (
  tenant_id text not null,
  workflow_id text not null,
  checkpoint_id text not null,
  sequence integer not null,
  stage text not null,
  request_hash text not null,
  output_hash text not null,
  reference_id text not null,
  reference_version text not null,
  status text not null,
  checkpoint jsonb not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  duration_ms double precision not null,
  primary key(tenant_id,workflow_id,checkpoint_id),
  constraint autonomous_workflow_checkpoints_workflow_fk
    foreign key(tenant_id,workflow_id)
    references public.autonomous_workflows(tenant_id,workflow_id)
    on delete cascade,
  constraint autonomous_workflow_checkpoint_sequence_positive
    check(sequence>0),
  constraint autonomous_workflow_checkpoint_stage_valid check(stage in(
    'intelligence','planning','execution','agent_runtime','tool_invocation',
    'collaboration','workspace','patch','artifact','review','proposal',
    'apply','knowledge'
  )),
  constraint autonomous_workflow_checkpoint_hashes_valid check(
    request_hash~'^[a-f0-9]{64}$' and output_hash~'^[a-f0-9]{64}$'
  ),
  constraint autonomous_workflow_checkpoint_duration_nonnegative
    check(duration_ms>=0),
  constraint autonomous_workflow_checkpoint_object
    check(jsonb_typeof(checkpoint)='object'),
  constraint autonomous_workflow_checkpoint_order_unique
    unique(tenant_id,workflow_id,sequence),
  constraint autonomous_workflow_checkpoint_stage_unique
    unique(tenant_id,workflow_id,stage)
);

create table if not exists public.autonomous_workflow_approvals (
  tenant_id text not null,
  workflow_id text not null,
  approval_id text not null,
  workflow_version integer not null,
  owner_id text not null,
  execution_reference_id text not null,
  idempotency_key text not null,
  approval jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,workflow_id,approval_id),
  constraint autonomous_workflow_approvals_workflow_fk
    foreign key(tenant_id,workflow_id)
    references public.autonomous_workflows(tenant_id,workflow_id)
    on delete cascade,
  constraint autonomous_workflow_approval_version_positive
    check(workflow_version>0),
  constraint autonomous_workflow_approval_object
    check(jsonb_typeof(approval)='object'),
  constraint autonomous_workflow_approval_idempotency_unique
    unique(tenant_id,workflow_id,idempotency_key)
);

create table if not exists public.autonomous_workflow_diagnostics (
  tenant_id text not null,
  workflow_id text not null,
  diagnostic_id text not null,
  workflow_version integer not null,
  stage text,
  severity text not null,
  code text not null,
  retryable boolean not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,workflow_id,diagnostic_id),
  constraint autonomous_workflow_diagnostics_workflow_fk
    foreign key(tenant_id,workflow_id)
    references public.autonomous_workflows(tenant_id,workflow_id)
    on delete cascade,
  constraint autonomous_workflow_diagnostic_severity_valid
    check(severity in('info','warning','error')),
  constraint autonomous_workflow_diagnostic_object
    check(jsonb_typeof(diagnostic)='object')
);

create table if not exists public.autonomous_workflow_lifecycle_events (
  tenant_id text not null,
  workflow_id text not null,
  event_id text not null,
  workflow_version integer not null,
  from_lifecycle text,
  to_lifecycle text not null,
  stage text,
  reason text not null,
  event jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,workflow_id,event_id),
  constraint autonomous_workflow_events_workflow_fk
    foreign key(tenant_id,workflow_id)
    references public.autonomous_workflows(tenant_id,workflow_id)
    on delete cascade,
  constraint autonomous_workflow_event_object
    check(jsonb_typeof(event)='object')
);

create table if not exists public.autonomous_workflow_recoveries (
  tenant_id text not null,
  workflow_id text not null,
  recovery_id text not null,
  workflow_version integer not null,
  stage text not null,
  attempt_id text not null,
  reason text not null,
  resumed_from_checkpoint integer not null,
  recovery jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,workflow_id,recovery_id),
  constraint autonomous_workflow_recoveries_workflow_fk
    foreign key(tenant_id,workflow_id)
    references public.autonomous_workflows(tenant_id,workflow_id)
    on delete cascade,
  constraint autonomous_workflow_recovery_reason_valid
    check(reason in('expired_stage_lease','interrupted_stage')),
  constraint autonomous_workflow_recovery_checkpoint_nonnegative
    check(resumed_from_checkpoint>=0),
  constraint autonomous_workflow_recovery_object
    check(jsonb_typeof(recovery)='object')
);

create table if not exists public.autonomous_workflow_attempt_events (
  tenant_id text not null,
  workflow_id text not null,
  event_id text not null,
  workflow_version integer not null,
  attempt_id text not null,
  stage text not null,
  request_hash text not null,
  attempt integer not null,
  event_type text not null,
  event jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,workflow_id,event_id),
  constraint autonomous_workflow_attempt_events_workflow_fk
    foreign key(tenant_id,workflow_id)
    references public.autonomous_workflows(tenant_id,workflow_id)
    on delete cascade,
  constraint autonomous_workflow_attempt_event_type_valid
    check(event_type in(
      'started','succeeded','failed','recovered','cancelled'
    )),
  constraint autonomous_workflow_attempt_number_positive check(attempt>0),
  constraint autonomous_workflow_attempt_hash_valid
    check(request_hash~'^[a-f0-9]{64}$'),
  constraint autonomous_workflow_attempt_event_object
    check(jsonb_typeof(event)='object'),
  constraint autonomous_workflow_attempt_event_unique
    unique(tenant_id,workflow_id,attempt_id,event_type)
);

create table if not exists public.autonomous_workflow_archives (
  tenant_id text not null,
  workflow_id text not null,
  archived_at timestamptz not null,
  final_workflow_version integer not null,
  final_lifecycle text not null,
  reason text not null,
  metadata jsonb not null,
  primary key(tenant_id,workflow_id),
  constraint autonomous_workflow_archives_workflow_fk
    foreign key(tenant_id,workflow_id)
    references public.autonomous_workflows(tenant_id,workflow_id)
    on delete cascade,
  constraint autonomous_workflow_archive_lifecycle_valid
    check(final_lifecycle in('completed','cancelled','failed')),
  constraint autonomous_workflow_archive_reason_valid
    check(reason='retention'),
  constraint autonomous_workflow_archive_object
    check(jsonb_typeof(metadata)='object')
);

create table if not exists public.autonomous_workflow_retention (
  tenant_id text primary key,
  retained_workflows integer not null,
  retained_versions integer not null,
  retained_diagnostics integer not null,
  updated_at timestamptz not null default now(),
  constraint autonomous_workflow_retention_positive check(
    retained_workflows>0 and retained_versions>0 and retained_diagnostics>0
  )
);

create index if not exists autonomous_workflows_active_idx
  on public.autonomous_workflows(
    tenant_id,owner_id,lifecycle,updated_at,workflow_id
  );
create index if not exists autonomous_workflows_repository_idx
  on public.autonomous_workflows(
    tenant_id,repository_id,repository_revision,execution_id
  );
create index if not exists autonomous_workflows_recovery_idx
  on public.autonomous_workflows(
    stage_lease_expires_at,lifecycle
  ) where stage_lease_expires_at is not null;
create index if not exists autonomous_workflow_versions_history_idx
  on public.autonomous_workflow_versions(
    tenant_id,workflow_id,workflow_version desc
  );
create index if not exists autonomous_workflow_checkpoints_stage_idx
  on public.autonomous_workflow_checkpoints(
    tenant_id,workflow_id,stage,sequence
  );
create index if not exists autonomous_workflow_diagnostics_created_idx
  on public.autonomous_workflow_diagnostics(
    tenant_id,workflow_id,severity,created_at desc
  );
create index if not exists autonomous_workflow_recoveries_created_idx
  on public.autonomous_workflow_recoveries(
    tenant_id,workflow_id,created_at desc
  );
create index if not exists autonomous_workflow_attempt_events_stage_idx
  on public.autonomous_workflow_attempt_events(
    tenant_id,workflow_id,stage,attempt,event_type
  );
create index if not exists autonomous_workflow_archives_retention_idx
  on public.autonomous_workflow_archives(tenant_id,archived_at desc);

create or replace function public.get_autonomous_workflow(
  input_tenant_id text,input_workflow_id text
) returns table(workflow jsonb)
language sql stable security invoker set search_path=public as $$
  select state from public.autonomous_workflows
  where tenant_id=input_tenant_id and workflow_id=input_workflow_id
$$;

create or replace function public.count_active_autonomous_workflows(
  input_tenant_id text,input_owner_id text
) returns table(active_count bigint)
language sql stable security invoker set search_path=public as $$
  select count(*) from public.autonomous_workflows
  where tenant_id=input_tenant_id and owner_id=input_owner_id
    and lifecycle not in('completed','cancelled','failed')
$$;

create or replace function public.save_autonomous_workflow(
  input_workflow jsonb,input_expected_version text
) returns table(workflow jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.autonomous_workflows%rowtype;
declare version_value jsonb;
declare checkpoint_value jsonb;
declare approval_value jsonb;
declare diagnostic_value jsonb;
declare event_value jsonb;
declare attempt_event_value jsonb;
declare recovery_value jsonb;
declare archive_value jsonb:=input_workflow->'archiveMetadata';
declare inflight_value jsonb:=input_workflow->'inFlight';
declare tenant_value text:=input_workflow->>'tenantId';
declare workflow_value text:=input_workflow->>'workflowId';
begin
  if jsonb_typeof(input_workflow)<>'object'
    or input_workflow->>'schemaVersion'<>'autonomous-workflow-schema-v1'
    or jsonb_typeof(input_workflow->'versions')<>'array'
    or jsonb_typeof(input_workflow->'checkpoints')<>'array'
    or jsonb_typeof(input_workflow->'approvals')<>'array'
    or jsonb_typeof(input_workflow->'diagnostics')<>'array'
    or jsonb_typeof(input_workflow->'lifecycleHistory')<>'array'
    or jsonb_typeof(input_workflow->'attemptHistory')<>'array'
    or jsonb_typeof(input_workflow->'recoveryHistory')<>'array'
    or jsonb_typeof(input_workflow->'retryCounts')<>'object'
    or jsonb_array_length(input_workflow->'versions')
      <>(input_workflow->>'workflowVersion')::integer
    or jsonb_array_length(input_workflow->'checkpoints')>13 then
    raise check_violation using message='autonomous_workflow_schema_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=input_workflow->>'repositoryId'
      and repository.owner_user_id=input_workflow->>'ownerId'
      and repository.current_revision=input_workflow->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation using message=
      'autonomous_workflow_ownership_or_revision_conflict';
  end if;
  if exists(
    select 1
    from jsonb_array_elements(input_workflow->'versions')
      with ordinality version(value,position)
    where (version.value->>'workflowVersion')::integer<>version.position
  ) or exists(
    select 1
    from jsonb_array_elements(input_workflow->'checkpoints')
      with ordinality checkpoint(value,position)
    where (checkpoint.value->>'sequence')::integer<>checkpoint.position
      or checkpoint.value->>'stage'<>(array[
        'intelligence','planning','execution','agent_runtime',
        'tool_invocation','collaboration','workspace','patch','artifact',
        'review','proposal','apply','knowledge'
      ])[checkpoint.position::integer]
  ) then
    raise check_violation using message=
      'autonomous_workflow_immutable_history_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_value||'|'||workflow_value,0)
  );
  select * into existing from public.autonomous_workflows candidate
  where candidate.tenant_id=tenant_value
    and candidate.workflow_id=workflow_value for update;
  if found and (
      input_expected_version is null
      or (existing.state->>'persistenceVersion')::bigint
        <>input_expected_version::bigint
    ) then
    raise serialization_failure using message=
      'autonomous_workflow_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure using message=
      'autonomous_workflow_version_conflict';
  end if;

  insert into public.autonomous_workflows(
    tenant_id,workflow_id,schema_version,repository_id,
    repository_revision,execution_id,owner_id,workflow_version,lifecycle,
    current_stage,state,stage_lease_expires_at,created_at,updated_at,
    completed_at
  ) values(
    tenant_value,workflow_value,input_workflow->>'schemaVersion',
    input_workflow->>'repositoryId',input_workflow->>'repositoryRevision',
    input_workflow->>'executionId',input_workflow->>'ownerId',
    (input_workflow->>'workflowVersion')::integer,
    input_workflow->>'lifecycle',nullif(input_workflow->>'currentStage',''),
    input_workflow,
    case when jsonb_typeof(inflight_value)='object'
      then (inflight_value->>'leaseExpiresAt')::timestamptz else null end,
    (input_workflow->>'createdAt')::timestamptz,
    (input_workflow->>'updatedAt')::timestamptz,
    nullif(input_workflow->>'completedAt','')::timestamptz
  ) on conflict(tenant_id,workflow_id) do update set
    workflow_version=excluded.workflow_version,
    lifecycle=excluded.lifecycle,current_stage=excluded.current_stage,
    state=excluded.state,
    stage_lease_expires_at=excluded.stage_lease_expires_at,
    updated_at=excluded.updated_at,completed_at=excluded.completed_at
  where autonomous_workflows.repository_id=excluded.repository_id
    and autonomous_workflows.repository_revision=
      excluded.repository_revision
    and autonomous_workflows.execution_id=excluded.execution_id
    and autonomous_workflows.owner_id=excluded.owner_id;
  if not found then
    raise check_violation using message=
      'autonomous_workflow_identity_conflict';
  end if;

  for version_value in
    select * from jsonb_array_elements(input_workflow->'versions')
  loop
    insert into public.autonomous_workflow_versions(
      tenant_id,workflow_id,workflow_version,lifecycle,current_stage,
      state_hash,reason,version,created_at
    ) values(
      tenant_value,workflow_value,
      (version_value->>'workflowVersion')::integer,
      version_value->>'lifecycle',
      nullif(version_value->>'currentStage',''),
      version_value->>'stateHash',version_value->>'reason',version_value,
      (version_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,workflow_id,workflow_version) do nothing;
    if not found and not exists(
      select 1 from public.autonomous_workflow_versions candidate
      where candidate.tenant_id=tenant_value
        and candidate.workflow_id=workflow_value
        and candidate.workflow_version=
          (version_value->>'workflowVersion')::integer
        and candidate.version=version_value
    ) then
      raise check_violation using message=
        'autonomous_workflow_immutable_history_conflict';
    end if;
  end loop;
  for checkpoint_value in
    select * from jsonb_array_elements(input_workflow->'checkpoints')
  loop
    insert into public.autonomous_workflow_checkpoints(
      tenant_id,workflow_id,checkpoint_id,sequence,stage,request_hash,
      output_hash,reference_id,reference_version,status,checkpoint,
      started_at,completed_at,duration_ms
    ) values(
      tenant_value,workflow_value,checkpoint_value->>'checkpointId',
      (checkpoint_value->>'sequence')::integer,checkpoint_value->>'stage',
      checkpoint_value->>'requestHash',
      checkpoint_value->'result'->>'outputHash',
      checkpoint_value->'result'->>'referenceId',
      checkpoint_value->'result'->>'referenceVersion',
      checkpoint_value->'result'->>'status',checkpoint_value,
      (checkpoint_value->>'startedAt')::timestamptz,
      (checkpoint_value->>'completedAt')::timestamptz,
      (checkpoint_value->>'durationMs')::double precision
    ) on conflict(tenant_id,workflow_id,checkpoint_id) do nothing;
  end loop;
  for approval_value in
    select * from jsonb_array_elements(input_workflow->'approvals')
  loop
    insert into public.autonomous_workflow_approvals(
      tenant_id,workflow_id,approval_id,workflow_version,owner_id,
      execution_reference_id,idempotency_key,approval,created_at
    ) values(
      tenant_value,workflow_value,approval_value->>'approvalId',
      (approval_value->>'workflowVersion')::integer,
      approval_value->>'ownerId',approval_value->>'executionReferenceId',
      approval_value->>'idempotencyKey',approval_value,
      (approval_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,workflow_id,approval_id) do nothing;
  end loop;
  for diagnostic_value in
    select * from jsonb_array_elements(input_workflow->'diagnostics')
  loop
    insert into public.autonomous_workflow_diagnostics(
      tenant_id,workflow_id,diagnostic_id,workflow_version,stage,severity,
      code,retryable,diagnostic,created_at
    ) values(
      tenant_value,workflow_value,diagnostic_value->>'diagnosticId',
      (diagnostic_value->>'workflowVersion')::integer,
      nullif(diagnostic_value->>'stage',''),
      diagnostic_value->>'severity',diagnostic_value->>'code',
      (diagnostic_value->>'retryable')::boolean,diagnostic_value,
      (diagnostic_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,workflow_id,diagnostic_id) do nothing;
  end loop;
  for event_value in
    select * from jsonb_array_elements(input_workflow->'lifecycleHistory')
  loop
    insert into public.autonomous_workflow_lifecycle_events(
      tenant_id,workflow_id,event_id,workflow_version,from_lifecycle,
      to_lifecycle,stage,reason,event,created_at
    ) values(
      tenant_value,workflow_value,event_value->>'eventId',
      (event_value->>'workflowVersion')::integer,
      nullif(event_value->>'from',''),event_value->>'to',
      nullif(event_value->>'stage',''),event_value->>'reason',event_value,
      (event_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,workflow_id,event_id) do nothing;
  end loop;
  for recovery_value in
    select * from jsonb_array_elements(input_workflow->'recoveryHistory')
  loop
    insert into public.autonomous_workflow_recoveries(
      tenant_id,workflow_id,recovery_id,workflow_version,stage,attempt_id,
      reason,resumed_from_checkpoint,recovery,created_at
    ) values(
      tenant_value,workflow_value,recovery_value->>'recoveryId',
      (recovery_value->>'workflowVersion')::integer,
      recovery_value->>'stage',recovery_value->>'attemptId',
      recovery_value->>'reason',
      (recovery_value->>'resumedFromCheckpoint')::integer,recovery_value,
      (recovery_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,workflow_id,recovery_id) do nothing;
  end loop;
  for attempt_event_value in
    select * from jsonb_array_elements(input_workflow->'attemptHistory')
  loop
    insert into public.autonomous_workflow_attempt_events(
      tenant_id,workflow_id,event_id,workflow_version,attempt_id,stage,
      request_hash,attempt,event_type,event,created_at
    ) values(
      tenant_value,workflow_value,attempt_event_value->>'eventId',
      (attempt_event_value->>'workflowVersion')::integer,
      attempt_event_value->>'attemptId',attempt_event_value->>'stage',
      attempt_event_value->>'requestHash',
      (attempt_event_value->>'attempt')::integer,
      attempt_event_value->>'event',attempt_event_value,
      (attempt_event_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,workflow_id,event_id) do nothing;
  end loop;
  if jsonb_typeof(archive_value)='object' then
    insert into public.autonomous_workflow_archives(
      tenant_id,workflow_id,archived_at,final_workflow_version,
      final_lifecycle,reason,metadata
    ) values(
      tenant_value,workflow_value,
      (archive_value->>'archivedAt')::timestamptz,
      (archive_value->>'finalWorkflowVersion')::integer,
      archive_value->>'finalLifecycle',archive_value->>'reason',archive_value
    ) on conflict(tenant_id,workflow_id) do nothing;
  end if;
  return query select input_workflow;
end; $$;

create or replace function public.list_recoverable_autonomous_workflows(
  input_now timestamptz
) returns table(workflows jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(
    jsonb_agg(state order by updated_at,workflow_id),'[]'::jsonb
  ) from public.autonomous_workflows
  where stage_lease_expires_at is not null
    and stage_lease_expires_at<=input_now
    and lifecycle not in('completed','cancelled','failed')
$$;

create or replace function public.autonomous_workflow_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  with filtered as(
    select * from public.autonomous_workflows candidate
    where input_tenant_id is null or candidate.tenant_id=input_tenant_id
  ), stages(stage,ordinal) as(values
    ('intelligence',1),('planning',2),('execution',3),('agent_runtime',4),
    ('tool_invocation',5),('collaboration',6),('workspace',7),('patch',8),
    ('artifact',9),('review',10),('proposal',11),('apply',12),
    ('knowledge',13)
  )
  select jsonb_build_object(
    'activeWorkflows',(
      select count(*) from filtered
      where lifecycle not in('completed','cancelled','failed')
    ),
    'stageDurationsMs',(
      select jsonb_object_agg(
        stage,coalesce((
          select sum(duration_ms)
          from public.autonomous_workflow_checkpoints checkpoint
          where checkpoint.stage=stages.stage
            and (
              input_tenant_id is null
              or checkpoint.tenant_id=input_tenant_id
            )
        ),0) order by ordinal
      ) from stages
    ),
    'retries',coalesce((
      select sum((
        select sum(value::integer)
        from jsonb_each_text(state->'retryCounts')
      )) from filtered
    ),0),
    'failures',coalesce((
      select sum((state->>'failureCount')::integer) from filtered
    ),0),
    'recoveryCount',coalesce((
      select sum((state->>'recoveryCount')::integer) from filtered
    ),0),
    'completionLatencyMs',coalesce((
      select sum(
        extract(epoch from(completed_at-created_at))*1000
      ) from filtered where completed_at is not null
    ),0)
  )
$$;

create or replace function public.collect_autonomous_workflows(
  input_tenant_id text,input_workflow_retention integer,
  input_version_retention integer,input_diagnostic_retention integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer:=0;
declare affected integer:=0;
begin
  insert into public.autonomous_workflow_retention(
    tenant_id,retained_workflows,retained_versions,retained_diagnostics
  ) values(
    input_tenant_id,greatest(1,input_workflow_retention),
    greatest(1,input_version_retention),
    greatest(1,input_diagnostic_retention)
  ) on conflict(tenant_id) do update set
    retained_workflows=excluded.retained_workflows,
    retained_versions=excluded.retained_versions,
    retained_diagnostics=excluded.retained_diagnostics,updated_at=now();
  with victims as(
    select workflow_id from public.autonomous_workflows
    where tenant_id=input_tenant_id
      and lifecycle in('completed','cancelled','failed')
    order by completed_at desc nulls last,workflow_id desc
    offset greatest(1,input_workflow_retention)
  )
  delete from public.autonomous_workflows candidate using victims
  where candidate.tenant_id=input_tenant_id
    and candidate.workflow_id=victims.workflow_id;
  get diagnostics affected=row_count;
  removed:=removed+affected;
  return query select removed;
end; $$;

create or replace function public.verify_autonomous_workflow_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  if input_engine_version<>'autonomous-workflow-orchestrator-v1'
    or input_schema_version<>'autonomous-workflow-schema-v1' then
    issues:=issues||'"autonomous_workflow_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'autonomous_workflows','autonomous_workflow_versions',
    'autonomous_workflow_checkpoints','autonomous_workflow_approvals',
    'autonomous_workflow_diagnostics','autonomous_workflow_lifecycle_events',
    'autonomous_workflow_recoveries','autonomous_workflow_attempt_events',
    'autonomous_workflow_archives',
    'autonomous_workflow_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(
      select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity
    ) then issues:=issues||to_jsonb(object_name||'_rls_missing'); end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='autonomous_workflows_active_idx')
    or not exists(select 1 from pg_indexes
      where indexname='autonomous_workflow_versions_history_idx')
    or not exists(select 1 from pg_indexes
      where indexname='autonomous_workflow_checkpoints_stage_idx')
    or not exists(select 1 from pg_indexes
      where indexname='autonomous_workflow_attempt_events_stage_idx')
    or not exists(select 1 from pg_indexes
      where indexname='autonomous_workflow_archives_retention_idx') then
    issues:=issues||'"autonomous_workflow_indexes_missing"'::jsonb;
  end if;
  if not exists(select 1 from pg_constraint
      where conname='autonomous_workflow_lifecycle_valid')
    or not exists(select 1 from pg_constraint
      where conname='autonomous_workflow_identity_fenced')
    or not exists(select 1 from pg_constraint
      where conname='autonomous_workflow_versions_workflow_fk'
        and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='autonomous_workflow_checkpoints_workflow_fk'
        and confdeltype='c') then
    issues:=issues||'"autonomous_workflow_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.autonomous_workflows','select')
    or has_table_privilege(
      'anon','public.autonomous_workflows','select')
    or not has_function_privilege(
      'service_role','public.save_autonomous_workflow(jsonb,text)','execute')
    or has_function_privilege(
      'anon','public.save_autonomous_workflow(jsonb,text)','execute')
  then
    issues:=issues||'"autonomous_workflow_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure(
      'public.collect_autonomous_workflows(text,integer,integer,integer)'
    ) is null then
    issues:=issues||'"autonomous_workflow_retention_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare object_name text;
begin
  foreach object_name in array array[
    'autonomous_workflows','autonomous_workflow_versions',
    'autonomous_workflow_checkpoints','autonomous_workflow_approvals',
    'autonomous_workflow_diagnostics','autonomous_workflow_lifecycle_events',
    'autonomous_workflow_recoveries','autonomous_workflow_attempt_events',
    'autonomous_workflow_archives',
    'autonomous_workflow_retention'
  ] loop
    execute format(
      'alter table public.%I enable row level security',object_name);
    execute format(
      'revoke all on table public.%I from public,anon,authenticated',
      object_name);
    execute format(
      'grant select,insert,update,delete on table public.%I to service_role',
      object_name);
  end loop;
end $$;

revoke all on function public.get_autonomous_workflow(text,text)
  from public,anon,authenticated;
revoke all on function public.count_active_autonomous_workflows(text,text)
  from public,anon,authenticated;
revoke all on function public.save_autonomous_workflow(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.list_recoverable_autonomous_workflows(timestamptz)
  from public,anon,authenticated;
revoke all on function public.autonomous_workflow_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_autonomous_workflows(
  text,integer,integer,integer
) from public,anon,authenticated;
revoke all on function public.verify_autonomous_workflow_contract(text,text)
  from public,anon,authenticated;

grant execute on function public.get_autonomous_workflow(text,text)
  to service_role;
grant execute on function public.count_active_autonomous_workflows(text,text)
  to service_role;
grant execute on function public.save_autonomous_workflow(jsonb,text)
  to service_role;
grant execute on function public.list_recoverable_autonomous_workflows(
  timestamptz
) to service_role;
grant execute on function public.autonomous_workflow_metrics(text)
  to service_role;
grant execute on function public.collect_autonomous_workflows(
  text,integer,integer,integer
) to service_role;
grant execute on function public.verify_autonomous_workflow_contract(text,text)
  to service_role;
