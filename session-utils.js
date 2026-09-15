/**
 * DESEO — Helper de identidad/sesión.
 * ------------------------------------------------------------------
 * PROBLEMA QUE RESUELVE: la app tomaba el `id` de usuario directamente de
 * `localStorage.deseo_user`, que el usuario puede editar para actuar como otra
 * persona (suplantación) en billetera, chat y perfil.
 *
 * ESTRATEGIA:
 *  - Preferir SIEMPRE la identidad de Clerk (`window.Clerk.user.id`), que es la
 *    fuente de verdad autenticada.
 *  - `localStorage` queda solo como caché de conveniencia, NO como autoridad.
 *  - `getVerifiedUserId()` devuelve el id de Clerk si hay sesión; si no, cae a la
 *    caché (compatibilidad) pero marca `verified: false` para que las operaciones
 *    sensibles puedan exigir verificación.
 *
 * NOTA: la verificación criptográfica del token debe hacerse en el backend.
 * Aquí solo evitamos que el `id` manipulable sea la autoridad principal.
 */
(function () {
    'use strict';

    function cacheUser() {
        try { return JSON.parse(localStorage.getItem('deseo_user') || 'null'); } catch (_) { return null; }
    }

    function clerkUser() {
        try { return (window.Clerk && window.Clerk.user) || null; } catch (_) { return null; }
    }

    var Session = {
        /** Id de usuario verificado (Clerk primero). */
        getVerifiedUserId: function () {
            var c = clerkUser();
            if (c && c.id) return c.id;
            return null;
        },

        /** Id de usuario best-effort (Clerk o caché). Úsalo solo para UI no sensible. */
        getUserId: function () {
            var v = this.getVerifiedUserId();
            if (v) return v;
            var u = cacheUser();
            return u ? (u.id || u.uid || null) : null;
        },

        /** Objeto de usuario normalizado. */
        getUser: function () {
            var c = clerkUser();
            if (c && c.id) {
                var email = '';
                try {
                    email = (c.primaryEmailAddress && c.primaryEmailAddress.emailAddress) || '';
                } catch (_) { /* noop */ }
                return { id: c.id, name: c.fullName || c.username || email, email: email, verified: true };
            }
            var u = cacheUser();
            if (u) return Object.assign({}, u, { verified: false });
            return null;
        },

        /** ¿Hay sesión verificada por Clerk? */
        isVerified: function () {
            return !!this.getVerifiedUserId();
        },

        /** Exige sesión verificada; lanza si no la hay (para operaciones sensibles). */
        requireVerifiedUserId: function () {
            var id = this.getVerifiedUserId();
            if (!id) throw new Error('Se requiere sesión verificada.');
            return id;
        }
    };

    if (typeof window !== 'undefined') {
        window.DeseoSession = Session;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Session;
    }
})();
