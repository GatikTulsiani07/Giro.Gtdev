create table if not exists public.repository_sandboxes (
  tenant_id text not null,
  sandbox_id text not null,
  schema_version text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  workflow_id text not null,
  execution_id text not null,
  owner_id text not null,
  repository_revision text not null,
  workspace_root text not null,
  workspace_fingerprint text not null,
  lifecycle text not null,
  persistence_version bigint not null,
  state jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  ready_at timestamptz,
  released_at timestamptz,
  archived_at timestamptz,
  primary key(tenant_id,sandbox_id),
  unique(tenant_id,workspace_root),
  unique(tenant_id,repository_id,workflow_id,execution_id,repository_revision),
  constraint repository_sandbox_schema_version_valid
    check(schema_version='repository-sandbox-schema-v1'),
  constraint repository_sandbox_identity_non_empty check(
    tenant_id<>'' and sandbox_id<>'' and repository_id<>'' and workflow_id<>''
    and execution_id<>'' and owner_id<>'' and repository_revision<>''
    and workspace_root<>'' and workspace_fingerprint<>''
  ),
  constraint repository_sandbox_lifecycle_valid check(
    lifecycle in('creating','ready','leased','released','archived','failed')
  ),
  constraint repository_sandbox_persistence_version_positive
    check(persistence_version>0),
  constraint repository_sandbox_state_object
    check(jsonb_typeof(state)='object'),
  constraint repository_sandbox_lifecycle_timestamps check(
    (lifecycle='ready' and ready_at is not null) or lifecycle<>'ready'
  )
);

create table if not exists public.repository_sandbox_leases (
  tenant_id text not null,
  sandbox_id text not null,
  lease_id text not null,
  owner_id text not null,
  lease_owner text not null,
  fencing_token bigint not null,
  claim_token text not null,
  started_at timestamptz not null,
  renewed_at timestamptz not null,
  expires_at timestamptz not null,
  renewals integer not null,
  released_at timestamptz,
  lease jsonb not null,
  primary key(tenant_id,sandbox_id,lease_id),
  unique(tenant_id,sandbox_id,fencing_token),
  constraint repository_sandbox_lease_sandbox_fk
    foreign key(tenant_id,sandbox_id)
    references public.repository_sandboxes(tenant_id,sandbox_id) on delete cascade,
  constraint repository_sandbox_lease_identity_non_empty check(
    lease_id<>'' and owner_id<>'' and lease_owner<>'' and claim_token<>''
  ),
  constraint repository_sandbox_lease_fence_positive check(fencing_token>0),
  constraint repository_sandbox_lease_renewals_nonnegative check(renewals>=0),
  constraint repository_sandbox_lease_times_valid check(
    started_at<=renewed_at and renewed_at<expires_at
    and (released_at is null or released_at>=started_at)
  ),
  constraint repository_sandbox_lease_object check(jsonb_typeof(lease)='object')
);

create unique index if not exists repository_sandbox_one_active_lease_idx
  on public.repository_sandbox_leases(tenant_id,sandbox_id)
  where released_at is null;

create table if not exists public.repository_sandbox_recoveries (
  tenant_id text not null,
  sandbox_id text not null,
  recovery_id text not null,
  reason text not null,
  previous_lifecycle text not null,
  recovered_lifecycle text not null,
  recovery jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,sandbox_id,recovery_id),
  constraint repository_sandbox_recovery_sandbox_fk
    foreign key(tenant_id,sandbox_id)
    references public.repository_sandboxes(tenant_id,sandbox_id) on delete cascade,
  constraint repository_sandbox_recovery_reason_valid check(
    reason in('abandoned_sandbox','expired_lease','failed_preparation','orphan_metadata')
  ),
  constraint repository_sandbox_recovery_lifecycles_valid check(
    previous_lifecycle in('creating','ready','leased','released','archived','failed')
    and recovered_lifecycle in('creating','ready','leased','released','archived','failed')
  ),
  constraint repository_sandbox_recovery_object check(jsonb_typeof(recovery)='object')
);

