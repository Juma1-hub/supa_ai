-- Stage 13: durable, idempotent Demo purchase intent journal.
-- This migration DOES NOT enable or execute purchases. It records intent only.
create table if not exists public.demo_purchase_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  strategy_id uuid not null references public.strategy_drafts(id) on delete restrict,
  deriv_account_id text not null,
  symbol text not null check (symbol in ('R_10','R_25','R_50','R_75','R_100','1HZ10V','1HZ25V','1HZ50V','1HZ75V','1HZ100V')),
  contract_type text not null check (contract_type in ('ODD','EVEN')),
  stake numeric(20,8) not null check (stake > 0),
  currency text not null,
  proposal_id text not null,
  ask_price numeric(20,8) not null check (ask_price > 0),
  status text not null default 'PREPARED_PURCHASE_DISABLED'
    check (status in ('PREPARED_PURCHASE_DISABLED','PURCHASE_UNKNOWN','PURCHASE_CONFIRMED','ABORTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, idempotency_key)
);
create index if not exists demo_purchase_intents_user_status_idx
  on public.demo_purchase_intents(user_id, status, created_at desc);
alter table public.demo_purchase_intents enable row level security;
drop policy if exists demo_purchase_intents_select_own on public.demo_purchase_intents;
create policy demo_purchase_intents_select_own on public.demo_purchase_intents
  for select to authenticated using (auth.uid() = user_id);

-- Only the backend service role can create intents. Reusing an idempotency key
-- with different parameters is rejected, not silently treated as the same request.
create or replace function public.create_demo_purchase_intent(
  p_user_id uuid, p_idempotency_key uuid, p_strategy_id uuid, p_deriv_account_id text,
  p_symbol text, p_contract_type text, p_stake numeric, p_currency text,
  p_proposal_id text, p_ask_price numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.demo_purchase_intents%rowtype; v_checkpoint public.runtime_checkpoints%rowtype;
begin
  if p_idempotency_key is null or p_stake is null or p_stake <= 0 or p_ask_price is null or p_ask_price <= 0
     or p_proposal_id is null or length(trim(p_proposal_id)) = 0 then
    raise exception 'Invalid purchase intent';
  end if;
  if not exists(select 1 from public.deriv_account_links
      where user_id=p_user_id and deriv_account_id=p_deriv_account_id and account_type='demo'
        and currency=p_currency) then
    raise exception 'Demo account is not linked to this user or currency';
  end if;
  select * into v_checkpoint from public.runtime_checkpoints
    where user_id=p_user_id and strategy_id=p_strategy_id for update;
  if not found then raise exception 'No matching durable strategy checkpoint'; end if;
  if not exists(select 1 from public.strategy_drafts
      where id=p_strategy_id and user_id=p_user_id and status='APPROVED_MONITORING_ONLY'
        and execution_enabled=false) then
    raise exception 'Strategy is not approved for monitoring';
  end if;
  insert into public.demo_purchase_intents(
    user_id,idempotency_key,strategy_id,deriv_account_id,symbol,contract_type,stake,currency,proposal_id,ask_price
  ) values (
    p_user_id,p_idempotency_key,p_strategy_id,p_deriv_account_id,p_symbol,p_contract_type,
    p_stake,p_currency,p_proposal_id,p_ask_price
  ) on conflict(user_id,idempotency_key) do nothing;
  select * into v_row from public.demo_purchase_intents
    where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if v_row.strategy_id <> p_strategy_id or v_row.deriv_account_id <> p_deriv_account_id
     or v_row.symbol <> p_symbol or v_row.contract_type <> p_contract_type
     or v_row.stake <> p_stake or v_row.currency <> p_currency
     or v_row.proposal_id <> p_proposal_id or v_row.ask_price <> p_ask_price then
    raise exception 'Idempotency key was already used with different purchase parameters';
  end if;
  return jsonb_build_object('intent_id',v_row.id,'status',v_row.status,'idempotent_replay',v_row.created_at < now() - interval '1 millisecond');
end; $$;
revoke all on function public.create_demo_purchase_intent(uuid,uuid,uuid,text,text,text,numeric,text,text,numeric) from public, anon, authenticated;
grant execute on function public.create_demo_purchase_intent(uuid,uuid,uuid,text,text,text,numeric,text,text,numeric) to service_role;
