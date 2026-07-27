create table if not exists public.repository_apply_transactions (
  tenant_id text not null,
  transaction_id text not null,
  schema_version text not null,
  proposal_id text not null,
  repository_id text not null references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  execution_id text not null,
  workspace_id text not null,
  owner_id text not null,
  transaction_version integer not null,
  lifecycle text not null,
  state jsonb not null,
  validation_failure_count integer not null default 0,
  conflict_count integer not null default 0,
  recovery_count integer not null default 0,
  apply_lease_expires_at timestamptz,
  confirmation_requested_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key(tenant_id,transaction_id),
  constraint repository_apply_transactions_proposal_fk
    foreign key(tenant_id,proposal_id)
    references public.repository_change_proposals(tenant_id,proposal_id)
    on delete cascade,
  constraint repository_apply_transactions_workspace_fk
    foreign key(tenant_id,workspace_id)
    references public.repository_workspaces(tenant_id,workspace_id)
    on delete cascade,
  constraint repository_apply_schema_version_valid
    check(schema_version='repository-apply-schema-v1'),
  constraint repository_apply_lifecycle_valid check(lifecycle in(
    'created','preparing','validating','awaiting_confirmation','ready',
    'cancelled','expired','archived'
  )),
  constraint repository_apply_version_positive check(transaction_version>0),
  constraint repository_apply_counts_nonnegative check(
    validation_failure_count>=0 and conflict_count>=0 and recovery_count>=0
  ),
  constraint repository_apply_state_object check(jsonb_typeof(state)='object'),
  constraint repository_apply_identity_fenced
    unique(tenant_id,proposal_id,repository_revision,execution_id,workspace_id)
);

create table if not exists public.repository_apply_transaction_versions (
  tenant_id text not null,
  transaction_id text not null,
  transaction_version integer not null,
  plan_hash text not null,
  proposal_version integer not null,
  proposal_output_hash text not null,
  preparation_metadata jsonb not null,
  version jsonb not null,
  created_at timestamptz not null,
  prepared_at timestamptz not null,
  validated_at timestamptz not null,
  primary key(tenant_id,transaction_id,transaction_version),
  constraint repository_apply_versions_transaction_fk
    foreign key(tenant_id,transaction_id)
    references public.repository_apply_transactions(tenant_id,transaction_id)
    on delete cascade,
  constraint repository_apply_version_numbers_positive
    check(transaction_version>0 and proposal_version>0),
  constraint repository_apply_version_objects check(
    jsonb_typeof(preparation_metadata)='object'
    and jsonb_typeof(version)='object'
  ),
  constraint repository_apply_plan_hash_unique
    unique(tenant_id,transaction_id,plan_hash)
);

create table if not exists public.repository_apply_plans (
  tenant_id text not null,
  transaction_id text not null,
  transaction_version integer not null,
  schema_version text not null,
  operation_count integer not null,
  affected_file_count integer not null,
  affected_symbol_count integer not null,
  dependency_count integer not null,
  plan jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,transaction_id,transaction_version),
  constraint repository_apply_plans_version_fk
    foreign key(tenant_id,transaction_id,transaction_version)
    references public.repository_apply_transaction_versions(
      tenant_id,transaction_id,transaction_version
    ) on delete cascade,
  constraint repository_apply_plan_schema_version_valid
    check(schema_version='repository-apply-plan-v1'),
  constraint repository_apply_plan_counts_nonnegative check(
    operation_count>=0 and affected_file_count>=0
    and affected_symbol_count>=0 and dependency_count>=0
  ),
  constraint repository_apply_plan_object check(jsonb_typeof(plan)='object')
);

create table if not exists public.repository_apply_rollbacks (
  tenant_id text not null,
  transaction_id text not null,
  transaction_version integer not null,
  inverse_operation_count integer not null,
  checkpoint_count integer not null,
  rollback_metadata jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,transaction_id,transaction_version),
  constraint repository_apply_rollbacks_version_fk
    foreign key(tenant_id,transaction_id,transaction_version)
    references public.repository_apply_transaction_versions(
      tenant_id,transaction_id,transaction_version
    ) on delete cascade,
  constraint repository_apply_rollback_counts_nonnegative
    check(inverse_operation_count>=0 and checkpoint_count>0),
  constraint repository_apply_rollback_object
    check(jsonb_typeof(rollback_metadata)='object')
);

