create table if not exists public.repository_proposed_artifacts (
  tenant_id text not null,
  artifact_id text not null,
  schema_version text not null,
  repository_id text not null references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  workspace_id text not null,
  execution_id text not null,
  work_unit_id text not null,
  owner_id text not null,
  artifact_type text not null,
  artifact_version integer not null,
  lifecycle text not null,
  state jsonb not null,
  validation_failure_count integer not null default 0,
  recovery_count integer not null default 0,
  generation_lease_expires_at timestamptz,
  review_requested_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key(tenant_id,artifact_id),
  foreign key(tenant_id,workspace_id)
    references public.repository_workspaces(tenant_id,workspace_id) on delete cascade,
  constraint repository_artifact_schema_version_valid
    check(schema_version='repository-artifact-schema-v1'),
  constraint repository_artifact_type_valid check(artifact_type in(
    'source_code','unit_tests','integration_tests','documentation',
    'configuration','migration_proposal','api_contract_update',
    'refactoring_proposal'
  )),
  constraint repository_artifact_lifecycle_valid check(lifecycle in(
    'created','generating','generated','validated','awaiting_review',
    'approved','rejected','archived','expired'
  )),
  constraint repository_artifact_version_positive check(artifact_version>0),
  constraint repository_artifact_counts_nonnegative
    check(validation_failure_count>=0 and recovery_count>=0),
  constraint repository_artifact_state_object check(jsonb_typeof(state)='object'),
  constraint repository_artifact_identity_fenced unique(
    tenant_id,workspace_id,execution_id,work_unit_id,artifact_type
  )
);

create table if not exists public.repository_artifact_versions (
  tenant_id text not null,
  artifact_id text not null,
  artifact_version integer not null,
  content_hash text not null,
  artifact_type text not null,
  structured_content jsonb not null,
  affected_files jsonb not null,
  affected_symbols jsonb not null,
  confidence double precision not null,
  warnings jsonb not null,
  generation_metadata jsonb not null,
  version jsonb not null,
  created_at timestamptz not null,
  generated_at timestamptz not null,
  validated_at timestamptz not null,
  primary key(tenant_id,artifact_id,artifact_version),
  constraint repository_artifact_versions_artifact_fk
  foreign key(tenant_id,artifact_id)
    references public.repository_proposed_artifacts(tenant_id,artifact_id) on delete cascade,
  constraint repository_artifact_version_number_positive check(artifact_version>0),
  constraint repository_artifact_version_confidence_valid
    check(confidence>=0 and confidence<=1),
  constraint repository_artifact_version_content_object
    check(jsonb_typeof(structured_content)='object'),
  constraint repository_artifact_version_arrays check(
    jsonb_typeof(affected_files)='array'
    and jsonb_typeof(affected_symbols)='array'
    and jsonb_typeof(warnings)='array'
  ),
  constraint repository_artifact_version_metadata_object
    check(jsonb_typeof(generation_metadata)='object'),
  constraint repository_artifact_version_state_object
    check(jsonb_typeof(version)='object'),
  constraint repository_artifact_version_hash_unique
    unique(tenant_id,artifact_id,content_hash)
);

create table if not exists public.repository_artifact_diagnostics (
  tenant_id text not null,
  artifact_id text not null,
  diagnostic_id text not null,
  artifact_version integer not null,
  severity text not null,
  code text not null,
  message text not null,
  affected_files jsonb not null,
  affected_symbols jsonb not null,
  finding jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,artifact_id,diagnostic_id),
  foreign key(tenant_id,artifact_id,artifact_version)
    references public.repository_artifact_versions(
      tenant_id,artifact_id,artifact_version
    ) on delete cascade,
  constraint repository_artifact_diagnostic_severity_valid
    check(severity in('warning','blocker','validation_finding')),
  constraint repository_artifact_diagnostic_arrays check(
    jsonb_typeof(affected_files)='array'
    and jsonb_typeof(affected_symbols)='array'
  ),
  constraint repository_artifact_diagnostic_finding_object
    check(jsonb_typeof(finding)='object')
);

create table if not exists public.repository_artifact_approvals (
  tenant_id text not null,
  artifact_id text not null,
  approval_id text not null,
  artifact_version integer not null,
  owner_id text not null,
  reviewer_id text not null,
  decision text not null,
  findings jsonb not null,
  idempotency_key text not null,
  approval jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,artifact_id,approval_id),
  foreign key(tenant_id,artifact_id,artifact_version)
    references public.repository_artifact_versions(
      tenant_id,artifact_id,artifact_version
    ) on delete cascade,
  constraint repository_artifact_approval_decision_valid
    check(decision in('approved','rejected')),
  constraint repository_artifact_approval_findings_array
    check(jsonb_typeof(findings)='array'),
  constraint repository_artifact_approval_object
    check(jsonb_typeof(approval)='object'),
  constraint repository_artifact_approval_idempotency_unique
    unique(tenant_id,artifact_id,idempotency_key)
);

