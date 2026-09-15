/**
 * DESEO — Control de logs de depuración.
 * Silencia console.log/debug/info salvo que CONFIG.DEBUG.enabled sea true.
 * console.warn y console.error SIEMPRE se muestran (errores reales).
 *
 * Cargar DESPUÉS de config.js y ANTES de los scripts de la app.
 */
(function () {
    'use strict';

    var level = 'info';
    var enabled = false;
    try {
        if (typeof CONFIG !== 'undefined' && CONFIG.DEBUG) {
            enabled = !!CONFIG.DEBUG.enabled;
            level = CONFIG.DEBUG.logLevel || 'info';
        }
    } catch (e) { /* CONFIG aún no disponible: por defecto silencio */ }

    if (enabled) return; // Si el debug está activo, no tocar nada.

    var noop = function () {};
    // Preservar referencia por si se necesita reactivar en runtime.
    try {
        window.__deseoOriginalConsole = {
            log: console.log,
            debug: console.debug,
            info: console.info
        };
    } catch (e) {}

    console.log = noop;
    console.debug = noop;
    if (level === 'warn' || level === 'error') console.info = noop;

    // Helper para reactivar el logging en caliente (consola): window.deseoEnableLogs(true)
    window.deseoEnableLogs = function (on) {
        var o = window.__deseoOriginalConsole;
        if (!o) return;
        if (on) {
            console.log = o.log;
            console.debug = o.debug;
            console.info = o.info;
        } else {
            console.log = noop; console.debug = noop; console.info = noop;
        }
    };
})();
