create table if not exists public.collaborations (
  tenant_id text not null,
  collaboration_id text not null,
  execution_id text not null,
  execution_version text not null,
  repository_id text not null references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  plan_version text not null,
  coordinator_runtime_id text not null,
  lifecycle text not null,
  context jsonb not null,
  state jsonb not null,
  conflict_count integer not null default 0,
  reassignment_count integer not null default 0,
  recovery_count integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key(tenant_id,collaboration_id),
  foreign key(repository_id,repository_revision)
    references public.repository_snapshots(repository_id,revision) on delete cascade,
  constraint collaborations_id_valid check (
    collaboration_id ~ '^collaboration_[0-9a-f]{24}$'
  ),
  constraint collaborations_lifecycle_valid check (lifecycle in (
    'created','assembling','active','paused','completed','cancelled','failed','superseded'
  )),
  constraint collaborations_identity_present check (
    btrim(tenant_id)<>'' and btrim(execution_id)<>'' and btrim(execution_version)<>''
    and btrim(plan_version)<>'' and btrim(coordinator_runtime_id)<>''
  ),
  constraint collaborations_json_valid check (
    jsonb_typeof(context)='object' and jsonb_typeof(state)='object'
  ),
  constraint collaborations_counts_valid check (
    conflict_count>=0 and reassignment_count>=0 and recovery_count>=0
  ),
  constraint collaborations_terminal_valid check (
    (lifecycle in ('completed','cancelled','failed','superseded'))=(completed_at is not null)
  )
);

create table if not exists public.collaboration_participants (
  tenant_id text not null,
  collaboration_id text not null,
  runtime_id text not null,
  agent_id text not null,
  capability_version text not null,
  role text not null,
  status text not null,
  assigned_work_units jsonb not null default '[]'::jsonb,
  lease jsonb,
  heartbeat jsonb,
  registered_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(tenant_id,collaboration_id,runtime_id),
  foreign key(tenant_id,collaboration_id)
    references public.collaborations(tenant_id,collaboration_id) on delete cascade,
  constraint collaboration_participants_role_valid check (
    role in ('coordinator','contributor','reviewer','observer')
  ),
  constraint collaboration_participants_status_valid check (
    status in ('registered','active','abandoned','completed','removed')
  ),
  constraint collaboration_participants_identity_present check (
    btrim(runtime_id)<>'' and btrim(agent_id)<>'' and btrim(capability_version)<>''
  ),
  constraint collaboration_participants_json_valid check (
    jsonb_typeof(assigned_work_units)='array'
    and (lease is null or jsonb_typeof(lease)='object')
    and (heartbeat is null or jsonb_typeof(heartbeat)='object')
  )
);

create table if not exists public.collaboration_work_units (
  tenant_id text not null,
  collaboration_id text not null,
  work_unit_id text not null,
  work_unit_version text not null,
  unit_order integer not null,
  prerequisites jsonb not null,
  status text not null,
  owner_runtime_id text,
  assignment jsonb,
  output_version integer not null,
  retry_count integer not null,
  definition jsonb not null,
  updated_at timestamptz not null,
  primary key(tenant_id,collaboration_id,work_unit_id),
  foreign key(tenant_id,collaboration_id)
    references public.collaborations(tenant_id,collaboration_id) on delete cascade,
  foreign key(tenant_id,collaboration_id,owner_runtime_id)
    references public.collaboration_participants(tenant_id,collaboration_id,runtime_id)
    on delete restrict,
  constraint collaboration_work_units_status_valid check (status in (
    'blocked','ready','assigned','running','awaiting_review','succeeded','failed','cancelled'
  )),
  constraint collaboration_work_units_versions_present check (
    btrim(work_unit_id)<>'' and btrim(work_unit_version)<>''
  ),
  constraint collaboration_work_units_counts_valid check (
    unit_order>=0 and output_version>=0 and retry_count>=0
  ),
  constraint collaboration_work_units_json_valid check (
    jsonb_typeof(prerequisites)='array' and jsonb_typeof(definition)='object'
    and (assignment is null or jsonb_typeof(assignment)='object')
  ),
  constraint collaboration_work_units_assignment_consistent check (
    (status in ('assigned','running','awaiting_review') and owner_runtime_id is not null and assignment is not null)
    or (status not in ('assigned','running','awaiting_review'))
  )
);

