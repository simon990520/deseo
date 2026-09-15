# Informe de Auditoría — Proyecto "Deseo"

> Auditoría **read-only**. No se editó ni eliminó ningún archivo del proyecto.
> Fecha: 2026-09-13 · Ámbito: `D:\Desarrollos\deseo` (rama `master`)
> Alcance: seguridad, funcionalidad, desarrollo y optimización.
> Nota: durante la prueba de escritura se creó y eliminó inmediatamente una clave de prueba (`_security_audit_probe`) en la base de datos; quedó borrada (verificado: `null`).

---

## 1. Qué es el proyecto

**"Deseo"** es una **plataforma de micro-deseos** (versión 2.0, "Proyecto parcero"): usuarios publican "deseos" geolocalizados (comida, transporte, servicios, etc.) que otras personas pueden cumplir, con un **monedero (wallet)** interno, **pagos vía Bold** (pasarela colombiana), **chat** entre usuarios, **perfiles**, **panel de administración** con aprobación de transacciones/retiros, y un **asistente de IA** (Gemini).

### Arquitectura real
- **Frontend:** HTML + CSS + JavaScript *vanilla* estático (sin framework, sin bundler). Mapbox GL JS para el mapa. Sin `package.json`.
- **Backend de datos:** Firebase **Realtime Database** (`parcero-6b971`) + Firebase Auth + **Clerk** (autenticación, parcialmente).
- **Backend de pagos:** funciones serverless estilo Vercel en `server/api/bold/`.
- **Persistencia local de respaldo:** `localStorage` (usuarios, deseos, balance, transacciones).
- **Hosting:** GitHub Pages (`simon990520.github.io/deseo`) + Vercel para las funciones.
- `data.json` (~3 MB) es un **volcado de datos reales** (perfiles, usuarios, fotos base64) versionado en el repo.

---

## 2. RESUMEN EJECUTIVO

| Área | Estado | Severidad global |
|---|---|---|
| Seguridad | 🔴 Crítico | **Apto solo para entorno de pruebas. NO producción.** |
| Funcionalidad | 🟡 Parcial | Flujos principales presentes; abundante código duplicado/muerto |
| Desarrollo | 🟡 Aceptable | Sin build, sin tests, duplicación, deuda técnica |
| Optimización | 🟠 Mejorable | `data.json` de 3 MB, 29 usos de `innerHTML`, sin caché |

**Hallazgo más grave:** la base de datos Firebase está **abierta al público — lectura Y escritura — sin autenticación**. Cualquier persona en Internet puede leer TODOS los usuarios, transacciones, chats y perfiles, e incluso **modificar balances, aprobar retiros o borrar datos**. Verificado en vivo (HTTP 200 en lectura, escritura y borrado).

---

## 3. SEGURIDAD — Hallazgos

### 🔴 CRÍTICO

**S3.1 — Firebase Realtime Database totalmente pública (lectura + escritura + borrado)**
Verificado en vivo:
- `GET https://parcero-6b971-default-rtdb.firebaseio.com/.json?shallow=true` → **HTTP 200** con lista de nodos: `users, transactions, chats, disputes, notifications, admin_notifications, availableProfiles, encounterOrders`.
- `PUT .../_security_audit_probe.json` → **HTTP 200** (escritura anónima confirmada).
- `DELETE` de ese nodo → **HTTP 200** (borrado anónimo confirmado).

Impacto: exfiltración masiva de datos personales (correos, teléfonos/Nequi, fotos, ubicaciones), manipulación de **balances y transacciones**, aprobación fraudulenta de retiros, borrado de datos, suplantación. Es el riesgo #1 del proyecto.
**Archivos:** `config.js` (expone `databaseURL`), `wallet-inline.js`, `admin-dashboard.js`. Las reglas de seguridad del RTDB son `true` para `.read`/`.write`.

**S3.2 — Panel de administración sin autenticación**
`admin.html` carga `config.js` + `admin-dashboard.js` directamente, **sin login ni validación de rol**. Cualquiera que abra `admin.html` obtiene el panel que lee/escribe en la BD (aprobar retiros, ver usuarios, cambiar ajustes). No hay verificación de `isAdmin` en cliente ni servidor.
**Archivos:** `admin.html:1807-1810`, `admin-dashboard.js`.

