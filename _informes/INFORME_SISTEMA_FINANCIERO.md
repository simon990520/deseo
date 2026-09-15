# INFORME DEL SISTEMA FINANCIERO — proyecto "Deseo"
**Fecha:** 2026-09-13 · **Alcance:** todos los flujos de dinero (frontend `firebase-money.js`, `wallet-inline.js`, `chat-client.js`, `chat-provider.js`, `admin-dashboard.js`, backend `server/api/bold/*`, `server/api/ai/gemini.js`)
**Método:** lectura directa del código + verificación en navegador real (puppeteer-core) contra el RTDB real `parcero-6b971`.

---

## 0. Resumen ejecutivo

**Veredicto global: el diseño del núcleo de dinero es CORRECTO y está bien pensado (transacciones atómicas + ledger de idempotencia). Ya no hay doble gasto ni doble cobro en los flujos que lo usan.**

Sin embargo el sistema **NO es óptimo en seguridad** todavía, por una razón de arquitectura, no de código:

> **Toda la autoridad financiera vive en el CLIENTE.** El RTDB es público (lectura/escritura sin auth), así que cualquier persona con la URL puede escribir `users/{id}/balance` directamente y saltarse **todas** las defensas buenas que hay en el JS. Las transacciones atómicas evitan *accidentes* (doble clic, carrera entre pestañas), pero **no evitan a un atacante** que llama a la REST API de Firebase.

**Los 3 niveles de seguridad, de mejor a peor:**

| Nivel | Mecanismo | Estado |
|---|---|---|
| 🟢 Atómico | `ref.transaction()` + listener persistente (`activateNode`) | **Implementado y verificado** |
| 🟢 Idempotente | `ledger/{opId}` con claim antes de aplicar | **Implementado y verificado** |
| 🟢 Validación | montos > 0, no sobregiro, permisos por rol | **Implementado (cliente)** |
| 🟠 Anti-repudio | Registro de órdenes/escrow + `platform_fees` | **Implementado** |
| 🔴 **Autoridad** | **El saldo lo escribe el cliente, no el servidor** | **PENDIENTE — requiere backend/rules** |

---

## 1. Inventario: qué toca dinero y dónde

| # | Flujo | Archivo(s) | Cobra | Acredita | Atómico | Idempotente |
|---|---|---|---|---|---|---|
| 1 | Enviar mensaje de chat | `chat-client.js` (sendMessage) | 390 al cliente | 100 al proveedor | ✅ | ✅ |
| 2 | Mensaje urgente / solicitud | `chat-client.js` (sendSpecialMessage) | 390 | 100 | ✅ | ✅ |
| 3 | Propina (tip) | `chat-client.js` (sendTip) | N | N | ✅ | ✅ |
| 4 | Solicitud de encuentro | `chat-client.js` (sendRequestService) | 100 | 100 | ✅ | ⚠️ |
| 5 | Fotos pagadas | `chat-client.js` (unlockPaidPhotos) | precio | precio | ✅ | ❌ |
| 6 | Oferta de encuentro → escrow | `chat-client.js` (respondToEncounterOffer) | precio | (retenido) | ✅ | ✅ |
| 7 | Liberación de escrow | `chat-client.js` (releaseEscrow) | — | precio al proveedor | ✅ | ✅ |
| 8 | Depósito / recarga Nequi | `wallet-inline.js` (handleNequiPayment) | — | al aprobar admin | ✅ (al aprobar) | ✅ (`approve_{txId}`) |
| 9 | Retiro bancario | `wallet-inline.js` (handleWithdraw → saveWithdrawalRequest) | reserva | reembolso si rechazo | ✅ | ✅ (`refund_{txId}`) |
| 10 | Recarga con Bold | `server/api/bold/create-payment-link.js` + `integrity-signature.js` | pago externo | (webhook → pendiente) | N/A | ⚠️ |
| 11 | Aprobación/rechazo admin | `admin-dashboard.js` | — | ✅ | ✅ | ✅ |

---

## 2. Cómo funciona CADA flujo (paso a paso)

### 🔹 Flujo 1 — Enviar mensaje de chat (`sendMessage`)
1. Se genera una **push key** de Firebase como `messageId` (evita colisiones de `Date.now()`).
2. `opId = msg_{chatId}_{messageId}` → determinista, reproducible, imposible de reutilizar.
3. `chargeClient(390, ...)` → `DeseoMoney.charge(...)`, que:
   - `claimOp(opId+'_out')`: si el ledger ya tiene esa op → **aborta** (idempotente).
   - `activateNode(balanceRef)`: escucha el nodo para que la transacción vea el valor real del servidor (bug del compat SDK v10 resuelto).
   - `balanceRef.transaction(cur => cur - 390)`, con `requireSufficient` → **nunca** deja saldo negativo.
   - Si no hay fondos → `releaseOp(opId)` (libera el claim) y devuelve `{ok:false}`.
