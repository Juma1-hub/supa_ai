-- Stage 18: durable, owner-isolated Demo account links.
-- Stores account metadata only. No OAuth/API token is ever persisted.
-- Apply only after reviewing existing data; the unique index intentionally fails
-- if one Deriv account is already linked to more than one Supa AI user.
alter table public.deriv_account_links
  add column if not exists verified_at timestamptz;

update public.deriv_account_links
set verified_at = coalesce(verified_at, created_at)
where verified_at is null;

create unique index if not exists deriv_account_links_account_global_uidx
  on public.deriv_account_links(deriv_account_id);

create or replace function public.link_verified_demo_account(
  p_user_id uuid, p_deriv_account_id text, p_currency text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.deriv_account_links%rowtype;
begin
  if p_user_id is null or p_deriv_account_id is null
     or length(trim(p_deriv_account_id)) < 3 or length(p_deriv_account_id) > 64
     or p_currency is null or length(trim(p_currency)) < 2 or length(p_currency) > 12 then
    raise exception 'Invalid verified Demo account metadata';
  end if;

  insert into public.deriv_account_links(user_id, deriv_account_id, account_type, currency, verified_at)
  values (p_user_id, p_deriv_account_id, 'demo', p_currency, now())
  on conflict (deriv_account_id) do update
    set currency = excluded.currency, verified_at = now()
    where public.deriv_account_links.user_id = excluded.user_id
      and public.deriv_account_links.account_type = 'demo'
  returning * into v_row;

  if not found then
    raise exception 'Deriv account is already linked to another Supa AI user';
  end if;

  return jsonb_build_object(
    'deriv_account_id', v_row.deriv_account_id,
    'account_type', v_row.account_type,
    'currency', v_row.currency,
    'verified_at', v_row.verified_at
  );
end; $$;

create or replace function public.list_my_demo_accounts(p_user_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'deriv_account_id', deriv_account_id,
    'account_type', account_type,
    'currency', currency,
    'verified_at', verified_at
  ) order by verified_at desc), '[]'::jsonb)
  from public.deriv_account_links
  where user_id = p_user_id and account_type = 'demo';
$$;

revoke all on function public.link_verified_demo_account(uuid,text,text) from public, anon, authenticated;
revoke all on function public.list_my_demo_accounts(uuid) from public, anon, authenticated;
grant execute on function public.link_verified_demo_account(uuid,text,text) to service_role;
grant execute on function public.list_my_demo_accounts(uuid) to service_role;
