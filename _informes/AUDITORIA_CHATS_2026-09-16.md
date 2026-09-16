# Auditoría de flujos de chat — "Deseo"
> Generado 2026-09-16. Revisión read-only. Consolidado de 4 auditorías paralelas + revisión propia.

## chat-client.js (flujo del CLIENTE)

### CRÍTICO
- **C1** (538–590): `sendMessage` cobra 390 ANTES de persistir el mensaje. Si `tempRef.set` falla → cliente pierde dinero sin mensaje; no hay compensación. Fix: persistir primero (pending) → cobrar idempotente → confirmar; o saga con refund.
- **C2** (565–575, dup 1943–1954): `platform_fees` se escribe aunque falle el crédito al proveedor (bloque en `try/catch(_){}`). Fix: registrar comisión solo si `creditProvider` retorna éxito.
- **C3** (894–912): `creditProvider` nunca señala fallo (siempre `try/catch` + `undefined`). Raíz de C2/C5. Fix: devolver `{ok}` y que llamadores validen/compensen.
- **C4** (1230–1262): `unlockPaidPhotos` — charge/credit SIN `opId` → doble cobro en doble clic/reintento. Pago antes de verificar que el mensaje tiene imágenes. Update `unlocked` tras cobro puede fallar. Fix: opId determinista `unlock_${chatId}_${messageId}`, verificar `images` antes de cobrar.
- **C5** (1292–1370): `respondToEncounterOffer` — cobra escrow y luego crea orden con `.set`. Si el set falla → dinero congelado sin orden. Fix: orden primero (creating) → cobrar → escrowed; o rollback.
- **C6** (1471–1477 + 1455–1469): `releaseEscrow` sin protección de doble liberación; `checkOrderCompletion` puede dispararse por cliente y proveedor casi a la vez → doble acreditación. Fix: `ref.transaction()` sobre status; solo el ganador libera.
- **C7** (1560–1587, 1625–1631): `raiseDispute`/`reportEncounterProblem` no atómicos: crea disputa luego update orden; si falla, orden sigue escrowed y podría liberarse sobre dinero en disputa. Fix: transacción; `checkOrderCompletion` aborta si `status==='disputed'`.
- **C8** (1560–1565): `raiseDispute` no valida que la orden esté en `escrowed` (puede disputar completed/cancelled). Fix: validar status.

### ALTO
- **A1** (869–912): `chargeClient` devuelve bool, `creditProvider` devuelve undefined (asimétrico). Fix: contrato `{ok,reason}`.
- **A2** (928–962): `sendTip` — cobra, credita sin validar, luego mensaje. Propina sin trazabilidad si el mensaje falla. Fix: validar creditProvider; registrar propina estructurada.
- **A3** (1908–1988 vs sendRequestService): `sendSpecialMessage` — cobro duplicable con sendRequestService.
- (truncado: más hallazgos ALTO/MEDIO en el informe completo del subagente)

## Módulos ADMIN (admin-auth-gate.js, admin-disputes.js, admin-dashboard.js)

### CRÍTICO
- **AUTH-01** (admin-auth-gate.js:1-215 + admin-dashboard.js:1694-1725): gate de admin 100% cliente y fail-open evadible (borrar script, setear `window.__DESEO_ADMIN_GRANTED__=true`, disparar CustomEvent `deseoAdminGranted`, instanciar AdminDashboard a mano). Con la apiKey pública → control total: aprobar retiros, editar balances, banear, resolver disputas, liberar escrow. Fix: TODO server-side (Cloud Functions + token Clerk verificado).
- **AUTH-02** (admin-auth-gate.js:79-105): rol admin se lee de Clerk `publicMetadata/privateMetadata` en cliente → escalada si el metadata es editable. Fix: autorizar solo contra token firmado + allowlist server-side.
- **DIS-01** (admin-disputes.js:625-712): `handlePaymentResolution` hace read-then-write directo (`once`+`set(current+amount)`) e IGNORA `firebase-money.js` → doble gasto, sin idempotencia, sin ledger. (El dashboard sí usa DeseoMoney → inconsistencia.) Fix: `DeseoMoney.credit(..., {opId:'dispute_'+disputeId})`.
- **DIS-02** (admin-disputes.js:565-620 + 625-712): resolución no atómica: marca `resolved` → push mensaje → paga. Si el pago falla, disputa queda resuelta sin pagar (o reabrir duplica pago). Fix: opId + multi-path update atómico; ideal Cloud Function transaccional.

### ALTO
- **DIS-03** (admin-disputes.js:520-534, 536-563): idempotencia solo por estado local en memoria; dos admins/pestañas confirman a la vez → doble pago. Fix: `transaction()` sobre disputes/{id} (claim a estado intermedio `resolving`).
- **DIS-04** (admin-disputes.js:713-733): `recordMicroTransaction` traga errores y ID `micro_${Date.now()}`. Pago hecho sin asiento → descuadre silencioso. Fix: propagar error; usar opId.
- **DASH-01** (admin-dashboard.js:373-427, 824-864, 1000-1030): carga TODA la colección `transactions` y `users` con `on('value')`, sin paginación → fuga masiva de PII/financiero + rendimiento. Fix: reglas RTDB + paginación `limitToLast`.
- **DASH-02** (admin-dashboard.js:583-597, 527-581, 1054-1104): `innerHTML`/URLs sin escape + `onclick` inline (XSS almacenado vía `proofImage`, `adminMessage`, `user.email`). Fix: escapar / textContent / CSP.
- (truncado: más hallazgos en el informe del subagente)

## Revisión propia (capa de dinero y reglas)
- **MONEY-01**: `firebase-money.js` es correcto en atomicidad/idempotencia (transaction + ledger opId), pero su propio header admite que la AUTORIDAD sigue en cliente mientras el RTDB sea público. Defensa real = Security Rules + Cloud Functions.
- **RULES-01**: reglas RTDB actuales = `true` para .read/.write (público). `firebase-rules.json` propuesto exige `auth.uid`, pero la app NO autentica contra Firebase (usa Clerk sin puente) → NO aplicable tal cual; requiere puente de auth (custom token) antes de desplegar.
- **IDX-01**: falta `.indexOn: "chatId"` en `/encounterOrders` (warning de Firebase en runtime).

