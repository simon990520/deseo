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

        // Aviso único (sin ruido) si falta config.local.js
        if (!LOCAL.MAPBOX_TOKEN || !LOCAL.FIREBASE_CONFIG) {
            console.warn('[Deseo] config.local.js no detectado o incompleto. La app usará placeholders. Copia config.example.js a config.local.js.');
        }
    }
})();