**S3.3 — Secretos hardcodeados en código cliente**
Todos visibles para cualquiera que abra el sitio:
- `config.js:14` → **Mapbox token** `pk.eyJ1Ijoic2ltb245OTA1MjAi...`
- `config.js:96` → **Gemini API key** `AIzaSyCIwYtCIlFQMOZGEP3VqEhQ0kycBIFfBMc`
- `config.js:139` → **Bold API KEY** `H-HdPzurw8OPki3Fv8_WU-qFOAPQ9SarD_HV36Fp4_I`
- `config.js:178` → **Firebase apiKey** `AIzaSyCcM6jTBDMl_Ax3tAhbv7OAVaTSAnzFUXw`
- `server/api/bold/create-payment-link.js` → **fallback hardcodeado** de la misma `BOLD_API_KEY` (`process.env.BOLD_API_KEY || H-HdPzur...`)

Impacto: abuso de cuota (Gemini/Mapbox a tu costa), uso indebido de la integración Bold, y la clave Bold server-side queda comprometida al estar también en cliente.

### 🟠 ALTO

**S3.4 — Endpoints de pago confían en datos del cliente**
`server/api/bold/create-payment-link.js` acepta `amount`, `orderId` y `callbackUrl` enviados por el cliente, con única validación `amount >= 1000` COP. Permite **manipular montos**, inyectar `orderId` arbitrarios y **redirigir callbacks**.
**S3.5 — CORS reflejado (wildcard efectivo)**
`Access-Control-Allow-Origin: <origin del request>` en ambos endpoints Bold → cualquier dominio puede llamarlos desde el navegador. (`create-payment-link.js`, `integrity-signature.js`).
**S3.6 — Logs de datos sensibles**
`integrity-signature.js` registra en consola prefijos de la **Secret Key** y el cuerpo del request; `create-payment-link.js` loguea el body completo (incluye montos/IDs).
**S3.7 — Autenticación duplicada con fallback local inseguro**
Existen **dos** sistemas de auth en paralelo: `auth.js` (`DeseoAuth`) y `script-auth.js` (`AuthManager`), ambos con `signInWithEmailLocal`/`signUpWithEmailLocal` que guardan **contraseñas en texto plano** en `localStorage` (`script-auth.js:271` comentario *"debería estar hasheado"*). Si Firebase falla, la app degrada a este modo local.
**S3.8 — Sin `.gitignore` en la raíz**
No existe `.gitignore`; `data.json` (3 MB con datos personales y fotos) y configs quedan versionados/expuestos. Riesgo de subir secretos y datos reales.

### 🟡 MEDIO

**S3.9 — XSS potencial por `innerHTML` con datos de usuario**
29 usos en `script-mapbox.js`, 14 en `chat-client.js`, 13 en `chat-provider.js`, 10 en admin, etc. Wishes, chats y perfiles se insertan vía `innerHTML`/`.setHTML(...)` sin sanitizar (ej. popups del mapa en `wishes.js`, render de chats). Combinado con la BD pública y escritura anónima, es un vector XSS directo.
**S3.10 — Datos personales ubicuos**
Correos, teléfonos/Nequi, fotos (base64) y geolocalización se almacenan en la BD pública y se renderizan en cliente. Sin cifrado ni control de acceso.
**S3.11 — Uso de Clerk sin verificación server-side**
`config.js` habilita Clerk (`pk_test_...`) pero la autorización real depende de la BD abierta; Clerk no protege los recursos.

### 🟢 BAJO / INFORMATIVO
- `VERCEL_BYPASS_TOKEN` vacío (bien), pero la lógica que lo soporta existe.
- Comentarios con API keys de ejemplo en `.md` (no secretos reales, pero confusos).
- `console.log` verbosos con detalles de config en producción (`config.js` imprime `apiKey`, `databaseURL`, etc.).

---

## 4. FUNCIONALIDAD

### Flujos identificados
1. **Autenticación:** Firebase Auth o Clerk; fallback local (`localStorage`). Eventos `authStateChanged` custom.
2. **Deseos:** crear/editar/borrar, geolocalización, mapa con markers por categoría, filtros (categoría, precio, búsqueda). `wishes.js` + `script-mapbox.js`.
3. **Wallet:** balance, ingresos (con comprobante Nequi), retiros (aprobación admin). `wallet-inline.js`.
4. **Pagos Bold:** `create-payment-link` + `integrity-signature` (firma SHA256 `{orderId}{amount}{currency}{secretKey}`).
5. **Chat:** dos implementaciones (`chat-client.js` 2097 líneas, `chat-provider.js` 1807) + `chats.js`.
6. **Admin:** dashboard con métricas, gráficos (Chart.js), gestión de transacciones/usuarios/disputas, ajustes del sistema.

