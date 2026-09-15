/**
 * DESEO — Utilidades de seguridad del cliente.
 * Expone helpers globales para escapar contenido antes de insertarlo en
 * innerHTML, evitando XSS con datos de usuario (nombres, mensajes, etc.).
 *
 * Uso:
 *   el.innerHTML = `<span>${escapeHtml(user.name)}</span>`;
 */
(function () {
    'use strict';

    var ENTITY_MAP = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;',
        '=': '&#61;'
    };

    /**
     * Escapa una cadena para inserción segura en HTML (texto o atributo entre comillas).
     * @param {*} value
     * @returns {string}
     */
    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"'`=]/g, function (ch) {
            return ENTITY_MAP[ch];
        });
    }

    /** Escapa para usar dentro de un atributo (comillas). */
    function escapeAttr(value) {
        return escapeHtml(value);
    }

    /**
     * Devuelve una URL segura: solo http(s), mailto, tel, data:image/*, o rutas relativas.
     * Bloquea javascript:, vbscript: y data: peligrosos (p. ej. data:text/html con scripts).
     * Permite data:image/* porque las fotos de perfil/wishes se guardan en base64.
     */
    function safeUrl(url) {
        if (!url) return '';
        var s = String(url).trim();
        // Siempre bloquear esquemas ejecutables.
        if (/^(javascript|vbscript):/i.test(s)) return '';
        // Permitir data: solo para imágenes raster seguras (las fotos se guardan en base64).
        // NO se permite svg+xml (puede contener <script> = XSS).
        if (/^data:/i.test(s)) {
            return /^data:image\/(png|jpe?g|gif|webp|bmp|avif);/i.test(s) ? s : '';
        }
        if (/^(https?:|mailto:|tel:|\/|\.\/|\.\.\/|#|\?)/i.test(s)) {
            return s;
        }
        return '';
    }

    /**
     * Devuelve un entero seguro (para precios, montos, ids numéricos).
     */
    function escapeInt(value, fallback) {
        var n = parseInt(value, 10);
        return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
    }

    /**
     * Crea un elemento con texto seguro (alternativa recomendada a innerHTML).
     */
    function setText(el, text) {
        if (el) el.textContent = text === null || text === undefined ? '' : String(text);
        return el;
    }

    var SALT_PREFIX = 'deseo$v1$';

    function bufToHex(buf) {
        var bytes = new Uint8Array(buf);
        var out = '';
        for (var i = 0; i < bytes.length; i++) {
            out += bytes[i].toString(16).padStart(2, '0');
        }
        return out;
    }

    /**
     * Genera un salt aleatorio (hex).
     */
    function generateSalt() {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            var arr = new Uint8Array(16);
            crypto.getRandomValues(arr);
            return bufToHex(arr.buffer);
        }
        // Fallback débil (no criptográfico) — sólo si no hay WebCrypto.
        return Date.now().toString(16) + Math.random().toString(16).slice(2);
    }

    /**
     * Hashea una contraseña con SHA-256 + salt (formato: deseoSv1S$salt$hash).
     * Devuelve una Promesa<string>.
     */
    function hashPassword(password, salt) {
        var s = salt || generateSalt();
        var input = s + '::' + String(password);
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)).then(function (buf) {
                return SALT_PREFIX + s + '$' + bufToHex(buf);
            });
        }
        // Fallback: NO usar en producción. Aún así no almacena texto plano.
        var h = 0;
        for (var i = 0; i < input.length; i++) {
            h = ((h << 5) - h + input.charCodeAt(i)) | 0;
        }
        return Promise.resolve(SALT_PREFIX + s + '$' + ('00000000' + (h >>> 0).toString(16)).slice(-8));
    }

    /**
     * Verifica una contraseña contra un hash almacenado.
     * Devuelve Promesa<boolean>.
     */
    function verifyPassword(password, stored) {
        if (!stored) return Promise.resolve(false);
        var str = String(stored);
        if (str.indexOf(SALT_PREFIX) !== 0) {
            // Formato legado (texto plano): comparación directa para migración.
            return Promise.resolve(str === String(password));
        }
        var rest = str.slice(SALT_PREFIX.length);
        var sep = rest.indexOf('$');
        if (sep < 0) return Promise.resolve(false);
        var salt = rest.slice(0, sep);
        return hashPassword(password, salt).then(function (recomputed) {
            return recomputed === str;
        });
    }

    /** ¿El hash está en formato seguro (no texto plano)? */
    function isHashed(stored) {
        return typeof stored === 'string' && stored.indexOf(SALT_PREFIX) === 0;
    }

    var api = {
        escapeHtml: escapeHtml,
        escapeAttr: escapeAttr,
        escapeInt: escapeInt,
        safeUrl: safeUrl,
        setText: setText,
        generateSalt: generateSalt,
        hashPassword: hashPassword,
        verifyPassword: verifyPassword,
        isHashed: isHashed
    };

    if (typeof window !== 'undefined') {
        window.escapeHtml = escapeHtml;
        window.escapeAttr = escapeAttr;
        window.escapeInt = escapeInt;
        window.safeUrl = safeUrl;
        window.setText = setText;
        window.hashPassword = hashPassword;
        window.verifyPassword = verifyPassword;
        window.isHashed = isHashed;
        window.DeseoSecurity = api;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
