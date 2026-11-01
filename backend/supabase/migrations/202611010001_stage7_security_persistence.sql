-- Supa AI Stage 7: user-owned records. No Deriv OAuth access tokens are stored.
create table if not exists public.strategy_drafts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  status text not null check (status in ('AWAITING_REVIEW','APPROVED_MONITORING_ONLY','REJECTED')),
  rules jsonb not null,
  execution_enabled boolean not null default false check (execution_enabled = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists strategy_drafts_user_created_idx on public.strategy_drafts(user_id, created_at desc);
alter table public.strategy_drafts enable row level security;
drop policy if exists strategy_drafts_select_own on public.strategy_drafts;
create policy strategy_drafts_select_own on public.strategy_drafts for select to authenticated using (auth.uid() = user_id);
drop policy if exists strategy_drafts_insert_own on public.strategy_drafts;
create policy strategy_drafts_insert_own on public.strategy_drafts for insert to authenticated with check (auth.uid() = user_id and execution_enabled = false);
drop policy if exists strategy_drafts_update_own on public.strategy_drafts;
create policy strategy_drafts_update_own on public.strategy_drafts for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id and execution_enabled = false);

create table if not exists public.deriv_account_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deriv_account_id text not null,
  account_type text not null check (account_type = 'demo'),
  currency text,
  created_at timestamptz not null default now(),
  unique(user_id, deriv_account_id)
);
alter table public.deriv_account_links enable row level security;
drop policy if exists deriv_account_links_select_own on public.deriv_account_links;
create policy deriv_account_links_select_own on public.deriv_account_links for select to authenticated using (auth.uid() = user_id);

create table if not exists public.trading_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  martingale_step integer not null default 0 check (martingale_step >= 0),
  next_stake numeric(20, 8) not null check (next_stake > 0),
  session_pnl numeric(20, 8) not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.trading_progress enable row level security;
drop policy if exists trading_progress_select_own on public.trading_progress;
create policy trading_progress_select_own on public.trading_progress for select to authenticated using (auth.uid() = user_id);