create table if not exists public.repository_sandbox_archives (
  tenant_id text not null,
  sandbox_id text not null,
  repository_revision text not null,
  workspace_fingerprint text not null,
  lease_count integer not null,
  metadata jsonb not null,
  archived_at timestamptz not null,
  primary key(tenant_id,sandbox_id),
  constraint repository_sandbox_archive_sandbox_fk
    foreign key(tenant_id,sandbox_id)
    references public.repository_sandboxes(tenant_id,sandbox_id) on delete cascade,
  constraint repository_sandbox_archive_identity_non_empty check(
    repository_revision<>'' and workspace_fingerprint<>''
  ),
  constraint repository_sandbox_archive_lease_count_nonnegative check(lease_count>=0),
  constraint repository_sandbox_archive_object check(jsonb_typeof(metadata)='object')
);

create table if not exists public.repository_sandbox_retention (
  tenant_id text primary key,
  retained_sandboxes integer not null,
  retained_recovery_records integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_sandbox_retention_positive check(
    retained_sandboxes>0 and retained_recovery_records>0
  )
);

create index if not exists repository_sandboxes_owner_lifecycle_idx
  on public.repository_sandboxes(tenant_id,owner_id,lifecycle,updated_at);
create index if not exists repository_sandboxes_repository_revision_idx
  on public.repository_sandboxes(tenant_id,repository_id,repository_revision);
create index if not exists repository_sandboxes_workflow_execution_idx
  on public.repository_sandboxes(tenant_id,workflow_id,execution_id);
create index if not exists repository_sandbox_leases_expiry_idx
  on public.repository_sandbox_leases(expires_at)
  where released_at is null;
create index if not exists repository_sandbox_recoveries_retention_idx
  on public.repository_sandbox_recoveries(tenant_id,sandbox_id,created_at desc);
create index if not exists repository_sandbox_archives_retention_idx
  on public.repository_sandbox_archives(tenant_id,archived_at desc);

create or replace function public.get_repository_sandbox(
  input_tenant_id text,input_owner_id text,input_repository_id text,
  input_sandbox_id text
) returns table(sandbox jsonb)
language sql stable security invoker set search_path=public as $$
  select state from public.repository_sandboxes
  where tenant_id=input_tenant_id and owner_id=input_owner_id
    and repository_id=input_repository_id and sandbox_id=input_sandbox_id
$$;

create or replace function public.list_repository_sandboxes_for_owner(
  input_tenant_id text,input_owner_id text
) returns table(sandboxes jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(state order by created_at,sandbox_id),'[]'::jsonb)
  from public.repository_sandboxes
  where tenant_id=input_tenant_id and owner_id=input_owner_id
$$;

