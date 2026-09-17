/**
 * DESEO — Puente Clerk  Supabase (dinero server-authoritative).
 * --------------------------------------------------------------------
 * PROBLEMA QUE RESUELVE:
 *  - Las páginas de chat (chat-client.html, chat-provider.html, settings.html)
 *    NO cargaban Clerk, por lo que `window.Clerk` era undefined y no era posible
 *    obtener un JWT para autenticar contra Supabase (auth.uid() = null).
 *  - Sin identidad verificada, las RPC de dinero (rpc_charge, rpc_transfer...)
 *    devuelven `not_authenticated` y no se puede migrar el cobro al servidor.
 *
 * SOLUCIÓN (100% lógica, sin tocar diseño):
 *  1. Carga Clerk (core ESM + bundle de UI) replicando la inicialización de
 *     index.html, pero de forma reutilizable y sin depender de DeseoApp.
 *  2. Expone `window.Clerk` (instancia) cuando está lista.
 *  3. Crea un cliente Supabase con `accessToken` dinámico: cada request pide a
 *     Clerk un JWT firmado (template 'supabase') que Supabase verifica y del que
 *     deriva auth.uid(). RLS + RPC deciden qué puede hacer el usuario.
 *  4. Expone:
 *       window.DeseoAuth.ready        -> Promise<Clerk|null>
 *       window.DeseoAuth.getToken()   -> Promise<string|null>
 *       window.DeseoSupabase          -> cliente supabase-js (o null)
 *
 * SEGURIDAD:
 *  - Solo se usa la anon/publishable key aquí (pública, protegida por RLS).
 *  - NUNCA se pone service_role / sb_secret_ en el cliente.
 */
