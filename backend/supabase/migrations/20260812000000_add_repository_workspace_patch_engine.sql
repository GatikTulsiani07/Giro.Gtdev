create table if not exists public.repository_workspaces (
  tenant_id text not null,
  workspace_id text not null,
  schema_version text not null,
  repository_id text not null references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  execution_id text not null,
  work_unit_id text not null,
  owner_id text not null,
  snapshot_version text not null,
  snapshot_hash text not null,
  lifecycle text not null,
  lease jsonb,
  state jsonb not null,
  conflict_count integer not null default 0,
  validation_failure_count integer not null default 0,
  recovery_count integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key(tenant_id,workspace_id),
  constraint repository_workspace_identity_non_empty check(
    tenant_id<>'' and workspace_id<>'' and repository_id<>'' and
    repository_revision<>'' and execution_id<>'' and work_unit_id<>'' and owner_id<>''
  ),
  constraint repository_workspace_lifecycle_valid check(lifecycle in(
    'created','preparing','ready','leased','active','validating',
    'archived','expired','failed','cancelled'
  )),
  constraint repository_workspace_state_object check(jsonb_typeof(state)='object'),
  constraint repository_workspace_counts_nonnegative check(
    conflict_count>=0 and validation_failure_count>=0 and recovery_count>=0
  ),
  constraint repository_workspace_lease_consistent check(
    (lifecycle in('leased','active','validating') and lease is not null) or
    (lifecycle not in('leased','active','validating') and lease is null)
  ),
  constraint repository_workspace_completion_consistent check(
    (lifecycle in('archived','expired','failed','cancelled') and completed_at is not null) or
    (lifecycle not in('archived','expired','failed','cancelled') and completed_at is null)
  )
);

create table if not exists public.repository_workspace_snapshots (
  tenant_id text not null,
  workspace_id text not null,
  snapshot_id text not null,
  snapshot_version text not null,
  snapshot_hash text not null,
  revision_hash text not null,
  repository_revision text not null,
  graph_version text not null,
  intelligence_version text not null,
  retrieval_version text not null,
  planning_version text not null,
  snapshot jsonb not null,
  published boolean not null,
  created_at timestamptz not null,
  primary key(tenant_id,workspace_id,snapshot_id),
  unique(tenant_id,workspace_id),
  constraint repository_workspace_snapshot_workspace_fk foreign key(tenant_id,workspace_id)
    references public.repository_workspaces(tenant_id,workspace_id) on delete cascade,
  constraint repository_workspace_snapshot_published check(published),
  constraint repository_workspace_snapshot_hash_non_empty check(
    snapshot_hash<>'' and revision_hash<>'' and repository_revision<>''
  ),
  constraint repository_workspace_snapshot_revision_fenced
    check(revision_hash=repository_revision),
  constraint repository_workspace_snapshot_object check(jsonb_typeof(snapshot)='object')
);

create table if not exists public.repository_patches (
  tenant_id text not null,
  workspace_id text not null,
  patch_id text not null,
  execution_id text not null,
  work_unit_id text not null,
  patch_version integer not null,
  snapshot_hash text not null,
  content_hash text not null,
  confidence double precision not null,
  created_at timestamptz not null,
  primary key(tenant_id,workspace_id,patch_id),
  unique(tenant_id,workspace_id,patch_version),
  foreign key(tenant_id,workspace_id)
    references public.repository_workspaces(tenant_id,workspace_id) on delete cascade,
  constraint repository_patch_version_positive check(patch_version>0),
  constraint repository_patch_confidence_valid check(confidence>=0 and confidence<=1),
  constraint repository_patch_hashes_non_empty check(snapshot_hash<>'' and content_hash<>'')
);

create table if not exists public.repository_patch_versions (
  tenant_id text not null,
  workspace_id text not null,
  patch_id text not null,
  patch_version integer not null,
  schema_version text not null,
  file_operations jsonb not null,
  symbol_operations jsonb not null,
  diagnostics jsonb not null,
  patch jsonb not null,
  validated_at timestamptz not null,
  primary key(tenant_id,workspace_id,patch_version),
  foreign key(tenant_id,workspace_id,patch_id)
    references public.repository_patches(tenant_id,workspace_id,patch_id) on delete cascade,
  constraint repository_patch_file_operations_array
    check(jsonb_typeof(file_operations)='array'),
  constraint repository_patch_symbol_operations_array
    check(jsonb_typeof(symbol_operations)='array'),
  constraint repository_patch_diagnostics_array check(jsonb_typeof(diagnostics)='array'),
  constraint repository_patch_version_object check(jsonb_typeof(patch)='object')
);

