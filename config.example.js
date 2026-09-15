/**
 * CONFIGURACIÓN DE DESEO APP — PLANTILLA
 * ---------------------------------------
 * Copia este archivo a `config.local.js` y rellena tus valores reales.
 * `config.local.js` NO se versiona (ver .gitignore).
 *
 * NUNCA subas tokens/keys reales al repositorio.
 * Si una key estuvo expuesta en el repo/commit/historial, RÓTALA en el panel
 * del proveedor: cambiarla aquí NO la invalida para quien ya la tenga.
 */
window.DESEO_LOCAL_CONFIG = {
    // Mapbox — https://account.mapbox.com/access-tokens/
    MAPBOX_TOKEN: 'TU_MAPBOX_TOKEN',

    // Google Gemini (Generative Language API) — https://ai.google.dev/
    GEMINI_API_KEY: 'TU_GEMINI_API_KEY',

    // Bold (pasarela de pagos) — https://developers.bold.co/
    // La API KEY no debe vivir en el cliente; aquí solo queda para el serverless.
    BOLD_API_KEY: 'TU_BOLD_API_KEY',

    // Firebase Web Config — consola Firebase > Configuración del proyecto
    FIREBASE_CONFIG: {
        apiKey: 'TU_FIREBASE_API_KEY',
        authDomain: 'TU_PROYECTO.firebaseapp.com',
        databaseURL: 'https://TU_PROYECTO-default-rtdb.firebaseio.com',
        projectId: 'TU_PROYECTO',
        storageBucket: 'TU_PROYECTO.firebasestorage.app',
        messagingSenderId: 'TU_SENDER_ID',
        appId: 'TU_APP_ID',
        measurementId: 'TU_MEASUREMENT_ID'
    },

    // Clerk — https://dashboard.clerk.com/ (publishable key es pública por diseño)
    CLERK_PUBLISHABLE_KEY: 'pk_test_XXXXXXXX',

    // Administración — SOLO usuarios autorizados pueden abrir admin.html.
    // Si dejas ambas listas vacías, el panel queda BLOQUEADO (fail-closed).
    ADMIN_USER_IDS: [],
    ADMIN_EMAILS: ['admin@deseo.com']
};
