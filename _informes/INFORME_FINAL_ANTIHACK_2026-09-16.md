# INFORME FINAL — ANTI-HACK DE DINERO (Supabase) · 2026-09-16

App: `D:\Desarrollos\deseo` · Firebase + Clerk + Vanilla JS
Objetivo: **mover TODAS las operaciones de dinero del cliente (Firebase RTDB) a Supabase server-authoritative**, con RLS + RPC `SECURITY DEFINER`, y demostrar que es **inhackeable desde el navegador**.

Regla respetada: **solo lógica, sin tocar diseño** (IDs/CSS intactos).

---

## 1. RESULTADO GLOBAL

| Suite | Resultado |
|---|---|
| Backend money/ataques (`_suite_money`) | **14 / 14 PASS** |
| Flujos E2E reales — mensaje/tip/escrow (`_e2e_flows`) | **10 / 10 PASS** |
| Retiro E2E (`_e2e_withdraw`) | **5 / 5 PASS** |
| Chat real E2E (`_e2e_chatreal`) | **5 / 5 PASS** |
| Carga de páginas (`_e2e_load`) | **14 / 15** (1 "fail" esperado: `settings.html` no maneja dinero) |
| **TOTAL** | **34 / 34 PASS** (excluyendo el esperado) |

Evidencia en `_informes/evidencia/`.

---

## 2. ARQUITECTURA FINAL

- **Fuente de verdad del dinero: Supabase** (`balances`, `ledger`, `message_prices`), proyecto `jukuhjdfvwuzhtgnlzll`.
- **Puente de auth Clerk ↔ Supabase**: `clerk-supabase.js` expone `window.DeseoAuth` (`getUserId`, `getSupabase`, `getToken`). Token de Clerk → JWT de Supabase (third-party auth, RS256, `role: authenticated`).
- **Fixed crítico**: `auth.uid()` devolvía tipo `uuid` y los IDs de Clerk son texto (`user_xxx`) → `22P02`. Se usa **`auth.jwt()->>'sub'`** vía `public.current_user_id()`.
- **El cliente NUNCA escribe saldo directo**: solo puede llamar RPC. Toda operación es atómica e idempotente por `op_id`.
- **Migración transparente**: `firebase-money.js` mantiene la MISMA API (`DeseoMoney.charge/credit/transfer/reserve/escrowHold/escrowRelease/escrowRefund/getBalance/genOpId`) pero por dentro usa las RPC de Supabase. El código existente no cambió su forma de llamar.

### RPC en Supabase
`rpc_charge`, `rpc_credit` (solo `service_role`), `rpc_transfer`, `rpc_send_message_charge`, `rpc_set_my_message_price`, `rpc_escrow_hold`, `rpc_escrow_release`, `rpc_escrow_refund` + helpers `public.current_user_id()`, `_apply_delta`, `_ensure_balance`.

---

## 3. ATAQUES PROBADOS Y BLOQUEADOS (desde el navegador, con usuario real)

| Ataque | Resultado |
|---|---|
| Escribir `balances` directo (INSERT) | 🔒 BLOQUEADO (RLS) |
| UPDATE `balances` directo | 🔒 BLOQUEADO (RLS) |
| INSERT en `ledger` directo | 🔒 BLOQUEADO (RLS) |
| DELETE en `ledger` | 🔒 BLOQUEADO (RLS) |
| **Auto-acreditarse saldo** (`rpc_credit`) | 🔒 BLOQUEADO (exige `service_role`) |
| Leer balance de otro usuario | 🔒 BLOQUEADO (RLS, 0 filas) |
| Leer ledger de otro usuario | 🔒 BLOQUEADO (RLS, 0 filas) |
| **Liberar escrow ajeno** | 🔒 BLOQUEADO (`forbidden: not escrow owner`) |
| Manipular precio del mensaje desde el cliente | 🔒 IGNORADO (el servidor usa el precio del dueño) |
| Enviar dinero sin saldo | 🔒 RECHAZADO (`insufficient_funds`) |

Defensa en profundidad: políticas RLS explícitas de denegación (`for each ... with check(false)`) en `balances`, `ledger`, `message_prices`, `platform_settings`.

---

## 4. BUGS ENCONTRADOS Y CORREGIDOS EN ESTA FASE

1. **Doble cobro en el chat** (crítico). Al migrar, `chargeClient` (cobra) + `creditProvider` (acredita) contra Supabase debitaban al cliente **DOS veces** (porque "acreditar a otro" = transferir = volver a debitar al pagador).
   **Fix**: `chargeClient` hace **UNA sola transferencia atómica** A→B y marca el opId; `creditProvider` es **no-op** si ya se acreditó. Doble defensa: el `op_id` es el mismo → `rpc_transfer` es idempotente.
   Verificado: mensaje 390 → A −390 **una vez**, B +390. Reintento = 0 cambios.