create table if not exists public.open_contracts (
  contract_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  deriv_account_id text not null,
  symbol text not null,
  contract_type text not null check (contract_type in ('ODD','EVEN')),
  stake numeric(20, 8) not null check (stake > 0),
  status text not null check (status in ('OPEN','SETTLED')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
alter table public.open_contracts enable row level security;
drop policy if exists open_contracts_select_own on public.open_contracts;
create policy open_contracts_select_own on public.open_contracts for select to authenticated using (auth.uid() = user_id);

create table if not exists public.confirmed_settlements (
  contract_id text primary key references public.open_contracts(contract_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  profit numeric(20, 8) not null,
  currency text not null,
  confirmed_by text not null check (confirmed_by = 'deriv'),
  settled_at timestamptz not null
);
alter table public.confirmed_settlements enable row level security;
drop policy if exists confirmed_settlements_select_own on public.confirmed_settlements;
create policy confirmed_settlements_select_own on public.confirmed_settlements for select to authenticated using (auth.uid() = user_id);

-- Backend service-role key is required for server-side writes and must never be exposed to browsers.
-- Browser users receive only own-row SELECT policies; all sensitive writes go through authenticated backend routes.

-- Stage 9: durable runtime checkpoints and atomic, idempotent settlements.
-- The service-role key is used only by the backend. Browser clients receive no write policy.
create table if not exists public.runtime_checkpoints (
  user_id uuid primary key references auth.users(id) on delete cascade,
  strategy_id uuid not null references public.strategy_drafts(id) on delete cascade,
  martingale_step integer not null check (martingale_step >= 0),
  session_pnl numeric(20,8) not null default 0,
  open_contract_ids text[] not null default '{}',
  checkpoint_version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.runtime_checkpoints enable row level security;
drop policy if exists runtime_checkpoints_select_own on public.runtime_checkpoints;
create policy runtime_checkpoints_select_own on public.runtime_checkpoints for select to authenticated using (auth.uid() = user_id);

-- Register an open contract and its matching progression checkpoint in one DB transaction.
create or replace function public.register_open_contract(
  p_user_id uuid, p_strategy_id uuid, p_contract_id text, p_deriv_account_id text,
  p_symbol text, p_contract_type text, p_stake numeric, p_martingale_step integer, p_session_pnl numeric
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_contract_id is null or length(trim(p_contract_id)) = 0 or p_stake <= 0 or p_martingale_step < 0 then
    raise exception 'Invalid open contract parameters';
  end if;
  insert into public.open_contracts(contract_id,user_id,deriv_account_id,symbol,contract_type,stake,status)
  values(p_contract_id,p_user_id,p_deriv_account_id,p_symbol,p_contract_type,p_stake,'OPEN');
  insert into public.runtime_checkpoints(user_id,strategy_id,martingale_step,session_pnl,open_contract_ids)
  values(p_user_id,p_strategy_id,p_martingale_step,p_session_pnl,array[p_contract_id])
  on conflict(user_id) do update set strategy_id=excluded.strategy_id,
    martingale_step=excluded.martingale_step,session_pnl=excluded.session_pnl,
    open_contract_ids=(select coalesce(array_agg(distinct x), '{}') from unnest(public.runtime_checkpoints.open_contract_ids || excluded.open_contract_ids) x),
    updated_at=now();
end; $$;

-- A settlement row is the idempotency key. Duplicate contract results return false and do not
-- alter P/L or Martingale progression a second time.
create or replace function public.apply_confirmed_settlement(
  p_user_id uuid, p_contract_id text, p_profit numeric, p_currency text, p_settled_at timestamptz,
  p_martingale_enabled boolean default true
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_step integer; v_pnl numeric(20,8); v_strategy uuid;
begin
  if p_profit is null or p_currency is null or length(trim(p_currency)) = 0 or p_settled_at is null then
    raise exception 'Invalid settlement details';
  end if;
  if exists(select 1 from public.confirmed_settlements where contract_id=p_contract_id) then
    return false;
  end if;
  select martingale_step,session_pnl,strategy_id into v_step,v_pnl,v_strategy
    from public.runtime_checkpoints where user_id=p_user_id for update;
  if not found then raise exception 'Runtime checkpoint not found'; end if;
  update public.open_contracts set status='SETTLED',settled_at=p_settled_at
    where contract_id=p_contract_id and user_id=p_user_id and status='OPEN';
  if not found then raise exception 'Open contract not found for this user'; end if;
  insert into public.confirmed_settlements(contract_id,user_id,profit,currency,confirmed_by,settled_at)
    values(p_contract_id,p_user_id,p_profit,p_currency,'deriv',p_settled_at);
  v_step := case when p_profit < 0 and p_martingale_enabled then v_step + 1
                 when p_profit > 0 then 0 else v_step end;
  update public.runtime_checkpoints set martingale_step=v_step, session_pnl=v_pnl+p_profit,
    open_contract_ids=array_remove(open_contract_ids,p_contract_id), updated_at=now()
    where user_id=p_user_id;
  insert into public.trading_progress(user_id,martingale_step,next_stake,session_pnl)
    select p_user_id,v_step,
      (rules->>'initial_stake')::numeric * case when coalesce((rules->>'martingale_enabled')::boolean,true)
        then power((rules->>'martingale_multiplier')::numeric,v_step) else 1 end,
      v_pnl+p_profit
    from public.strategy_drafts where id=v_strategy and user_id=p_user_id
  on conflict(user_id) do update set martingale_step=excluded.martingale_step,
    next_stake=excluded.next_stake,session_pnl=excluded.session_pnl,updated_at=now();
  return true;
end; $$;
revoke all on function public.register_open_contract(uuid,uuid,text,text,text,text,numeric,integer,numeric) from public, anon, authenticated;
revoke all on function public.apply_confirmed_settlement(uuid,text,numeric,text,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.register_open_contract(uuid,uuid,text,text,text,text,numeric,integer,numeric) to service_role;
grant execute on function public.apply_confirmed_settlement(uuid,text,numeric,text,timestamptz,boolean) to service_role;

-- Stage 11: list only the authenticated user's persisted OPEN Demo contracts for
-- restart reconciliation. This function does not modify trading state.
create or replace function public.list_reconcilable_open_contracts(
  p_user_id uuid, p_deriv_account_id text, p_limit integer default 20
) returns table(contract_id text, deriv_account_id text, currency text, martingale_enabled boolean)
language sql security definer set search_path = public as $$
  select oc.contract_id, oc.deriv_account_id, coalesce(al.currency, '') as currency,
         coalesce((sd.rules->>'martingale_enabled')::boolean, false) as martingale_enabled
  from public.open_contracts oc
  join public.deriv_account_links al
    on al.user_id=oc.user_id and al.deriv_account_id=oc.deriv_account_id and al.account_type='demo'
  join public.runtime_checkpoints rc on rc.user_id=oc.user_id
  join public.strategy_drafts sd on sd.id=rc.strategy_id and sd.user_id=oc.user_id
  where oc.user_id=p_user_id and oc.deriv_account_id=p_deriv_account_id and oc.status='OPEN'
  order by oc.created_at asc
  limit greatest(1, least(coalesce(p_limit,20),50));
$$;
revoke all on function public.list_reconcilable_open_contracts(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.list_reconcilable_open_contracts(uuid,text,integer) to service_role;