create table if not exists public.collaboration_messages (
  tenant_id text not null,
  collaboration_id text not null,
  message_id text not null,
  message_type text not null,
  sender_runtime_id text not null,
  receiver_runtime_id text not null,
  execution_version text not null,
  work_unit_id text not null,
  work_unit_version text not null,
  payload_schema_version text not null,
  payload_hash text not null,
  payload jsonb not null,
  orphaned boolean not null default false,
  created_at timestamptz not null,
  primary key(tenant_id,collaboration_id,message_id),
  foreign key(tenant_id,collaboration_id)
    references public.collaborations(tenant_id,collaboration_id) on delete cascade,
  foreign key(tenant_id,collaboration_id,sender_runtime_id)
    references public.collaboration_participants(tenant_id,collaboration_id,runtime_id)
    on delete restrict,
  foreign key(tenant_id,collaboration_id,receiver_runtime_id)
    references public.collaboration_participants(tenant_id,collaboration_id,runtime_id)
    on delete restrict,
  foreign key(tenant_id,collaboration_id,work_unit_id)
    references public.collaboration_work_units(tenant_id,collaboration_id,work_unit_id)
    on delete cascade,
  constraint collaboration_messages_type_valid check (message_type in (
    'assignment','progress','question','answer','review_request','review_response',
    'blocker','completion','diagnostic'
  )),
  constraint collaboration_messages_id_valid check (
    message_id ~ '^collaboration_message_[0-9a-f]{24}$'
  ),
  constraint collaboration_messages_hash_valid check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint collaboration_messages_payload_valid check (
    jsonb_typeof(payload)='object' and btrim(payload_schema_version)<>''
  )
);

create table if not exists public.collaboration_reviews (
  tenant_id text not null,
  collaboration_id text not null,
  review_id text not null,
  work_unit_id text not null,
  work_unit_version text not null,
  requester_runtime_id text not null,
  reviewer_runtime_id text not null,
  reviewed_output_version integer not null,
  verdict text,
  findings jsonb not null default '[]'::jsonb,
  status text not null,
  requested_at timestamptz not null,
  reviewed_at timestamptz,
  primary key(tenant_id,collaboration_id,review_id),
  foreign key(tenant_id,collaboration_id)
    references public.collaborations(tenant_id,collaboration_id) on delete cascade,
  foreign key(tenant_id,collaboration_id,work_unit_id)
    references public.collaboration_work_units(tenant_id,collaboration_id,work_unit_id)
    on delete cascade,
  foreign key(tenant_id,collaboration_id,requester_runtime_id)
    references public.collaboration_participants(tenant_id,collaboration_id,runtime_id)
    on delete restrict,
  foreign key(tenant_id,collaboration_id,reviewer_runtime_id)
    references public.collaboration_participants(tenant_id,collaboration_id,runtime_id)
    on delete restrict,
  constraint collaboration_reviews_id_valid check (
    review_id ~ '^collaboration_review_[0-9a-f]{24}$'
  ),
  constraint collaboration_reviews_status_valid check (
    status in ('pending','completed','cancelled')
  ),
  constraint collaboration_reviews_verdict_valid check (
    verdict is null or verdict in ('approved','changes_requested','rejected')
  ),
  constraint collaboration_reviews_findings_valid check (jsonb_typeof(findings)='array'),
  constraint collaboration_reviews_version_valid check (reviewed_output_version>0),
  constraint collaboration_reviews_completion_valid check (
    (status='completed' and verdict is not null and reviewed_at is not null)
    or (status<>'completed' and verdict is null and reviewed_at is null)
  )
);

