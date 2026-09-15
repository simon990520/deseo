# Informe de Flujos — Proyecto Deseo

**Ruta:** `D:\Desarrollos\deseo` · **Fecha:** 2026-09-13 · **Modo:** solo lectura (auditoría de flujos)
**Alcance:** login/registro, mapa/deseos, billetera, pagos Bold, chat cliente/proveedor, admin, perfil.

> Referencias con `archivo:línea`. Estados: **OK** · **Deficiente** · **Roto** · **Código muerto**.

---

## 1. Autenticación y registro

### Flujo: Inicio de sesión (Clerk)
**Cómo funciona hoy**
- `index.html` carga Clerk con la publishable key inyectada desde `CONFIG.CLERK.publishableKey` (ya sin hardcode).
- Al autenticar, Clerk llama `handleClerkSignIn(user)` (`script-mapbox.js:81`): arma `currentUser {id,name,email,profileImageUrl}` y lo guarda en **localStorage y sessionStorage** como `deseo_user` (`:91-92`), llama `checkProfileCompletion()`, muestra bienvenida y `updateAuthUI()`.
- Cierre de sesión: `handleClerkSignOut()` (`:110`) borra `deseo_user` de ambos storages.
- Botón navbar → `window.Clerk.signOut()` (`:623`). Apertura de login: `showAuthUI()` (`:671`) con reintentos si Clerk aún no cargó (`:674-712`).
- Al iniciar: `initializeApp()` (`:718`) revisa sesión local y, si hay `window.Clerk.user`, llama `handleClerkSignIn` (`:773-775`).

**Estado:** OK conceptualmente (Clerk es sólido), **Deficiente** en la capa de app.

**Problemas concretos**
- `script-mapbox.js:91-92` — la identidad real vive en `localStorage.deseo_user`, **manipulable**. Toda la app (wallet, chat, perfil) confía en ese `id` sin verificar contra Clerk. Cambiar ese valor te hace "ser" otro usuario.
- `:306-363` `isUserProfileComplete()` lee `users/{id}` de un RTDB público: cualquiera puede ver/crear perfiles.
- Existen **3 sistemas de auth** (Clerk inline, `auth.js` DeseoAuth, `script-auth.js` AuthManager); los dos últimos son **código muerto** no cargado por ningún HTML → carga de mantenimiento y confusión.
- `checkProfileCompletion()` (`:268`) espera 1s fijo (`setTimeout`) a que Firebase inicialice — race frágil.

**Mejoras**
- Derivar identidad de un **token verificado** (Clerk/Firebase Auth) en cada operación sensible, no de localStorage.
- Unificar en un único módulo de auth; retirar o marcar explícitamente el código muerto.
- Sustituir esperas fijas por `await` de la inicialización de Firebase.

**Riesgos:** suplantación de identidad trivial; accesos cruzados a datos/saldo ajenos.

### Flujo: Completar perfil
**Cómo funciona hoy**
- Si el perfil está incompleto, `showProfileCompletionModal()` (`:365`) redirige a `profile-complete.html` vía `profileCompleteBtn`.
- `ProfileCompleteManager` (`script-profile-complete.js`) valida nickname, descripción, **edad ≥18**, **≥3 fotos**, **≥1 pose** (`:436-470`), guarda en `users/{id}` con `profile`, `profileComplete:true`, `userInfo` (`:535-548`).
- Fotos: `fileToBase64` (`:304`) → guarda **base64 dentro del RTDB** (`:284`).

**Estado:** Deficiente.

**Problemas concretos**
- **Fotos en base64 en la BD** (`script-profile-complete.js:280-284`): infla el RTDB, encarece lecturas, y el listado/mapa leen el base64 completo.
- Detección de usuario por 4 métodos en cascada (`window.deseoApp` → Clerk → localStorage → sessionStorage; `:479-528`) — herencia de las múltiples capas de auth.
- Validación solo en cliente; el server (RTDB público) acepta cualquier estructura.

**Mejoras:** subir imágenes a **Cloud Storage** y guardar solo URLs; validar server-side; un único método de obtención de usuario.

**Riesgos:** costos de ancho de banda; PII/imágenes en BD abierta.

---

## 2. Mapa y deseos (wishes)