(function () {
    'use strict';

    var CFG = (typeof window !== 'undefined' && window.CONFIG) || {};
    var clerkCfg = CFG.CLERK || {};
    var sbCfg = CFG.SUPABASE || {};

    var state = {
        clerkReady: null,   // Promise<instance|null>
        supabase: null,
        tokenTemplate: sbCfg.jwtTemplate || 'supabase'
    };

    // ---------------------------------------------------------------------
    // 1) Carga de Clerk (mismo patrón que index.html)
    // ---------------------------------------------------------------------
    function deriveDomain(pk) {
        try { return atob(pk.split('_')[2]).slice(0, -1); } catch (e) { return ''; }
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.async = true;
            s.crossOrigin = 'anonymous';
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('No se pudo cargar ' + src)); };
            document.head.appendChild(s);
        });
    }

    async function loadClerk() {
        var key = clerkCfg.publishableKey || clerkCfg.PUBLISHABLE_KEY || '';
        if (!key || /XXXX/.test(key)) {
            console.warn('[DeseoAuth] Clerk publishable key no configurada.');
            return null;
        }
        // Si ya hay instancia (p.ej. index.html), reutilizarla.
        if (window.Clerk && window.Clerk.loaded) return window.Clerk;

        var domain = deriveDomain(key);
        try {
            var uiLoad = domain
                ? loadScript('https://' + domain + '/npm/@clerk/ui@1/dist/ui.browser.js')
                : Promise.resolve();

            var mod = await import('https://cdn.jsdelivr.net/npm/@clerk/clerk-js@6.31.1/+esm');
            var ClerkCtor = mod.Clerk || (mod.default && mod.default.Clerk) || mod.default;
            if (!ClerkCtor) throw new Error('No se encontró la clase Clerk (ESM).');

            await uiLoad;
            var uiCtor = window.__internal_ClerkUICtor;
            var instance = window.Clerk && window.Clerk.load ? window.Clerk : new ClerkCtor(key);
            await instance.load(uiCtor ? { ui: { ClerkUI: uiCtor } } : undefined);
            window.Clerk = instance;
            window.__DESEO_CLERK__ = instance;
            console.log('[DeseoAuth] Clerk listo.' + (instance.user ? ' (usuario: ' + instance.user.id + ')' : ' (sin sesión)'));
            return instance;
        } catch (err) {
            console.error('[DeseoAuth] Error cargando Clerk:', err);
            return null;
        }
    }

    // ---------------------------------------------------------------------
    // 2) Carga de supabase-js (ESM) y cliente con accessToken de Clerk
    // ---------------------------------------------------------------------
    async function buildSupabase(clerk) {
        if (!sbCfg.url || !sbCfg.anonKey) {
            console.warn('[DeseoAuth] Supabase no configurado (config.local.js).');
            return null;
        }
        try {
            var mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
            var createClient = mod.createClient || (mod.default && mod.default.createClient);
            if (!createClient) throw new Error('createClient no disponible en supabase-js.');

            var client = createClient(sbCfg.url, sbCfg.anonKey, {
                auth: { persistSession: false, autoRefreshToken: false },
                global: {
                    // Cada request pide un JWT fresco a Clerk (template 'supabase').
                    fetch: async function (input, init) {
                        init = init || {};
                        var headers = new Headers(init.headers || {});
                        try {
                            var tok = await getToken();
                            if (tok) headers.set('Authorization', 'Bearer ' + tok);
                        } catch (e) { /* sin token: la request irá anónima (RLS la bloqueará) */ }
                        init.headers = headers;
                        return fetch(input, init);
                    }
                }
            });
            console.log('[DeseoAuth] Supabase cliente listo.');
            return client;
        } catch (err) {
            console.error('[DeseoAuth] Error creando cliente Supabase:', err);
            return null;
        }
    }

    // ---------------------------------------------------------------------
    // 3) getToken(): JWT de Clerk para Supabase
    // ---------------------------------------------------------------------
    async function getToken() {
        var clerk = await state.clerkReady;
        if (!clerk) return null;
        var sess = clerk.session;
        if (!sess) return null;
        // Preferir el template dedicado; si no existe, intentar el token por defecto.
        try {
            var t = await sess.getToken({ template: state.tokenTemplate });
            if (t) return t;
        } catch (e) {
            console.warn('[DeseoAuth] getToken template "' + state.tokenTemplate + '" falló:', e && e.message);
        }
        try { return await sess.getToken(); } catch (e2) { return null; }
    }

    // ---------------------------------------------------------------------
    // 4) Init
    // ---------------------------------------------------------------------
    state.clerkReady = (async function () {
        if (!clerkCfg.enabled) { console.warn('[DeseoAuth] Clerk deshabilitado.'); return null; }
        var clerk = await loadClerk();
        state.supabase = await buildSupabase(clerk);
        return clerk;
    })();

    // Supabase puede construirse en paralelo (no depende de la sesión, solo del SDK).
    // Exponer una promesa para quien necesite esperarlo de forma determinista.
    state.supabaseReady = (async function () {
        await state.clerkReady;                       // Clerk primero (incluye build)
        if (state.supabase) return state.supabase;
        // Reintento único por si buildSupabase falló por red transitoria.
        try { state.supabase = await buildSupabase(await state.clerkReady); } catch (e) {}
        return state.supabase;
    })();

    window.DeseoAuth = {
        ready: state.clerkReady,
        waitForSupabase: state.supabaseReady,
        getToken: getToken,
        getSupabase: function () { return state.supabase; },
        // Id del usuario autenticado (Clerk). Fuente: instancia de Clerk.
        getUserId: async function () {
            try {
                var clerk = await state.clerkReady;
                if (clerk && clerk.user && clerk.user.id) return clerk.user.id;
            } catch (_) { /* noop */ }
            return null;
        }
    };
    // Exponer el cliente como global simple (puede ser null hasta que cargue).
    Object.defineProperty(window, 'DeseoSupabase', {
        get: function () { return state.supabase; },
        configurable: true
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = window.DeseoAuth;
    }
})();