create or replace function public.save_repository_sandbox(
  input_sandbox jsonb,input_expected_version text
) returns table(sandbox jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.repository_sandboxes%rowtype;
declare lease_value jsonb;
declare recovery_value jsonb;
declare archive_value jsonb:=input_sandbox->'archiveMetadata';
declare tenant_value text:=input_sandbox->>'tenantId';
declare sandbox_value text:=input_sandbox->>'sandboxId';
begin
  if jsonb_typeof(input_sandbox)<>'object'
    or jsonb_typeof(input_sandbox->'workspace')<>'object'
    or jsonb_typeof(input_sandbox->'leases')<>'array'
    or jsonb_typeof(input_sandbox->'recoveryHistory')<>'array'
    or input_sandbox->'workspace'->>'repositoryRevision'
      <>input_sandbox->>'repositoryRevision'
    or input_sandbox->'workspace'->'repositorySnapshot'->>'repositoryId'
      <>input_sandbox->>'repositoryId'
    or input_sandbox->'workspace'->'repositorySnapshot'->>'repositoryRevision'
      <>input_sandbox->>'repositoryRevision' then
    raise check_violation using message='repository_sandbox_state_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=input_sandbox->>'repositoryId'
      and repository.owner_user_id=input_sandbox->>'ownerId'
      and repository.current_revision=input_sandbox->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation using message='repository_sandbox_access_denied';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(tenant_value||'|'||sandbox_value,0)
  );
  select * into existing from public.repository_sandboxes candidate
  where candidate.tenant_id=tenant_value
    and candidate.sandbox_id=sandbox_value for update;
  if found and input_expected_version is null then
    if existing.repository_id=input_sandbox->>'repositoryId'
      and existing.workflow_id=input_sandbox->>'workflowId'
      and existing.execution_id=input_sandbox->>'executionId'
      and existing.owner_id=input_sandbox->>'ownerId'
      and existing.repository_revision=input_sandbox->>'repositoryRevision'
      and existing.workspace_root=input_sandbox->>'workspaceRoot'
      and existing.workspace_fingerprint=
        input_sandbox->'workspace'->>'workspaceFingerprint' then
      return query select existing.state;
      return;
    end if;
    raise check_violation using message='repository_sandbox_identity_conflict';
  elsif found and existing.persistence_version<>input_expected_version::bigint then
    raise serialization_failure using message='repository_sandbox_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure using message='repository_sandbox_version_conflict';
  end if;

  insert into public.repository_sandboxes(
    tenant_id,sandbox_id,schema_version,repository_id,workflow_id,execution_id,
    owner_id,repository_revision,workspace_root,workspace_fingerprint,lifecycle,
    persistence_version,state,created_at,updated_at,ready_at,released_at,archived_at
  ) values(
    tenant_value,sandbox_value,input_sandbox->>'schemaVersion',
    input_sandbox->>'repositoryId',input_sandbox->>'workflowId',
    input_sandbox->>'executionId',input_sandbox->>'ownerId',
    input_sandbox->>'repositoryRevision',input_sandbox->>'workspaceRoot',
    input_sandbox->'workspace'->>'workspaceFingerprint',
    input_sandbox->>'lifecycle',(input_sandbox->>'persistenceVersion')::bigint,
    input_sandbox,(input_sandbox->>'createdAt')::timestamptz,
    (input_sandbox->>'updatedAt')::timestamptz,
    nullif(input_sandbox->>'readyAt','')::timestamptz,
    nullif(input_sandbox->>'releasedAt','')::timestamptz,
    nullif(input_sandbox->>'archivedAt','')::timestamptz
  ) on conflict(tenant_id,sandbox_id) do update set
    lifecycle=excluded.lifecycle,persistence_version=excluded.persistence_version,
    state=excluded.state,updated_at=excluded.updated_at,ready_at=excluded.ready_at,
    released_at=excluded.released_at,archived_at=excluded.archived_at
  where repository_sandboxes.repository_id=excluded.repository_id
    and repository_sandboxes.workflow_id=excluded.workflow_id
    and repository_sandboxes.execution_id=excluded.execution_id
    and repository_sandboxes.owner_id=excluded.owner_id
    and repository_sandboxes.repository_revision=excluded.repository_revision
    and repository_sandboxes.workspace_root=excluded.workspace_root
    and repository_sandboxes.workspace_fingerprint=excluded.workspace_fingerprint;
  if not found then
    raise check_violation using message='repository_sandbox_identity_conflict';
  end if;

  for lease_value in select value from jsonb_array_elements(input_sandbox->'leases')
  loop
    insert into public.repository_sandbox_leases(
      tenant_id,sandbox_id,lease_id,owner_id,lease_owner,fencing_token,
      claim_token,started_at,renewed_at,expires_at,renewals,released_at,lease
    ) values(
      tenant_value,sandbox_value,lease_value->>'leaseId',lease_value->>'ownerId',
      lease_value->>'leaseOwner',(lease_value->>'fencingToken')::bigint,
      lease_value->>'claimToken',(lease_value->>'startedAt')::timestamptz,
      (lease_value->>'renewedAt')::timestamptz,
      (lease_value->>'expiresAt')::timestamptz,
      (lease_value->>'renewals')::integer,
      nullif(lease_value->>'releasedAt','')::timestamptz,lease_value
    ) on conflict(tenant_id,sandbox_id,lease_id) do update set
      renewed_at=excluded.renewed_at,expires_at=excluded.expires_at,
      renewals=excluded.renewals,released_at=excluded.released_at,
      lease=excluded.lease
    where repository_sandbox_leases.owner_id=excluded.owner_id
      and repository_sandbox_leases.lease_owner=excluded.lease_owner
      and repository_sandbox_leases.fencing_token=excluded.fencing_token
      and repository_sandbox_leases.claim_token=excluded.claim_token;
    if not found then
      raise check_violation using message='repository_sandbox_stale_lease';
    end if;
  end loop;

  for recovery_value in
    select value from jsonb_array_elements(input_sandbox->'recoveryHistory')
  loop
    insert into public.repository_sandbox_recoveries(
      tenant_id,sandbox_id,recovery_id,reason,previous_lifecycle,
      recovered_lifecycle,recovery,created_at
    ) values(
      tenant_value,sandbox_value,recovery_value->>'recoveryId',
      recovery_value->>'reason',recovery_value->>'previousLifecycle',
      recovery_value->>'recoveredLifecycle',recovery_value,
      (recovery_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,sandbox_id,recovery_id) do nothing;
  end loop;

  if jsonb_typeof(archive_value)='object' then
    insert into public.repository_sandbox_archives(
      tenant_id,sandbox_id,repository_revision,workspace_fingerprint,
      lease_count,metadata,archived_at
    ) values(
      tenant_value,sandbox_value,archive_value->>'repositoryRevision',
      archive_value->>'workspaceFingerprint',
      (archive_value->>'leaseCount')::integer,archive_value,
      (archive_value->>'archivedAt')::timestamptz
    ) on conflict(tenant_id,sandbox_id) do nothing;
  end if;
  return query select input_sandbox;
end; $$;

create or replace function public.list_recoverable_repository_sandboxes()
returns table(sandboxes jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(state order by updated_at,sandbox_id),'[]'::jsonb)
  from public.repository_sandboxes
  where lifecycle in('creating','leased','failed')
$$;

create or replace function public.recover_orphan_repository_sandbox_metadata()
returns integer
language plpgsql security invoker set search_path=public as $$
declare removed integer:=0;
declare affected integer;
begin
  delete from public.repository_sandbox_leases child
  where not exists(select 1 from public.repository_sandboxes parent
    where parent.tenant_id=child.tenant_id and parent.sandbox_id=child.sandbox_id);
  get diagnostics affected=row_count; removed:=removed+affected;
  delete from public.repository_sandbox_recoveries child
  where not exists(select 1 from public.repository_sandboxes parent
    where parent.tenant_id=child.tenant_id and parent.sandbox_id=child.sandbox_id);
  get diagnostics affected=row_count; removed:=removed+affected;
  delete from public.repository_sandbox_archives child
  where not exists(select 1 from public.repository_sandboxes parent
    where parent.tenant_id=child.tenant_id and parent.sandbox_id=child.sandbox_id);
  get diagnostics affected=row_count; removed:=removed+affected;
  return removed;
end; $$;

create or replace function public.repository_sandbox_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'sandboxCreation',count(*),
    'activeLeases',(select count(*) from public.repository_sandbox_leases lease
      where lease.released_at is null and lease.expires_at>now()
        and (input_tenant_id is null or lease.tenant_id=input_tenant_id)),
    'leaseRenewals',coalesce((select sum(renewals)
      from public.repository_sandbox_leases lease
      where input_tenant_id is null or lease.tenant_id=input_tenant_id),0),
    'recoveryCount',coalesce((select count(*)
      from public.repository_sandbox_recoveries recovery
      where input_tenant_id is null or recovery.tenant_id=input_tenant_id),0),
    'preparationLatencyMs',coalesce(sum(
      (state->'workspace'->>'preparationLatencyMs')::double precision),0),
    'archiveCount',count(*) filter(where lifecycle='archived')
  ) from public.repository_sandboxes candidate
  where input_tenant_id is null or candidate.tenant_id=input_tenant_id