create table if not exists public.repository_workspace_diagnostics (
  tenant_id text not null,
  workspace_id text not null,
  diagnostic_id text not null,
  patch_id text,
  severity text not null,
  code text not null,
  message text not null,
  affected_files jsonb not null,
  affected_symbols jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,workspace_id,diagnostic_id),
  foreign key(tenant_id,workspace_id)
    references public.repository_workspaces(tenant_id,workspace_id) on delete cascade,
  constraint repository_workspace_diagnostic_severity_valid
    check(severity in('warning','blocker','validation_failure')),
  constraint repository_workspace_diagnostic_arrays check(
    jsonb_typeof(affected_files)='array' and jsonb_typeof(affected_symbols)='array'
  )
);

create table if not exists public.repository_workspace_archives (
  tenant_id text not null,
  workspace_id text not null,
  archived_at timestamptz not null,
  patch_count integer not null,
  final_patch_version integer not null,
  snapshot_hash text not null,
  metadata jsonb not null,
  primary key(tenant_id,workspace_id),
  foreign key(tenant_id,workspace_id)
    references public.repository_workspaces(tenant_id,workspace_id) on delete cascade,
  constraint repository_workspace_archive_counts_nonnegative
    check(patch_count>=0 and final_patch_version>=0),
  constraint repository_workspace_archive_metadata_object check(jsonb_typeof(metadata)='object')
);

create table if not exists public.repository_workspace_retention (
  tenant_id text primary key,
  archived_workspaces integer not null,
  patch_history integer not null,
  diagnostics integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_workspace_retention_positive check(
    archived_workspaces>0 and patch_history>0 and diagnostics>0
  )
);

create index if not exists repository_workspaces_owner_lifecycle_idx
  on public.repository_workspaces(tenant_id,owner_id,lifecycle,created_at);
create index if not exists repository_workspaces_execution_idx
  on public.repository_workspaces(tenant_id,execution_id,work_unit_id);
create index if not exists repository_workspaces_repository_revision_idx
  on public.repository_workspaces(repository_id,repository_revision);
create index if not exists repository_workspaces_lease_expiration_idx
  on public.repository_workspaces(((lease->>'expiresAt')));
create index if not exists repository_patches_history_idx
  on public.repository_patches(tenant_id,workspace_id,patch_version desc);
create index if not exists repository_workspace_diagnostics_created_idx
  on public.repository_workspace_diagnostics(tenant_id,workspace_id,created_at desc);
create index if not exists repository_workspace_archives_retention_idx
  on public.repository_workspace_archives(tenant_id,archived_at desc);

create or replace function public.get_repository_workspace(
  input_tenant_id text,input_workspace_id text
) returns table(workspace jsonb)
language sql stable security invoker set search_path=public as $$
  select state from public.repository_workspaces
  where tenant_id=input_tenant_id and workspace_id=input_workspace_id
$$;

