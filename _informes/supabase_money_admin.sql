-- ============================================================================
-- DESEO — Operaciones ADMINISTRATIVAS de dinero (server-authoritative)
-- ============================================================================
-- PROBLEMA QUE RESUELVE:
--   Con el dinero migrado a Supabase, `DeseoMoney.credit(db, otroUser, amt)`
--   pasa a ser una TRANSFERENCIA (el admin pagaría de su bolsillo), y
--   `DeseoMoney.charge(db, otroUser, amt)` cobra SIEMPRE al autenticado (el
--   admin), no al usuario objetivo. Además `rpc_credit` está restringido a
--   service_role. Resultado: aprobar depósitos/retiros desde el panel admin
--   queda ROTO.
--
-- SOLUCIÓN:
--   Una lista de admins EN EL SERVIDOR (tabla `admins`) y RPCs que:
--     - validan que el llamador (auth.jwt()->>'sub') sea admin,
--     - mueven el saldo del usuario objetivo (crédito o débito) de forma
--       atómica e idempotente,
--     - dejan rastro en el ledger con reason 'admin_deposit'/'admin_withdrawal'.
--   El cliente NUNCA decide; solo invoca. Si no es admin → excepción 'forbidden'.
--
-- Idempotente: se puede re-ejecutar. Ejecutar en SQL Editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tabla de ADMINS (server-side). El admin se identifica por su sub de Clerk
--    (texto, p.ej. 'user_32kYJSs4HXzp3ksidFbRJn2LJw5').
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    text primary key,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
-- Nadie (cliente) lee ni escribe la tabla de admins. Solo service_role / RPC.
drop policy if exists admins_no_client on public.admins;

-- Seed: el admin actual del proyecto (config.local.js ADMIN_USER_IDS/EMAILS).
insert into public.admins(user_id) values ('user_32kYJSs4HXzp3ksidFbRJn2LJw5')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Helper: ¿el usuario autenticado es admin? (server-side, no confía cliente)
-- ---------------------------------------------------------------------------
create or replace function public._is_admin(p_user text default null)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins where user_id = coalesce(p_user, auth.jwt()->>'sub')
  );
$$;

-- ---------------------------------------------------------------------------
-- 3) rpc_admin_credit: acredita saldo al usuario objetivo (aprobación depósito).
--    SOLO admin. Idempotente por op_id. Registra en ledger.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_admin_credit(
  p_user   text,
  p_amount integer,
  p_reason text default 'admin_deposit',
  p_op_id  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin text := auth.jwt()->>'sub';
  v_op    text := coalesce(p_op_id, 'admin_credit_' || p_user || '_' || (extract(epoch from now())::bigint)::text);
  v_new   integer;
begin
  if v_admin is null then raise exception 'not_authenticated'; end if;
  if not public._is_admin(v_admin) then raise exception 'forbidden: not admin'; end if;
  if p_user is null then raise exception 'user_required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;

  -- Idempotencia de motor.
  begin
    insert into public.ledger(op_id, user_id, direction, amount, reason, counterpart)
    values (v_op, p_user, 'in', p_amount, p_reason, v_admin);
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'idempotent', true, 'balance',
      (select balance from public.balances where user_id = p_user));
  end;

  v_new := public._apply_delta(p_user, p_amount);
  return jsonb_build_object('ok', true, 'balance', v_new, 'user_id', p_user, 'op_id', v_op);
end $$;

-- ---------------------------------------------------------------------------
-- 4) rpc_admin_charge: debita saldo al usuario objetivo (aprobación retiro).
--    SOLO admin. Idempotente por op_id. Registra en ledger.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_admin_charge(
  p_user   text,
  p_amount integer,
  p_reason text default 'admin_withdrawal',
  p_op_id  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin text := auth.jwt()->>'sub';
  v_op    text := coalesce(p_op_id, 'admin_charge_' || p_user || '_' || (extract(epoch from now())::bigint)::text);
  v_new   integer;
begin
  if v_admin is null then raise exception 'not_authenticated'; end if;
  if not public._is_admin(v_admin) then raise exception 'forbidden: not admin'; end if;
  if p_user is null then raise exception 'user_required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;

  begin
    insert into public.ledger(op_id, user_id, direction, amount, reason, counterpart)
    values (v_op, p_user, 'out', p_amount, p_reason, v_admin);
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'idempotent', true, 'balance',
      (select balance from public.balances where user_id = p_user));
  end;

  begin
    v_new := public._apply_delta(p_user, -p_amount);
  exception when others then
    delete from public.ledger where op_id = v_op;
    raise;
  end;

  return jsonb_build_object('ok', true, 'balance', v_new, 'user_id', p_user, 'op_id', v_op);
end $$;

-- ---------------------------------------------------------------------------
-- 5) Permisos: solo authenticated puede invocar (la validación de admin va dentro)
-- ---------------------------------------------------------------------------
revoke all on function public.rpc_admin_credit, public.rpc_admin_charge from public;
grant execute on function public.rpc_admin_credit, public.rpc_admin_charge to authenticated;
revoke all on function public._is_admin from public;

-- ============================================================================
-- FIN
-- ============================================================================