$$;

create or replace function public.collect_repository_sandboxes(
  input_tenant_id text,input_sandbox_retention integer,
  input_recovery_retention integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.repository_sandbox_retention(
    tenant_id,retained_sandboxes,retained_recovery_records
  ) values(
    input_tenant_id,greatest(1,input_sandbox_retention),
    greatest(1,input_recovery_retention)
  ) on conflict(tenant_id) do update set
    retained_sandboxes=excluded.retained_sandboxes,
    retained_recovery_records=excluded.retained_recovery_records,
    updated_at=now();
  with ranked as(
    select tenant_id,sandbox_id,recovery_id,row_number() over(
      partition by tenant_id,sandbox_id order by created_at desc,recovery_id desc
    ) as position from public.repository_sandbox_recoveries
    where tenant_id=input_tenant_id
  )
  delete from public.repository_sandbox_recoveries recovery using ranked
  where recovery.tenant_id=ranked.tenant_id
    and recovery.sandbox_id=ranked.sandbox_id
    and recovery.recovery_id=ranked.recovery_id
    and ranked.position>greatest(1,input_recovery_retention);
  with victims as(
    select sandbox_id from public.repository_sandboxes
    where tenant_id=input_tenant_id
      and lifecycle in('released','archived','failed')
    order by updated_at desc,sandbox_id desc
    offset greatest(1,input_sandbox_retention)
  )
  delete from public.repository_sandboxes candidate using victims
  where candidate.tenant_id=input_tenant_id
    and candidate.sandbox_id=victims.sandbox_id;
  get diagnostics removed=row_count;
  return query select removed;
end; $$;

create or replace function public.verify_repository_sandbox_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  if input_engine_version<>'repository-sandbox-v1'
    or input_schema_version<>'repository-sandbox-schema-v1' then
    issues:=issues||'"repository_sandbox_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'repository_sandboxes','repository_sandbox_leases',
    'repository_sandbox_recoveries','repository_sandbox_archives',
    'repository_sandbox_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity) then
      issues:=issues||to_jsonb(object_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='repository_sandboxes_owner_lifecycle_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_sandbox_one_active_lease_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_sandbox_leases_expiry_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_sandbox_archives_retention_idx') then
    issues:=issues||'"repository_sandbox_indexes_missing"'::jsonb;
  end if;
  if not exists(select 1 from pg_constraint
      where conname='repository_sandbox_lifecycle_valid')
    or not exists(select 1 from pg_constraint
      where conname='repository_sandbox_lease_sandbox_fk' and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='repository_sandbox_recovery_sandbox_fk' and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='repository_sandbox_archive_sandbox_fk' and confdeltype='c') then
    issues:=issues||'"repository_sandbox_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.repository_sandboxes','select')
    or has_table_privilege('anon','public.repository_sandboxes','select')
    or not has_function_privilege('service_role',
      'public.save_repository_sandbox(jsonb,text)','execute')
    or has_function_privilege('anon',
      'public.save_repository_sandbox(jsonb,text)','execute') then
    issues:=issues||'"repository_sandbox_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure(
      'public.collect_repository_sandboxes(text,integer,integer)') is null
    or to_regprocedure(
      'public.recover_orphan_repository_sandbox_metadata()') is null then
    issues:=issues||'"repository_sandbox_retention_or_recovery_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare object_name text;
