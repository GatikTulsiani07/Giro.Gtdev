create table if not exists public.repository_engineering_sessions (
  tenant_id text not null,
  session_id text not null,
  owner_id text not null,
  user_id text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  workflow_id text,
  schema_version text not null,
  persistence_version bigint not null,
  lifecycle text not null,
  expires_at timestamptz not null,
  reuse_count bigint not null default 0,
  recovery_count bigint not null default 0,
  record jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  archived_at timestamptz,
  primary key(tenant_id,session_id),
  constraint repository_engineering_session_snapshot_fk
    foreign key(repository_id,repository_revision)
    references public.repository_snapshots(repository_id,revision)
    on delete cascade,
  constraint repository_engineering_session_schema_valid check(
    schema_version='repository-session-schema-v1'
  ),
  constraint repository_engineering_session_lifecycle_valid check(
    lifecycle in('active','interrupted','stale','recovered','archived')
  ),
  constraint repository_engineering_session_values_valid check(
    tenant_id<>'' and session_id<>'' and owner_id<>'' and user_id<>''
    and repository_id<>'' and repository_revision~'^[0-9a-f]{40}$'
    and persistence_version>0 and reuse_count>=0 and recovery_count>=0
    and jsonb_typeof(record)='object'
  ),
  constraint repository_engineering_session_archive_valid check(
    lifecycle<>'archived' or archived_at is not null
  )
);

create index if not exists repository_engineering_sessions_owner_idx
  on public.repository_engineering_sessions(
    tenant_id,owner_id,updated_at desc
  );
create index if not exists repository_engineering_sessions_repository_idx
  on public.repository_engineering_sessions(
    repository_id,repository_revision,updated_at desc
  );
create index if not exists repository_engineering_sessions_expiration_idx
  on public.repository_engineering_sessions(lifecycle,expires_at);

create table if not exists public.repository_session_events (
  tenant_id text not null,
  session_id text not null,
  event_id text not null,
  sequence integer not null,
  kind text not null,
  reference_id text not null,
  event jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,session_id,event_id),
  unique(tenant_id,session_id,sequence),
  constraint repository_session_event_session_fk
    foreign key(tenant_id,session_id)
    references public.repository_engineering_sessions(tenant_id,session_id)
    on delete cascade,
  constraint repository_session_event_kind_valid check(kind in(
    'query','answer','feature','symbol','file','insight','plan',
    'specification','execution_summary'
  )),
  constraint repository_session_event_values_valid check(
    event_id<>'' and sequence>0 and reference_id<>''
    and jsonb_typeof(event)='object'
  )
);
create index if not exists repository_session_events_navigation_idx
  on public.repository_session_events(
    tenant_id,session_id,kind,sequence desc
  );

create table if not exists public.repository_session_context_snapshots (
  tenant_id text not null,
  session_id text not null,
  context_version bigint not null,
  context_size integer not null,
  context jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,session_id,context_version),
  constraint repository_session_context_session_fk
    foreign key(tenant_id,session_id)
    references public.repository_engineering_sessions(tenant_id,session_id)
    on delete cascade,
  constraint repository_session_context_values_valid check(
    context_version>0 and context_size>=0
    and jsonb_typeof(context)='object'
  )
);
create index if not exists repository_session_context_latest_idx
  on public.repository_session_context_snapshots(
    tenant_id,session_id,context_version desc
  );

create table if not exists public.repository_session_diagnostics (
  tenant_id text not null,
  session_id text not null,
  diagnostic_id text not null,
  code text not null,
  severity text not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,session_id,diagnostic_id),
  constraint repository_session_diagnostic_session_fk
    foreign key(tenant_id,session_id)
    references public.repository_engineering_sessions(tenant_id,session_id)
    on delete cascade,
  constraint repository_session_diagnostic_severity_valid
    check(severity in('info','warning','error')),
  constraint repository_session_diagnostic_values_valid check(
    diagnostic_id<>'' and code<>'' and jsonb_typeof(diagnostic)='object'
  )
);
create index if not exists repository_session_diagnostics_code_idx
  on public.repository_session_diagnostics(
    tenant_id,code,created_at desc
  );