### Problemas funcionales
- **Duplicación masiva:** dos auth (`auth.js`/`script-auth.js`), dos/ tres módulos de chat, lógica de wallet duplicada (inline + manager). Riesgo de comportamientos divergentes e inconsistencias.
- **Fallback silencioso a `localStorage`** cuando falla Firebase → datos inconsistentes entre usuarios/dispositivos.
- **Consistencia financiera débil:** balance/transacciones viven en la BD pública; el "modo local" y el real pueden desincronizar. Retiros dependen de aprobación admin sin trazabilidad robusta.
- **Config placeholder/real mezclada:** hay `databaseURL` de prueba (`samplep-d6b68`) y real (`parcero-6b971`) con lógica condicional confusa.
- **`data.json` de 3 MB** parece un respaldo volcado, no una fuente viva → confusión sobre la fuente de verdad.

---

## 5. DESARROLLO

- **Stack sin tooling:** no hay `package.json`, ni bundler, ni linting, ni tests, ni CI. Todo es script plano.
- **Sin control de versiones limpio:** datos reales y fotos versionados.
- **Deuda técnica alta:** código muerto, comentarios "TODO"/"en producción esto debería...", logs de debug permanentes, duplicación.
- **Acoplamiento global:** todo cuelga de `window.*` (`window.CONFIG`, `window.deseoApp`, `window.firebaseDB`...), difícil de testear.
- **Inconsistencia de configuración:** versiones de Firebase (compat 10.7.1), mezcla de Clerk + Firebase + auth local.
- **Documentación:** hay varios `.md` de setup (FIREBASE_*, MAPBOX_*, SETUP_INSTRUCTIONS) útiles, pero desactualizados respecto al código.

---

## 6. OPTIMIZACIÓN

- **`data.json` (≈3 MB)** en el repo y posiblemente cargado por HTTP: penaliza repo y rendimiento.
- **Fotos base64** en la BD/localStorage: infla respuestas y memoria; debería usar Firebase Storage con URLs.
- **29+ `innerHTML`** y re-renders completos de listas (renderizan todo el listado al menor cambio) → fugas de rendimiento; usar `DocumentFragment`/delegación.
- **Listeners de Firebase** con lógica de limpieza manual (`cleanupFirebaseListeners`) — propenso a fugas si falla.
- **Logs `console.log` masivos** en caliente (npm-style debug) → coste en móvil.
- **Sin caché/versionado real**: `config.js?v=3.0&t=2024-01-15` es un parche manual.
- **Sin code-splitting**: `script-mapbox.js` (4981 líneas) carga entero aunque no se use el mapa.
- **Assets por CDN sin `defer`/`async`** en varios `<script>` → bloqueo de render.

---

## 7. RECOMENDACIONES PRIORIZADAS

### Inmediato (bloqueante para producción)
1. **Cerrar Firebase:** reglas RTDB con autenticación obligatoria por rol (`users/$uid` solo su dueño; `transactions`/`admin_*` solo admin; `.read/.write: false` por defecto). Esto es lo primero, hoy.
2. **Proteger `admin.html`:** exigir sesión con claim `admin` (Custom Claims de Firebase) validada en servidor; nunca confiar en cliente.
3. **Rotar TODOS los secretos expuestos** (Mapbox, Gemini, Bold API key, Firebase) y **sacarlos del cliente**. Las llamadas a Gemini/Bold deben pasar por tu backend.
4. **Validad montos en servidor:** `amount`/`orderId` derivados de la orden real en BD, nunca del cliente. Restringir `callbackUrl` a una lista blanca.
5. **CORS con allowlist** de dominios propios, y eliminar logs de datos sensibles.

### Corto plazo
6. Añadir `.gitignore` y **sacar `data.json` y fotos del repo**; migrar imágenes a Storage.
7. Unificar auth (una sola implementación) y **eliminar el login local con contraseñas en texto plano**; hashear si se mantiene.
8. Sanitizar todo `innerHTML` (DOMPurify o `textContent`).

### Medio plazo
9. Introducir `package.json` + bundler (Vite), lint, tests y CI básico.
10. Unificar/eliminar módulos duplicados (chat, wallet).
11. Optimizar render (fragmentos, delegación) y lazy-load del mapa.

---

## 8. CONCLUSIÓN

El proyecto **funciona como prototipo/demo** y la arquitectura de producto está clara, pero **está lejos de ser seguro para producción**. La combinación de **(a) base de datos pública con escritura anónima + (b) panel admin sin login + (c) claves secretas en el cliente + (d) endpoints de pago que confían en el cliente** equivale a exponer el negocio financiero y los datos personales a cualquiera.

**Se recomienda tratar la base de datos y el admin como prioridad absoluta antes de cualquier uso real**, rotar secretos y revisar los flujos de pago.

---

