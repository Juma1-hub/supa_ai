-- Stage 20: unified Demo + Real account linking.
-- Metadata only: no OAuth/API tokens are stored.
-- The global unique index from Stage 18 ensures a Deriv account cannot be
-- claimed by multiple Supa AI users, regardless of account type.

-- Stage 7 originally constrained account_type to Demo only. Expand it before
-- persisting Real account metadata.
alter table public.deriv_account_links
  drop constraint if exists deriv_account_links_account_type_check;
alter table public.deriv_account_links
  add constraint deriv_account_links_account_type_check
  check (account_type in ('demo', 'real'));

create or replace function public.link_verified_deriv_account(
  p_user_id uuid,
  p_deriv_account_id text,
  p_account_type text,
  p_currency text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.deriv_account_links%rowtype;
begin
  if p_user_id is null
     or p_deriv_account_id is null
     or length(trim(p_deriv_account_id)) < 3
     or length(p_deriv_account_id) > 64
     or p_account_type not in ('demo', 'real')
     or p_currency is null
     or length(trim(p_currency)) < 2
     or length(p_currency) > 12 then
    raise exception 'Invalid verified Deriv account metadata';
  end if;

  insert into public.deriv_account_links(user_id, deriv_account_id, account_type, currency, verified_at)
  values (p_user_id, p_deriv_account_id, p_account_type, p_currency, now())
  on conflict (deriv_account_id) do update
    set account_type = excluded.account_type,
        currency = excluded.currency,
        verified_at = now()
    where public.deriv_account_links.user_id = excluded.user_id
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

create or replace function public.list_my_deriv_accounts(p_user_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'deriv_account_id', deriv_account_id,
    'account_type', account_type,
    'currency', currency,
    'verified_at', verified_at
  ) order by verified_at desc), '[]'::jsonb)
  from public.deriv_account_links
  where user_id = p_user_id;
$$;

revoke all on function public.link_verified_deriv_account(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.list_my_deriv_accounts(uuid) from public, anon, authenticated;
grant execute on function public.link_verified_deriv_account(uuid,text,text,text) to service_role;
grant execute on function public.list_my_deriv_accounts(uuid) to service_role;