create table if not exists public.repository_artifact_archives (
  tenant_id text not null,
  artifact_id text not null,
  archived_at timestamptz not null,
  final_artifact_version integer not null,
  content_hash text not null,
  reason text not null,
  metadata jsonb not null,
  primary key(tenant_id,artifact_id),
  foreign key(tenant_id,artifact_id)
    references public.repository_proposed_artifacts(tenant_id,artifact_id) on delete cascade,
  constraint repository_artifact_archive_version_positive
    check(final_artifact_version>0),
  constraint repository_artifact_archive_reason_valid
    check(reason in('retention','manual','workspace_terminal')),
  constraint repository_artifact_archive_metadata_object
    check(jsonb_typeof(metadata)='object')
);

create table if not exists public.repository_artifact_retention (
  tenant_id text primary key,
  retained_artifacts integer not null,
  retained_versions integer not null,
  retained_diagnostics integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_artifact_retention_positive check(
    retained_artifacts>0 and retained_versions>0 and retained_diagnostics>0
  )
);

create index if not exists repository_proposed_artifacts_workspace_type_idx
  on public.repository_proposed_artifacts(
    tenant_id,workspace_id,artifact_type,artifact_version desc
  );
create index if not exists repository_proposed_artifacts_execution_idx
  on public.repository_proposed_artifacts(tenant_id,execution_id,work_unit_id);
create index if not exists repository_proposed_artifacts_owner_lifecycle_idx
  on public.repository_proposed_artifacts(tenant_id,owner_id,lifecycle,updated_at);
create index if not exists repository_proposed_artifacts_recovery_idx
  on public.repository_proposed_artifacts(
    lifecycle,generation_lease_expires_at,updated_at
  );
create index if not exists repository_artifact_versions_history_idx
  on public.repository_artifact_versions(
    tenant_id,artifact_id,artifact_version desc
  );
create index if not exists repository_artifact_diagnostics_created_idx
  on public.repository_artifact_diagnostics(
    tenant_id,artifact_id,created_at desc
  );
create index if not exists repository_artifact_approvals_wait_idx
  on public.repository_artifact_approvals(
    tenant_id,artifact_id,created_at
  );
create index if not exists repository_artifact_archives_retention_idx
  on public.repository_artifact_archives(tenant_id,archived_at desc);

create or replace function public.get_repository_artifact(
  input_tenant_id text,input_artifact_id text
) returns table(artifact jsonb)
language sql stable security invoker set search_path=public as $$
  select state from public.repository_proposed_artifacts
  where tenant_id=input_tenant_id and artifact_id=input_artifact_id
$$;

create or replace function public.count_repository_workspace_artifacts(
  input_tenant_id text,input_workspace_id text
) returns table(artifact_count bigint)
language sql stable security invoker set search_path=public as $$
  select count(*) from public.repository_proposed_artifacts
  where tenant_id=input_tenant_id and workspace_id=input_workspace_id
$$;