### Flujo: Inicializar mapa + marcadores + perfiles
**Cómo funciona hoy**
- `initializeMapbox()` (`:785`) crea el mapa; `initializeFirebase()` (`:4255`) inicializa RTDB, `loadAvailableProfiles()`, `setupRealtimeListeners()`, `setupAvailableProfilesListeners()`.
- `loadAvailableProfiles()` (`:1761`) lee `availableProfiles`; `renderAvailableProfilesOnMap()` (`:1835`) y `createProfileMarker()` (`:1850`) dibujan marcadores HTML custom con foto + alias + categoría.
- Click en marcador → `showProfileDetails(profile, index)` (`:2473`) abre la ficha.

**Estado:** Deficiente (funciona, pero con fugas y coste).

**Problemas concretos**
- **Logs `[DEBUG]` masivos** en `initializeFirebase` (`:4255-4285`) — ya silenciados por `log-utils.js`, pero sigue siendo ruido de código.
- Marcadores sin **clustering**: con muchos perfiles, rendimiento y solapamiento visual. No hay `clearMarkers` eficiente al filtrar.
- Listeners en tiempo real (`:4433`, `:4482`, `:4940`, `:5228`) se registran sin `off()` al salir de página → **fugas** en navegación SPA.
- Cada marcador hace hasta 2 lecturas a `users/{id}` si no está en caché (`:1856-1867`); la caché `userProfilesCache` nunca expira.

**Mejoras:** clustering (supercluster), `off()` en `beforeunload`, expiración de caché, paginación/geo-query.
**Riesgos:** lentitud con volumen; datos obsoletos en caché.

### Flujo: Crear deseo
**Cómo funciona hoy**
- `openCreateWishModal()` → `setupCreateWishModal()` (`:4696`) valida, obtiene ubicación (`getCurrentLocation` `:4647`) y geocodifica inverso (`reverseGeocode` `:4785`).
- `createWish(wishData)` (`:4551`) exige usuario autenticado; si Firebase está off/indisponible → `createWishLocally()` (`:4803`). Con Firebase: `wishesRef.push().set({...})` con `author`, `location`, `ServerValue.TIMESTAMP`.

**Estado:** OK funcional.

**Problemas concretos**
- Si Firebase falla, cae a **local** en silencio (`:4573`) — el deseo "se crea" pero no es visible para otros (UX engañosa).
- `parseInt(wishData.price)` sin validar NaN negativos (`:4596`).
- Catálogo de categorías/poses hardcodeado en cliente.

**Mejoras:** indicar explícitamente "guardado local (no publicado)"; validar precio; catálogo server-side.

**Riesgos:** expectativas falsas de publicación; datos inválidos en BD.

### Flujo: AI (Gemini)
**Cómo funciona hoy**
- `initializeGeminiClient()` (`:2188`) toma `CONFIG.AI.GEMINI.apiKey`; `generateGeminiResponse()` (`:2214`) hace `fetch` directo a Gemini con header **`X-goog-api-key`** desde el navegador.

**Estado:** Roto para seguridad (funciona, pero expone la key).

**Problemas concretos**
- `script-mapbox.js:2233` — **API key de Gemini usada desde el cliente** → cualquiera la extrae de DevTools/red y la usa a tu costa.
- Sin límite de tokens/rate; sin manejo de errores de cuota.
- Fallback local `generateAIResponse()` (`:2120`) con respuestas predefinidas.

**Mejoras:** mover la llamada a Gemini a un backend/serverless con la key en servidor; rate-limit por usuario.

**Riesgos:** robo de API key y facturación; abuso.

---

## 3. Billetera

> Detalle ampliado en `_informes/flujo-wallet-pagos.md`.

### Flujo: Ver saldo
**Cómo funciona hoy:** `loadBalance()` (`wallet-inline.js:185`) toma `userId` de `localStorage.deseo_user`, lee `users/{id}/balance`, `parseFloat` (`:206`), render (`:1160`).
**Estado:** Deficiente.
**Problemas:** `userId` manipulable (`:187-193`); saldo cae a 0 en silencio si Firebase falla (`:196-199`); `parseFloat` sin validar NaN (`:206`).
**Mejoras:** identidad verificada; estado "sin conexión"; `Number.isFinite`.
**Riesgos:** ver saldo ajeno; saldo fantasma.