4. Si el cobro falla → se aborta y **no se envía el mensaje**. ✅ (no se entrega producto sin pago)
5. `creditProvider(100, ...)` → acredita al proveedor con `opId+'_in'`.
6. Se escribe `platform_fees/{opId}` = 290 (auditable).
7. Se persiste el mensaje con `tempRef.set()`.

**Contabilidad:** 390 = 100 (proveedor) + 290 (plataforma). ✅ Cuadra.
**Puntos débiles:** si el proceso muere entre el paso 3 y el 5, el cliente pagó y el proveedor no cobró; el mensaje tampoco se envía. No hay reconciliación automática (habría que reintentar; el `opId` lo hace seguro).

---

### 🔹 Flujo 4 — Solicitud de encuentro (`sendRequestService`)
Cobra 100 al cliente y acredita 100 al proveedor, **NO idempotente**: usa `sendSpecialMessage(...)` con un `payOpId` generado dentro (`special_{chatId}_{Date.now()}_{rand}`). Si el usuario **doble-clica**, se generan 2 `payOpId` distintos → **2 cobros de 100**. Es dinero pequeño y el flujo es de bajo riesgo, pero es una **inconsistencia** frente al resto (todos los demás usan `messageId`/orden como semilla).
**Además:** el mensaje de solicitud se envía por `sendSpecialMessage`, que para `service_request` **vuelve a cobrar 390** (porque `service_request` está en `paidMessageTypes`). Es decir, **una sola acción cobra 100 + 390 = 490**. Hay que confirmar si es intencional; si no, es un doble cobro lógico.

**Recomendación:** mover el cobro al borde (un único punto) y derivar `opId` del id del mensaje, igual que el flujo 1.

---

### 🔹 Flujo 5 — Fotos pagadas (`unlockPaidPhotos`)
Cobra `price` al cliente, acredita `price` al proveedor, marca `unlocked:true` en el mensaje.
**Problemas:**
- **NO idempotente**: no se pasa `opId`. Si el usuario recarga y vuelve a hacer clic en "desbloquear", **se cobra de nuevo** aunque ya esté desbloqueado.
- Cualquiera con acceso al RTDB puede leer el `messageId` y las fotos directamente (`images`), aunque `unlocked` sea `false`. **El "pago" por contenido es cosmético sin reglas de servidor.** 🔴

**Recomendación:** `opId = photos_{chatId}_{messageId}` + verificar `message.unlocked` antes de cobrar; idealmente el contenido cifrado hasta el pago (server-side).

---

### 🔹 Flujo 6/7 — Escrow (oferta de encuentro)
1. Cliente acepta la oferta → `orderId` único + `escrowOpId = escrow_{chatId}_{orderId}`.
2. `chargeClient(price)` → **retención**: el dinero sale del cliente y **no** va al proveedor todavía.
3. Se crea `encounterOrders/{orderId}` con `status:'escrowed'`, `clientConfirmed:false`, `providerConfirmed:false`.
4. Proveedor confirma (`providerConfirmOrder`) → `providerConfirmed:true`.
5. Cliente confirma (`clientConfirmOrder`) → cuando **ambos** son `true` y `status==='escrowed'` → `status:'completed'` + `releaseEscrow`.
6. `releaseEscrow` → `creditProvider(escrowAmount, ..., opId = release_{escrowOpId})` → idempotente, un solo pago.
7. Se envía mensaje de sistema + se ofrecen calificaciones.

**Verificación real:** cliente 200.000 → 125.000 (−75.000 retenido) → proveedor 1.000 → 76.000 (+75.000), orden `completed`. Sin errores. ✅
**Puntos débiles:**
- El **dinero retenido no vive en ninguna cuenta de escrow**: simplemente se descontó y "se recuerda" en `escrowAmount`. Si nadie confirma, el dinero queda en el limbo (no hay cuenta de garantía real).
- `checkOrderCompletion` se ejecuta en **ambos clientes** (cliente y proveedor) cuando ambos confirman; ambos intentan liberar. **Pero `opId` determinista lo salva** (segundo intento → `idempotent:true`). Aun así es frágil: mejor una sola autoridad (servidor).
- `releaseEscrow` se dispara tras un `update` de estado; si el cliente cierra la pestaña justo antes, no se libera hasta que alguien vuelva a confirmar. Falta un "barrido" de órdenes atascadas.