create or replace function public.save_repository_artifact(
  input_artifact jsonb,input_expected_version text
) returns table(artifact jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.repository_proposed_artifacts%rowtype;
declare version_value jsonb;
declare diagnostic_value jsonb;
declare approval_value jsonb;
declare archive_value jsonb:=input_artifact->'archiveMetadata';
declare tenant_value text:=input_artifact->>'tenantId';
declare artifact_value text:=input_artifact->>'artifactId';
begin
  if jsonb_typeof(input_artifact)<>'object'
    or jsonb_typeof(input_artifact->'versions')<>'array'
    or jsonb_typeof(input_artifact->'diagnostics')<>'array'
    or jsonb_typeof(input_artifact->'approvals')<>'array'
    or jsonb_typeof(input_artifact->'lifecycleHistory')<>'array'
    or jsonb_typeof(input_artifact->'recoveryHistory')<>'array'
    or jsonb_array_length(input_artifact->'versions')<1 then
    raise check_violation using message='repository_artifact_schema_invalid';
  end if;
  if not exists(
    select 1 from public.repository_workspaces workspace
    join public.repositories repository
      on repository.repository_id=workspace.repository_id
    where workspace.tenant_id=tenant_value
      and workspace.workspace_id=input_artifact->>'workspaceId'
      and workspace.execution_id=input_artifact->>'executionId'
      and workspace.work_unit_id=input_artifact->>'workUnitId'
      and workspace.repository_revision=input_artifact->>'repositoryRevision'
      and workspace.owner_id=input_artifact->>'ownerId'
      and (
        workspace.lifecycle in('active','validating')
        or (
          input_artifact->>'lifecycle' in('archived','expired')
          and exists(
            select 1 from public.repository_proposed_artifacts artifact
            where artifact.tenant_id=tenant_value
              and artifact.artifact_id=artifact_value
          )
        )
      )
      and repository.owner_user_id=input_artifact->>'ownerId'
      and repository.current_revision=input_artifact->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation using message='repository_artifact_workspace_stale';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(tenant_value||'|'||artifact_value,0)
  );
  select * into existing from public.repository_proposed_artifacts candidate
  where candidate.tenant_id=tenant_value
    and candidate.artifact_id=artifact_value for update;
  if found and (input_expected_version is null or
      (existing.state->>'persistenceVersion')::bigint
        <>input_expected_version::bigint) then
    raise serialization_failure
      using message='repository_artifact_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure
      using message='repository_artifact_version_conflict';
  end if;

  insert into public.repository_proposed_artifacts(
    tenant_id,artifact_id,schema_version,repository_id,repository_revision,
    workspace_id,execution_id,work_unit_id,owner_id,artifact_type,
    artifact_version,lifecycle,state,validation_failure_count,recovery_count,
    generation_lease_expires_at,review_requested_at,created_at,updated_at,
    completed_at
  ) values(
    tenant_value,artifact_value,input_artifact->>'schemaVersion',
    input_artifact->>'repositoryId',input_artifact->>'repositoryRevision',
    input_artifact->>'workspaceId',input_artifact->>'executionId',
    input_artifact->>'workUnitId',input_artifact->>'ownerId',
    input_artifact->>'artifactType',
    (input_artifact->>'artifactVersion')::integer,
    input_artifact->>'lifecycle',input_artifact,
    (input_artifact->>'validationFailureCount')::integer,
    (input_artifact->>'recoveryCount')::integer,
    nullif(input_artifact->>'generationLeaseExpiresAt','')::timestamptz,
    nullif(input_artifact->>'reviewRequestedAt','')::timestamptz,
    (input_artifact->>'createdAt')::timestamptz,
    (input_artifact->>'updatedAt')::timestamptz,
    nullif(input_artifact->>'completedAt','')::timestamptz
  ) on conflict(tenant_id,artifact_id) do update set
    artifact_version=excluded.artifact_version,
    lifecycle=excluded.lifecycle,state=excluded.state,
    validation_failure_count=excluded.validation_failure_count,
    recovery_count=excluded.recovery_count,
    generation_lease_expires_at=excluded.generation_lease_expires_at,
    review_requested_at=excluded.review_requested_at,
    updated_at=excluded.updated_at,completed_at=excluded.completed_at
  where repository_proposed_artifacts.repository_id=excluded.repository_id
    and repository_proposed_artifacts.repository_revision=excluded.repository_revision
    and repository_proposed_artifacts.workspace_id=excluded.workspace_id
    and repository_proposed_artifacts.execution_id=excluded.execution_id
    and repository_proposed_artifacts.work_unit_id=excluded.work_unit_id
    and repository_proposed_artifacts.owner_id=excluded.owner_id
    and repository_proposed_artifacts.artifact_type=excluded.artifact_type;
  if not found then
    raise check_violation using message='repository_artifact_identity_conflict';
  end if;

  for version_value in
    select * from jsonb_array_elements(input_artifact->'versions')
  loop
    if version_value->'structuredContent'->>'proposalOnly'<>'true'
      or version_value->'structuredContent'->>'schemaVersion'
        <>'repository-artifact-content-v1' then
      raise check_violation using message='repository_artifact_schema_invalid';
    end if;
    insert into public.repository_artifact_versions(
      tenant_id,artifact_id,artifact_version,content_hash,artifact_type,
      structured_content,affected_files,affected_symbols,confidence,warnings,
      generation_metadata,version,created_at,generated_at,validated_at
    ) values(
      tenant_value,artifact_value,
      (version_value->>'artifactVersion')::integer,
      version_value->>'contentHash',
      version_value->'structuredContent'->>'artifactType',
      version_value->'structuredContent',version_value->'affectedFiles',
      version_value->'affectedSymbols',
      (version_value->>'confidence')::double precision,
      version_value->'warnings',version_value->'generationMetadata',
      version_value,(version_value->>'createdAt')::timestamptz,
      (version_value->>'generatedAt')::timestamptz,
      (version_value->>'validatedAt')::timestamptz
    ) on conflict(tenant_id,artifact_id,artifact_version) do nothing;
    if not found and not exists(
      select 1 from public.repository_artifact_versions candidate
      where candidate.tenant_id=tenant_value
        and candidate.artifact_id=artifact_value
        and candidate.artifact_version=
          (version_value->>'artifactVersion')::integer
        and candidate.content_hash=version_value->>'contentHash'
    ) then
      raise check_violation using message='repository_artifact_version_stale';
    end if;
  end loop;

  for diagnostic_value in
    select * from jsonb_array_elements(input_artifact->'diagnostics')
  loop
    insert into public.repository_artifact_diagnostics(
      tenant_id,artifact_id,diagnostic_id,artifact_version,severity,code,
      message,affected_files,affected_symbols,finding,created_at
    ) values(
      tenant_value,artifact_value,diagnostic_value->>'diagnosticId',
      coalesce((diagnostic_value->>'artifactVersion')::integer,
        (input_artifact->>'artifactVersion')::integer),
      diagnostic_value->>'severity',diagnostic_value->>'code',
      diagnostic_value->>'message',diagnostic_value->'affectedFiles',
      diagnostic_value->'affectedSymbols',diagnostic_value,
      (diagnostic_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,artifact_id,diagnostic_id) do nothing;
  end loop;

  for approval_value in
    select * from jsonb_array_elements(input_artifact->'approvals')
  loop
    insert into public.repository_artifact_approvals(
      tenant_id,artifact_id,approval_id,artifact_version,owner_id,reviewer_id,
      decision,findings,idempotency_key,approval,created_at
    ) values(
      tenant_value,artifact_value,approval_value->>'approvalId',
      (approval_value->>'artifactVersion')::integer,
      approval_value->>'ownerId',approval_value->>'reviewerId',
      approval_value->>'decision',approval_value->'findings',
      approval_value->>'idempotencyKey',approval_value,
      (approval_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,artifact_id,approval_id) do nothing;
  end loop;

  if jsonb_typeof(archive_value)='object' then
    insert into public.repository_artifact_archives(
      tenant_id,artifact_id,archived_at,final_artifact_version,
      content_hash,reason,metadata
    ) values(
      tenant_value,artifact_value,
      (archive_value->>'archivedAt')::timestamptz,
      (archive_value->>'finalArtifactVersion')::integer,
      archive_value->>'contentHash',archive_value->>'reason',archive_value
    ) on conflict(tenant_id,artifact_id) do nothing;
  end if;
  return query select input_artifact;
end; $$;

create or replace function public.list_recoverable_repository_artifacts()
returns table(artifacts jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(state order by updated_at,artifact_id),'[]'::jsonb)
  from public.repository_proposed_artifacts
  where lifecycle not in('approved','rejected','archived','expired')
$$;

create or replace function public.repository_artifact_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'artifactsGenerated',coalesce(sum(jsonb_array_length(state->'versions')),0),
    'generationLatencyMs',coalesce(sum((
      select sum((version->'generationMetadata'->>'generationLatencyMs')::numeric)
      from jsonb_array_elements(state->'versions') version
    )),0),
    'validationFailures',coalesce(sum(validation_failure_count),0),
    'recoveryCount',coalesce(sum(recovery_count),0),
    'retentionCount',0,
    'approvalWaitTimeMs',coalesce(sum((
      select sum(greatest(0,extract(epoch from(
        (approval->>'createdAt')::timestamptz-review_requested_at
      ))*1000))
      from jsonb_array_elements(state->'approvals') approval
      where review_requested_at is not null
    )),0)
  ) from public.repository_proposed_artifacts candidate
  where input_tenant_id is null or candidate.tenant_id=input_tenant_id
$$;

create or replace function public.collect_repository_artifacts(
  input_tenant_id text,input_artifact_retention integer,
  input_version_retention integer,input_diagnostic_retention integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer:=0;
declare affected integer:=0;
begin
  insert into public.repository_artifact_retention(
    tenant_id,retained_artifacts,retained_versions,retained_diagnostics
  ) values(
    input_tenant_id,greatest(1,input_artifact_retention),
    greatest(1,input_version_retention),
    greatest(1,input_diagnostic_retention)
  ) on conflict(tenant_id) do update set
    retained_artifacts=excluded.retained_artifacts,
    retained_versions=excluded.retained_versions,
    retained_diagnostics=excluded.retained_diagnostics,
    updated_at=now();
  with ranked as(
    select tenant_id,artifact_id,diagnostic_id,
      row_number() over(
        partition by tenant_id,artifact_id
        order by created_at desc,diagnostic_id desc
      ) as position
    from public.repository_artifact_diagnostics
    where tenant_id=input_tenant_id
  )
  delete from public.repository_artifact_diagnostics diagnostic using ranked
  where diagnostic.tenant_id=ranked.tenant_id
    and diagnostic.artifact_id=ranked.artifact_id
    and diagnostic.diagnostic_id=ranked.diagnostic_id
    and ranked.position>greatest(1,input_diagnostic_retention);
  get diagnostics affected=row_count;
  removed:=removed+affected;
  with victims as(
    select artifact_id from public.repository_proposed_artifacts
    where tenant_id=input_tenant_id
      and lifecycle in('approved','rejected','archived','expired')
    order by completed_at desc nulls last,artifact_id desc
    offset greatest(1,input_artifact_retention)
  )
  delete from public.repository_proposed_artifacts candidate using victims
  where candidate.tenant_id=input_tenant_id
    and candidate.artifact_id=victims.artifact_id;
  get diagnostics affected=row_count;
  removed:=removed+affected;
  return query select removed;
end; $$;

create or replace function public.verify_repository_artifact_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  if input_engine_version<>'repository-artifact-engine-v1'
    or input_schema_version<>'repository-artifact-schema-v1' then
    issues:=issues||'"repository_artifact_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'repository_proposed_artifacts','repository_artifact_versions',
    'repository_artifact_diagnostics','repository_artifact_approvals',
    'repository_artifact_archives','repository_artifact_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(
      select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity
    ) then
      issues:=issues||to_jsonb(object_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='repository_proposed_artifacts_workspace_type_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_artifact_versions_history_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_artifact_archives_retention_idx') then
    issues:=issues||'"repository_artifact_indexes_missing"'::jsonb;
  end if;
  if not exists(select 1 from pg_constraint
      where conname='repository_artifact_lifecycle_valid')
    or not exists(select 1 from pg_constraint
      where conname='repository_artifact_identity_fenced')
    or not exists(select 1 from pg_constraint
      where conname='repository_artifact_version_confidence_valid')
    or not exists(select 1 from pg_constraint
      where conname='repository_artifact_versions_artifact_fk'
        and confdeltype='c') then
    issues:=issues||'"repository_artifact_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.repository_proposed_artifacts','select')
    or has_table_privilege(
      'anon','public.repository_proposed_artifacts','select')
    or not has_function_privilege(
      'service_role','public.save_repository_artifact(jsonb,text)','execute')
    or has_function_privilege(
      'anon','public.save_repository_artifact(jsonb,text)','execute') then
    issues:=issues||'"repository_artifact_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure(
      'public.collect_repository_artifacts(text,integer,integer,integer)'
    ) is null
    or to_regprocedure(
      'public.count_repository_workspace_artifacts(text,text)'
    ) is null then
    issues:=issues||'"repository_artifact_retention_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare object_name text;