begin
  foreach object_name in array array[
    'repository_sandboxes','repository_sandbox_leases',
    'repository_sandbox_recoveries','repository_sandbox_archives',
    'repository_sandbox_retention'
  ] loop
    execute format('alter table public.%I enable row level security',object_name);
    execute format(
      'revoke all on table public.%I from public,anon,authenticated',object_name
    );
    execute format(
      'grant select,insert,update,delete on table public.%I to service_role',
      object_name
    );
  end loop;
end $$;

revoke all on function public.get_repository_sandbox(text,text,text,text)
  from public,anon,authenticated;
revoke all on function public.list_repository_sandboxes_for_owner(text,text)
  from public,anon,authenticated;
revoke all on function public.save_repository_sandbox(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.list_recoverable_repository_sandboxes()
  from public,anon,authenticated;
revoke all on function public.recover_orphan_repository_sandbox_metadata()
  from public,anon,authenticated;
revoke all on function public.repository_sandbox_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_repository_sandboxes(text,integer,integer)
  from public,anon,authenticated;
revoke all on function public.verify_repository_sandbox_contract(text,text)
  from public,anon,authenticated;

grant execute on function public.get_repository_sandbox(text,text,text,text)
  to service_role;
grant execute on function public.list_repository_sandboxes_for_owner(text,text)
  to service_role;
grant execute on function public.save_repository_sandbox(jsonb,text)
  to service_role;
grant execute on function public.list_recoverable_repository_sandboxes()
  to service_role;
grant execute on function public.recover_orphan_repository_sandbox_metadata()
  to service_role;
grant execute on function public.repository_sandbox_metrics(text)
  to service_role;
grant execute on function public.collect_repository_sandboxes(text,integer,integer)
  to service_role;
grant execute on function public.verify_repository_sandbox_contract(text,text)
  to service_role;
