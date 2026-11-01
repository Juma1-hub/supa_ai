-- Stage 15: atomically bind an independently Deriv-confirmed contract to its
-- durable purchase intent and per-user runtime. This migration adds NO buy path.
alter table public.demo_purchase_intents
  add column if not exists contract_id text;

alter table public.demo_purchase_intents
  drop constraint if exists demo_purchase_intents_status_check;
alter table public.demo_purchase_intents
  add constraint demo_purchase_intents_status_check
  check (status in ('PREPARED_PURCHASE_DISABLED','PURCHASE_UNKNOWN','PURCHASE_CONFIRMED','ABORTED'));

create unique index if not exists demo_purchase_intents_contract_id_uidx
  on public.demo_purchase_intents(contract_id) where contract_id is not null;

create or replace function public.confirm_demo_purchase_and_register_contract(
  p_user_id uuid, p_intent_id uuid, p_contract_id text,
  p_martingale_step integer, p_session_pnl numeric
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_intent public.demo_purchase_intents%rowtype; v_checkpoint public.runtime_checkpoints%rowtype;
begin
  if p_contract_id is null or p_contract_id !~ '^[0-9]{1,32}$'
     or p_martingale_step is null or p_martingale_step < 0 or p_session_pnl is null then
    raise exception 'Invalid Deriv-confirmed contract registration';
  end if;
  select * into v_intent from public.demo_purchase_intents
    where id=p_intent_id and user_id=p_user_id for update;
  if not found then raise exception 'Purchase intent not found for this user'; end if;
  if v_intent.status='PURCHASE_CONFIRMED' and v_intent.contract_id=p_contract_id then
    return false;
  end if;
  if v_intent.status not in ('PREPARED_PURCHASE_DISABLED','PURCHASE_UNKNOWN') then
    raise exception 'Purchase intent is not eligible for contract reconciliation';
  end if;
  if exists(select 1 from public.open_contracts where contract_id=p_contract_id) then
    raise exception 'Deriv contract is already registered';
  end if;
  if not exists(select 1 from public.deriv_account_links
      where user_id=p_user_id and deriv_account_id=v_intent.deriv_account_id
        and account_type='demo' and currency=v_intent.currency) then
    raise exception 'Demo account ownership or currency check failed';
  end if;
  if not exists(select 1 from public.strategy_drafts
      where id=v_intent.strategy_id and user_id=p_user_id
        and status='APPROVED_MONITORING_ONLY' and execution_enabled=false) then
    raise exception 'Approved monitoring strategy not found';
  end if;
  select * into v_checkpoint from public.runtime_checkpoints
    where user_id=p_user_id and strategy_id=v_intent.strategy_id for update;
  if not found then raise exception 'Durable strategy checkpoint not found'; end if;

  insert into public.open_contracts(
    contract_id,user_id,deriv_account_id,symbol,contract_type,stake,status
  ) values (
    p_contract_id,p_user_id,v_intent.deriv_account_id,v_intent.symbol,
    v_intent.contract_type,v_intent.stake,'OPEN'
  );
  update public.runtime_checkpoints set
    martingale_step=p_martingale_step, session_pnl=p_session_pnl,
    open_contract_ids=(select coalesce(array_agg(distinct x), '{}')
      from unnest(open_contract_ids || array[p_contract_id]) x), updated_at=now()
    where user_id=p_user_id and strategy_id=v_intent.strategy_id;
  update public.demo_purchase_intents set status='PURCHASE_CONFIRMED',
    contract_id=p_contract_id, updated_at=now()
    where id=p_intent_id and user_id=p_user_id;
  return true;
end; $$;

revoke all on function public.confirm_demo_purchase_and_register_contract(uuid,uuid,text,integer,numeric)
  from public, anon, authenticated;
grant execute on function public.confirm_demo_purchase_and_register_contract(uuid,uuid,text,integer,numeric)
  to service_role;