create or replace function public.save_repository_workspace(
  input_workspace jsonb,input_expected_version text
) returns table(workspace jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.repository_workspaces%rowtype;
declare snapshot_value jsonb:=input_workspace->'snapshot';
declare patch_value jsonb;
declare diagnostic_value jsonb;
declare archive_value jsonb:=input_workspace->'archiveMetadata';
declare tenant_value text:=input_workspace->>'tenantId';
declare workspace_value text:=input_workspace->>'workspaceId';
begin
  if jsonb_typeof(input_workspace)<>'object'
    or jsonb_typeof(input_workspace->'patches')<>'array'
    or jsonb_typeof(input_workspace->'diagnostics')<>'array'
    or jsonb_typeof(input_workspace->'recoveryHistory')<>'array'
    or jsonb_typeof(snapshot_value)<>'object'
    or snapshot_value->>'published'<>'true' then
    raise check_violation using message='repository_workspace_state_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=input_workspace->>'repositoryId'
      and repository.owner_user_id=input_workspace->>'ownerId'
      and repository.current_revision=input_workspace->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation using message='repository_workspace_snapshot_unpublished';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant_value||'|'||workspace_value,0));
  select * into existing from public.repository_workspaces candidate
  where candidate.tenant_id=tenant_value and candidate.workspace_id=workspace_value
  for update;
  if found and (input_expected_version is null or
      (existing.state->>'persistenceVersion')::bigint<>input_expected_version::bigint) then
    raise serialization_failure using message='repository_workspace_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure using message='repository_workspace_version_conflict';
  end if;

  insert into public.repository_workspaces(
    tenant_id,workspace_id,schema_version,repository_id,repository_revision,
    execution_id,work_unit_id,owner_id,snapshot_version,snapshot_hash,lifecycle,
    lease,state,conflict_count,validation_failure_count,recovery_count,
    created_at,updated_at,completed_at
  ) values(
    tenant_value,workspace_value,input_workspace->>'schemaVersion',
    input_workspace->>'repositoryId',input_workspace->>'repositoryRevision',
    input_workspace->>'executionId',input_workspace->>'workUnitId',
    input_workspace->>'ownerId',input_workspace->>'snapshotVersion',
    snapshot_value->>'snapshotHash',input_workspace->>'lifecycle',
    case when jsonb_typeof(input_workspace->'lease')='object'
      then input_workspace->'lease' else null end,
    input_workspace,(input_workspace->>'conflictCount')::integer,
    (input_workspace->>'validationFailureCount')::integer,
    (input_workspace->>'recoveryCount')::integer,
    (input_workspace->>'createdAt')::timestamptz,
    (input_workspace->>'updatedAt')::timestamptz,
    nullif(input_workspace->>'completedAt','')::timestamptz
  ) on conflict(tenant_id,workspace_id) do update set
    lifecycle=excluded.lifecycle,lease=excluded.lease,state=excluded.state,
    conflict_count=excluded.conflict_count,
    validation_failure_count=excluded.validation_failure_count,
    recovery_count=excluded.recovery_count,updated_at=excluded.updated_at,
    completed_at=excluded.completed_at
  where repository_workspaces.repository_id=excluded.repository_id
    and repository_workspaces.repository_revision=excluded.repository_revision
    and repository_workspaces.execution_id=excluded.execution_id
    and repository_workspaces.work_unit_id=excluded.work_unit_id
    and repository_workspaces.owner_id=excluded.owner_id
    and repository_workspaces.snapshot_hash=excluded.snapshot_hash;
  if not found then
    raise check_violation using message='repository_workspace_identity_conflict';
  end if;

  insert into public.repository_workspace_snapshots(
    tenant_id,workspace_id,snapshot_id,snapshot_version,snapshot_hash,
    revision_hash,repository_revision,graph_version,intelligence_version,
    retrieval_version,planning_version,snapshot,published,created_at
  ) values(
    tenant_value,workspace_value,snapshot_value->>'snapshotId',
    snapshot_value->>'snapshotVersion',snapshot_value->>'snapshotHash',
    snapshot_value->>'revisionHash',snapshot_value->>'repositoryRevision',
    snapshot_value->>'graphVersion',snapshot_value->>'intelligenceVersion',
    snapshot_value->>'retrievalVersion',snapshot_value->>'planningVersion',
    snapshot_value,true,(snapshot_value->>'createdAt')::timestamptz
  ) on conflict(tenant_id,workspace_id) do update set
    snapshot_hash=excluded.snapshot_hash
  where repository_workspace_snapshots.snapshot_id=excluded.snapshot_id
    and repository_workspace_snapshots.snapshot_hash=excluded.snapshot_hash;
  if not found then
    raise check_violation using message='repository_workspace_snapshot_stale';
  end if;

  for patch_value in select * from jsonb_array_elements(input_workspace->'patches') loop
    insert into public.repository_patches(
      tenant_id,workspace_id,patch_id,execution_id,work_unit_id,patch_version,
      snapshot_hash,content_hash,confidence,created_at
    ) values(
      tenant_value,workspace_value,patch_value->>'patchId',
      patch_value->>'executionId',patch_value->>'workUnitId',
      (patch_value->>'patchVersion')::integer,patch_value->>'snapshotHash',
      patch_value->>'contentHash',(patch_value->>'confidence')::double precision,
      (patch_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,workspace_id,patch_id) do nothing;
    if not found and not exists(
      select 1 from public.repository_patches candidate
      where candidate.tenant_id=tenant_value and candidate.workspace_id=workspace_value
        and candidate.patch_id=patch_value->>'patchId'
        and candidate.content_hash=patch_value->>'contentHash'
        and candidate.patch_version=(patch_value->>'patchVersion')::integer
    ) then raise check_violation using message='repository_patch_version_stale'; end if;
    insert into public.repository_patch_versions(
      tenant_id,workspace_id,patch_id,patch_version,schema_version,
      file_operations,symbol_operations,diagnostics,patch,validated_at
    ) values(
      tenant_value,workspace_value,patch_value->>'patchId',
      (patch_value->>'patchVersion')::integer,'repository-patch-schema-v1',
      patch_value->'fileOperations',patch_value->'symbolOperations',
      patch_value->'diagnostics',patch_value,
      (patch_value->>'validatedAt')::timestamptz
    ) on conflict(tenant_id,workspace_id,patch_version) do nothing;
  end loop;

  for diagnostic_value in
    select * from jsonb_array_elements(input_workspace->'diagnostics')
  loop
    insert into public.repository_workspace_diagnostics(
      tenant_id,workspace_id,diagnostic_id,patch_id,severity,code,message,
      affected_files,affected_symbols,created_at
    ) values(
      tenant_value,workspace_value,diagnostic_value->>'diagnosticId',
      nullif(diagnostic_value->>'patchId',''),diagnostic_value->>'severity',
      diagnostic_value->>'code',diagnostic_value->>'message',
      diagnostic_value->'affectedFiles',diagnostic_value->'affectedSymbols',
      (diagnostic_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,workspace_id,diagnostic_id) do nothing;
  end loop;

  if jsonb_typeof(archive_value)='object' then
    insert into public.repository_workspace_archives(
      tenant_id,workspace_id,archived_at,patch_count,final_patch_version,
      snapshot_hash,metadata
    ) values(
      tenant_value,workspace_value,(archive_value->>'archivedAt')::timestamptz,
      (archive_value->>'patchCount')::integer,
      (archive_value->>'finalPatchVersion')::integer,
      archive_value->>'snapshotHash',archive_value
    ) on conflict(tenant_id,workspace_id) do nothing;
  end if;
  return query select input_workspace;
end; $$;

create or replace function public.list_recoverable_repository_workspaces()
returns table(workspaces jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(state order by updated_at,workspace_id),'[]'::jsonb)
  from public.repository_workspaces
  where lifecycle not in('archived','expired','failed','cancelled')
$$;

create or replace function public.repository_workspace_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'workspaceCreation',count(*),
    'activeWorkspaces',count(*) filter(
      where lifecycle not in('archived','expired','failed','cancelled')),
    'patchGeneration',coalesce(sum(jsonb_array_length(state->'patches')),0),
    'validationFailures',coalesce(sum(validation_failure_count),0),
    'conflicts',coalesce(sum(conflict_count),0),
    'archiveCount',count(*) filter(where lifecycle='archived'),
    'recoveryCount',coalesce(sum(recovery_count),0),
    'workspaceDurationMs',coalesce(sum(case when completed_at is not null
      then extract(epoch from(completed_at-created_at))*1000 else 0 end),0)
  ) from public.repository_workspaces candidate
  where input_tenant_id is null or candidate.tenant_id=input_tenant_id
$$;

create or replace function public.collect_repository_workspaces(
  input_tenant_id text,input_workspace_retention integer,
  input_patch_retention integer,input_diagnostic_retention integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.repository_workspace_retention(
    tenant_id,archived_workspaces,patch_history,diagnostics
  ) values(
    input_tenant_id,greatest(1,input_workspace_retention),
    greatest(1,input_patch_retention),greatest(1,input_diagnostic_retention)
  ) on conflict(tenant_id) do update set
    archived_workspaces=excluded.archived_workspaces,
    patch_history=excluded.patch_history,diagnostics=excluded.diagnostics,
    updated_at=now();
  with ranked as(
    select tenant_id,workspace_id,diagnostic_id,
      row_number() over(
        partition by tenant_id,workspace_id order by created_at desc,diagnostic_id desc
      ) as position
    from public.repository_workspace_diagnostics
    where tenant_id=input_tenant_id
  )
  delete from public.repository_workspace_diagnostics diagnostic using ranked
  where diagnostic.tenant_id=ranked.tenant_id
    and diagnostic.workspace_id=ranked.workspace_id
    and diagnostic.diagnostic_id=ranked.diagnostic_id
    and ranked.position>greatest(1,input_diagnostic_retention);
  with ranked as(
    select tenant_id,workspace_id,patch_id,
      row_number() over(
        partition by tenant_id,workspace_id order by patch_version desc,patch_id desc
      ) as position
    from public.repository_patches where tenant_id=input_tenant_id
  )
  delete from public.repository_patches patch using ranked
  where patch.tenant_id=ranked.tenant_id
    and patch.workspace_id=ranked.workspace_id
    and patch.patch_id=ranked.patch_id
    and ranked.position>greatest(1,input_patch_retention);
  with victims as(
    select workspace_id from public.repository_workspaces
    where tenant_id=input_tenant_id
      and lifecycle in('archived','expired','failed','cancelled')
    order by completed_at desc,workspace_id desc
    offset greatest(1,input_workspace_retention)
  )
  delete from public.repository_workspaces candidate using victims
  where candidate.tenant_id=input_tenant_id
    and candidate.workspace_id=victims.workspace_id;
  get diagnostics removed=row_count;
  return query select removed;
end; $$;

create or replace function public.verify_repository_workspace_contract(
  input_engine_version text,input_patch_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare table_name text;
begin
  if input_engine_version<>'repository-workspace-patch-v1'
    or input_patch_schema_version<>'repository-patch-schema-v1' then
    issues:=issues||'"repository_workspace_version_incompatible"'::jsonb;
  end if;
  foreach table_name in array array[
    'repository_workspaces','repository_workspace_snapshots','repository_patches',
    'repository_patch_versions','repository_workspace_diagnostics',
    'repository_workspace_archives','repository_workspace_retention'
  ] loop
    if to_regclass('public.'||table_name) is null then
      issues:=issues||to_jsonb(table_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||table_name) and relrowsecurity) then
      issues:=issues||to_jsonb(table_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='repository_workspaces_owner_lifecycle_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_patches_history_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_workspace_archives_retention_idx') then
    issues:=issues||'"repository_workspace_indexes_missing"'::jsonb;
  end if;
  if not exists(select 1 from pg_constraint
      where conname='repository_workspace_lifecycle_valid')
    or not exists(select 1 from pg_constraint
      where conname='repository_workspace_snapshot_revision_fenced')
    or not exists(select 1 from pg_constraint
      where conname='repository_patch_confidence_valid')
    or not exists(select 1 from pg_constraint
      where conname='repository_workspace_snapshot_workspace_fk'
        and confdeltype='c') then
    issues:=issues||'"repository_workspace_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege('service_role','public.repository_workspaces','select')
    or has_table_privilege('anon','public.repository_workspaces','select')
    or not has_function_privilege('service_role',
      'public.save_repository_workspace(jsonb,text)','execute')
    or has_function_privilege('anon',
      'public.save_repository_workspace(jsonb,text)','execute') then
    issues:=issues||'"repository_workspace_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure('public.collect_repository_workspaces(text,integer,integer,integer)')
      is null then
    issues:=issues||'"repository_workspace_retention_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'repository_workspaces','repository_workspace_snapshots','repository_patches',
    'repository_patch_versions','repository_workspace_diagnostics',
    'repository_workspace_archives','repository_workspace_retention'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
    execute format('grant select,insert,update,delete on table public.%I to service_role',table_name);
  end loop;
end $$;

revoke all on function public.get_repository_workspace(text,text)
  from public,anon,authenticated;
revoke all on function public.save_repository_workspace(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.list_recoverable_repository_workspaces()
  from public,anon,authenticated;
revoke all on function public.repository_workspace_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_repository_workspaces(text,integer,integer,integer)
  from public,anon,authenticated;
revoke all on function public.verify_repository_workspace_contract(text,text)
  from public,anon,authenticated;

grant execute on function public.get_repository_workspace(text,text) to service_role;
grant execute on function public.save_repository_workspace(jsonb,text) to service_role;
grant execute on function public.list_recoverable_repository_workspaces() to service_role;
grant execute on function public.repository_workspace_metrics(text) to service_role;
grant execute on function public.collect_repository_workspaces(text,integer,integer,integer)
  to service_role;
grant execute on function public.verify_repository_workspace_contract(text,text)
  to service_role;
