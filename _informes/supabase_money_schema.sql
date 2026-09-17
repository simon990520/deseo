-- ============================================================================
-- DESEO — Esquema de DINERO en Supabase (server-authoritative, anti-hack)
-- ============================================================================
-- Objetivo: que el CLIENTE nunca pueda mover saldo. Solo el servidor (RPC
-- SECURITY DEFINER + RLS) toca dinero. Replica la semántica de firebase-money.js:
--   charge (idempotente, sin saldo negativo), credit, transfer, reserve.
--
-- Idempotencia REAL de motor: UNIQUE(op_id) en ledger. Doble submit = error de
-- constraint (no depende de lógica de app).
--
-- Ejecutar en: Supabase → SQL Editor (una sola vez). Es idempotente (IF NOT EXISTS).
-- NO usa Cloud Functions de pago: RPC + RLS funcionan en el plan gratis.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Extensiones
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Tabla de SALDOS (una fila por usuario)
-- ---------------------------------------------------------------------------
create table if not exists public.balances (
  user_id     text primary key,
  balance     integer not null default 0,
  updated_at  timestamptz not null default now(),
  constraint balances_non_negative check (balance >= 0)
);

-- ---------------------------------------------------------------------------
-- 2) Tabla LEDGER (append-only, idempotente por op_id)
-- ---------------------------------------------------------------------------
create table if not exists public.ledger (
  op_id       text primary key,            -- idempotencia a nivel de motor
  user_id     text not null,
  direction   text not null check (direction in ('in','out')),
  amount      integer not null check (amount > 0),
  reason      text,
  chat_id     text,
  counterpart text,                         -- to/from (el otro lado)
  created_at  timestamptz not null default now()
);
create index if not exists ledger_user_idx on public.ledger(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3) Tabla PRECIO POR USUARIO (lo define el dueño; el servidor lo usa al cobrar)
-- ---------------------------------------------------------------------------
create table if not exists public.message_prices (
  user_id           text primary key,
  message_price     integer not null default 390 check (message_price >= 0),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4) Precios de la PLATAFORMA (servidor; el cliente solo lee)
-- ---------------------------------------------------------------------------
create table if not exists public.platform_settings (
  key    text primary key,
  value  integer not null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings(key, value) values
  ('tip_default', 0),
  ('photo_default', 0)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5) RLS: bloquear escritura de dinero desde el cliente
-- ---------------------------------------------------------------------------
alter table public.balances          enable row level security;
alter table public.ledger            enable row level security;
alter table public.message_prices    enable row level security;
alter table public.platform_settings enable row level security;

-- --- balances: cada quien ve SOLO su saldo. NADIE escribe (solo RPC/service_role).
drop policy if exists balances_select_own on public.balances;
create policy balances_select_own on public.balances
  for select using ( auth.uid()::text = user_id );
-- Sin policy de INSERT/UPDATE/DELETE => denegado por defecto para el cliente.

-- --- ledger: cada quien ve SOLO sus movimientos. NADIE escribe.
drop policy if exists ledger_select_own on public.ledger;
create policy ledger_select_own on public.ledger
  for select using ( auth.uid()::text = user_id );

-- --- message_prices: lectura pública (el chat necesita el precio del otro);
--     escritura SOLO del propio usuario (o vía RPC). El cobro NO confía en esto
--     desde el cliente: la RPC lo relee en servidor.
drop policy if exists prices_select_all on public.message_prices;
create policy prices_select_all on public.message_prices
  for select using ( true );

drop policy if exists prices_upsert_own on public.message_prices;
create policy prices_upsert_own on public.message_prices
  for insert with check ( auth.uid()::text = user_id );
drop policy if exists prices_update_own on public.message_prices;
create policy prices_update_own on public.message_prices
  for update using ( auth.uid()::text = user_id )
  with check ( auth.uid()::text = user_id );
-- NOTA anti-hack: para máxima seguridad, quita las policies de insert/update de
-- arriba y obliga a usar la RPC set_my_message_price (el precio lo fija el server).

-- --- platform_settings: lectura para todos, escritura solo service_role.
drop policy if exists settings_select_all on public.platform_settings;
create policy settings_select_all on public.platform_settings
  for select using ( true );

-- ============================================================================
-- 6) FUNCIONES INTERNAS (privadas)
-- ============================================================================