### Anexo — archivos clave revisados
`config.js`, `auth.js`, `script-auth.js`, `wallet-inline.js`, `wishes.js`, `admin.html`, `admin-dashboard.js`, `server/api/bold/create-payment-link.js`, `server/api/bold/integrity-signature.js`, `data.json` (muestra), `index.html` (scripts), y recuentos de sinks en 15 módulos JS.

---

## 9. ESTADO DE REMEDIACI�N � FASE 1 (sin credenciales)

> Cambios aplicados sin romper dise�o ni funcionalidad. Ver _backup_audit/ para copias previas.

### 9.1 Secretos fuera del cliente
- Creado `config.local.js` (NO versionado) con los valores reales; `config.example.js` como plantilla versionada.
- `config.js` reescrito: lee de `window.DESEO_LOCAL_CONFIG` con fallbacks seguros; **sin secretos**.
- `<script src="config.local.js">` insertado **antes** de `config.js` en 9 HTML.
- `server/api/bold/create-payment-link.js` y `integrity-signature.js`: claves **solo** desde `process.env`; sin fallback hardcodeado; CORS restringido; monto validado (entero 1.000�5.000.000 COP); `callbackUrl` validada (https, sin open redirect); sin logs sensibles.
- **Eliminados** duplicados en ra�z `create-payment-link.js` / `integrity-signature.js` que a�n ten�an la clave Bold hardcodeada.
- **Clave Clerk de `index.html`**: ahora inyectada din�micamente desde `CONFIG.CLERK.publishableKey` (sin literal en HTML).
- Verificado: `git grep` no encuentra ninguno de los 4 secretos reales en archivos versionados.

### 9.2 XSS (`innerHTML`)
- Creado `security-utils.js`: `escapeHtml`, `escapeAttr`, `escapeInt`, `safeUrl` (bloquea `javascript:`/`data:`/`vbscript:`), `setText`.
- Escapados los **sinks reales de datos de usuario** en 13 m�dulos (script-mapbox, wishes, chat-client, chat-provider, chats, wallet-inline, script-profile-complete, admin-dashboard, script, admin-disputes, app, auth, script-auth).
- `admin-disputes.js`: reemplazado `onclick` inline por **handler delegado** + `data-evidence-url` (evita inyecci�n por JS inline).
- Verificado en DOM real (jsdom): `<img src=x onerror=alert(1)>` ? entidades inofensivas; `javascript:` ? `""`.

### 9.3 Credenciales locales
- `security-utils.js`: `hashPassword` (SHA-256+salt, formato `deseo\\\`), `verifyPassword` (migraci�n transparente desde texto plano), `isHashed`.
- `auth.js` / `script-auth.js` endurecidos (almacenan hash; verifican legacy y migran). *Ambos son c�digo muerto; el login vivo est� en `script-mapbox.js` (Clerk/Firebase).*

### 9.4 Ruido de logs
- Creado `log-utils.js` cargado **despu�s** de `config.js`: silencia `console.log/debug/info` salvo `CONFIG.DEBUG.enabled`; `warn`/`error` se mantienen. Reactivable en consola con `window.deseoEnableLogs(true)`.

### 9.5 Duplicados y bugs latentes corregidos
- `script-mapbox.js`: eliminada 2� `getCategoryName` (sombraba la completa) y bloque muerto de carrusel de fotos mal pegado en `showAuthModal` (referenciaba `displayProfile` inexistente).
- `chat-client.js`: eliminada `showError`/`sendTip`/`handleQuickAction` duplicadas (la 2� sombreaba y **romp�a** las acciones r�pidas tip/request/favorite/report/urgent/rate). Qued� una sola de cada, la completa.
- `chat-provider.js`: eliminada `sendSpecialMessage` duplicada; renombrada la 2� `handleQuickAction` a `handleChatMenuAction` (restaura las acciones r�pidas del proveedor).
- `server/api/bold/create-payment-link.js`: eliminada variable sin uso.

### 9.6 Tooling
- A�adidos `.gitignore`, `package.json` (scripts), `.eslintrc.js`.
- `npx eslint .` ? **0 errores** (41 warnings cosm�ticos: vars sin usar / bloques vac�os).
- Todos los `*.js` pasan `node --check`.

### 9.7 PENDIENTE (requiere credenciales / decisi�n del usuario)
- **Rotar** los 4 secretos expuestos (Mapbox, Gemini, Bold, Firebase).
- **Reglas de Firebase** + Cloud Functions: requieren plan Blaze + `firebase login`. **No aplicar reglas estrictas todav�a**: la app NO autentica contra Firebase, as� que reglas "correctas" = app rota. Requiere refactor de auth primero.
- Refactor de unicaci�n de auth (`script-mapbox.js` como �nica fuente).
- Migrar im�genes de `data.json` a Storage.
