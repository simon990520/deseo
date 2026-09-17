-- ============================================================================
-- DESEO — PARCHE: usar auth.jwt()->>'sub' en vez de auth.uid() (IDs de Clerk no son UUID)
-- ============================================================================
-- PROBLEMA: auth.uid() devuelve tipo uuid; los IDs de Clerk son text ("user_xxx").
-- Al comparar/intentar castear, Postgres lanza:
--   22P02 invalid input syntax for type uuid: "user_32kY..."
-- SOLUCIÓN: leer el claim `sub` del JWT como texto: (auth.jwt() ->> 'sub')
-- Ejecutar una vez en Supabase → SQL Editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: id del usuario autenticado como texto (compatible con Clerk)
-- ---------------------------------------------------------------------------
create or replace function public.current_user_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::text;
$$;
grant execute on function public.current_user_id() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Re-crear el helper interno usando current_user_id()
-- ---------------------------------------------------------------------------
create or replace function public._ensure_balance(p_user text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  insert into public.balances(user_id, balance) values (p_user, 0)
  on conflict (user_id) do nothing;
end $$;

create or replace function public._apply_delta(p_user text, p_delta integer)
returns integer language plpgsql security definer set search_path = public
as $$
declare v_new integer;
begin
  perform public._ensure_balance(p_user);
  update public.balances
     set balance = balance + p_delta, updated_at = now()
   where user_id = p_user
   returning balance into v_new;
  if v_new is null then raise exception 'balance_row_missing'; end if;
  if v_new < 0 then raise exception 'insufficient_funds'; end if;
  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: reemplazar auth.uid()::text por public.current_user_id()
-- ---------------------------------------------------------------------------
drop policy if exists balances_select_own on public.balances;
create policy balances_select_own on public.balances
  for select using ( public.current_user_id() = user_id );

drop policy if exists ledger_select_own on public.ledger;
create policy ledger_select_own on public.ledger
  for select using ( public.current_user_id() = user_id );

drop policy if exists prices_upsert_own on public.message_prices;
create policy prices_upsert_own on public.message_prices
  for insert with check ( public.current_user_id() = user_id );
drop policy if exists prices_update_own on public.message_prices;
create policy prices_update_own on public.message_prices
  for update using ( public.current_user_id() = user_id )
  with check ( public.current_user_id() = user_id );

-- ---------------------------------------------------------------------------
-- RPC: re-crear con current_user_id()
-- ---------------------------------------------------------------------------
create or replace function public.rpc_charge(
  p_amount integer, p_reason text default 'charge',
  p_chat_id text default null, p_op_id text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_uid text := public.current_user_id(); v_new integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if p_op_id is null then raise exception 'op_id_required'; end if;
  begin
    insert into public.ledger(op_id, user_id, direction, amount, reason, chat_id)
    values (p_op_id, v_uid, 'out', p_amount, p_reason, p_chat_id);
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'idempotent', true, 'balance',
      (select balance from public.balances where user_id = v_uid));
  end;
  begin
    v_new := public._apply_delta(v_uid, -p_amount);
  exception when others then
    delete from public.ledger where op_id = p_op_id; raise;
  end;
  return jsonb_build_object('ok', true, 'balance', v_new, 'op_id', p_op_id);
end $$;

create or replace function public.rpc_credit(
  p_amount integer, p_reason text default 'credit',
  p_chat_id text default null, p_op_id text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_uid text := public.current_user_id(); v_new integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if p_op_id is null then raise exception 'op_id_required'; end if;
  begin
    insert into public.ledger(op_id, user_id, direction, amount, reason, chat_id)
    values (p_op_id, v_uid, 'in', p_amount, p_reason, p_chat_id);
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'idempotent', true, 'balance',
      (select balance from public.balances where user_id = v_uid));
  end;
  v_new := public._apply_delta(v_uid, p_amount);
  return jsonb_build_object('ok', true, 'balance', v_new, 'op_id', p_op_id);
end $$;

create or replace function public.rpc_transfer(
  p_to_user text, p_amount integer, p_reason text default 'transfer',
  p_chat_id text default null, p_op_id text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_from text := public.current_user_id();
  v_out text := p_op_id || '_out';
  v_in  text := p_op_id || '_in';
  v_bal integer;
begin
  if v_from is null then raise exception 'not_authenticated'; end if;
  if p_to_user is null or p_to_user = v_from then raise exception 'invalid_target'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if p_op_id is null then raise exception 'op_id_required'; end if;
  if exists (select 1 from public.ledger where op_id = v_out) then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  insert into public.ledger(op_id, user_id, direction, amount, reason, chat_id, counterpart)
  values (v_out, v_from, 'out', p_amount, p_reason, p_chat_id, p_to_user);
  begin
    v_bal := public._apply_delta(v_from, -p_amount);
  exception when others then
    delete from public.ledger where op_id = v_out; raise;
  end;
  insert into public.ledger(op_id, user_id, direction, amount, reason, chat_id, counterpart)
  values (v_in, p_to_user, 'in', p_amount, p_reason, p_chat_id, v_from);
  perform public._apply_delta(p_to_user, p_amount);
  return jsonb_build_object('ok', true, 'op_id', p_op_id, 'balance', v_bal);
end $$;

create or replace function public.rpc_send_message_charge(
  p_owner text, p_amount integer, p_chat_id text default null, p_op_id text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_from text := public.current_user_id(); v_price integer; v_amount integer;
begin
  if v_from is null then raise exception 'not_authenticated'; end if;
  if p_owner is null or p_owner = v_from then raise exception 'invalid_target'; end if;
  if p_op_id is null then raise exception 'op_id_required'; end if;
  select message_price into v_price from public.message_prices where user_id = p_owner;
  v_amount := coalesce(v_price, 390);
  if v_amount <= 0 then return jsonb_build_object('ok', true, 'free', true, 'amount', 0); end if;
  return public.rpc_transfer(p_owner, v_amount, 'message', p_chat_id, p_op_id);
end $$;

create or replace function public.rpc_set_my_message_price(
  p_price integer, p_user text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid text := public.current_user_id();
  v_target text;
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if p_price is null or p_price < 0 then raise exception 'invalid_price'; end if;
  v_target := coalesce(p_user, v_uid);
  if v_target is null then raise exception 'not_authenticated'; end if;
  if v_target <> v_uid and v_role <> 'service_role' then raise exception 'forbidden'; end if;
  insert into public.message_prices(user_id, message_price, updated_at)
  values (v_target, p_price, now())
  on conflict (user_id) do update set message_price = excluded.message_price, updated_at = now();
  return jsonb_build_object('ok', true, 'user_id', v_target, 'price', p_price);
end $$;

grant execute on function public.rpc_charge, public.rpc_credit, public.rpc_transfer,
  public.rpc_send_message_charge, public.rpc_set_my_message_price to authenticated;