create table if not exists public.collaboration_diagnostics (
  tenant_id text not null,
  collaboration_id text not null,
  diagnostic_id text not null,
  code text not null,
  message text not null,
  retryable boolean not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  primary key(tenant_id,collaboration_id,diagnostic_id),
  foreign key(tenant_id,collaboration_id)
    references public.collaborations(tenant_id,collaboration_id) on delete cascade,
  constraint collaboration_diagnostics_id_valid check (
    diagnostic_id ~ '^collaboration_diagnostic_[0-9a-f]{24}$'
  ),
  constraint collaboration_diagnostics_present check (
    btrim(code)<>'' and btrim(message)<>''
  ),
  constraint collaboration_diagnostics_details_valid check (jsonb_typeof(details)='object')
);

create table if not exists public.collaboration_recovery_state (
  tenant_id text not null,
  collaboration_id text not null,
  recovery_id text not null,
  reason text not null,
  participant_runtime_id text,
  work_unit_id text,
  previous_state text not null,
  recovered_state text not null,
  recovered_at timestamptz not null,
  primary key(tenant_id,collaboration_id,recovery_id),
  foreign key(tenant_id,collaboration_id)
    references public.collaborations(tenant_id,collaboration_id) on delete cascade,
  constraint collaboration_recovery_id_valid check (
    recovery_id ~ '^collaboration_recovery_[0-9a-f]{24}$'
  ),
  constraint collaboration_recovery_reason_valid check (reason in (
    'abandoned_participant','expired_lease','interrupted_session',
    'pending_review','orphan_message'
  )),
  constraint collaboration_recovery_states_present check (
    btrim(previous_state)<>'' and btrim(recovered_state)<>''
  )
);

create table if not exists public.collaboration_retention (
  tenant_id text primary key,
  retention_count integer not null,
  updated_at timestamptz not null default now(),
  constraint collaboration_retention_count_valid check (retention_count>0)
);

create index if not exists collaborations_active_idx
  on public.collaborations(tenant_id,lifecycle,updated_at,collaboration_id)
  where lifecycle not in ('completed','cancelled','failed','superseded');
create index if not exists collaborations_execution_idx
  on public.collaborations(tenant_id,execution_version,repository_revision);
create index if not exists collaboration_participants_lease_idx
  on public.collaboration_participants(tenant_id,status,(lease->>'expiresAt'))
  where lease is not null and status='active';
create index if not exists collaboration_participants_capability_idx
  on public.collaboration_participants(tenant_id,capability_version,runtime_id);
create index if not exists collaboration_work_units_schedule_idx
  on public.collaboration_work_units(tenant_id,collaboration_id,status,unit_order,work_unit_id);
create index if not exists collaboration_messages_route_idx
  on public.collaboration_messages(tenant_id,collaboration_id,receiver_runtime_id,created_at);
create index if not exists collaboration_reviews_pending_idx
  on public.collaboration_reviews(tenant_id,collaboration_id,reviewer_runtime_id,requested_at)
  where status='pending';
create index if not exists collaboration_diagnostics_code_idx
  on public.collaboration_diagnostics(tenant_id,collaboration_id,code,created_at);
create index if not exists collaboration_recovery_time_idx
  on public.collaboration_recovery_state(tenant_id,collaboration_id,recovered_at);

create or replace function public.get_collaboration(
  input_tenant_id text,input_collaboration_id text
) returns table(collaboration jsonb)
language sql stable security invoker set search_path=public as $$
  select state from public.collaborations
  where tenant_id=input_tenant_id and collaboration_id=input_collaboration_id
$$;

