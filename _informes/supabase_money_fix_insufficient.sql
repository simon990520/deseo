-- ============================================================================
-- DESEO — FIX #3: mensaje de error claro para fondos insuficientes
-- ============================================================================
-- PROBLEMA: cuando el saldo no alcanza, el UPDATE choca con el CHECK
--            "balances_non_negative" y lanza un error genérico que el cliente
--            no reconoce como insufficient_funds (parece error 500).
-- SOLUCIÓN: validar el saldo ANTES del UPDATE y lanzar 'insufficient_funds'
--           explícitamente. Si por carrera el UPDATE viola el check, se
--           normaliza el mensaje.
-- ============================================================================

create or replace function public._apply_delta(p_user text, p_delta integer)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  v_new integer;
  v_cur integer;
begin
  perform public._ensure_balance(p_user);

  -- Bloquear la fila para evitar carreras entre lecturas concurrentes.
  select balance into v_cur from public.balances where user_id = p_user for update;
  if v_cur is null then v_cur := 0; end if;

  -- Validación previa: deuda no permitida.
  if (v_cur + p_delta) < 0 then
    raise exception 'insufficient_funds' using errcode = 'P0001';
  end if;

  begin
    update public.balances
       set balance = balance + p_delta, updated_at = now()
     where user_id = p_user
     returning balance into v_new;
  exception when check_violation then
    -- Red de seguridad ante carreras: normalizar a insufficient_funds.
    raise exception 'insufficient_funds' using errcode = 'P0001';
  end;

  if v_new is null then raise exception 'balance_row_missing'; end if;
  return v_new;
end $$;