create table if not exists public.repository_session_metrics (
  tenant_id text not null,
  session_id text not null,
  duration_ms double precision not null default 0,
  context_size integer not null default 0,
  reuse_count bigint not null default 0,
  recovery_count bigint not null default 0,
  updated_at timestamptz not null,
  primary key(tenant_id,session_id),
  constraint repository_session_metric_session_fk
    foreign key(tenant_id,session_id)
    references public.repository_engineering_sessions(tenant_id,session_id)
    on delete cascade,
  constraint repository_session_metric_values_valid check(
    duration_ms>=0 and context_size>=0
    and reuse_count>=0 and recovery_count>=0
  )
);
create index if not exists repository_session_metrics_updated_idx
  on public.repository_session_metrics(tenant_id,updated_at desc);

alter table public.repository_engineering_sessions enable row level security;
alter table public.repository_session_events enable row level security;
alter table public.repository_session_context_snapshots enable row level security;
alter table public.repository_session_diagnostics enable row level security;
alter table public.repository_session_metrics enable row level security;

revoke all on public.repository_engineering_sessions
  from anon,authenticated;
revoke all on public.repository_session_events
  from anon,authenticated;
revoke all on public.repository_session_context_snapshots
  from anon,authenticated;
revoke all on public.repository_session_diagnostics
  from anon,authenticated;
revoke all on public.repository_session_metrics
  from anon,authenticated;
grant select,insert,update,delete on public.repository_engineering_sessions
  to service_role;
grant select,insert,update,delete on public.repository_session_events
  to service_role;
grant select,insert,update,delete
  on public.repository_session_context_snapshots to service_role;
grant select,insert,update,delete on public.repository_session_diagnostics
  to service_role;
grant select,insert,update,delete on public.repository_session_metrics
  to service_role;

create or replace function public.repository_session_context_size(
  input_context jsonb
) returns integer
language sql
immutable
set search_path=public,pg_temp
as $$
  select
    coalesce(jsonb_array_length(input_context->'previousQuestions'),0)+
    coalesce(jsonb_array_length(input_context->'previousAnswers'),0)+
    coalesce(jsonb_array_length(input_context->'recentFiles'),0)+
    coalesce(jsonb_array_length(input_context->'recentSymbols'),0)+
    coalesce(jsonb_array_length(input_context->'recentFeatures'),0)+
    coalesce(jsonb_array_length(input_context->'viewedInsights'),0)+
    coalesce(jsonb_array_length(input_context->'viewedPlans'),0)+
    coalesce(jsonb_array_length(input_context->'viewedSpecifications'),0)+
    coalesce(jsonb_array_length(
      input_context->'viewedExecutionSummaries'),0)+
    case when input_context->>'activeFeature' is null then 0 else 1 end+
    case when input_context->>'activeModule' is null then 0 else 1 end+
    case when input_context->>'activeWorkflow' is null then 0 else 1 end+
    case when input_context->>'activeArchitecture' is null then 0 else 1 end+
    case when input_context->>'activeChangeAnalysis' is null then 0 else 1 end
$$;

create or replace function public.get_repository_engineering_session(
  input_tenant_id text,
  input_owner_id text,
  input_session_id text
) returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select record
  from public.repository_engineering_sessions
  where tenant_id=input_tenant_id and owner_id=input_owner_id
    and session_id=input_session_id
$$;

