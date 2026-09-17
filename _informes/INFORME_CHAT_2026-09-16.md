# Informe de Auditoría y Pruebas — Flujos de Chat (Deseo)

**Fecha:** 2026-09-16
**Alcance:** Todos los flujos de chat (cliente y proveedor), cobros, y modelo de precios.
**Modo:** Pruebas E2E automatizadas (Puppeteer + Firebase RTDB real).

---

## 1. Objetivo

1. Corregir el **doble cobro** al enviar mensajes.
2. Verificar/arreglar **todos** los flujos de chat para cliente y proveedor.
3. Confirmar el modelo de **precio del mensaje definido por el usuario en Firebase**.
4. Garantizar **conservación del dinero** (lo que paga el cliente == lo que recibe el proveedor).

---

## 2. Cambios de lógica aplicados (solo lógica, sin tocar diseño)

### `chat-client.js`
- **Envío robusto (anti doble cobro):** delegación a nivel de documento para `#sendBtn` (click) y `#messageInput` (Enter), enlazada al **inicio** de `init()` (`setupRobustSendDelegation`). Antes el botón no tenía listeners hasta ~10s después de cargar → clics repetidos → múltiples `sendMessage` → múltiples cobros.
- **Locks de reentrada:**
  - `sendMessage()` → `_sendingMessage` + timeout de seguridad 15s.
  - `sendSpecialMessage()` → `_sendingSpecial`.
  - `sendTip()` → `_sendingTip`.
  - `respondToEncounterOffer()` → `_respondingOffer` (evita doble aceptación → doble escrow).
- **Precio por usuario en mensajes especiales:** `sendSpecialMessage` (urgent / service_request) ahora lee `users/{otherUserId}/profile/messagePrice` **directo de Firebase** (igual que el mensaje normal), en vez del precio global `messageClientCost`. `PROVIDER_CREDIT = CLIENT_COST` (100% al dueño; comisión al retirar).
- **BUG DE DINERO corregido — propina:** `sendTip` acreditaba `DeseoPricing.get('tipProviderCredit', amount)` (valor global 100), por lo que el proveedor recibía **más** de lo cobrado (p.ej. cliente pagaba 80, proveedor recibía 100). Ahora `providerCredit = amount` (1:1).
- **Código muerto eliminado** en `sendRequestService` (variables `COST`/`CREDIT` sin uso que podían confundir).

---

## 3. Resultados de las suites E2E

| Suite | Qué cubre | Resultado |
|---|---|---|
| `_suite_chat.js` | Mensaje texto (click/Enter), calificar, urgente, solicitud, propina, doble disparo | **9/9 OK** |
| `_test_flows2.js` | Reportar (gratis), desbloquear fotos pagas (1 cobro, no doble) | **4/4 OK** |
| `_suite_chat3.js` | Precio definido por el usuario, cobro per-user, modal servicio, escrow de encuentro, saldo insuficiente | **7/7 OK** |
| `_suite_final.js` | E2E cliente+proveedor simultáneos + cuadre de dinero | **7/7 OK** |
| `_suite_prov2.js` | Proveedor confirma, cliente libera escrow, idempotencia | **3/3 OK** |

### Detalle destacado
- **Doble cobro resuelto:** clic+Enter simultáneo con el mismo contenido → cobra **1 vez**.
- **Precio per-user:** el usuario define su precio en `/settings` → persiste en `users/{uid}/profile/messagePrice`; el chat del emisor lo lee directo y cobra ese valor.
- **Calificar:** GRATIS (no cobra), guarda en `users/{calificado}/ratings/{id}` y actualiza `reliability`.
- **Reportar:** GRATIS, guarda en `reports/{id}` y `chats/{chatId}/reports/{id}`.
- **Fotos pagas:** descuento con `opId` determinista + transacción `unlocked` → no doble cobro; proveedor recibe 100%.
- **Encuentro (escrow):** aceptar crea 1 orden; doble aceptación no duplica; saldo insuficiente **no cobra ni deja orden huérfana**; liberación idempotente.
- **Conservación de dinero:** 3 mensajes × 120 + propina 80 = **440**; A baja 440, B sube 440 ✅.

---

## 4. Puntos abiertos / recomendaciones (no bloqueantes)

1. **Anti-hack real:** mover cobros a **Cloud Functions** con Admin SDK y reglas RTDB bloqueadas. Hoy el cliente puede, en teoría, escribir su balance si las reglas lo permiten.
2. **Comisión (50%):** aplicar en el **retiro** (fuera del alcance actual).
3. **Índice:** añadir `.indexOn: "chatId"` en `/encounterOrders` para el listener del proveedor.
4. **`prompt()` en `claimPaymentAsProvider`:** usa diálogo nativo; considerar modal propio.

---

## 5. Archivos modificados en esta sesión

- `chat-client.js` (lógica: envío robusto, locks, precio per-user en especiales, fix propina).
- (Sesiones previas) `script-settings.js`, `settings.html`, `firebase-money.js`, `chat-provider.js`, `chats.js`, `config.js`, `vercel.json`, `admin-*.js`.

**NO se ha hecho commit** (a la espera de autorización).