create table if not exists public.repository_apply_diagnostics (
  tenant_id text not null,
  transaction_id text not null,
  transaction_version integer not null,
  diagnostic_id text not null,
  severity text not null,
  code text not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,transaction_id,diagnostic_id),
  constraint repository_apply_diagnostics_version_fk
    foreign key(tenant_id,transaction_id,transaction_version)
    references public.repository_apply_transaction_versions(
      tenant_id,transaction_id,transaction_version
    ) on delete cascade,
  constraint repository_apply_diagnostic_severity_valid
    check(severity in('info','warning','error')),
  constraint repository_apply_diagnostic_object
    check(jsonb_typeof(diagnostic)='object')
);

create table if not exists public.repository_apply_confirmations (
  tenant_id text not null,
  transaction_id text not null,
  transaction_version integer not null,
  confirmation_id text not null,
  owner_id text not null,
  confirmer_id text not null,
  decision text not null,
  rationale_codes jsonb not null,
  idempotency_key text not null,
  confirmation jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,transaction_id,confirmation_id),
  constraint repository_apply_confirmations_version_fk
    foreign key(tenant_id,transaction_id,transaction_version)
    references public.repository_apply_transaction_versions(
      tenant_id,transaction_id,transaction_version
    ) on delete cascade,
  constraint repository_apply_confirmation_decision_valid
    check(decision in('ready','cancelled')),
  constraint repository_apply_confirmation_codes_array
    check(jsonb_typeof(rationale_codes)='array'),
  constraint repository_apply_confirmation_object
    check(jsonb_typeof(confirmation)='object'),
  constraint repository_apply_confirmation_idempotency_unique
    unique(tenant_id,transaction_id,idempotency_key)
);

create table if not exists public.repository_apply_archives (
  tenant_id text not null,
  transaction_id text not null,
  archived_at timestamptz not null,
  final_transaction_version integer not null,
  plan_hash text not null,
  reason text not null,
  metadata jsonb not null,
  primary key(tenant_id,transaction_id),
  constraint repository_apply_archives_transaction_fk
    foreign key(tenant_id,transaction_id)
    references public.repository_apply_transactions(tenant_id,transaction_id)
    on delete cascade,
  constraint repository_apply_archive_version_positive
    check(final_transaction_version>0),
  constraint repository_apply_archive_reason_valid
    check(reason in('manual','retention','proposal_terminal')),
  constraint repository_apply_archive_metadata_object
    check(jsonb_typeof(metadata)='object')
);

create table if not exists public.repository_apply_retention (
  tenant_id text primary key,
  retained_transactions integer not null,
  retained_versions integer not null,
  retained_diagnostics integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_apply_retention_positive check(
    retained_transactions>0 and retained_versions>0 and retained_diagnostics>0
  )
);

create index if not exists repository_apply_transactions_proposal_idx
  on public.repository_apply_transactions(
    tenant_id,proposal_id,transaction_version desc
  );
create index if not exists repository_apply_transactions_workspace_idx
  on public.repository_apply_transactions(
    tenant_id,workspace_id,execution_id,repository_revision
  );
create index if not exists repository_apply_transactions_lifecycle_idx
  on public.repository_apply_transactions(
    tenant_id,owner_id,lifecycle,updated_at
  );
create index if not exists repository_apply_transactions_recovery_idx
  on public.repository_apply_transactions(
    lifecycle,apply_lease_expires_at,updated_at
  );
create index if not exists repository_apply_versions_history_idx
  on public.repository_apply_transaction_versions(
    tenant_id,transaction_id,transaction_version desc
  );
create index if not exists repository_apply_plans_scope_idx
  on public.repository_apply_plans(
    tenant_id,affected_file_count,affected_symbol_count
  );
create index if not exists repository_apply_diagnostics_created_idx
  on public.repository_apply_diagnostics(
    tenant_id,transaction_id,severity,created_at desc
  );
create index if not exists repository_apply_archives_retention_idx
  on public.repository_apply_archives(tenant_id,archived_at desc);