### Flujo: Recargar (Nequi manual)
**Cómo funciona hoy:** `showNequiInstructions` (`:625`) con Nequi hardcodeado `3146959639` (`:700`); `handleNequiPayment` (`:780`) valida login, comprobante ≤5MB, `confirm()`, base64, crea transacción **con amount del cliente** `status:pending_verification` (`:840-856`), guarda con `saveToFirebase` (`:1000`); acredita solo al aprobar admin (`admin-dashboard.js:728-736`).
**Estado:** Deficiente.
**Problemas:** monto sin verificar (`:838`); `saveToFirebase` (`:999-1003`) hace `update({balance:this.balance})` (valor local) — **sobrescribe el saldo real**; sin idempotencia (`:834`); **cero `runTransaction`**; comprobante base64 en BD pública (`:843`); `notifyAdmin` (`:1046`) no envía nada.
**Mejoras:** orden server-side; `runTransaction`; Storage; idempotencia por hash; migrar a Bold con webhook firmado.
**Riesgos:** fraude, sobrescritura de saldo, exposición de capturas bancarias, race.

### Flujo: Retiro
**Cómo funciona hoy:** `handleWithdraw()` (`:1082`) valida monto≥1000 (`:1090`), `amount>balance` (`:1094`), banco/cuenta/titular; crea `outcome/pending_verification` (`:1117-1130`); `saveWithdrawalRequest` (`:1147`). **No descuenta al solicitar**; descuenta al aprobar admin.
**Estado:** Roto (seguridad).
**Problemas:** no reserva fondos → **múltiples retiros del mismo saldo** (double-spend); validación solo cliente; `id: Date.now()` colisionable.
**Mejoras:** reservar/bloquear fondos atómicamente al solicitar; validar server-side.
**Riesgos:** retiros duplicados.

### Flujo: Bold (link + firma)
**Cómo funciona hoy:** `server/api/bold/create-payment-link.js` e `integrity-signature.js` existen pero **el cliente no los llama**.
**Estado:** Código muerto (no cableado).
**Mejoras:** integrar Bold con webhook firmado para acreditación automática.

### Flujo: Microtransacciones / historial
**Estado:** OK parcial. `renderTransactions()` escapa montos (`:576`); sin paginación; base64 en listados. Mejora: lazy-load + Storage.

---

## 4. Chat (cliente / proveedor)

### Flujo: Mensajes en tiempo real
**Cómo funciona hoy**
- `loadMessages()` (`chat-client.js:319`) hace `once('value')`, normaliza por `timestamp`, `renderMessages()`, y escucha `child_added` (`:352`) con dedupe por `{timestamp,senderId,message}`. Indicador "escribiendo": `setupTypingListener` (`:416`), `startTyping/stopTyping` (`:889/:899`).
- **Envío:** `sendMessage()` (`:429`) **cobra al cliente 390** (`chargeClient`) y **acredita al proveedor 100** (`creditProvider`) por cada mensaje de texto.

**Estado:** Deficiente.

**Problemas concretos**
- `chat-client.js:437-444` — **se cobra 390 y se abona 100; 290 no tienen destino auditado**. El usuario paga por escribir.
- `chargeClient`/`creditProvider` (`:760-792`) — **read-then-write no atómico** (`parseInt(snap) + amount` → `set`): condiciones de carrera y doble gasto.
- **Dedupe frágil** por texto+timestamp (`:355-358`): mensajes idénticos repetidos se descartan.
- `id: Date.now().toString()` (`:449`) — colisiones con envíos rápidos.
- `sendMessage` cobra **antes** de confirmar `set` del mensaje (`:441` vs `:453`): si falla el set, ya cobró.
- Listeners `child_added` y `typing` sin limpieza → fugas.
- Varios `[DEBUG]` y `console.error` informativos por todos los handlers.

**Mejoras:** transacción atómica/ledger server-side; comisión explícita y auditada; ids tipo push key; cobrar solo tras persistir; `off()` al salir.
**Riesgos:** pérdida de saldo del usuario; doble cobro; inconsistencias.

### Flujo: Propinas (sendTip)
**Cómo funciona hoy:** `sendTip()` (`:811`) lee `tipAmount`, `chargeClient(amount,'Propina')` → `creditProvider(amount,'Propina recibida')` → envía mensaje especial.
**Estado:** Deficiente. **Problemas:** mismo patrón no atómico; sin validar tope; sin idempotencia. **Riesgos:** doble débito/crédito.