---

### 🔹 Flujo 8 — Depósito Nequi
1. Usuario sube comprobante (máx 5MB) + monto.
2. Se crea `transactions/{userId}/{txId}` con `status:'pending_verification'`, `type:'income'`.
3. Se crea `admin_notifications` para el admin.
4. **NO se acredita nada** hasta que el admin aprueba.
5. Admin aprueba → `approveTransactionWithMessage` → `DeseoMoney.credit(..., opId = approve_{txId})` (idempotente) + `status:'completed'`.
6. Admin rechaza → `status:'rejected'`, sin movimiento de saldo (correcto para income).

**Puntos débiles:**
- El comprobante es una **imagen base64 en el RTDB** (público) → cualquiera puede leer los comprobantes y números de Nequi. 🔴 **PII expuesta.**
- El saldo solo se acredita "de palabra" del admin: no hay verificación automática del pago real.

---

### 🔹 Flujo 9 — Retiro
1. Validaciones: monto ≥ 1.000, ≤ balance, banco, cuenta y titular.
2. **`saveWithdrawalRequest`**: `DeseoMoney.reserve(amount, opId = txId)` → descuenta **ya**, atómicamente, sin sobregiro. ✅ (esto arregló el doble-retiro).
3. Se guarda la transacción con `fundsReserved:true`.
4. Admin aprueba → detecta `fundsReserved===true` → **no vuelve a descontar** (correcto).
5. Admin rechaza → `DeseoMoney.credit(..., opId = refund_{txId})` → devuelve el saldo + `fundsReserved:false`. ✅

**Puntos débiles:**
- El "retiro" no genera ninguna orden de pago real (no llama a Bold/banco): es un registro que el admin paga manualmente fuera del sistema. Es un **libro de intenciones**, no un sistema de pagos.
- `getCurrentUserId()` y varias validaciones aún leen `localStorage.deseo_user` como fallback (el `DeseoSession` verificado tiene prioridad, pero si no está disponible, un usuario que edite localStorage puede ver el saldo de otro).

---

### 🔹 Flujo 10 — Bold (serverless)
`create-payment-link.js` e `integrity-signature.js` fueron reescritos: **solo leen llaves de `process.env`**, CORS restringido. **No hay webhook** que acredite el saldo automáticamente al confirmarse el pago → hoy requiere aprobación manual (como Nequi).
**Puntos débiles:** falta webhook firmado + acreditación idempotente server-side. Sin eso, Bold es un "generador de links".

---

### 🔹 Flujo 11 — Aprobación admin
- Idempotencia explícita: si `status==='completed'` o `'rejected'` → rechaza la re-acción.
- `opId` determinista (`approve_{txId}` / `refund_{txId}`) → aunque se ejecute dos veces, **solo aplica una**.
- ⚠️ **No hay validación de que el monto aprobado coincida con el de la transacción**: `approveTransactionWithMessage(transactionId, userId, amount, ...)` recibe `amount` del llamador y lo usa; si el DOM/manipulación cambia ese `amount`, se acredita un monto distinto al registrado. **Debería usar `transactionData.amount`.** 🟠

---

## 3. Optimizaciones de seguridad recomendadas (priorizadas)

### 🔴 Críticas (sin esto, todo lo anterior es cosmético)
1. **Mover la autoridad al servidor.** Cloud Functions (Admin SDK) o serverless (`server/api/**`) que hagan los `charge/credit`. El cliente solo *pide*, el servidor *valida y aplica*. Mientras el RTDB sea escribible, cualquiera puede `PUT users/{x}/balance = 999999999`.
2. **Reglas de Firebase RTDB** (tras el puente Clerk→Firebase, Opción A):
   - `users/{uid}/balance`: **solo lectura** para el dueño; escritura **denegada** a todos (solo Functions/Admin).
   - `ledger/{opId}`: `".write": false` (solo servidor).
   - `platform_fees/*`: `".write": false`.
   - `transactions/{uid}`: el dueño lee; el dueño **crea** con `status:'pending_verification'` pero **no** puede cambiar `status` ni `amount`.
   - `encounterOrders/*`: transiciones válidas por rol (cliente confirma como cliente, proveedor como proveedor).
3. **Nunca acreditar con `amount` del llamador** en el admin: usar siempre `transactionData.amount`.
4. **Reglas de validación de forma** (Opción B, aplicable ya sin credenciales): aunque no haya auth, se puede al menos bloquear escrituras a nodos sensibles y validar tipos/rangos por nodo.