create or replace function public.save_repository_engineering_session(
  input_record jsonb,
  input_expected_version bigint default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  input_session jsonb:=input_record->'session';
  input_context jsonb:=input_record->'context';
  current_session public.repository_engineering_sessions%rowtype;
  saved_record jsonb;
  saved_version bigint;
  item jsonb;
begin
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=input_session->>'repositoryId'
      and repository.owner_user_id=input_session->>'ownerId'
      and repository.owner_user_id=input_session->>'userId'
      and repository.deletion_state='active'
      and repository.current_revision=
        input_session->>'repositoryRevision'
      and repository.indexed_revision=
        input_session->>'repositoryRevision'
  ) then raise exception 'repository_session_fence_invalid'; end if;

  select * into current_session
  from public.repository_engineering_sessions
  where tenant_id=input_session->>'tenantId'
    and session_id=input_session->>'sessionId'
  for update;

  if input_expected_version is not null and
      (current_session.session_id is null or
       current_session.persistence_version<>input_expected_version) then
    raise exception 'repository_session_version_conflict';
  end if;
  if current_session.session_id is not null and (
      current_session.owner_id<>input_session->>'ownerId' or
      current_session.user_id<>input_session->>'userId' or
      current_session.repository_id<>input_session->>'repositoryId' or
      current_session.repository_revision<>
        input_session->>'repositoryRevision') then
    raise exception 'repository_session_identity_conflict';
  end if;

  saved_version:=case when current_session.session_id is null
    then 1 else current_session.persistence_version+1 end;
  saved_record:=jsonb_set(
    input_record,'{session,persistenceVersion}',to_jsonb(saved_version),true);

  insert into public.repository_engineering_sessions(
    tenant_id,session_id,owner_id,user_id,repository_id,
    repository_revision,workflow_id,schema_version,persistence_version,
    lifecycle,expires_at,reuse_count,recovery_count,record,
    created_at,updated_at,archived_at
  ) values(
    input_session->>'tenantId',input_session->>'sessionId',
    input_session->>'ownerId',input_session->>'userId',
    input_session->>'repositoryId',
    input_session->>'repositoryRevision',
    nullif(input_session->>'workflowId',''),
    input_session->>'schemaVersion',saved_version,
    input_session->>'lifecycle',
    (input_session->>'expiresAt')::timestamptz,
    (input_record->>'reuseCount')::bigint,
    (input_record->>'recoveryCount')::bigint,saved_record,
    (input_session->>'createdAt')::timestamptz,
    (input_session->>'updatedAt')::timestamptz,
    (input_session->>'archivedAt')::timestamptz
  ) on conflict(tenant_id,session_id) do update set
    workflow_id=excluded.workflow_id,
    persistence_version=excluded.persistence_version,
    lifecycle=excluded.lifecycle,
    expires_at=excluded.expires_at,
    reuse_count=excluded.reuse_count,
    recovery_count=excluded.recovery_count,
    record=excluded.record,
    updated_at=excluded.updated_at,
    archived_at=excluded.archived_at;

  delete from public.repository_session_events
  where tenant_id=input_session->>'tenantId'
    and session_id=input_session->>'sessionId';
  for item in select * from jsonb_array_elements(input_record->'events')
  loop
    insert into public.repository_session_events(
      tenant_id,session_id,event_id,sequence,kind,reference_id,
      event,created_at
    ) values(
      input_session->>'tenantId',input_session->>'sessionId',
      item->>'eventId',(item->>'sequence')::integer,item->>'kind',
      item->>'referenceId',item,(item->>'createdAt')::timestamptz
    );
  end loop;

  insert into public.repository_session_context_snapshots(
    tenant_id,session_id,context_version,context_size,context,created_at
  ) values(
    input_session->>'tenantId',input_session->>'sessionId',
    (input_context->>'contextVersion')::bigint,
    public.repository_session_context_size(input_context),
    input_context,(input_context->>'updatedAt')::timestamptz
  ) on conflict(tenant_id,session_id,context_version)
  do update set context_size=excluded.context_size,
    context=excluded.context,created_at=excluded.created_at;

  for item in
    select * from jsonb_array_elements(input_record->'diagnostics')
  loop
    insert into public.repository_session_diagnostics(
      tenant_id,session_id,diagnostic_id,code,severity,
      diagnostic,created_at
    ) values(
      input_session->>'tenantId',input_session->>'sessionId',
      item->>'diagnosticId',item->>'code',item->>'severity',
      item,(item->>'createdAt')::timestamptz
    ) on conflict do nothing;
  end loop;

  insert into public.repository_session_metrics(
    tenant_id,session_id,duration_ms,context_size,reuse_count,
    recovery_count,updated_at
  ) values(
    input_session->>'tenantId',input_session->>'sessionId',
    greatest(0,extract(epoch from(
      (input_session->>'updatedAt')::timestamptz-
      (input_session->>'createdAt')::timestamptz))*1000),
    public.repository_session_context_size(input_context),
    (input_record->>'reuseCount')::bigint,
    (input_record->>'recoveryCount')::bigint,
    (input_session->>'updatedAt')::timestamptz
  ) on conflict(tenant_id,session_id) do update set
    duration_ms=excluded.duration_ms,
    context_size=excluded.context_size,
    reuse_count=excluded.reuse_count,
    recovery_count=excluded.recovery_count,
    updated_at=excluded.updated_at;
  return saved_record;