create or replace function public.save_collaboration_state(
  input_collaboration jsonb,input_expected_updated_at text
) returns table(collaboration jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.collaborations%rowtype;
declare participant jsonb;
declare unit jsonb;
declare message jsonb;
declare review jsonb;
declare diagnostic jsonb;
declare recovery jsonb;
declare tenant_value text:=input_collaboration->>'tenantId';
declare collaboration_value text:=input_collaboration->>'collaborationId';
begin
  if jsonb_typeof(input_collaboration)<>'object'
    or jsonb_typeof(input_collaboration->'participants')<>'array'
    or jsonb_typeof(input_collaboration->'workUnits')<>'array'
    or jsonb_typeof(input_collaboration->'messages')<>'array'
    or jsonb_typeof(input_collaboration->'reviews')<>'array'
    or jsonb_typeof(input_collaboration->'diagnostics')<>'array'
    or jsonb_typeof(input_collaboration->'recoveryState')<>'array' then
    raise check_violation using message='collaboration_state_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant_value||'|'||collaboration_value,0));
  select * into existing from public.collaborations candidate
  where candidate.tenant_id=tenant_value
    and candidate.collaboration_id=collaboration_value for update;
  if found and (input_expected_updated_at is null
      or existing.updated_at<>input_expected_updated_at::timestamptz) then
    raise serialization_failure using message='collaboration_version_conflict';
  elsif not found and input_expected_updated_at is not null then
    raise serialization_failure using message='collaboration_version_conflict';
  end if;

  insert into public.collaborations(
    tenant_id,collaboration_id,execution_id,execution_version,repository_id,
    repository_revision,plan_version,coordinator_runtime_id,lifecycle,context,state,
    conflict_count,reassignment_count,recovery_count,created_at,updated_at,completed_at
  ) values(
    tenant_value,collaboration_value,input_collaboration->>'executionId',
    input_collaboration->>'executionVersion',input_collaboration->>'repositoryId',
    input_collaboration->>'repositoryRevision',input_collaboration->>'planVersion',
    input_collaboration->>'coordinatorRuntimeId',input_collaboration->>'lifecycle',
    input_collaboration->'context',input_collaboration,
    (input_collaboration->>'conflictCount')::integer,
    (input_collaboration->>'reassignmentCount')::integer,
    (input_collaboration->>'recoveryCount')::integer,
    (input_collaboration->>'createdAt')::timestamptz,
    (input_collaboration->>'updatedAt')::timestamptz,
    nullif(input_collaboration->>'completedAt','')::timestamptz
  ) on conflict(tenant_id,collaboration_id) do update set
    lifecycle=excluded.lifecycle,context=excluded.context,state=excluded.state,
    conflict_count=excluded.conflict_count,reassignment_count=excluded.reassignment_count,
    recovery_count=excluded.recovery_count,updated_at=excluded.updated_at,
    completed_at=excluded.completed_at;

  for participant in select * from jsonb_array_elements(input_collaboration->'participants') loop
    insert into public.collaboration_participants(
      tenant_id,collaboration_id,runtime_id,agent_id,capability_version,role,status,
      assigned_work_units,lease,heartbeat,registered_at,updated_at
    ) values(
      tenant_value,collaboration_value,participant->>'runtimeId',participant->>'agentId',
      participant->>'capabilityVersion',participant->>'role',participant->>'status',
      participant->'assignedWorkUnits',
      case when jsonb_typeof(participant->'lease')='object' then participant->'lease' else null end,
      case when jsonb_typeof(participant->'heartbeat')='object' then participant->'heartbeat' else null end,
      (participant->>'registeredAt')::timestamptz,(participant->>'updatedAt')::timestamptz
    ) on conflict(tenant_id,collaboration_id,runtime_id) do update set
      status=excluded.status,assigned_work_units=excluded.assigned_work_units,
      lease=excluded.lease,heartbeat=excluded.heartbeat,updated_at=excluded.updated_at
    where collaboration_participants.agent_id=excluded.agent_id
      and collaboration_participants.capability_version=excluded.capability_version
      and collaboration_participants.role=excluded.role;
    if not found then raise check_violation using message='stale_collaboration_capability'; end if;
  end loop;

  for unit in select * from jsonb_array_elements(input_collaboration->'workUnits') loop
    insert into public.collaboration_work_units(
      tenant_id,collaboration_id,work_unit_id,work_unit_version,unit_order,
      prerequisites,status,owner_runtime_id,assignment,output_version,retry_count,
      definition,updated_at
    ) values(
      tenant_value,collaboration_value,unit->>'workUnitId',unit->>'workUnitVersion',
      (unit->>'order')::integer,unit->'prerequisites',unit->>'status',
      nullif(unit->>'ownerRuntimeId',''),
      case when jsonb_typeof(unit->'assignment')='object' then unit->'assignment' else null end,
      (unit->>'outputVersion')::integer,(unit->>'retryCount')::integer,
      unit,(unit->>'updatedAt')::timestamptz
    ) on conflict(tenant_id,collaboration_id,work_unit_id) do update set
      status=excluded.status,owner_runtime_id=excluded.owner_runtime_id,
      assignment=excluded.assignment,output_version=excluded.output_version,
      retry_count=excluded.retry_count,definition=excluded.definition,
      updated_at=excluded.updated_at
    where collaboration_work_units.work_unit_version=excluded.work_unit_version;
    if not found then raise check_violation using message='stale_collaboration_work_unit'; end if;
  end loop;

  for message in select * from jsonb_array_elements(input_collaboration->'messages') loop
    insert into public.collaboration_messages(
      tenant_id,collaboration_id,message_id,message_type,sender_runtime_id,
      receiver_runtime_id,execution_version,work_unit_id,work_unit_version,
      payload_schema_version,payload_hash,payload,orphaned,created_at
    ) values(
      tenant_value,collaboration_value,message->>'messageId',message->>'messageType',
      message->>'senderRuntimeId',message->>'receiverRuntimeId',
      message->>'executionVersion',message->>'workUnitId',message->>'workUnitVersion',
      message->>'payloadSchemaVersion',message->>'payloadHash',message->'payload',
      (message->>'orphaned')::boolean,(message->>'timestamp')::timestamptz
    ) on conflict(tenant_id,collaboration_id,message_id) do update set
      orphaned=excluded.orphaned
    where collaboration_messages.payload_hash=excluded.payload_hash
      and collaboration_messages.sender_runtime_id=excluded.sender_runtime_id
      and collaboration_messages.receiver_runtime_id=excluded.receiver_runtime_id;
    if not found then raise check_violation using message='collaboration_message_conflict'; end if;
  end loop;

  for review in select * from jsonb_array_elements(input_collaboration->'reviews') loop
    insert into public.collaboration_reviews(
      tenant_id,collaboration_id,review_id,work_unit_id,work_unit_version,
      requester_runtime_id,reviewer_runtime_id,reviewed_output_version,verdict,
      findings,status,requested_at,reviewed_at
    ) values(
      tenant_value,collaboration_value,review->>'reviewId',review->>'workUnitId',
      review->>'workUnitVersion',review->>'requesterRuntimeId',
      review->>'reviewerRuntimeId',(review->>'reviewedOutputVersion')::integer,
      nullif(review->>'verdict',''),review->'findings',review->>'status',
      (review->>'requestedAt')::timestamptz,
      nullif(review->>'timestamp','')::timestamptz
    ) on conflict(tenant_id,collaboration_id,review_id) do update set
      reviewer_runtime_id=excluded.reviewer_runtime_id,verdict=excluded.verdict,
      findings=excluded.findings,status=excluded.status,reviewed_at=excluded.reviewed_at
    where collaboration_reviews.work_unit_version=excluded.work_unit_version
      and collaboration_reviews.reviewed_output_version=excluded.reviewed_output_version;
    if not found then raise check_violation using message='stale_collaboration_review'; end if;
  end loop;

  for diagnostic in select * from jsonb_array_elements(input_collaboration->'diagnostics') loop
    insert into public.collaboration_diagnostics(
      tenant_id,collaboration_id,diagnostic_id,code,message,retryable,details,created_at
    ) values(
      tenant_value,collaboration_value,diagnostic->>'diagnosticId',diagnostic->>'code',
      diagnostic->>'message',(diagnostic->>'retryable')::boolean,diagnostic->'details',
      (diagnostic->>'timestamp')::timestamptz
    ) on conflict(tenant_id,collaboration_id,diagnostic_id) do nothing;
  end loop;

  for recovery in select * from jsonb_array_elements(input_collaboration->'recoveryState') loop
    insert into public.collaboration_recovery_state(
      tenant_id,collaboration_id,recovery_id,reason,participant_runtime_id,
      work_unit_id,previous_state,recovered_state,recovered_at
    ) values(
      tenant_value,collaboration_value,recovery->>'recoveryId',recovery->>'reason',
      nullif(recovery->>'participantRuntimeId',''),nullif(recovery->>'workUnitId',''),
      recovery->>'previousState',recovery->>'recoveredState',
      (recovery->>'timestamp')::timestamptz
    ) on conflict(tenant_id,collaboration_id,recovery_id) do nothing;
  end loop;

  return query select input_collaboration;
end; $$;

create or replace function public.record_collaboration_conflict(
  input_tenant_id text,input_collaboration_id text,input_code text,input_message text
) returns void
language plpgsql security invoker set search_path=public as $$
declare diagnostic_value jsonb;
declare diagnostic_id_value text;
declare timestamp_value timestamptz:=clock_timestamp();
begin
  diagnostic_id_value:='collaboration_diagnostic_'||
    substr(md5(input_collaboration_id||'|'||input_code||'|'||timestamp_value::text)||
      md5(input_code||input_collaboration_id),1,24);
  diagnostic_value:=jsonb_build_object(
    'diagnosticId',diagnostic_id_value,'code',input_code,'message',input_message,
    'retryable',false,'details','{}'::jsonb,'timestamp',timestamp_value::text
  );
  update public.collaborations set
    conflict_count=conflict_count+1,
    state=jsonb_set(jsonb_set(
      jsonb_set(state,'{conflictCount}',to_jsonb(conflict_count+1)),
      '{diagnostics}',coalesce(state->'diagnostics','[]'::jsonb)||diagnostic_value),
      '{updatedAt}',to_jsonb(timestamp_value::text)),
    updated_at=timestamp_value
  where tenant_id=input_tenant_id and collaboration_id=input_collaboration_id;
  insert into public.collaboration_diagnostics(
    tenant_id,collaboration_id,diagnostic_id,code,message,retryable,details,created_at
  ) values(
    input_tenant_id,input_collaboration_id,diagnostic_id_value,input_code,
    input_message,false,'{}'::jsonb,timestamp_value
  );
end; $$;

create or replace function public.list_recoverable_collaborations()
returns table(collaborations jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(state order by updated_at,collaboration_id),'[]'::jsonb)
  from public.collaborations
  where lifecycle not in ('completed','cancelled','failed','superseded')
$$;

create or replace function public.collaboration_metrics(input_tenant_id text default null)
returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'activeCollaborations',count(*) filter(
      where lifecycle in ('assembling','active','paused')),
    'participants',coalesce(sum(jsonb_array_length(state->'participants')),0),
    'messages',coalesce(sum(jsonb_array_length(state->'messages')),0),
    'reviews',coalesce(sum(jsonb_array_length(state->'reviews')),0),
    'conflicts',coalesce(sum(conflict_count),0),
    'reassignmentCount',coalesce(sum(reassignment_count),0),
    'recoveryCount',coalesce(sum(recovery_count),0),
    'completionLatencyMs',coalesce(sum(case when completed_at is not null
      then extract(epoch from (completed_at-created_at))*1000 else 0 end),0)
  ) from public.collaborations collaboration
  where input_tenant_id is null or collaboration.tenant_id=input_tenant_id
