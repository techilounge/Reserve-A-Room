-- Preserve provider request identity without storing rendered messages or guest links.
-- Deploy this migration before deploying the matching application code.
alter table public.email_logs
  add column provider_first_attempt_at timestamptz,
  add column provider_payload_hash text,
  add column provider_review_required boolean not null default false;

alter table public.system_email_logs
  add column provider_first_attempt_at timestamptz,
  add column provider_payload_hash text,
  add column provider_review_required boolean not null default false;

-- An earlier attempt used a different idempotency format. Its outcome cannot be
-- safely reconstructed: stop automatic retry and require an operator to check Resend.
update public.email_logs
set provider_review_required = true, status = 'failed',
    error_message = 'Delivery outcome requires manual review before retrying.'
where status in ('sending', 'failed') and attempt_count > 0;

update public.system_email_logs
set provider_review_required = true, status = 'failed',
    error_message = 'Delivery outcome requires manual review before retrying.'
where status in ('sending', 'failed') and attempt_count > 0;

create or replace function public.claim_emails(p_limit integer default 20, p_reservation_id uuid default null)
returns setof uuid language sql security definer set search_path = '' as $$
  update public.email_logs e
  set status = 'sending', attempt_count = e.attempt_count + 1, last_attempt_at = now()
  where e.id in (
    select x.id from public.email_logs x
    where (x.status = 'queued' or (x.status = 'sending' and x.last_attempt_at < now() - interval '10 minutes'))
      and not x.provider_review_required and x.attempt_count < 5
      and (p_reservation_id is null or x.reservation_id = p_reservation_id)
    order by x.created_at limit least(greatest(p_limit, 1), 100) for update skip locked
  ) returning e.id;
$$;

create or replace function public.claim_system_emails(p_limit integer default 20, p_entity_id uuid default null)
returns setof uuid language sql security definer set search_path = '' as $$
  update public.system_email_logs e
  set status = 'sending', attempt_count = e.attempt_count + 1, last_attempt_at = now()
  where e.id in (
    select x.id from public.system_email_logs x
    where (x.status in ('queued', 'failed') or (x.status = 'sending' and x.last_attempt_at < now() - interval '10 minutes'))
      and not x.provider_review_required and x.attempt_count < 5
      and (p_entity_id is null or x.entity_id = p_entity_id)
    order by x.created_at limit least(greatest(p_limit, 1), 100) for update skip locked
  ) returning e.id;
$$;

create or replace function public.retry_email(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  update public.email_logs
  set status = 'queued', attempt_count = 0, error_message = null
  where id = p_id and status in ('failed', 'skipped') and not provider_review_required;
  if not found then
    raise exception 'Email is not retryable; review delivery in Resend first.' using errcode = 'RAR05';
  end if;
  perform private.write_audit('email.retried', 'email', p_id::text, '{}'::jsonb);
end;
$$;

create function public.prepare_email_delivery(p_id uuid, p_payload_hash text, p_system boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first timestamptz;
  v_hash text;
  v_review boolean;
begin
  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid payload fingerprint.' using errcode = 'RAR10';
  end if;

  if p_system then
    select provider_first_attempt_at, provider_payload_hash, provider_review_required
      into v_first, v_hash, v_review
      from public.system_email_logs where id = p_id and status = 'sending' for update;
  else
    select provider_first_attempt_at, provider_payload_hash, provider_review_required
      into v_first, v_hash, v_review
      from public.email_logs where id = p_id and status = 'sending' for update;
  end if;
  if not found then raise exception 'Email claim not found.' using errcode = 'RAR08'; end if;

  if v_review or (v_first is not null and
      (v_first < pg_catalog.now() - interval '23 hours' or v_hash is distinct from p_payload_hash)) then
    if p_system then
      update public.system_email_logs set provider_review_required = true where id = p_id;
    else
      update public.email_logs set provider_review_required = true where id = p_id;
    end if;
    return 'review_required';
  end if;

  if v_first is null then
    if p_system then
      update public.system_email_logs set provider_first_attempt_at = pg_catalog.now(), provider_payload_hash = p_payload_hash where id = p_id;
    else
      update public.email_logs set provider_first_attempt_at = pg_catalog.now(), provider_payload_hash = p_payload_hash where id = p_id;
    end if;
  end if;
  return 'ready';
end;
$$;

revoke execute on function public.prepare_email_delivery(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.prepare_email_delivery(uuid, text, boolean) to service_role;