create or replace function public.get_repository_apply_transaction(
  input_tenant_id text,input_transaction_id text
) returns table(transaction jsonb)
language sql stable security invoker set search_path=public as $$
  select state from public.repository_apply_transactions
  where tenant_id=input_tenant_id and transaction_id=input_transaction_id
$$;

create or replace function public.count_repository_proposal_apply_transactions(
  input_tenant_id text,input_proposal_id text
) returns table(transaction_count bigint)
language sql stable security invoker set search_path=public as $$
  select count(*) from public.repository_apply_transactions
  where tenant_id=input_tenant_id and proposal_id=input_proposal_id
$$;

create or replace function public.save_repository_apply_transaction(
  input_transaction jsonb,input_expected_version text
) returns table(transaction jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.repository_apply_transactions%rowtype;
declare version_value jsonb;
declare artifact_value jsonb;
declare patch_value jsonb;
declare diagnostic_value jsonb;
declare confirmation_value jsonb;
declare archive_value jsonb:=input_transaction->'archiveMetadata';
declare tenant_value text:=input_transaction->>'tenantId';
declare transaction_value text:=input_transaction->>'transactionId';
begin
  if jsonb_typeof(input_transaction)<>'object'
    or jsonb_typeof(input_transaction->'versions')<>'array'
    or jsonb_typeof(input_transaction->'diagnostics')<>'array'
    or jsonb_typeof(input_transaction->'confirmations')<>'array'
    or jsonb_typeof(input_transaction->'lifecycleHistory')<>'array'
    or jsonb_typeof(input_transaction->'recoveryHistory')<>'array'
    or jsonb_array_length(input_transaction->'versions')<1
    or jsonb_array_length(input_transaction->'versions')
      <>(input_transaction->>'transactionVersion')::integer then
    raise check_violation using message='repository_apply_schema_invalid';
  end if;
  if not exists(
    select 1 from public.repository_change_proposals proposal
    join public.repository_workspaces workspace
      on workspace.tenant_id=proposal.tenant_id
      and workspace.workspace_id=proposal.workspace_id
    join public.repositories repository
      on repository.repository_id=proposal.repository_id
    where proposal.tenant_id=tenant_value
      and proposal.proposal_id=input_transaction->>'proposalId'
      and proposal.repository_id=input_transaction->>'repositoryId'
      and proposal.repository_revision=input_transaction->>'repositoryRevision'
      and proposal.execution_id=input_transaction->>'executionId'
      and proposal.workspace_id=input_transaction->>'workspaceId'
      and proposal.owner_id=input_transaction->>'ownerId'
      and (
        (
          proposal.lifecycle='approved'
          and workspace.lifecycle in('active','validating')
        )
        or (
          input_transaction->>'lifecycle' in(
            'ready','cancelled','expired','archived'
          )
          and exists(
            select 1 from public.repository_apply_transactions prior
            where prior.tenant_id=tenant_value
              and prior.transaction_id=transaction_value
          )
        )
      )
      and repository.owner_user_id=input_transaction->>'ownerId'
      and repository.current_revision=input_transaction->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation using message='repository_apply_inputs_stale';
  end if;

  for version_value in
    select * from jsonb_array_elements(input_transaction->'versions')
  loop
    if version_value->'preparationMetadata'->>'schemaVersion'
        <>'repository-apply-plan-v1'
      or jsonb_typeof(version_value->'applyPlan')<>'object'
      or jsonb_typeof(
        version_value->'applyPlan'->'orderedOperations'
      )<>'array'
      or jsonb_typeof(
        version_value->'applyPlan'->'affectedFiles'
      )<>'array'
      or jsonb_typeof(
        version_value->'applyPlan'->'affectedSymbols'
      )<>'array'
      or jsonb_typeof(
        version_value->'applyPlan'->'dependencyGraph'
      )<>'object'
      or jsonb_typeof(
        version_value->'applyPlan'->'rollbackPlan'
      )<>'object'
      or jsonb_typeof(
        version_value->'applyPlan'->'rollbackPlan'->'inverseOperations'
      )<>'array'
      or jsonb_typeof(
        version_value->'applyPlan'->'rollbackPlan'->'validationCheckpoints'
      )<>'array'
      or jsonb_array_length(
        version_value->'applyPlan'->'rollbackPlan'->'inverseOperations'
      )<>jsonb_array_length(
        version_value->'applyPlan'->'orderedOperations'
      )
      or jsonb_array_length(
        version_value->'applyPlan'->'rollbackPlan'->'validationCheckpoints'
      )<1
      or version_value->'applyPlan'->'validationSummary'->>'valid'<>'true'
      or jsonb_typeof(
        version_value->'preparationMetadata'->'artifactVersions'
      )<>'array'
      or jsonb_typeof(
        version_value->'preparationMetadata'->'patchVersions'
      )<>'array'
      or jsonb_array_length(
        version_value->'preparationMetadata'->'artifactVersions'
      )<1
      or jsonb_array_length(
        version_value->'preparationMetadata'->'patchVersions'
      )<1 then
      raise check_violation using message='repository_apply_schema_invalid';
    end if;
    if not exists(
      select 1 from public.repository_change_proposals proposal
      where proposal.tenant_id=tenant_value
        and proposal.proposal_id=input_transaction->>'proposalId'
        and proposal.proposal_version=
          (version_value->'preparationMetadata'->>'proposalVersion')::integer
        and proposal.state->'versions'->-1->>'outputHash'=
          version_value->'preparationMetadata'->>'proposalOutputHash'
    ) then
      raise check_violation using message='repository_apply_proposal_stale';
    end if;
    for artifact_value in select * from jsonb_array_elements(
      version_value->'preparationMetadata'->'artifactVersions'
    ) loop
      if not exists(
        select 1 from public.repository_proposed_artifacts artifact
        where artifact.tenant_id=tenant_value
          and artifact.artifact_id=artifact_value->>'artifactId'
          and artifact.workspace_id=input_transaction->>'workspaceId'
          and artifact.execution_id=input_transaction->>'executionId'
          and artifact.owner_id=input_transaction->>'ownerId'
          and artifact.repository_revision=
            input_transaction->>'repositoryRevision'
          and artifact.lifecycle='approved'
          and artifact.artifact_version=
            (artifact_value->>'artifactVersion')::integer
          and artifact.state->'versions'->-1->>'contentHash'=
            artifact_value->>'contentHash'
      ) then
        raise check_violation using message=
          'repository_apply_artifact_incompatible';
      end if;
    end loop;
    for patch_value in select * from jsonb_array_elements(
      version_value->'preparationMetadata'->'patchVersions'
    ) loop
      if not exists(
        select 1 from public.repository_workspaces workspace,
          jsonb_array_elements(workspace.state->'patches') patch
        where workspace.tenant_id=tenant_value
          and workspace.workspace_id=input_transaction->>'workspaceId'
          and patch->>'patchId'=patch_value->>'patchId'
          and (patch->>'patchVersion')::integer=
            (patch_value->>'patchVersion')::integer
          and patch->>'contentHash'=patch_value->>'contentHash'
      ) then
        raise check_violation using message='repository_apply_patch_incompatible';
      end if;
    end loop;
  end loop;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_value||'|'||transaction_value,0)
  );
  select * into existing from public.repository_apply_transactions candidate
  where candidate.tenant_id=tenant_value
    and candidate.transaction_id=transaction_value for update;
  if found and (input_expected_version is null or
      (existing.state->>'persistenceVersion')::bigint
        <>input_expected_version::bigint) then
    raise serialization_failure using message='repository_apply_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure using message='repository_apply_version_conflict';
  end if;

  insert into public.repository_apply_transactions(
    tenant_id,transaction_id,schema_version,proposal_id,repository_id,
    repository_revision,execution_id,workspace_id,owner_id,
    transaction_version,lifecycle,state,validation_failure_count,
    conflict_count,recovery_count,apply_lease_expires_at,
    confirmation_requested_at,created_at,updated_at,completed_at
  ) values(
    tenant_value,transaction_value,input_transaction->>'schemaVersion',
    input_transaction->>'proposalId',input_transaction->>'repositoryId',
    input_transaction->>'repositoryRevision',
    input_transaction->>'executionId',input_transaction->>'workspaceId',
    input_transaction->>'ownerId',
    (input_transaction->>'transactionVersion')::integer,
    input_transaction->>'lifecycle',input_transaction,
    (input_transaction->>'validationFailureCount')::integer,
    (input_transaction->>'conflictCount')::integer,
    (input_transaction->>'recoveryCount')::integer,
    nullif(input_transaction->>'applyLeaseExpiresAt','')::timestamptz,
    nullif(input_transaction->>'confirmationRequestedAt','')::timestamptz,
    (input_transaction->>'createdAt')::timestamptz,
    (input_transaction->>'updatedAt')::timestamptz,
    nullif(input_transaction->>'completedAt','')::timestamptz
  ) on conflict(tenant_id,transaction_id) do update set
    transaction_version=excluded.transaction_version,
    lifecycle=excluded.lifecycle,state=excluded.state,
    validation_failure_count=excluded.validation_failure_count,
    conflict_count=excluded.conflict_count,
    recovery_count=excluded.recovery_count,
    apply_lease_expires_at=excluded.apply_lease_expires_at,
    confirmation_requested_at=excluded.confirmation_requested_at,
    updated_at=excluded.updated_at,completed_at=excluded.completed_at
  where repository_apply_transactions.proposal_id=excluded.proposal_id
    and repository_apply_transactions.repository_id=excluded.repository_id
    and repository_apply_transactions.repository_revision=
      excluded.repository_revision
    and repository_apply_transactions.execution_id=excluded.execution_id
    and repository_apply_transactions.workspace_id=excluded.workspace_id
    and repository_apply_transactions.owner_id=excluded.owner_id;
  if not found then
    raise check_violation using message='repository_apply_identity_conflict';
  end if;

  for version_value in
    select * from jsonb_array_elements(input_transaction->'versions')
  loop
    insert into public.repository_apply_transaction_versions(
      tenant_id,transaction_id,transaction_version,plan_hash,
      proposal_version,proposal_output_hash,preparation_metadata,version,
      created_at,prepared_at,validated_at
    ) values(
      tenant_value,transaction_value,
      (version_value->>'transactionVersion')::integer,
      version_value->>'planHash',
      (version_value->'preparationMetadata'->>'proposalVersion')::integer,
      version_value->'preparationMetadata'->>'proposalOutputHash',
      version_value->'preparationMetadata',version_value,
      (version_value->>'createdAt')::timestamptz,
      (version_value->>'preparedAt')::timestamptz,
      (version_value->>'validatedAt')::timestamptz
    ) on conflict(tenant_id,transaction_id,transaction_version) do nothing;
    if not found and not exists(
      select 1 from public.repository_apply_transaction_versions candidate
      where candidate.tenant_id=tenant_value
        and candidate.transaction_id=transaction_value
        and candidate.transaction_version=
          (version_value->>'transactionVersion')::integer
        and candidate.plan_hash=version_value->>'planHash'
    ) then
      raise check_violation using message='repository_apply_version_stale';
    end if;
    insert into public.repository_apply_plans(
      tenant_id,transaction_id,transaction_version,schema_version,
      operation_count,affected_file_count,affected_symbol_count,
      dependency_count,plan,created_at
    ) values(
      tenant_value,transaction_value,
      (version_value->>'transactionVersion')::integer,
      version_value->'applyPlan'->>'schemaVersion',
      jsonb_array_length(version_value->'applyPlan'->'orderedOperations'),
      jsonb_array_length(version_value->'applyPlan'->'affectedFiles'),
      jsonb_array_length(version_value->'applyPlan'->'affectedSymbols'),
      jsonb_array_length(
        version_value->'applyPlan'->'dependencyGraph'->'edges'
      ),version_value->'applyPlan',
      (version_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,transaction_id,transaction_version) do nothing;
    insert into public.repository_apply_rollbacks(
      tenant_id,transaction_id,transaction_version,inverse_operation_count,
      checkpoint_count,rollback_metadata,created_at
    ) values(
      tenant_value,transaction_value,
      (version_value->>'transactionVersion')::integer,
      jsonb_array_length(
        version_value->'applyPlan'->'rollbackPlan'->'inverseOperations'
      ),
      jsonb_array_length(
        version_value->'applyPlan'->'rollbackPlan'->'validationCheckpoints'
      ),
      version_value->'applyPlan'->'rollbackPlan',
      (version_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,transaction_id,transaction_version) do nothing;
  end loop;

  for diagnostic_value in
    select * from jsonb_array_elements(input_transaction->'diagnostics')
  loop
    insert into public.repository_apply_diagnostics(
      tenant_id,transaction_id,transaction_version,diagnostic_id,severity,
      code,diagnostic,created_at
    ) values(
      tenant_value,transaction_value,
      (diagnostic_value->>'transactionVersion')::integer,
      diagnostic_value->>'diagnosticId',diagnostic_value->>'severity',
      diagnostic_value->>'code',diagnostic_value,
      (diagnostic_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,transaction_id,diagnostic_id) do nothing;
  end loop;
  for confirmation_value in
    select * from jsonb_array_elements(input_transaction->'confirmations')
  loop
    insert into public.repository_apply_confirmations(
      tenant_id,transaction_id,transaction_version,confirmation_id,
      owner_id,confirmer_id,decision,rationale_codes,idempotency_key,
      confirmation,created_at
    ) values(
      tenant_value,transaction_value,
      (confirmation_value->>'transactionVersion')::integer,
      confirmation_value->>'confirmationId',confirmation_value->>'ownerId',
      confirmation_value->>'confirmerId',confirmation_value->>'decision',
      confirmation_value->'rationaleCodes',
      confirmation_value->>'idempotencyKey',confirmation_value,
      (confirmation_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,transaction_id,confirmation_id) do nothing;
  end loop;
  if jsonb_typeof(archive_value)='object' then
    insert into public.repository_apply_archives(
      tenant_id,transaction_id,archived_at,final_transaction_version,
      plan_hash,reason,metadata
    ) values(
      tenant_value,transaction_value,
      (archive_value->>'archivedAt')::timestamptz,
      (archive_value->>'finalTransactionVersion')::integer,
      archive_value->>'planHash',archive_value->>'reason',archive_value
    ) on conflict(tenant_id,transaction_id) do nothing;
  end if;
  return query select input_transaction;
end; $$;

create or replace function public.list_recoverable_repository_apply_transactions()
returns table(transactions jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(state order by updated_at,transaction_id),'[]'::jsonb)
  from public.repository_apply_transactions
  where lifecycle not in('ready','cancelled','expired','archived')
$$;

create or replace function public.repository_apply_transaction_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'transactionsCreated',coalesce(
      sum(jsonb_array_length(state->'versions')),0),
    'validationFailures',coalesce(sum(validation_failure_count),0),
    'rollbackPlans',coalesce(sum(jsonb_array_length(state->'versions')),0),
    'conflicts',coalesce(sum(conflict_count),0),
    'preparationLatencyMs',coalesce(sum((
      select sum(
        (version->'preparationMetadata'->>'preparationLatencyMs')
          ::double precision
      ) from jsonb_array_elements(state->'versions') version
    )),0),
    'recoveryCount',coalesce(sum(recovery_count),0)
  ) from public.repository_apply_transactions candidate
  where input_tenant_id is null or candidate.tenant_id=input_tenant_id
$$;

create or replace function public.collect_repository_apply_transactions(
  input_tenant_id text,input_transaction_retention integer,
  input_version_retention integer,input_diagnostic_retention integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer:=0;
declare affected integer:=0;
begin
  insert into public.repository_apply_retention(
    tenant_id,retained_transactions,retained_versions,retained_diagnostics
  ) values(
    input_tenant_id,greatest(1,input_transaction_retention),
    greatest(1,input_version_retention),
    greatest(1,input_diagnostic_retention)
  ) on conflict(tenant_id) do update set
    retained_transactions=excluded.retained_transactions,
    retained_versions=excluded.retained_versions,
    retained_diagnostics=excluded.retained_diagnostics,updated_at=now();
  with ranked as(
    select tenant_id,transaction_id,diagnostic_id,
      row_number() over(
        partition by tenant_id,transaction_id
        order by created_at desc,diagnostic_id desc
      ) as position
    from public.repository_apply_diagnostics where tenant_id=input_tenant_id
  )
  delete from public.repository_apply_diagnostics diagnostic using ranked
  where diagnostic.tenant_id=ranked.tenant_id
    and diagnostic.transaction_id=ranked.transaction_id
    and diagnostic.diagnostic_id=ranked.diagnostic_id
    and ranked.position>greatest(1,input_diagnostic_retention);
  get diagnostics affected=row_count;
  removed:=removed+affected;
  with victims as(
    select transaction_id from public.repository_apply_transactions
    where tenant_id=input_tenant_id
      and lifecycle in('ready','cancelled','expired','archived')
    order by completed_at desc nulls last,transaction_id desc
    offset greatest(1,input_transaction_retention)
  )
  delete from public.repository_apply_transactions candidate using victims
  where candidate.tenant_id=input_tenant_id
    and candidate.transaction_id=victims.transaction_id;
  get diagnostics affected=row_count;
  removed:=removed+affected;
  return query select removed;
end; $$;

create or replace function public.verify_repository_apply_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  if input_engine_version<>'repository-apply-engine-v1'
    or input_schema_version<>'repository-apply-schema-v1' then
    issues:=issues||'"repository_apply_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'repository_apply_transactions','repository_apply_transaction_versions',
    'repository_apply_plans','repository_apply_rollbacks',
    'repository_apply_diagnostics','repository_apply_confirmations',
    'repository_apply_archives','repository_apply_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(
      select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity
    ) then issues:=issues||to_jsonb(object_name||'_rls_missing'); end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='repository_apply_transactions_proposal_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_apply_versions_history_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_apply_plans_scope_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_apply_archives_retention_idx') then
    issues:=issues||'"repository_apply_indexes_missing"'::jsonb;
  end if;
  if not exists(select 1 from pg_constraint
      where conname='repository_apply_lifecycle_valid')
    or not exists(select 1 from pg_constraint
      where conname='repository_apply_identity_fenced')
    or not exists(select 1 from pg_constraint
      where conname='repository_apply_plan_schema_version_valid')
    or not exists(select 1 from pg_constraint
      where conname='repository_apply_transactions_proposal_fk'
        and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='repository_apply_rollbacks_version_fk'
        and confdeltype='c') then
    issues:=issues||'"repository_apply_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.repository_apply_transactions','select')
    or has_table_privilege(
      'anon','public.repository_apply_transactions','select')
    or not has_function_privilege(
      'service_role','public.save_repository_apply_transaction(jsonb,text)',
      'execute')
    or has_function_privilege(
      'anon','public.save_repository_apply_transaction(jsonb,text)','execute')
  then issues:=issues||'"repository_apply_grants_invalid"'::jsonb; end if;
  if to_regprocedure(
      'public.collect_repository_apply_transactions(text,integer,integer,integer)'
    ) is null then
    issues:=issues||'"repository_apply_retention_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare object_name text;
begin
  foreach object_name in array array[
    'repository_apply_transactions','repository_apply_transaction_versions',
    'repository_apply_plans','repository_apply_rollbacks',
    'repository_apply_diagnostics','repository_apply_confirmations',
    'repository_apply_archives','repository_apply_retention'
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

revoke all on function public.get_repository_apply_transaction(text,text)
  from public,anon,authenticated;
revoke all on function public.count_repository_proposal_apply_transactions(
  text,text
) from public,anon,authenticated;
revoke all on function public.save_repository_apply_transaction(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.list_recoverable_repository_apply_transactions()
  from public,anon,authenticated;
revoke all on function public.repository_apply_transaction_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_repository_apply_transactions(
  text,integer,integer,integer
) from public,anon,authenticated;
revoke all on function public.verify_repository_apply_contract(text,text)
  from public,anon,authenticated;

grant execute on function public.get_repository_apply_transaction(text,text)
  to service_role;
grant execute on function public.count_repository_proposal_apply_transactions(
  text,text
) to service_role;
grant execute on function public.save_repository_apply_transaction(jsonb,text)
  to service_role;
grant execute on function public.list_recoverable_repository_apply_transactions()
  to service_role;
grant execute on function public.repository_apply_transaction_metrics(text)
  to service_role;
grant execute on function public.collect_repository_apply_transactions(
  text,integer,integer,integer
) to service_role;
grant execute on function public.verify_repository_apply_contract(text,text)
  to service_role;