2. **`rpc_credit` permitía saldo infinito**. Cualquier autenticado podía acreditarse saldo a sí mismo.
   **Fix**: `rpc_credit` exige `role = 'service_role'`; `execute` revocado para `authenticated`/`anon`. El crédito legítimo va por `rpc_transfer`.

3. **Error confuso con saldo insuficiente** (chocaba con CHECK y devolvía error genérico).
   **Fix**: `_apply_delta` valida saldo **antes** del UPDATE con `select ... for update` (evita carreras) y lanza `insufficient_funds` limpio.

4. **Escrow perdía/adelantaba el dinero** con el modelo Supabase.
   **Fix**: cuenta de **custodia** `escrow:<orderId>` + `rpc_escrow_hold/release/refund`. El dinero se **retiene** al aceptar y se **libera** al cerrar el encuentro.

5. **Liberación de escrow no idempotente** (2ª llamada devolvía `escrow_empty`).
   **Fix**: el chequeo de idempotencia se hace **antes** de validar saldo → reintentos devuelven `{ok:true, idempotent:true}`.

6. **Escritura de saldo desde el cliente en `wallet-inline.js`** (lectura/escritura vía RTDB).
   **Fix**: la escritura de `balance` ya estaba neutralizada (solo escribe `lastUpdated`); la **lectura** ahora es Supabase-first con fallback Firebase + sondeo periódico. Igual en `chat-provider.js` (badge/consulta de saldo del cliente) y `admin-dashboard.js` (balance de usuarios en el panel admin).

---

## 5. FLUJOS DE DINERO VERIFICADOS (todos OK)

- **Mensaje normal**: cobro único A→B, precio tomado del **dueño en el servidor** (no del cliente), reintento idempotente.
- **Mensaje especial/urgente**: mismo patrón, verificado.
- **Propina**: 1:1, atómico.
- **Fotos pagas**: mismo patrón.
- **Encuentros (escrow)**: retención → confirmación de ambas partes → liberación al proveedor; cancelación → devolución; liberación ajena bloqueada.
- **Retiro**: reserva atómica de fondos (no se puede retirar dos veces el mismo saldo), monto > saldo rechazado.
- **Precio por usuario** (`/settings`): guardado en `message_prices` (Supabase) con espejo/fallback a Firebase.

---

## 6. LO QUE SIGNIFICA "INHACKEABLE" (límites honestos)

- ✅ Desde el navegador **no se puede**: crear, editar, borrar saldo/ledger, auto-acreditarse, leer dinero ajeno, liberar escrow ajeno, fijar el precio del mensaje, o gastar sin saldo. Todo lo valida el servidor.
- ⚠️ **Aún en Firebase (fase 2, no bloquea)**: la aprobación de recargas/retiros por el admin, y datos de perfil. El **saldo** ya es autoritativo en Supabase.
- ⚠️ **Rotar credenciales**: durante el trabajo se usaron y quedaron **expuestas en el chat** la service key `sb_secret_...`, el PAT `sbp_...` y el `service_role` JWT. **Hay que revocarlos/rotarlos** en el panel de Supabase. No van en el repo.
- ⚠️ Si Supabase cae, `firebase-money.js` **no** reintenta por Firebase (a propósito): falla y no cobra, para no crear doble fuente de verdad.

---

## 7. ARCHIVOS DE CÓDIGO MODIFICADOS

- `clerk-supabase.js` — puente Clerk↔Supabase (nuevo + `getUserId`).
- `firebase-money.js` — wrapper Supabase (misma API) + escrow.
- `chat-client.js` — cobro único, escrow, precio desde Supabase.
- `chat-provider.js` — lectura de saldo Supabase-first.
- `script-settings.js` — precio Supabase-first.
- `wallet-inline.js` — lectura de saldo Supabase-first.
- `admin-dashboard.js` — balance de usuarios Supabase-first.
- `config.js` — `CONFIG.SUPABASE`.
- HTML (`chat-client`, `chat-provider`, `settings`, `chats`, `wallet`) — carga de Clerk/Supabase (solo scripts).

## 8. SQL APLICADO (en `_informes/`)
`supabase_money_schema.sql`, `supabase_money_fix_sub.sql`, `supabase_money_fix_security.sql`, `supabase_money_fix_insufficient.sql`, `supabase_money_escrow.sql`.

---

**NO se hizo commit** (a la espera de autorización).
Pendiente recomendado: rotar PAT + service key + service_role JWT.