### Flujo: Encuentros con escrow
**Cómo funciona hoy:** al aceptar oferta (`:1160-1210`), `chargeClient(offer.price,'encounter_escrow')` y crea orden `escrowed` en `encounterOrders`. Botón "Confirmar encuentro finalizado" (`:1249`) con **ventana de 5 min** (`:1273-1288`) para confirmar o **reportar problema** → `raiseDispute()` (`:1433`) crea `disputes/{id}` `open`. Al confirmar ambas partes, `checkOrderCompletion` (`:1345`) → `releaseEscrow` (`:1370`) acredita al proveedor.
**Estado:** Conceptualmente bueno (escrow), **Deficiente** en implementación.
**Problemas:** `chargeClient` del escrow no atómico; `id: order_${Date.now()}`; confianza en `providerConfirmed` escrito por cliente; liberación (`releaseEscrow`) reutiliza `creditProvider` no atómico; regla de 5 min fija y opinable.
**Mejoras:** escrow en servidor con transacciones; estados verificados; liberación idempotente.
**Riesgos:** fondos retenidos/liberados incorrectamente; doble liberación.

### Flujo: Fotos pagadas / desbloqueo
**Cómo funciona hoy:** mensajes `paid_photo_bundle` con `unlocked` (`:958-970`) muestran fotos según el flag.
**Estado:** Deficiente. **Problemas:** `unlocked` es un flag en el mensaje; sin verificación de pago por foto; posible bypass editando el mensaje. **Riesgos:** contenido visible sin pago.

### Flujo: Reportes, calificaciones, acciones rápidas
**Cómo funciona hoy:** `sendReport()` (`:559`), `sendRating()`/`saveRating()` (`:1607/:1687`) con `updateUserReliability()` (`:1704`); acciones rápidas en `setupEventListeners()` (`:212`) por `data-action` (tip/request/favorite/report/urgent/rate/evidence) y `handleQuickAction()` (`:504`).
**Estado:** OK parcial (ya consolidado; se eliminaron duplicados).
**Problemas:** `prompt()/confirm()` nativos para disputas/calificación (`:1329`, `:1304`) — mala UX; rating recalcula promedio leyendo **todas** las calificaciones (`:1710`); `window.submitRating` global.
**Mejoras:** modales propios; agregados incrementales server-side.

### Flujo: Chat del proveedor
**Cómo funciona hoy:** `chat-provider.js` espeja el cliente; `sendSpecialMessage` duplicado eliminado; `handleQuickAction`→`handleChatMenuAction`.
**Estado:** OK parcial tras dedupe. Mismos patrones no atómicos donde cobra.

---

## 5. Administración

### Flujo: Acceso al panel
**Cómo funciona hoy:** `admin.html` carga `admin-dashboard.js` directamente (`admin.html:1813`).
**Estado:** **Roto (crítico).**
**Problemas:** **no hay login ni gate** — cualquiera con la URL entra; solo existe un campo "Intentos máximos de login" en Ajustes (`admin.html:1703`) que **no protege nada**.
**Mejoras:** gate real (Clerk/Auth + rol admin verificado server-side); 2FA.
**Riesgos:** control total del negocio (aprobar retiros, editar saldos) por cualquiera.

### Flujo: Aprobar/rechazar transacciones y balance
**Cómo funciona hoy:** `saveAdminMessage()` (`admin-dashboard.js:664`) → `approveTransactionWithMessage()` (`:692`) marca `completed` y **recalcula balance** `currentBalance ± amount` (`:728-736`) con read-then-write; `rejectTransactionWithMessage()` (`:765`).
**Estado:** Roto (integridad financiera).
**Problemas:**
- `:713-736` — **read-then-write no atómico** del balance: dos aprobaciones concurrentes → saldo inconsistente.
- **No verifica que la transacción no esté ya aprobada** (`:700`) → doble aprobación = doble crédito.
- `currentBalance = userData.balance || 0` (`:713`) sin validar tipo.
- Todo el panel opera sobre **RTDB público** sin auth.
**Mejoras:** `runTransaction`; idempotencia por estado; validación server-side; auditoría.
**Riesgos:** creación/pérdida de dinero; manipulación.

### Flujo: Disputas
**Cómo funciona hoy:** `admin-disputes.js` lista `disputes`, chat con partes, evidencias, resolución.
**Estado:** OK parcial (con evidencia ya escapada). **Problemas:** mismo acceso sin gate; acciones sin auditoría; evidencias por URL con handlers delegados (ya corregido). **Riesgos:** resolución no trazable.

### Flujo: Métricas y export
**Cómo funciona hoy:** Chart.js + `loadDashboardData`; export CSV/Excel (`admin.html:1436-1439`).
**Estado:** OK. **Problemas:** sin paginación; consultas globales a RTDB público.

