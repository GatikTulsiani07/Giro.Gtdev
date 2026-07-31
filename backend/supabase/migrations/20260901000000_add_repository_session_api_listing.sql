create or replace function public.list_repository_engineering_sessions(
  input_tenant_id text,
  input_owner_id text
) returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'sessions',
    coalesce(
      jsonb_agg(record order by updated_at desc,session_id desc),
      '[]'::jsonb
    )
  )
  from public.repository_engineering_sessions
  where tenant_id=input_tenant_id
    and owner_id=input_owner_id
    and lifecycle in('active','recovered')
$$;

create or replace function
public.verify_repository_session_api_persistence_contract()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'valid',
    to_regprocedure(
      'public.list_repository_engineering_sessions(text,text)'
    ) is not null,
    'schemaVersion','repository-session-schema-v1',
    'listing',
    to_regprocedure(
      'public.list_repository_engineering_sessions(text,text)'
    ) is not null
  )
$$;

revoke all on function public.list_repository_engineering_sessions(text,text)
  from public;
revoke all on function
  public.verify_repository_session_api_persistence_contract() from public;

grant execute on function
  public.list_repository_engineering_sessions(text,text) to service_role;
grant execute on function
  public.verify_repository_session_api_persistence_contract() to service_role;
