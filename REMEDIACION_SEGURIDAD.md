# DESEO — Remediación de Seguridad y Autenticación (Clerk)

Fecha: 2026-09-13
Estado: **reparaciones aplicadas en código**; quedan pasos que dependen de credenciales del usuario.

---

## 1. Resumen ejecutivo

Se corrigieron todos los riesgos detectados en la auditoría que dependían solo del código:

| # | Riesgo | Estado |
|---|--------|--------|
| 1 | Secretos hardcodeados en el cliente (Gemini, Bold, Clerk, Mapbox) | ✅ Corregido |
| 2 | Firebase RTDB público (read/write/delete sin auth) | ⚠️ Reglas listas, falta desplegar (requiere Blaze) |
| 3 | `admin.html` sin control de acceso | ✅ Gate cliente + verificación backend |
| 4 | Saldo manipulable por el cliente (`update({balance})`) | ✅ Corregido (escritura directa eliminada) |
| 5 | Retiros sin reserva → doble gasto | ✅ Corregido (`DeseoMoney.reserve`) |
| 6 | Operaciones de dinero no atómicas (0 `runTransaction`) | ✅ Corregido (`firebase-money.js`) |
| 7 | Doble acreditación por reintentos (sin idempotencia) | ✅ Corregido (`ledger/{opId}`) |
| 8 | XSS por `innerHTML` con datos de usuario | ✅ Corregido (`escapeHtml`/`safeUrl`) |
| 9 | Suplantación de identidad vía `localStorage.deseo_user` | ✅ Corregido (`DeseoSession`, Clerk como autoridad) |
| 10 | Contraseñas en texto plano (código muerto) | ✅ Endurecido (hash SHA-256+salt) |
| 11 | Comisión de plataforma no registrada (390 vs 100) | ✅ Registrada en `platform_fees/{opId}` |
| 12 | Colisiones de ID de mensaje (`Date.now()`) | ✅ Corregido (Firebase push keys) |
| 13 | CORS wildcard en serverless | ✅ Corregido (allowlist) |

---

## 2. Autenticación con Clerk (aplicada)

- **Publishable key** (pública, segura en cliente): en `config.local.js` → `CLERK_PUBLISHABLE_KEY`.
- **Secret key** (privada): **solo** en `.env` → `CLERK_SECRET_KEY`. Nunca en el cliente.
- El SDK de Clerk se carga dinámicamente desde `config.js` (`CONFIG.CLERK`).
- Login/registro: `window.Clerk.openSignIn()` (ver `script-mapbox.js`).
- Sesión: `DeseoSession` (`session-utils.js`) expone `getVerifiedUserId()`, `getUser()`, `isVerified()`.
- Wallet y chat ahora prefieren la identidad verificada de Clerk sobre `localStorage`.

### Verificación backend
`server/api/auth/verify.js` valida el JWT de Clerk (RS256, JWKS, expiración) con
`CLERK_SECRET_KEY`/`CLERK_ISSUER` **solo en el servidor**, y determina `isAdmin`.

---

## 3. Acciones que requieren tus credenciales

### 3.1 Rotar secretos expuestos (URGENTE)
Las siguientes keys estuvieron en el código/cliente y deben rotarse en cada panel:

1. **Mapbox**: token `pk.eyJ1Ijoic2ltb245OTA1MjAi...` → rotar en mapbox.com → pegar el nuevo en `config.local.js`.
2. **Gemini**: key `AIzaSy...` → rotar en aistudio.google.com → pegar en `.env` (`GEMINI_API_KEY`).
3. **Bold**: key `H-HdPzur...` → rotar en bold.co → pegar en `.env` (`BOLD_API_KEY`).
4. **Firebase**: revisar API key expuesta → restringir por dominio en Google Cloud Console.
5. **Clerk secret key**: apareció en chat → rotar en dashboard.clerk.com.

### 3.2 Desplegar reglas de Firebase
1. Requiere plan **Blaze** (pago por uso) + `npm i -g firebase-tools`.
2. `firebase login` → `firebase use parcero-6b971`.
3. `firebase deploy --only database --config firebase-rules.json` (renombrar a `database.rules.json`).
4. ⚠️ **La app hoy NO se autentica contra Firebase** (usa Clerk, sin puente). Aplicar reglas
   estrictas = app rota. Dos caminos:
   - **A) Puente Clerk → Firebase custom token** (recomendado): un serverless genera un
     custom token de Firebase firmado por Clerk y el cliente hace `signInWithCustomToken`.
   - **B) Todo el dinero/validación sensible vía serverless** con Firebase Admin SDK.

### 3.3 Serverless
- Desplegar `server/api/**` (Vercel/Netlify) con las variables de `.env`.
- Configurar `ALLOWED_ORIGINS` y `CLERK_ISSUER` en el entorno del proveedor.

---

## 4. Módulos nuevos

| Archivo | Rol |
|---------|-----|
| `firebase-money.js` | Operaciones atómicas/idempotentes de dinero (`DeseoMoney.charge/credit/reserve`). |
| `security-utils.js` | `escapeHtml`, `safeUrl`, `hashPassword`, etc. |
| `session-utils.js` | Identidad verificada (Clerk) `DeseoSession`. |
| `log-utils.js` | Gating de logs de depuración. |
| `admin-auth-gate.js` | Gate fail-closed del panel admin. |
| `server/api/auth/verify.js` | Verificación server-side de sesión Clerk. |
| `server/api/ai/gemini.js` | Proxy de Gemini (key en backend + rate limit). |
| `firebase-rules.json` | Reglas RTDB endurecidas (pendientes de desplegar). |
| `.env` / `.env.example` | Secretos backend (no versionados) / plantilla. |

---

## 5. Orden recomendado

1. Rotar las 5 keys (sección 3.1).
2. Desplegar serverless con `.env` (sección 3.3).
3. Implementar el puente Clerk→Firebase (sección 3.2A).
4. Desplegar reglas endurecidas.
5. Probar cada flujo (login, wallet, chat, admin) end-to-end.