---

## 6. Problemas transversales (todos los flujos)

1. **Toda la lógica sensible vive en el cliente** (saldo, cobros, escrow, aprobaciones). El "servidor" solo confirma lo que el cliente propuso.
2. **RTDB público** (lectura/escritura/borrado sin auth) — verificado en fase anterior.
3. **Cero `runTransaction`** en todo el proyecto → ninguna operación financiera es atómica.
4. **Identidad desde localStorage**, manipulable, en billetera/chat/perfil.
5. **API keys en el cliente** (Gemini ya; Bold key en `config.local.js`).
6. **Código muerto** (Bold serverless no cableado; `auth.js`/`script-auth.js`; `autoApproveSmall` nunca usado).
7. **Fugas de listeners** de Firebase al navegar.
8. **IDs por `Date.now()`** → colisiones.
9. **Base64 de imágenes en la BD** (perfiles y comprobantes).
10. **Números/reglas de negocio hardcodeados** (Nequi destino, comisión 390/100, ventana 5 min).

## 7. Priorización recomendada

| Prioridad | Acción |
|---|---|
| P0 | Gate de admin real + reglas de Firebase con auth |
| P0 | Mover lógica financiera a backend con `runTransaction` (saldo, cobros, escrow, aprobaciones) |
| P0 | Rotar/keys a servidor: Gemini, Bold |
| P1 | Identidad verificada (token) en todas las operaciones sensibles |
| P1 | Idempotencia en recargas, retiros, aprobaciones y propinas |
| P1 | Reservar fondos al solicitar retiro |
| P2 | Imágenes a Storage; clustering de mapa; limpieza de listeners |
| P2 | Unificar auth; retirar código muerto; comisión explícita y auditada |

---

## 12. Chat cliente/proveedor — verificación end-to-end (2026-09-13, post-reparación)

**Método:** harness Puppeteer real contra localhost:3000 + RTDB real (chatId real, usuario inyectado). Flujos probados enviando/recibiendo de verdad y midiendo saldos antes/después.

### Flujos verificados como FUNCIONANDO
| Flujo | Resultado | Evidencia |
|---|---|---|
| Carga de chat (cliente) | OK | 84 métodos, listeners en sendBtn/messageInput/tipBtn/sendTipBtn/quickActions/requestBtn/reportBtn |
| Carga de chat (proveedor) | OK | 81 métodos, listeners correctos |
| Enviar mensaje (cliente→proveedor) | OK | Persiste en `chats/{id}/messages`, render en DOM, tiempo real 2→3 |
| Realtime bidireccional | OK | Proveedor recibe mensaje del cliente y viceversa |
| Cobro por mensaje (390) | OK | Saldo −390; contabilidad 390 = 100 (proveedor) + 290 (plataforma) |
| Propina (tip) | OK | Cliente −500 / proveedor +500 |
| Solicitud de servicio (cliente) | OK | Tarjeta con título/descripción/presupuesto |
| Oferta de servicio (proveedor) | OK | Tarjeta 'oferta enviada'/'de encuentro' según lado |
| Escrow: aceptar oferta | OK | Cliente −75000 retenido |
| Escrow: confirmación proveedor | OK | Fondos siguen retenidos |
| Escrow: confirmación cliente → liberar | OK | Proveedor +75000, orden `completed` |
| Idempotencia (mismo opId x3) | OK | 1 solo cobro, 2 respuestas `idempotent:true` |
| Concurrencia (10 cobros, fondos justos) | OK | Todos aplicados, saldo exacto, sin race |
| Anti-sobregiro (10 cobros, 2500 saldo) | OK | Solo 2 exitosos, 8 rechazados, saldo 500 |

### Bugs corregidos en esta sesión
1. **Burbujas vacías** en service_request/service_offer (payloads sin campo message) → añadido texto legible + renderizadores dedicados por lado.
2. **pplyDelta cobraba de menos / no commitaba** (caché local vacía en compat SDK v10) → **solución definitiva**: ctivateNode() con listener persistente + 	ransaction() (applyLocally por defecto).
3. **Race de doble gasto** introducido por un fallback read-then-write (`set`) → **eliminado**; ahora todo pasa por transacción atómica. Verificado con concurrencia y anti-sobregiro.

**Archivos clave:** irebase-money.js (`applyDelta`/`claimOp`/`activateNode`), chat-client.js, chat-provider.js.

