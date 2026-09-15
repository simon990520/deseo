# Informe — Flujos de Billetera (Wallet) y Pagos

**Proyecto:** `D:\Desarrollos\deseo` · **Ámbito:** wallet + Bold · solo lectura · 2026-09-13

## 0. Contexto y mapa de archivos

| Pieza | Rol real |
|---|---|
| `wallet-inline.js` (1177) | **Toda** la lógica de billetera en cliente. Saldo, transacciones, microtransacciones, recarga Nequi, retiro. |
| `wallet.html` (226) | UI: tarjeta de saldo, tabs, modales Agregar/Retirar. Firebase compat 10.7.1 + wallet-inline.js. |
| `server/api/bold/create-payment-link.js` (96) | Serverless que crea link Bold. **No cableado al cliente** (código muerto). |
| `server/api/bold/integrity-signature.js` (61) | Serverless firma SHA256. **No cableado al cliente.** |
| `config.js` | `CONFIG.BOLD` con endpoints Vercel, WEBHOOK_URL, sandbox. |
| `config.local.js` | Contiene BOLD_API_KEY real en texto plano (riesgo). |
| `script-mapbox.js` (4922) | **No contiene lógica de wallet/pagos** (solo link de nav a wallet.html). |
| `admin-dashboard.js` | Aquí se aprueban transacciones y **se recalcula el balance** (líneas 692-745). |

**Conclusión estructural:** existe una implementación completa de Bold (link + firma) **desconectada** de la app. La recarga real es **manual por Nequi** (`wallet-inline.js`), NO Bold. Bold está como código muerto cableable.

## Flujo: Ver saldo
**Cómo funciona:** al cargar wallet.html, `initializeInlineWallet()` (:1191) instancia InlineWalletManager. `loadBalance()` (:185) lee `localStorage['deseo_user']` para userId. `database.ref('users/{userId}').once('value')` → `userData.balance` → parseFloat (:206). `renderBalance()` (:1160) escribe `this.balance.toFixed(2)`.
**Estado:** Deficiente.
**Problemas:**
- `wallet-inline.js:187-193` userId de localStorage → manipulable (ver saldo ajeno).
- `:196-199` si Firebase falla, saldo cae a 0 en silencio.
- `:206` parseFloat sin validar NaN/negativos.
- Saldo se lee de cliente; solo admin escribe/valida.
**Mejoras:** userId de token verificado; estado explícito sin conexión; validar Number.isFinite y >=0.
**Riesgos:** enumeración de saldos; saldo fantasma 0.

## Flujo: Recargar saldo (Nequi manual)
**Cómo funciona:** showAddMoneyModal (:1160) → showNequiInstructions(amount) (:625) dibuja HTML con Nequi 3146959639 (hardcodeado, :700) e input file (:711). handleNequiPayment(amount) (:780): valida login, comprobante ≤5MB, confirm(), base64 (fileToBase64 :829), crea transacción con amount del input, `status:'pending_verification'` (:840-856), inserta local + renderTransactions (:859), setTimeout 50ms → saveToFirebase (:1000) + notifyAdmin (:1046). Acreditación real SOLO al aprobar admin (`admin-dashboard.js:728-736`).
**Estado:** Deficiente.
**Problemas:**
- Monto confiado al cliente (:838); comprobante "a ojo" sin conciliación bancaria.
- **`saveToFirebase` (:999-1003) hace `userRef.update({balance:this.balance})` con valor local** — último-escribir-gana sobre el saldo real. Peligroso.
- `id: nequi_${Date.now()}_${random}` (:834) sin idempotencia → N solicitudes con mismo comprobante.
- Cero `runTransaction` en el proyecto.
- Comprobante base64 en BD pública (proofImage :843).
- notifyAdmin (:1046) no envía nada (notificación simulada).
- setTimeout con catch que borra local pero puede dejar inconsistencia parcial.
- Número Nequi destino visible en DevTools.
**Mejoras:** monto de orden server-side; runTransaction/increment atómico; Storage para comprobantes; idempotencia por hash; migrar a Bold con webhook firmado.
**Riesgos:** fraude financiero; sobrescritura de saldo; exposición de datos bancarios; race multi-pestaña.

## Flujo: Retiro
**Cómo funciona:** modal (wallet.html:159) campos monto/banco/cuenta/titular. handleWithdraw() (:1082) valida monto≥1000 (:1090), **amount > this.balance → error** (:1094), banco/cuenta/titular. Crea outcome/pending_verification/id Date.now() (:1117-1130). saveWithdrawalRequest → transactions/{userId}/{id}.set (:1147). **No descuenta saldo al solicitar**; se descuenta solo si admin aprueba (`admin-dashboard.js:728`).
**Estado:** Roto para seguridad.
**Problemas:**
- **No reserva/bloquea fondos al solicitar** → se pueden crear múltiples solicitudes con el mismo saldo (double-spend).
- Validación de saldo solo en cliente.
- `id: Date.now()` colisionable.
- No hay estado de "fondos retenidos".
**Mejoras:** reservar fondos atómicamente al solicitar; validar en servidor; ids únicos.
**Riesgos:** retiros múltiples del mismo saldo.

## Flujo: Bold (link + firma)
**Cómo funciona:** existen create-payment-link.js e integrity-signature.js serverless, pero **el cliente no los llama**. CONFIG.BOLD define endpoints Vercel no usados.
**Estado:** Código muerto (no cableado).
**Problemas:** funcionalidad de pago automático no integrada; recarga depende de aprobación manual.
**Mejoras:** cablear Bold con webhook firmado para acreditación automática.
**Riesgos:** el flujo manual es el cuello de botella y el punto de fraude.

## Flujo: Microtransacciones / historial
**Cómo funciona:** renderTransactions() pinta `transactions/{userId}` con escapeInt en montos (:576).
**Estado:** OK parcial.
**Problemas:** base64 de comprobantes en listados; sin paginación.
**Mejoras:** lazy-load + Storage.
**Riesgos:** rendimiento con historial grande.

## Hallazgos transversales
- **Cero `runTransaction`** en todo el proyecto → ninguna operación de saldo es atómica.
- Toda la lógica financiera vive en el cliente; el servidor solo "confirma" lo que el cliente propuso.
- `autoApproveSmall` se guarda pero **nunca se usa**.
- `config.local.js` con BOLD_API_KEY en texto plano (debe rotarse).
- La BD pública permite escribir balances directamente → se puede "inyectar" saldo sin pasar por la app.