begin
  foreach object_name in array array[
    'repository_proposed_artifacts','repository_artifact_versions',
    'repository_artifact_diagnostics','repository_artifact_approvals',
    'repository_artifact_archives','repository_artifact_retention'
  ] loop
    execute format(
      'alter table public.%I enable row level security',object_name
    );
    execute format(
      'revoke all on table public.%I from public,anon,authenticated',
      object_name
    );
    execute format(
      'grant select,insert,update,delete on table public.%I to service_role',
      object_name
    );
  end loop;
end $$;

revoke all on function public.get_repository_artifact(text,text)
  from public,anon,authenticated;
revoke all on function public.count_repository_workspace_artifacts(text,text)
  from public,anon,authenticated;
revoke all on function public.save_repository_artifact(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.list_recoverable_repository_artifacts()
  from public,anon,authenticated;
revoke all on function public.repository_artifact_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_repository_artifacts(
  text,integer,integer,integer
) from public,anon,authenticated;
revoke all on function public.verify_repository_artifact_contract(text,text)
  from public,anon,authenticated;

grant execute on function public.get_repository_artifact(text,text)
  to service_role;
grant execute on function public.count_repository_workspace_artifacts(text,text)
  to service_role;
grant execute on function public.save_repository_artifact(jsonb,text)
  to service_role;
grant execute on function public.list_recoverable_repository_artifacts()
  to service_role;
grant execute on function public.repository_artifact_metrics(text)
  to service_role;
grant execute on function public.collect_repository_artifacts(
  text,integer,integer,integer
) to service_role;
grant execute on function public.verify_repository_artifact_contract(text,text)
  to service_role;