end
$$;

create or replace function public.record_repository_session_reuse(
  input_tenant_id text,input_owner_id text,input_session_id text
) returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  update public.repository_engineering_sessions
  set reuse_count=reuse_count+1,
    record=jsonb_set(record,'{reuseCount}',to_jsonb(reuse_count+1),true)
  where tenant_id=input_tenant_id and owner_id=input_owner_id
    and session_id=input_session_id;
  if not found then raise exception 'repository_session_not_found'; end if;
  update public.repository_session_metrics
  set reuse_count=reuse_count+1
  where tenant_id=input_tenant_id and session_id=input_session_id;
end
$$;

create or replace function public.archive_repository_engineering_session(
  input_tenant_id text,input_owner_id text,input_session_id text,
  input_archived_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare saved jsonb;
begin
  update public.repository_engineering_sessions
  set lifecycle='archived',archived_at=input_archived_at,
    updated_at=input_archived_at,persistence_version=persistence_version+1,
    record=jsonb_set(jsonb_set(jsonb_set(jsonb_set(
      record,'{session,lifecycle}','"archived"',true),
      '{session,archivedAt}',to_jsonb(to_char(
        input_archived_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),true),
      '{session,updatedAt}',to_jsonb(to_char(
        input_archived_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),true),
      '{session,persistenceVersion}',
      to_jsonb(persistence_version+1),true)
  where tenant_id=input_tenant_id and owner_id=input_owner_id
    and session_id=input_session_id
  returning record into saved;
  return saved;
end
$$;

create or replace function public.recover_repository_engineering_sessions(
  input_recovered_at timestamptz
) returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare item record;
declare recovered integer:=0;
declare next_lifecycle text;
declare code text;
declare diagnostic jsonb;
declare repaired_context jsonb;
begin
  for item in
    select session.*,
      not exists(select 1
        from public.repository_session_context_snapshots context
        where context.tenant_id=session.tenant_id
          and context.session_id=session.session_id) partial
    from public.repository_engineering_sessions session
    where session.lifecycle in('interrupted','stale')
      or session.expires_at<=input_recovered_at
      or not exists(select 1
        from public.repository_session_context_snapshots context
        where context.tenant_id=session.tenant_id
          and context.session_id=session.session_id)
    for update
  loop
    recovered:=recovered+1;
    next_lifecycle:=case
      when item.lifecycle='stale' or item.expires_at<=input_recovered_at
        then 'archived' else 'recovered' end;
    code:=case when item.partial
      then 'repository_session_partial_persistence_recovered'
      when next_lifecycle='archived'
        then 'repository_session_stale_archived'
      else 'repository_session_interruption_recovered' end;
    repaired_context:=coalesce(item.record->'context',jsonb_build_object(
      'sessionId',item.session_id,'contextVersion',1,
      'activeFeature',null,'activeModule',null,'activeWorkflow',null,
      'activeArchitecture',null,'activeChangeAnalysis',null,
      'previousQuestions','[]'::jsonb,'previousAnswers','[]'::jsonb,
      'recentFiles','[]'::jsonb,'recentSymbols','[]'::jsonb,
      'recentFeatures','[]'::jsonb,'viewedInsights','[]'::jsonb,
      'viewedPlans','[]'::jsonb,'viewedSpecifications','[]'::jsonb,
      'viewedExecutionSummaries','[]'::jsonb,
      'updatedAt',to_char(input_recovered_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
    diagnostic:=jsonb_build_object(
      'diagnosticId',item.session_id||':'||code||':'||recovered,
      'sessionId',item.session_id,'code',code,
      'message',case when next_lifecycle='archived'
        then 'Expired or stale session was archived.'
        else 'Repository session persistence was recovered.' end,
      'severity','warning','createdAt',to_char(
        input_recovered_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    update public.repository_engineering_sessions
    set lifecycle=next_lifecycle,updated_at=input_recovered_at,
      archived_at=case when next_lifecycle='archived'
        then input_recovered_at else null end,
      persistence_version=persistence_version+1,
      recovery_count=recovery_count+1,
      record=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
        jsonb_set(record,'{context}',repaired_context,true),
        '{session,lifecycle}',to_jsonb(next_lifecycle),true),
        '{session,updatedAt}',to_jsonb(to_char(
          input_recovered_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),true),
        '{session,archivedAt}',case when next_lifecycle='archived'
          then to_jsonb(to_char(input_recovered_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          else 'null'::jsonb end,true),
        '{session,persistenceVersion}',
          to_jsonb(persistence_version+1),true),
        '{recoveryCount}',to_jsonb(recovery_count+1),true),
        '{diagnostics}',coalesce(record->'diagnostics','[]'::jsonb)||
          jsonb_build_array(diagnostic),true)
    where tenant_id=item.tenant_id and session_id=item.session_id;
    insert into public.repository_session_context_snapshots(
      tenant_id,session_id,context_version,context_size,context,created_at
    ) values(
      item.tenant_id,item.session_id,
      (repaired_context->>'contextVersion')::bigint,
      public.repository_session_context_size(repaired_context),
      repaired_context,input_recovered_at
    ) on conflict do nothing;
    insert into public.repository_session_diagnostics(
      tenant_id,session_id,diagnostic_id,code,severity,
      diagnostic,created_at
    ) values(
      item.tenant_id,item.session_id,diagnostic->>'diagnosticId',
      code,'warning',diagnostic,input_recovered_at
    ) on conflict do nothing;
    update public.repository_session_metrics
    set recovery_count=recovery_count+1,
      context_size=public.repository_session_context_size(repaired_context),
      updated_at=input_recovered_at
    where tenant_id=item.tenant_id and session_id=item.session_id;
  end loop;
  return recovered;
end
$$;

create or replace function public.collect_repository_engineering_sessions(
  input_tenant_id text,input_retained_sessions integer
) returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare removed integer;
begin
  with victims as (
    select tenant_id,session_id
    from public.repository_engineering_sessions
    where tenant_id=input_tenant_id and lifecycle='archived'
    order by updated_at desc,session_id
    offset greatest(0,input_retained_sessions)
  )
  delete from public.repository_engineering_sessions session
  using victims
  where session.tenant_id=victims.tenant_id
    and session.session_id=victims.session_id;
  get diagnostics removed=row_count;
  return removed;
end
$$;

create or replace function public.repository_session_engine_metrics(
  input_tenant_id text default null
) returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'activeSessions',count(*) filter(where session.lifecycle in(
      'active','recovered')),
    'averageSessionDurationMs',coalesce(avg(metric.duration_ms),0),
    'averageContextSize',coalesce(avg(metric.context_size),0),
    'recoveryCount',coalesce(sum(metric.recovery_count),0),
    'sessionReuse',coalesce(sum(metric.reuse_count),0)
  )
  from public.repository_engineering_sessions session
  join public.repository_session_metrics metric
    using(tenant_id,session_id)
  where input_tenant_id is null or session.tenant_id=input_tenant_id
$$;

create or replace function public.verify_repository_session_engine_contract()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  with required_tables(name) as (values
    ('repository_engineering_sessions'),('repository_session_events'),
    ('repository_session_context_snapshots'),
    ('repository_session_diagnostics'),('repository_session_metrics')
  ), required_indexes(name) as (values
    ('repository_engineering_sessions_pkey'),
    ('repository_engineering_sessions_owner_idx'),
    ('repository_engineering_sessions_repository_idx'),
    ('repository_engineering_sessions_expiration_idx'),
    ('repository_session_events_pkey'),
    ('repository_session_events_navigation_idx'),
    ('repository_session_context_snapshots_pkey'),
    ('repository_session_context_latest_idx'),
    ('repository_session_diagnostics_pkey'),
    ('repository_session_diagnostics_code_idx'),
    ('repository_session_metrics_pkey'),
    ('repository_session_metrics_updated_idx')
  ), required_functions(name) as (values
    ('save_repository_engineering_session'),
    ('get_repository_engineering_session'),
    ('record_repository_session_reuse'),
    ('archive_repository_engineering_session'),
    ('recover_repository_engineering_sessions'),
    ('collect_repository_engineering_sessions'),
    ('repository_session_engine_metrics'),
    ('verify_repository_session_engine_contract')
  ), failures as (
    select 'table:'||name failure from required_tables
    where to_regclass('public.'||name) is null
    union all
    select 'index:'||name from required_indexes
    where to_regclass('public.'||name) is null
    union all
    select 'rls:'||name from required_tables
    where not coalesce((select relrowsecurity from pg_class
      where oid=to_regclass('public.'||name)),false)
    union all
    select 'grant:'||name from required_tables
    where not has_table_privilege(
      'service_role','public.'||name,'select')
      or has_table_privilege('anon','public.'||name,'select')
    union all
    select 'function:'||name from required_functions
    where not exists(
      select 1 from pg_proc procedure
      join pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='public' and procedure.proname=name
    )
  )
  select jsonb_build_object(
    'valid',not exists(select 1 from failures),
    'schemaVersion','repository-session-schema-v1',
    'tables',5,'indexes',12,'rls',5,'grants',5,
    'retention',to_regprocedure(
      'public.collect_repository_engineering_sessions(text,integer)')
      is not null,
    'failures',coalesce((select jsonb_agg(failure order by failure)
      from failures),'[]'::jsonb)
  )
$$;

revoke all on function public.repository_session_context_size(jsonb)
  from public;
revoke all on function public.get_repository_engineering_session(
  text,text,text) from public;
revoke all on function public.save_repository_engineering_session(
  jsonb,bigint) from public;
revoke all on function public.record_repository_session_reuse(
  text,text,text) from public;
revoke all on function public.archive_repository_engineering_session(
  text,text,text,timestamptz) from public;
revoke all on function public.recover_repository_engineering_sessions(
  timestamptz) from public;
revoke all on function public.collect_repository_engineering_sessions(
  text,integer) from public;
revoke all on function public.repository_session_engine_metrics(text)
  from public;
revoke all on function public.verify_repository_session_engine_contract()
  from public;
grant execute on function public.get_repository_engineering_session(
  text,text,text) to service_role;
grant execute on function public.save_repository_engineering_session(
  jsonb,bigint) to service_role;
grant execute on function public.record_repository_session_reuse(
  text,text,text) to service_role;
grant execute on function public.archive_repository_engineering_session(
  text,text,text,timestamptz) to service_role;
grant execute on function public.recover_repository_engineering_sessions(
  timestamptz) to service_role;
grant execute on function public.collect_repository_engineering_sessions(
  text,integer) to service_role;
grant execute on function public.repository_session_engine_metrics(text)
  to service_role;
grant execute on function public.verify_repository_session_engine_contract()
  to service_role;
