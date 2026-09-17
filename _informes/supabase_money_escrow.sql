-- ============================================================================
-- DESEO — FASE 2: ESCROW de encuentros (custodia server-authoritative)
-- ============================================================================
-- MODELO:
--  - Al aceptar una oferta, el cliente PAGA: rpc_escrow_hold mueve su saldo a
--    una cuenta de CUSTODIA por orden ("escrow:<orderId>").
--  - Al confirmar AMBAS partes, se LIBERA: rpc_escrow_release mueve de la
--    custodia al PROVEEDOR (idempotente por op_id). El llamador debe ser el
--    CLIENTE dueño del escrow (o service_role).
--  - Cancelación/disputa: rpc_escrow_refund devuelve al cliente.
--  - El cliente NUNCA puede mover saldo arbitrariamente: solo estas RPC.
--  - Cuenta de custodia: user_id = 'escrow:' || p_order_id (text, no Clerk).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ¿Es una cuenta de custodia? (no es un usuario real)
-- ---------------------------------------------------------------------------
create or replace function public._is_escrow(p_user text)
returns boolean language sql immutable as $$
  select p_user is not null and left(p_user, 7) = 'escrow:';
$$;

-- ---------------------------------------------------------------------------
-- rpc_escrow_hold(order_id, amount, op_id):
--   Debita al autenticado y acredita a la custodia escrow:<order_id>.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_escrow_hold(
  p_order_id text, p_amount integer, p_op_id text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_from text := public.current_user_id();
  v_escrow text := 'escrow:' || p_order_id;
  v_out text := coalesce(p_op_id, 'escrow_hold_' || p_order_id) || '_out';
  v_in  text := coalesce(p_op_id, 'escrow_hold_' || p_order_id) || '_in';
  v_bal integer;
begin
  if v_from is null then raise exception 'not_authenticated'; end if;
  if p_order_id is null or p_order_id = '' then raise exception 'order_required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if exists (select 1 from public.ledger where op_id = v_out) then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  insert into public.ledger(op_id, user_id, direction, amount, reason, counterpart)
  values (v_out, v_from, 'out', p_amount, 'escrow_hold', v_escrow);
  begin
    v_bal := public._apply_delta(v_from, -p_amount);
  exception when others then
    delete from public.ledger where op_id = v_out; raise;
  end;
  insert into public.ledger(op_id, user_id, direction, amount, reason, counterpart)
  values (v_in, v_escrow, 'in', p_amount, 'escrow_hold', v_from);
  perform public._apply_delta(v_escrow, p_amount);
  return jsonb_build_object('ok', true, 'balance', v_bal, 'escrow', v_escrow);
end $$;

-- ---------------------------------------------------------------------------
-- rpc_escrow_release(order_id, to_user, op_id):
--   Mueve la custodia al proveedor. Solo el cliente que depositó puede liberar.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_escrow_release(
  p_order_id text, p_to_user text, p_op_id text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid text := public.current_user_id();
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_escrow text := 'escrow:' || p_order_id;
  v_amt integer;
  v_holder text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_order_id is null or p_to_user is null then raise exception 'invalid_args'; end if;

  -- Idempotencia PRIMERO: si ya se liberó con este op_id, devolver ok sin re-validar saldo.
  if exists (select 1 from public.ledger where op_id = coalesce(p_op_id,'release_'||p_order_id)) then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;

  -- Verificar que el llamador sea quien depositó el escrow (o service_role).
  select counterpart into v_holder from public.ledger
    where user_id = v_escrow and direction = 'in' and reason = 'escrow_hold'
    order by created_at limit 1;
  if v_role <> 'service_role' and v_holder <> v_uid then
    raise exception 'forbidden: not escrow owner';
  end if;

  select balance into v_amt from public.balances where user_id = v_escrow;
  if v_amt is null or v_amt <= 0 then raise exception 'escrow_empty'; end if;

  insert into public.ledger(op_id, user_id, direction, amount, reason, counterpart)
  values (coalesce(p_op_id,'release_'||p_order_id), v_escrow, 'out', v_amt, 'escrow_release', p_to_user);
  perform public._apply_delta(v_escrow, -v_amt);
  insert into public.ledger(op_id, user_id, direction, amount, reason, counterpart)
  values (coalesce(p_op_id,'release_'||p_order_id)||'_in', p_to_user, 'in', v_amt, 'escrow_release', v_escrow);
  perform public._apply_delta(p_to_user, v_amt);
  return jsonb_build_object('ok', true, 'released', v_amt, 'to', p_to_user);
end $$;

-- ---------------------------------------------------------------------------
-- rpc_escrow_refund(order_id, op_id): devuelve la custodia al cliente original.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_escrow_refund(
  p_order_id text, p_op_id text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid text := public.current_user_id();
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_escrow text := 'escrow:' || p_order_id;
  v_amt integer;
  v_holder text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- Idempotencia PRIMERO.
  if exists (select 1 from public.ledger where op_id = coalesce(p_op_id,'refund_'||p_order_id)) then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  select counterpart into v_holder from public.ledger
    where user_id = v_escrow and direction = 'in' and reason = 'escrow_hold'
    order by created_at limit 1;
  if v_role <> 'service_role' and v_holder <> v_uid then
    raise exception 'forbidden: not escrow owner';
  end if;
  select balance into v_amt from public.balances where user_id = v_escrow;
  if v_amt is null or v_amt <= 0 then raise exception 'escrow_empty'; end if;
  insert into public.ledger(op_id, user_id, direction, amount, reason, counterpart)
  values (coalesce(p_op_id,'refund_'||p_order_id), v_escrow, 'out', v_amt, 'escrow_refund', v_holder);
  perform public._apply_delta(v_escrow, -v_amt);
  insert into public.ledger(op_id, user_id, direction, amount, reason, counterpart)
  values (coalesce(p_op_id,'refund_'||p_order_id)||'_in', v_holder, 'in', v_amt, 'escrow_refund', v_escrow);
  perform public._apply_delta(v_holder, v_amt);
  return jsonb_build_object('ok', true, 'refunded', v_amt, 'to', v_holder);
end $$;

grant execute on function public.rpc_escrow_hold, public.rpc_escrow_release,
  public.rpc_escrow_refund to authenticated;

-- ---------------------------------------------------------------------------
-- Permitir que la custodia NO dispare RLS de "solo el propio": la custodia no
-- es un usuario. Se crea con _ensure_balance vía RPC SECURITY DEFINER. OK.
-- ---------------------------------------------------------------------------