$$;

create or replace function public.collect_collaborations(
  input_tenant_id text,input_retention_count integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.collaboration_retention(tenant_id,retention_count)
  values(input_tenant_id,greatest(1,input_retention_count))
  on conflict(tenant_id) do update set
    retention_count=excluded.retention_count,updated_at=now();
  with victims as (
    select collaboration_id from public.collaborations
    where tenant_id=input_tenant_id
      and lifecycle in ('completed','cancelled','failed','superseded')
    order by created_at desc,collaboration_id desc offset greatest(1,input_retention_count)
  )
  delete from public.collaborations collaboration using victims
  where collaboration.tenant_id=input_tenant_id
    and collaboration.collaboration_id=victims.collaboration_id;
  get diagnostics removed=row_count;
  return query select removed;
end; $$;

create or replace function public.verify_collaboration_contract(input_engine_version text)
returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare table_name text;
begin
  if input_engine_version<>'multi-agent-collaboration-v1' then
    issues:=issues||'"collaboration_engine_version_incompatible"'::jsonb;
  end if;
  foreach table_name in array array[
    'collaborations','collaboration_participants','collaboration_work_units',
    'collaboration_messages','collaboration_reviews','collaboration_diagnostics',
    'collaboration_recovery_state','collaboration_retention'
  ] loop
    if to_regclass('public.'||table_name) is null then
      issues:=issues||to_jsonb(table_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||table_name) and relrowsecurity) then
      issues:=issues||to_jsonb(table_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='collaboration_work_units_schedule_idx')
    or not exists(select 1 from pg_indexes
      where indexname='collaboration_reviews_pending_idx')
    or not exists(select 1 from pg_indexes
      where indexname='collaboration_participants_lease_idx') then
    issues:=issues||'"collaboration_indexes_missing"'::jsonb;
  end if;
  if not has_table_privilege('service_role','public.collaborations','select')
    or has_table_privilege('anon','public.collaborations','select')
    or not has_function_privilege('service_role',
      'public.save_collaboration_state(jsonb,text)','execute')
    or has_function_privilege('anon',
      'public.save_collaboration_state(jsonb,text)','execute') then
    issues:=issues||'"collaboration_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure('public.collect_collaborations(text,integer)') is null then
    issues:=issues||'"collaboration_retention_missing"'::jsonb;
  end if;
  if exists(
    select 1 from public.collaboration_work_units unit
    left join public.collaboration_participants participant
      on participant.tenant_id=unit.tenant_id
      and participant.collaboration_id=unit.collaboration_id
      and participant.runtime_id=unit.owner_runtime_id
    where unit.owner_runtime_id is not null and participant.runtime_id is null
  ) then issues:=issues||'"collaboration_ownership_invalid"'::jsonb; end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'collaborations','collaboration_participants','collaboration_work_units',
    'collaboration_messages','collaboration_reviews','collaboration_diagnostics',
    'collaboration_recovery_state','collaboration_retention'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
    execute format('grant select,insert,update,delete on table public.%I to service_role',table_name);
  end loop;
end $$;

revoke all on function public.get_collaboration(text,text) from public,anon,authenticated;
revoke all on function public.save_collaboration_state(jsonb,text) from public,anon,authenticated;
revoke all on function public.record_collaboration_conflict(text,text,text,text) from public,anon,authenticated;
revoke all on function public.list_recoverable_collaborations() from public,anon,authenticated;
revoke all on function public.collaboration_metrics(text) from public,anon,authenticated;
revoke all on function public.collect_collaborations(text,integer) from public,anon,authenticated;
revoke all on function public.verify_collaboration_contract(text) from public,anon,authenticated;

grant execute on function public.get_collaboration(text,text) to service_role;
grant execute on function public.save_collaboration_state(jsonb,text) to service_role;
grant execute on function public.record_collaboration_conflict(text,text,text,text) to service_role;
grant execute on function public.list_recoverable_collaborations() to service_role;
grant execute on function public.collaboration_metrics(text) to service_role;
grant execute on function public.collect_collaborations(text,integer) to service_role;
grant execute on function public.verify_collaboration_contract(text) to service_role;