### 🟠 Importantes
5. **Sacar los comprobantes (PII) del RTDB público**: subirlos a Firebase Storage con reglas, y guardar solo la URL. Hoy base64 en nodo público = filtración de comprobantes y números de Nequi.
6. **Cuenta de escrow real**: crear `escrow/{orderId}` como nodo contable propio (o mover el escrow enteramente al backend) en vez de "recordar" el monto descontado.
7. **Barrido de órdenes atascadas**: cron (Cloud Function programada) que libere/reembolse órdenes `escrowed` con confirmaciones vencidas.
8. **Idempotencia en flujos 4 y 5** (`sendRequestService`, `unlockPaidPhotos`): pasar `opId` determinista y verificar estado antes de cobrar.
9. **Webhook firmado de Bold** que acredite saldo automáticamente e idempotentemente.
10. **Validar rol en el servidor**, no solo el gate de Clerk en el cliente (`admin-auth-gate.js` es fail-closed, pero es del lado cliente → evadible).

### 🟡 Deseables
11. **Límites y rate-limiting** por usuario (máx. mensajes/min, máx. monto por operación, máx. tips/día) — hoy no hay ninguno.
12. **Auditoría contable**: un job que verifique `sum(ledger) == balance` por usuario y alerte de descuadres.
13. **Rastro de doble escritura**: `applyDelta` devuelve `{committed:false}` silencioso en algunos casos; conviene loguear/reintentar explícitamente.
14. **Moneda entera**: hoy todo es `parseInt`; correcto en COP (no hay centavos), pero convendría documentarlo/normalizarlo.
15. **`reserve` en retiro**: añadir TTL — si el admin nunca actúa, los fondos quedan retenidos indefinidamente sin reembolso automático.

---

## 4. Lo que ya está BIEN (no tocar)

- ✅ `firebase-money.js` con `transaction()` + `activateNode()`: resuelve el bug real del compat SDK v10 (transacción veía `null`).
- ✅ `ledger/{opId}` como **claim antes de aplicar** → idempotencia real (probado: mismo `opId` ×3 = 1 cobro).
- ✅ `requireSufficient` → **sin sobregiro** (probado: 10×1.000 con 2.500 → solo 2 pasan).
- ✅ Concurrencia entre pestañas (probado: 10×1.000 con 10.000 → saldo 0, contabilidad cuadra).
- ✅ El retiro **reserva al solicitar**, no al aprobar → mata el doble-retiro.
- ✅ El admin **no** vuelve a descontar retiros con `fundsReserved`.
- ✅ Comisión de plataforma separada y auditable (`platform_fees`).
- ✅ `chargeClient` **aborta** si `DeseoMoney` no está → no hay camino "sin cobro" por fallo de carga.
- ✅ Nunca se escribe `balance` desde memoria del cliente en el guardado de transacción (se eliminó el `update({balance})` peligroso).

---

## 5. Conclusión

El sistema financiero está **funcionalmente sólido y bien diseñado a nivel de operación individual**: no se pierde dinero por doble gasto, no hay sobregiros, el escrow funciona, y los flujos están verificados en navegador real.

Su **techo de seguridad** lo pone una decisión de arquitectura: **la autoridad final sigue en el cliente sobre una base de datos pública.** Los tres pendientes ya conocidos (rotar llaves, desplegar reglas Firebase tras el puente Clerk→Firebase, desplegar serverless) son exactamente lo que convierte este sistema de "correcto pero vulnerable" en "correcto y seguro". **Ninguno es opcional si hay dinero real.**

**Orden correcto de ejecución (no cambiar):**
1. Rotar las 5 llaves expuestas.
2. Puente Clerk→Firebase (Opción A) o reglas pragmáticas (Opción B).
3. Desplegar reglas + serverless.
4. Prueba end-to-end post-deploy.

**Sobre la Opción B (sin credenciales nuevas), lo que SÍ se puede endurecer ya:**
- Bloquear escritura a `ledger/*`, `platform_fees/*`, `admin_notifications/*`.
- Impedir que `users/{uid}/balance` sea escrito por clientes (aunque sin auth no se puede distinguir "dueño" de "atacante" → mejor bloquear todo y mover a backend).
- Validar forma/rangos por nodo y bloquear borrado de nodos financieros.

> Nota honesta: **la Opción B sola no resuelve el problema de raíz** (sin identidad en las reglas, `auth` es siempre `null`). Sirve como mitigación temporal, no como solución.
