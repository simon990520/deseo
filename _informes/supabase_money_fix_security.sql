-- ============================================================================
-- DESEO — FIX DE SEGURIDAD #2 (exploits encontrados en pruebas)
-- ============================================================================
-- HALLAZGO 1: el cliente podía BORRAR filas del ledger (DELETE 204), destruyendo
--             la idempotencia (podía repetir un cobro/aplicar dos veces).
--             Causa: faltaban policies explícitas para bloquear DELETE/UPDATE.
-- HALLAZGO 2: rpc_credit permitía al usuario acreditarse saldo a sí mismo
--             (exploit crítico: saldo infinito). Debe restringirse a service_role.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- FIX 1: bloquear TODO acceso de escritura del cliente a ledger y balances.
-- Estrategia: RLS ya está ON; SIN policy => denegado. Pero para asegurar,
-- añadimos policies EXPLÍCITAS de denegación para UPDATE/DELETE/INSERT.
-- (En Postgres RLS: con RLS activo y "for all" restrictivo, negamos explícito.)
-- ---------------------------------------------------------------------------

-- balances: denegar insert/update/delete a clientes (solo service_role bypasa RLS).
drop policy if exists balances_no_insert on public.balances;
create policy balances_no_insert on public.balances for insert with check (false);
drop policy if exists balances_no_update on public.balances;
create policy balances_no_update on public.balances for update using (false);
drop policy if exists balances_no_delete on public.balances;
create policy balances_no_delete on public.balances for delete using (false);

-- ledger: solo SELECT propio (ya existe). Denegar insert/update/delete.
drop policy if exists ledger_no_insert on public.ledger;
create policy ledger_no_insert on public.ledger for insert with check (false);
drop policy if exists ledger_no_update on public.ledger;
create policy ledger_no_update on public.ledger for update using (false);
drop policy if exists ledger_no_delete on public.ledger;
create policy ledger_no_delete on public.ledger for delete using (false);

-- message_prices: denegar delete (nadie borra precios desde el cliente).
drop policy if exists prices_no_delete on public.message_prices;
create policy prices_no_delete on public.message_prices for delete using (false);

-- platform_settings: solo lectura (ya). Denegar toda escritura cliente.
drop policy if exists settings_no_write_ins on public.platform_settings;
create policy settings_no_write_ins on public.platform_settings for insert with check (false);
drop policy if exists settings_no_write_upd on public.platform_settings;
create policy settings_no_write_upd on public.platform_settings for update using (false);
drop policy if exists settings_no_write_del on public.platform_settings;
create policy settings_no_write_del on public.platform_settings for delete using (false);

-- ---------------------------------------------------------------------------
-- FIX 2: rpc_credit SOLO para service_role (o auto-crédito controlado).
-- Un usuario normal NO puede acreditarse saldo. El crédito real (pagos) se
-- hace por rpc_transfer (mueve del pagador). rpc_credit queda para el backend.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_credit(
  p_amount integer, p_reason text default 'credit',
  p_chat_id text default null, p_op_id text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid text := public.current_user_id();
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_new integer;
begin
  -- SOLO service_role puede acreditar arbitrariamente. Un usuario normal NO.
  if v_role <> 'service_role' then
    raise exception 'forbidden: credit requires service_role';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if p_op_id is null then raise exception 'op_id_required'; end if;
  if v_uid is null then raise exception 'not_authenticated'; end if;
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

-- Quitar execute de rpc_credit/charge a usuarios normales si no deben usar directo.
-- NOTA: rpc_charge SÍ lo usa el cliente (cobrarse a sí mismo). rpc_credit NO.
revoke execute on function public.rpc_credit from authenticated, anon;

-- ---------------------------------------------------------------------------
-- FIX 3 (defensivo): asegurar que rpc_transfer NO permita op_id vacío ni mover
-- a uno mismo, y que use siempre el pagador = autenticado. (Ya estaba, se refuerza.)
-- ---------------------------------------------------------------------------
-- (sin cambios adicionales; validaciones ya presentes)

-- ---------------------------------------------------------------------------
-- LIMPIAR restos de la prueba (el auto-crédito h1 y el saldo inflado)
-- ---------------------------------------------------------------------------
delete from public.ledger where op_id in ('h1');
update public.balances set balance = 750 where user_id = (select user_id from public.ledger where op_id = 'm1' limit 1);