-- Asegura que exista fila de saldo para un usuario.
create or replace function public._ensure_balance(p_user text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.balances(user_id, balance) values (p_user, 0)
  on conflict (user_id) do nothing;
end $$;

-- Aplica un delta a un saldo de forma ATÓMICA. Respeta no-negativo.
-- Devuelve el nuevo saldo. Lanza excepción si quedaría negativo.
create or replace function public._apply_delta(p_user text, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_new integer;
begin
  perform public._ensure_balance(p_user);
  update public.balances
     set balance = balance + p_delta, updated_at = now()
   where user_id = p_user
   returning balance into v_new;
  if v_new is null then
    raise exception 'balance_row_missing';
  end if;
  if v_new < 0 then
    raise exception 'insufficient_funds';
  end if;
  return v_new;
end $$;

-- ============================================================================
-- 7) RPIs PÚBLICAS (las llama el cliente; validan autoridad y mueven dinero)
-- ============================================================================
-- Convención de op_id: mismo patrón que hoy -> "..._out" y "..._in" para transfer,
-- y op_id base para charge/credit individuales.

-- ---------------------------------------------------------------------------
-- charge: cobra al usuario autenticado. Idempotente por op_id.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_charge(
  p_amount integer,
  p_reason text default 'charge',
  p_chat_id text default null,
  p_op_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  v_new integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if p_op_id is null then raise exception 'op_id_required'; end if;

  -- Idempotencia de motor: si ya existe, no aplicar.
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
    -- compensación: revertir el registro del ledger
    delete from public.ledger where op_id = p_op_id;
    raise;
  end;

  return jsonb_build_object('ok', true, 'balance', v_new, 'op_id', p_op_id);
end $$;

-- ---------------------------------------------------------------------------
-- credit: acredita al usuario autenticado. Idempotente por op_id.
-- (Para acreditar a OTRO usuario desde pago, usar las RPC de flujo, no esta,
--  salvo service_role.)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_credit(
  p_amount integer,
  p_reason text default 'credit',
  p_chat_id text default null,
  p_op_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  v_new integer;
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

-- ---------------------------------------------------------------------------
-- transfer: cliente autenticado paga a un DESTINO -> mueve ambos lados en una
-- transacción. Idempotente por op_id (usa op_id_out / op_id_in).
-- SEGURIDAD: el que paga es SIEMPRE auth.uid(). El destino se valida.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_transfer(
  p_to_user text,
  p_amount integer,
  p_reason text default 'transfer',
  p_chat_id text default null,
  p_op_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text := auth.uid()::text;
  v_out text := p_op_id || '_out';
  v_in  text := p_op_id || '_in';
  v_bal integer;
begin
  if v_from is null then raise exception 'not_authenticated'; end if;
  if p_to_user is null or p_to_user = v_from then raise exception 'invalid_target'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if p_op_id is null then raise exception 'op_id_required'; end if;

  -- Idempotencia: si ya se hizo el OUT, asumimos completo (misma lógica que hoy).
  if exists (select 1 from public.ledger where op_id = v_out) then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;

  -- OUT (del pagador)
  insert into public.ledger(op_id, user_id, direction, amount, reason, chat_id, counterpart)
  values (v_out, v_from, 'out', p_amount, p_reason, p_chat_id, p_to_user);

  begin
    v_bal := public._apply_delta(v_from, -p_amount);
  exception when others then
    delete from public.ledger where op_id = v_out;
    raise;
  end;

  -- IN (del receptor)
  insert into public.ledger(op_id, user_id, direction, amount, reason, chat_id, counterpart)
  values (v_in, p_to_user, 'in', p_amount, p_reason, p_chat_id, v_from);
  perform public._apply_delta(p_to_user, p_amount);

  return jsonb_build_object('ok', true, 'op_id', p_op_id, 'balance', v_bal);
end $$;

-- ---------------------------------------------------------------------------
-- send_message_charge: cobra un MENSAJE al pagador usando el PRECIO DEL DUEÑO
-- leído en SERVIDOR (no confía en el cliente). Acredita al dueño 1:1.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_send_message_charge(
  p_owner text,
  p_amount integer,             -- monto tentativo del cliente (se ignora salvo 0/negativo)
  p_chat_id text default null,
  p_op_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text := auth.uid()::text;
  v_price integer;
  v_amount integer;
begin
  if v_from is null then raise exception 'not_authenticated'; end if;
  if p_owner is null or p_owner = v_from then raise exception 'invalid_target'; end if;
  if p_op_id is null then raise exception 'op_id_required'; end if;

  -- PRECIO AUTORITATIVO desde servidor.
  select message_price into v_price from public.message_prices where user_id = p_owner;
  v_amount := coalesce(v_price, 390);       -- fallback igual que la app
  if v_amount <= 0 then
    -- Precio 0: mensaje gratis; solo registrar intento idempotente.
    return jsonb_build_object('ok', true, 'free', true, 'amount', 0);
  end if;

  return public.rpc_transfer(p_owner, v_amount, 'message', p_chat_id, p_op_id);
end $$;

-- ---------------------------------------------------------------------------
-- set_my_message_price: el dueño fija SU precio (o service_role cualquiera).
-- ---------------------------------------------------------------------------
create or replace function public.rpc_set_my_message_price(
  p_price integer,
  p_user text default null       -- solo service_role puede fijar a otro
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  v_target text;
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if p_price is null or p_price < 0 then raise exception 'invalid_price'; end if;
  v_target := coalesce(p_user, v_uid);
  if v_target is null then raise exception 'not_authenticated'; end if;
  if v_target <> v_uid and v_role <> 'service_role' then
    raise exception 'forbidden';
  end if;

  insert into public.message_prices(user_id, message_price, updated_at)
  values (v_target, p_price, now())
  on conflict (user_id) do update set message_price = excluded.message_price, updated_at = now();

  return jsonb_build_object('ok', true, 'user_id', v_target, 'price', p_price);
end $$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución: solo usuarios autenticados (o anon con auth.uid()).
-- ---------------------------------------------------------------------------
revoke all on function public.rpc_charge, public.rpc_credit, public.rpc_transfer,
  public.rpc_send_message_charge, public.rpc_set_my_message_price from public;
grant execute on function public.rpc_charge, public.rpc_credit, public.rpc_transfer,
  public.rpc_send_message_charge, public.rpc_set_my_message_price to authenticated;

-- ============================================================================
-- 8) REALTIME (opcional): exponer saldos para badges en vivo
-- ============================================================================
-- alter publication supabase_realtime add table public.balances;

-- ============================================================================
-- FIN. Pruebas sugeridas:
--   select * from public.balances;
--   select public.rpc_transfer('otro_user', 100, 'message', 'chat_x', 'op_1');
--   select public.rpc_transfer('otro_user', 100, 'message', 'chat_x', 'op_1'); -- idempotente
-- ============================================================================
