/**
 * CONFIGURACIÓN DE DESEO APP
 * Plataforma de micro-deseos
 * VERSIÓN 3.0 - Proyecto parcero
 *
 * IMPORTANTE (seguridad):
 * Este archivo NO contiene secretos. Los tokens/keys reales viven en
 * `config.local.js` (no versionado; ver config.example.js como plantilla).
 * Si falta `config.local.js`, la app arranca en modo degradado y avisa.
 */

(function () {
    'use strict';

    // Valores locales (config.local.js) si están disponibles.
    var LOCAL = (typeof window !== 'undefined' && window.DESEO_LOCAL_CONFIG) || {};

    var PLACEHOLDER_FIREBASE = {
        apiKey: 'TU_FIREBASE_API_KEY',
        authDomain: 'TU_PROYECTO.firebaseapp.com',
        databaseURL: 'https://TU_PROYECTO-default-rtdb.firebaseio.com',
        projectId: 'TU_PROYECTO',
        storageBucket: 'TU_PROYECTO.firebasestorage.app',
        messagingSenderId: 'TU_SENDER_ID',
        appId: 'TU_APP_ID',
        measurementId: 'TU_MEASUREMENT_ID'
    };

    var CONFIG = {
        // ===== MAPBOX =====
        MAPBOX_TOKEN: LOCAL.MAPBOX_TOKEN || 'TU_MAPBOX_TOKEN',

        MAP: {
            defaultCenter: [-3.7038, 40.4168],
            defaultZoom: 12,
            styles: {
                light: 'mapbox://styles/mapbox/light-v11',
                dark: 'mapbox://styles/mapbox/dark-v11',
                streets: 'mapbox://styles/mapbox/streets-v12',
                satellite: 'mapbox://styles/mapbox/satellite-v9',
                outdoors: 'mapbox://styles/mapbox/outdoors-v12'
            },
            defaultStyle: 'dark'
        },

        APP: {
            name: 'Deseo',
            version: '2.0.0',
            description: 'Plataforma de Micro-Deseos',
            notifications: {
                duration: 4000,
                position: 'top-right'
            },
            defaultFilters: {
                maxPrice: 1000,
                category: '',
                distance: 10
            }
        },

        CATEGORIES: {
            comida: { name: 'Comida', icon: 'fas fa-utensils', color: '#10b981', priceRange: [5, 25] },
            transporte: { name: 'Transporte', icon: 'fas fa-car', color: '#3b82f6', priceRange: [8, 30] },
            entretenimiento: { name: 'Entretenimiento', icon: 'fas fa-gamepad', color: '#8b5cf6', priceRange: [15, 50] },
            servicios: { name: 'Servicios', icon: 'fas fa-tools', color: '#f59e0b', priceRange: [10, 40] },
            compras: { name: 'Compras', icon: 'fas fa-shopping-bag', color: '#ef4444', priceRange: [10, 35] }
        },

        AI: {
            responseDelay: 1000,
            maxRetries: 3,
            GEMINI: {
                enabled: true,
                // SEGURIDAD: la key NO se expone al cliente. Se usa el proxy
                // serverless (server/api/ai/gemini.js) con GEMINI_API_KEY en env.
                apiKey: '',
                model: 'gemini-2.0-flash',
                proxyUrl: (LOCAL.AI_PROXY_URL || 'https://server-eo9ez6okm-koddio999s-projects.vercel.app/api/ai/gemini'),
                apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models'
            },
            KEYWORDS: {
                viajes: ['viaje', 'viajar', 'playa', 'montaña', 'hotel', 'vuelo', 'turismo', 'vacaciones', 'ruta', 'tour'],
                comida: ['comida', 'café', 'coffee', 'almuerzo', 'cena', 'desayuno', 'pizza', 'hamburguesa', 'restaurante', 'postre'],
                ocio: ['ocio', 'diversión', 'cine', 'película', 'leer', 'música', 'concierto', 'parque', 'paseo', 'juego'],
                trabajo: ['trabajo', 'freelance', 'proyecto', 'reunión', 'oficina', 'empleo', 'currículum', 'cv', 'entrevista', 'deadline'],
                amor: ['amor', 'cita', 'pareja', 'novia', 'novio', 'romántico', 'regalo', 'flores', 'detalles', 'san valentín'],
                transporte: ['transporte', 'uber', 'taxi', 'carro', 'coche', 'moto', 'bus', 'metro', 'traslado', 'llevar'],
                servicios: ['servicio', 'arreglar', 'reparar', 'limpieza', 'pasear perro', 'jardín', 'mudanza', 'clases', 'ayuda', 'cuidar'],
                compras: ['comprar', 'compra', 'tienda', 'supermercado', 'pedido', 'producto', 'envío', 'entrega', 'mercado', 'regalo']
            },
            EMOTIONAL_ANALYSIS: {
                positive: ['feliz', 'contento', 'alegre', 'emocionado', 'genial', 'perfecto', 'excelente', 'fantástico', 'increíble', 'maravilloso', 'bueno', 'bien', 'sí', 'claro', 'quiero', 'necesito', 'busco', 'deseo', 'me gusta', 'me encanta', 'me fascina', 'me interesa', 'me apetece', 'me gustaría'],
                negative: ['triste', 'deprimido', 'mal', 'terrible', 'horrible', 'fatal', 'pésimo', 'odio', 'detesto', 'no', 'nunca', 'jamás', 'imposible', 'difícil', 'complicado', 'problema', 'error', 'fallo', 'fracaso', 'decepción', 'frustración', 'ira', 'enojo', 'molesto', 'irritado', 'furioso', 'enojado', 'estresado', 'ansioso', 'preocupado', 'nervioso', 'tenso', 'agobiado', 'abrumado', 'cansado', 'agotado', 'exhausto', 'frustrado', 'decepcionado'],
                neutral: ['ok', 'vale', 'bien', 'entendido', 'claro', 'sí', 'no', 'tal vez', 'quizás', 'posiblemente', 'probablemente', 'seguramente', 'ciertamente', 'efectivamente', 'exactamente', 'precisamente', 'justamente', 'puede ser']
            },
            responses: {
                greetings: [
                    "¡Hola! Soy tu asistente de deseos. ¿En qué puedo ayudarte hoy?",
                    "¡Perfecto! Cuéntame qué necesitas y te ayudo a crear el deseo ideal.",
                    "¡Excelente! Vamos a crear un deseo que alguien pueda cumplir fácilmente."
                ],
                priceSuggestions: {
                    comida: "Para deseos de comida, sugiero entre $5-25 dependiendo de lo que necesites.",
                    servicios: "Para servicios, el precio típico es $10-40 según la complejidad.",
                    compras: "Para compras, considera $10-35 más el costo de los productos.",
                    transporte: "Para transporte, $8-30 es un rango justo según la distancia.",
                    entretenimiento: "Para entretenimiento, $15-50 es apropiado según la actividad."
                }
            }
        },

        // ===== BOLD =====
        // La API KEY NO se expone al cliente. El backend serverless la usa desde env.
        // Aquí solo queda el flag de entorno y los endpoints.
        BOLD: {
            ENVIRONMENT: 'sandbox',
            CURRENCY: 'COP',
            WEBHOOK_URL: 'https://simon990520.github.io/deseo/webhooks/bold',
            SIGNATURE_ENDPOINT: 'https://server-eo9ez6okm-koddio999s-projects.vercel.app/api/bold/integrity-signature',
            PAYMENT_LINK_ENDPOINT: 'https://server-eo9ez6okm-koddio999s-projects.vercel.app/api/bold/create-payment-link',
            VERCEL_BYPASS_TOKEN: ''
        },

        GEOLOCATION: {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 300000
        },

        DEBUG: {
            enabled: false,
            logLevel: 'info'
        },

        CLERK: {
            enabled: true,
            publishableKey: LOCAL.CLERK_PUBLISHABLE_KEY || 'pk_test_XXXXXXXX'
        },

        // ===== SUPABASE (capa de dinero server-authoritative, anti-hack) =====
        // La anon key es pública (segura en el navegador); la seguridad real la
        // impone RLS + RPC SECURITY DEFINER en el servidor. NUNCA poner aquí la
        // sb_secret_ / service_role.
        SUPABASE: {
            url: LOCAL.SUPABASE_URL || '',
            anonKey: LOCAL.SUPABASE_ANON_KEY || '',
            // Nombre del JWT template de Clerk que Supabase verifica.
            jwtTemplate: (LOCAL.SUPABASE_JWT_TEMPLATE || 'supabase')
        },

        // ===== API (backend serverless) =====
        // Endpoints del backend. VERIFY_ENDPOINT valida el token de Clerk y
        // devuelve { valid, userId, isAdmin } (isAdmin derivado de ADMIN_USER_IDS
        // en el servidor). Se usa como segunda barrera del gate de admin.
        API: {
            BASE_URL: (LOCAL.API_BASE_URL || 'https://server-eo9ez6okm-koddio999s-projects.vercel.app'),
            VERIFY_ENDPOINT: (LOCAL.API_VERIFY_ENDPOINT || 'https://server-eo9ez6okm-koddio999s-projects.vercel.app/api/auth/verify')
        },

        // ===== ADMIN =====
        // Control de acceso al panel. Fail-closed: si estas listas están vacías,
        // admin.html queda bloqueado. Añade aquí los IDs/emails de administradores.
        ADMIN: {
            authorizedUserIds: (LOCAL.ADMIN_USER_IDS || []),
            authorizedEmails: (LOCAL.ADMIN_EMAILS || []),
            roleKey: 'role',
            requiredRole: 'admin'
        },

        FIREBASE: {
            enabled: true,
            config: LOCAL.FIREBASE_CONFIG || PLACEHOLDER_FIREBASE,
            database: {
                wishes: 'wishes',
                users: 'users',
                conversations: 'conversations'
            }
        },

        // ===== PRECIOS CONFIGURABLES =====
        // Estos son los valores POR DEFECTO (semilla). Se pueden sobrescribir
        // en tiempo real desde `settings` (nodo `settings/pricing` en RTDB) o
        // desde el panel de Configuración. El punto único de lectura es
        // `DeseoPricing.get(...)` (ver utilidades abajo), NO accedas a
        // CONFIG.PRICING directamente en el código de chat.
        PRICING: {
            // Chat / mensajes
            messageClientCost: 390,     // lo que paga el cliente por mensaje
            messageProviderCredit: 100, // lo que recibe el proveedor por mensaje
            // Solicitud inmediata de encuentro ("enviar ahora")
            encounterRequestCost: 100,
            encounterRequestCredit: 100,
            // Propinas
            tipClientCost: 390,
            tipProviderCredit: 100,
            // Comisión de plataforma mostrada en UI (derivada, informativa)
            currency: 'COP'
        }
    };

    // ===== PRECIOS: RESOLUCIÓN CENTRALIZADA =====
    // ÚNICO punto de verdad para precios. Fuente persistente: Firebase
    // RTDB en `settings/pricing`. Prioridad: defaults (CONFIG.PRICING) <
    // overrides inyectados (window.DESEO_PRICING_OVERRIDES, p.ej. config.local.js)
    // < valores remotos cargados de Firebase (_pricingRemote, cache en memoria).
    // Ya NO se usa localStorage para precios.
    var _pricingRemote = null; // cache en memoria de settings/pricing

    function _pricingOverrides() {
        var out = {};
        try {
            var base = CONFIG.PRICING || {};
            for (var k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k]; }
        } catch (_) {}
        // 1) Overrides locales inyectados (config.local.js)
        try {
            var inj = (typeof window !== 'undefined' && window.DESEO_PRICING_OVERRIDES) || null;
            if (inj) for (var k2 in inj) { if (Object.prototype.hasOwnProperty.call(inj, k2)) out[k2] = inj[k2]; }
        } catch (_) {}
        // 2) Valores remotos de Firebase (settings/pricing), ya sanitizados al cargar
        try {
            var rem = _pricingRemote;
            if (rem) {
                for (var k3 in rem) {
                    if (!Object.prototype.hasOwnProperty.call(rem, k3)) continue;
                    out[k3] = rem[k3];
                }
            }
        } catch (_) {}
        return out;
    }

    var PRICING_FIELDS = [
        { key: 'messageClientCost', label: 'Precio por mensaje (cliente paga)', min: 0 },
        { key: 'messageProviderCredit', label: 'Pago al proveedor por mensaje', min: 0 },
        { key: 'encounterRequestCost', label: 'Solicitud de encuentro (cliente paga)', min: 0 },
        { key: 'encounterRequestCredit', label: 'Pago al proveedor por solicitud', min: 0 },
        { key: 'tipClientCost', label: 'Propina (cliente paga)', min: 0 },
        { key: 'tipProviderCredit', label: 'Pago al proveedor por propina', min: 0 }
    ];

    // Normaliza un objeto de precios: solo claves numéricas >= 0 conocidas.
    function _sanitizePricing(obj) {
        var out = {};
        if (!obj || typeof obj !== 'object') return out;
        for (var i = 0; i < PRICING_FIELDS.length; i++) {
            var key = PRICING_FIELDS[i].key;
            if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
            var v = obj[key];
            var n = (typeof v === 'string') ? parseInt(v, 10) : v;
            if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[key] = n;
        }
        return out;
    }

    var DeseoPricing = {
        fields: PRICING_FIELDS,
        defaults: function () {
            var o = {};
            for (var k in CONFIG.PRICING) { if (Object.prototype.hasOwnProperty.call(CONFIG.PRICING, k)) o[k] = CONFIG.PRICING[k]; }
            return o;
        },
        all: function () { return _pricingOverrides(); },
        get: function (key, fallback) {
            var o = _pricingOverrides();
            var v = o[key];
            if (typeof v === 'number' && Number.isFinite(v)) return v;
            if (typeof v === 'string' && v !== '' && Number.isFinite(parseInt(v, 10))) return parseInt(v, 10);
            return (fallback !== undefined) ? fallback : 0;
        },
        // Comisión de plataforma por mensaje (derivada, informativa)
        platformFee: function () {
            return Math.max(0, this.get('messageClientCost', 0) - this.get('messageProviderCredit', 0));
        },
        // Aplica un objeto de precios a la cache en memoria (usado al cargar de Firebase).
        applyRemote: function (obj) {
            _pricingRemote = _sanitizePricing(obj);
            return _pricingRemote;
        },
        // Guarda TODOS los precios en Firebase (settings/pricing). Devuelve true/false.
        // values: objeto parcial; se fusiona con los valores actuales.
        save: async function (db, values) {
            if (!db || !db.ref) return false;
            var current = _pricingOverrides();
            var incoming = _sanitizePricing(values || {});
            var merged = {};
            for (var i = 0; i < PRICING_FIELDS.length; i++) {
                var key = PRICING_FIELDS[i].key;
                if (Object.prototype.hasOwnProperty.call(incoming, key)) merged[key] = incoming[key];
                else if (typeof current[key] === 'number') merged[key] = current[key];
            }
            merged.updatedAt = new Date().toISOString();
            try {
                await db.ref('settings/pricing').set(merged);
                _pricingRemote = merged;
                return true;
            } catch (e) {
                console.error('❌ No se pudieron guardar los precios en Firebase:', e);
                return false;
            }
        },
        // Compatibilidad: set local solo en memoria (no persiste). Preferir save(db,...).
        set: function (key, value) {
            var n = (typeof value === 'string') ? parseInt(value, 10) : value;
            if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return false;
            var current = _pricingRemote ? Object.assign({}, _pricingRemote) : {};
            current[key] = n;
            _pricingRemote = _sanitizePricing(current);
            return true;
        },
        setMany: function (obj) {
            var merged = Object.assign({}, _pricingRemote || {}, _sanitizePricing(obj || {}));
            _pricingRemote = _sanitizePricing(merged);
            return true;
        },
        // Descarta overrides remotos (vuelve a defaults/inyectados). No persiste.
        reset: function () {
            _pricingRemote = null;
            return true;
        },
        // Carga precios desde Firebase (nodo settings/pricing).
        // Los valores del servidor tienen prioridad sobre defaults/inyectados.
        // Si no hay nodo, mantiene defaults y devuelve false.
        loadFromFirebase: async function (db) {
            if (!db || !db.ref) return false;
            try {
                var snap = await db.ref('settings/pricing').once('value');
                var val = snap && snap.val ? snap.val() : null;
                if (val && typeof val === 'object') {
                    _pricingRemote = _sanitizePricing(val);
                    return true;
                }
            } catch (e) { /* sin nodo o sin permisos: usar defaults */ }
            return false;
        },
        // Escucha cambios en vivo de settings/pricing (multi-instancia/multi-admin).
        subscribe: function (db, cb) {
            if (!db || !db.ref) return null;
            try {
                var handler = function (snap) {
                    var val = snap && snap.val ? snap.val() : null;
                    _pricingRemote = (val && typeof val === 'object') ? _sanitizePricing(val) : null;
                    if (typeof cb === 'function') cb(_pricingRemote);
                };
                db.ref('settings/pricing').on('value', handler);
                return function () { try { db.ref('settings/pricing').off('value', handler); } catch (_) {} };
            } catch (_) { return null; }
        }
    };

    // ===== UTILIDADES =====
    function getCategoryConfig(category) {
        return CONFIG.CATEGORIES[category] || { name: 'Otros', icon: 'fas fa-star', color: '#6b7280', priceRange: [5, 50] };
    }
    function getCategoryName(category) { return getCategoryConfig(category).name; }
    function getCategoryColor(category) { return getCategoryConfig(category).color; }
    function getCategoryPriceRange(category) { return getCategoryConfig(category).priceRange; }

    function isMapboxTokenConfigured() {
        return !!(CONFIG.MAPBOX_TOKEN && CONFIG.MAPBOX_TOKEN !== 'TU_MAPBOX_TOKEN' && CONFIG.MAPBOX_TOKEN.startsWith('pk.'));
    }

    function getRandomAIResponse(type) {
        var responses = CONFIG.AI.responses[type];
        if (!responses || responses.length === 0) return '';
        return responses[Math.floor(Math.random() * responses.length)];
    }

    function debugLog(message, level) {
        level = level || 'info';
        if (!CONFIG.DEBUG.enabled) return;
        var levels = ['debug', 'info', 'warn', 'error'];
        if (levels.indexOf(level) >= levels.indexOf(CONFIG.DEBUG.logLevel)) {
            console[level]('[Deseo App] ' + message);
        }
    }

    // ===== EXPORTAR =====
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = CONFIG;
    }
    if (typeof window !== 'undefined') {
        window.CONFIG = CONFIG;
        window.getCategoryConfig = getCategoryConfig;
        window.getCategoryName = getCategoryName;
        window.getCategoryColor = getCategoryColor;
        window.getCategoryPriceRange = getCategoryPriceRange;
        window.isMapboxTokenConfigured = isMapboxTokenConfigured;
        window.getRandomAIResponse = getRandomAIResponse;
        window.debugLog = debugLog;
        window.DeseoPricing = DeseoPricing;

        // Aviso único (sin ruido) si falta config.local.js
        if (!LOCAL.MAPBOX_TOKEN || !LOCAL.FIREBASE_CONFIG) {
            console.warn('[Deseo] config.local.js no detectado o incompleto. La app usará placeholders. Copia config.example.js a config.local.js.');
        }
    }
})();
