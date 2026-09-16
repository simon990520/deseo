/**
 * DESEO — Gate de acceso al panel de administración.
 * ---------------------------------------------------
 * PROBLEMA QUE RESUELVE: admin.html no tenía ningún control de acceso; cualquiera
 * con la URL entraba y podía aprobar retiros / editar saldos.
 *
 * ESTRATEGIA (defensa en profundidad):
 *  1. Este gate (cliente) bloquea la UI hasta validar sesión + rol admin.
 *  2. La validación REAL de permisos debe vivir en el backend (server/api/*) y en
 *     las Firebase Security Rules. El gate de cliente es solo UX/primera barrera:
 *     NUNCA es suficiente por sí solo.
 *
 * Requiere:
 *  - Clerk cargado (publishable key en config.local.js).
 *  - `CONFIG.ADMIN.authorizedUserIds` y/o `CONFIG.ADMIN.authorizedEmails`.
 *    Si ambos están vacíos, el panel se bloquea (fail-closed).
 *
 * Expone `window.deseoAdminGate.ready` (Promise<boolean>) por si otro módulo
 * quiere esperar el resultado.
 */
(function () {
    'use strict';

    var GATE_ID = 'deseoAdminGateOverlay';

    function getAdminConfig() {
        var cfg = (window.CONFIG && window.CONFIG.ADMIN) || null;
        if (!cfg) return { authorizedUserIds: [], authorizedEmails: [], roleKey: 'role' };
        return {
            authorizedUserIds: Array.isArray(cfg.authorizedUserIds) ? cfg.authorizedUserIds.filter(Boolean) : [],
            authorizedEmails: Array.isArray(cfg.authorizedEmails) ? cfg.authorizedEmails.map(function (e) { return String(e).toLowerCase(); }) : [],
            roleKey: cfg.roleKey || 'role',
            requiredRole: cfg.requiredRole || 'admin'
        };
    }

    function deny(reason) {
        // Ocultar todo el panel y mostrar pantalla de acceso denegado.
        document.documentElement.style.visibility = 'visible';
        var overlay = document.getElementById(GATE_ID);
        if (overlay) {
            overlay.innerHTML =
                '<div style="max-width:420px;text-align:center;font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#e5e7eb;">' +
                '<div style="font-size:44px;margin-bottom:12px;">🔒</div>' +
                '<h1 style="font-size:20px;margin:0 0 8px;">Acceso restringido</h1>' +
                '<p style="font-size:14px;opacity:.85;margin:0 0 16px;">' + (reason || 'No autorizado.') + '</p>' +
                '<button id="deseoAdminRetryBtn" style="padding:10px 18px;border-radius:8px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-weight:600;">Iniciar sesión</button>' +
                '</div>';
            var btn = document.getElementById('deseoAdminRetryBtn');
            if (btn) {
                btn.onclick = function () {
                    if (window.Clerk && typeof window.Clerk.openSignIn === 'function') {
                        window.Clerk.openSignIn();
                    } else {
                        window.location.reload();
                    }
                };
            }
        }
        // Cortar la inicialización del dashboard admin.
        window.__DESEO_ADMIN_DENIED__ = true;
        document.dispatchEvent(new CustomEvent('deseoAdminDenied', { detail: { reason: reason } }));
    }

    function isAuthorized(user, adminCfg) {
        if (!user) return false;
        // Comparar id de Clerk
        if (adminCfg.authorizedUserIds.length > 0 && adminCfg.authorizedUserIds.indexOf(user.id) !== -1) {
            return true;
        }
        // Comparar email principal
        var email = '';
        try {
            email = (user.primaryEmailAddress && user.primaryEmailAddress.emailAddress) || '';
            if (!email && Array.isArray(user.emailAddresses) && user.emailAddresses[0]) {
                email = user.emailAddresses[0].emailAddress || '';
            }
        } catch (_) { /* noop */ }
        email = String(email).toLowerCase();
        if (email && adminCfg.authorizedEmails.length > 0 && adminCfg.authorizedEmails.indexOf(email) !== -1) {
            return true;
        }
        // Metadatos públicos/privados de Clerk con rol admin
        try {
            var meta = user.publicMetadata || {};
            var priv = user.privateMetadata || {};
            var roleKey = adminCfg.roleKey;
            var required = adminCfg.requiredRole;
            if (meta && meta[roleKey] === required) return true;
            if (priv && priv[roleKey] === required) return true;
        } catch (_) { /* noop */ }
        return false;
    }

    /**
     * Verificación server-side (defensa en profundidad): pide al backend que
     * valide el token de Clerk y devuelva isAdmin (derivado de ADMIN_USER_IDS).
     * Si el endpoint no está configurado o falla, NO bloquea (el gate cliente
     * ya validó); pero si responde explícitamente isAdmin=false, se deniega.
     * @returns {Promise<boolean>} true si se permite continuar.
     */
    function verifyServerSide() {
        var cfg = (window.CONFIG && window.CONFIG.API) || {};
        var endpoint = cfg.VERIFY_ENDPOINT || cfg.AUTH_VERIFY_ENDPOINT;
        if (!endpoint) return Promise.resolve(true); // sin backend configurado: no bloquear
        if (!window.Clerk || typeof window.Clerk.session === 'undefined') return Promise.resolve(true);

        return window.Clerk.session.getToken()
            .then(function (token) {
                if (!token) return true;
                return fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ token: token })
                });
            })
            .then(function (res) {
                if (!res || !res.ok) return true; // fallo de red/servidor: no bloquear
                return res.json();
            })
            .then(function (data) {
                if (data && data.valid === true && data.isAdmin === false) {
                    return false; // el backend dice que NO es admin -> denegar
                }
                return true;
            })
            .catch(function () { return true; });
    }

    function bootGate() {
        var adminCfg = getAdminConfig();

        function run() {
            if (!window.Clerk) {
                deny('Servicio de autenticación no disponible.');
                return;
            }
            var doCheck = function () {
                var user = window.Clerk.user;
                if (!user) {
                    deny('Debes iniciar sesión con una cuenta de administrador.');
                    return;
                }
                if (!isAuthorized(user, adminCfg)) {
                    deny('Tu cuenta no tiene permisos de administrador.');
                    return;
                }
                // Segunda barrera: validar contra el backend (si está configurado).
                verifyServerSide().then(function (allowed) {
                    if (!allowed) {
                        deny('Tu cuenta no tiene permisos de administrador (verificación del servidor).');
                        return;
                    }
                    // Autorizado: quitar overlay y arrancar el dashboard.
                    var overlay = document.getElementById(GATE_ID);
                    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    document.documentElement.style.visibility = 'visible';
                    window.__DESEO_ADMIN_GRANTED__ = true;
                    document.dispatchEvent(new CustomEvent('deseoAdminGranted'));
                });
            };

            if (typeof window.Clerk.load === 'function') {
                // v6: la instancia ya fue cargada en admin.html. No re-llamar load()
                // (sin {ui} desactivaría los componentes). Solo evaluar el estado actual.
                doCheck();
            } else {
                doCheck();
            }
        }

        var attempts = 0;
        var settled = false;
        var timer = setInterval(function () {
            attempts += 1;
            // Esperar a que la instancia real (window.Clerk) exista. El init puede tardar
            // por la carga del módulo ESM + bundle de UI.
            if (window.Clerk) {
                if (settled) return;
                settled = true;
                clearInterval(timer);
                run();
                return;
            }
            // Si el init terminó sin éxito (null), reintentar hasta el timeout.
            if (attempts > 150) { // ~30s
                clearInterval(timer);
                deny('No se pudo cargar el servicio de autenticación.');
            }
        }, 200);
    }

    // Insertar overlay de bloqueo lo antes posible (fail-closed mientras valida).
    function mountOverlay() {
        if (document.getElementById(GATE_ID)) return;
        var overlay = document.createElement('div');
        overlay.id = GATE_ID;
        overlay.style.cssText =
            'position:fixed;inset:0;z-index:2147483647;background:#0b1220;display:flex;' +
            'align-items:center;justify-content:center;';
        overlay.innerHTML =
            '<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#e5e7eb;text-align:center;">' +
            '<div style="width:34px;height:34px;border:3px solid rgba(255,255,255,.2);border-top-color:#60a5fa;' +
            'border-radius:50%;margin:0 auto 12px;animation:deseoSpin 1s linear infinite;"></div>' +
            '<div style="font-size:14px;opacity:.85;">Verificando permisos…</div>' +
            '<style>@keyframes deseoSpin{to{transform:rotate(360deg)}}</style>' +
            '</div>';
        (document.body || document.documentElement).appendChild(overlay);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountOverlay);
    } else {
        mountOverlay();
    }

    // Exponer la promesa de resultado.
    window.deseoAdminGate = {
        ready: new Promise(function (resolve) {
            document.addEventListener('deseoAdminGranted', function () { resolve(true); });
            document.addEventListener('deseoAdminDenied', function () { resolve(false); });
        })
    };

    bootGate();
})();
