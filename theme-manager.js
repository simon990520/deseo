// ===== THEME MANAGER - GESTIÓN GLOBAL DE TEMAS (FUENTE ÚNICA DE VERDAD) =====
// Este archivo es el ÚNICO responsable de leer/escribir el tema en toda la app.
// Clave canónica en localStorage: 'deseo_theme'  (valores: 'light' | 'dark')
// Se migra automáticamente la clave antigua 'deseo-theme' (con guion).
console.log('🎨 Inicializando Theme Manager...');

(function () {
    'use strict';

    const STORAGE_KEY = 'deseo_theme';        // clave canónica
    const LEGACY_KEY = 'deseo-theme';         // clave antigua (migración)
    const DEFAULT_THEME = 'dark';

    // Lee el tema guardado, migrando la clave antigua si es necesario.
    function readStoredTheme() {
        try {
            let theme = localStorage.getItem(STORAGE_KEY);

            // Migración: si no existe la clave nueva pero sí la antigua, la usamos.
            if (!theme) {
                const legacy = localStorage.getItem(LEGACY_KEY);
                if (legacy === 'light' || legacy === 'dark') {
                    theme = legacy;
                    localStorage.setItem(STORAGE_KEY, legacy);
                    localStorage.removeItem(LEGACY_KEY);
                }
            }

            return (theme === 'light' || theme === 'dark') ? theme : DEFAULT_THEME;
        } catch (error) {
            console.warn('⚠️ Error accediendo a localStorage:', error);
            return DEFAULT_THEME;
        }
    }

    function writeStoredTheme(theme) {
        try {
            localStorage.setItem(STORAGE_KEY, theme);
            // Limpiar la clave antigua para evitar inconsistencias futuras.
            localStorage.removeItem(LEGACY_KEY);
        } catch (error) {
            console.warn('⚠️ Error guardando tema en localStorage:', error);
        }
    }

    // Aplica el tema a <html> Y <body> para que TODOS los selectores CSS
    // ([data-theme="dark"], body.dark-mode, etc.) funcionen sin importar
    // dónde estén definidos.
    function applyThemeToDOM(theme) {
        const root = document.documentElement;
        const body = document.body;

        root.setAttribute('data-theme', theme);
        if (body) {
            body.setAttribute('data-theme', theme);
            body.classList.toggle('dark-mode', theme === 'dark');
        }
    }

    function updateToggleIcon(theme) {
        const themeToggle = document.getElementById('themeToggle') ||
                            document.getElementById('theme-toggle') ||
                            document.querySelector('.theme-toggle') ||
                            document.querySelector('[data-theme-toggle]');
        if (!themeToggle) return;
        const icon = themeToggle.querySelector('i');
        if (icon) {
            // En tema claro mostramos luna (para pasar a oscuro) y viceversa.
            icon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
        }
    }

    class ThemeManager {
        constructor() {
            this.currentTheme = readStoredTheme();
            this.init();
        }

        init() {
            console.log('🎨 ThemeManager: Inicializando...');

            // Aplicar tema guardado al cargar la página
            this.applyTheme(this.currentTheme, { persist: false });

            // Configurar botón de tema si existe
            this.setupThemeToggle();

            // Escuchar cambios de tema desde otras pestañas
            this.setupStorageListener();

            console.log(`✅ ThemeManager: Inicializado con tema ${this.currentTheme}`);
        }

        getStoredTheme() {
            return readStoredTheme();
        }

        setStoredTheme(theme) {
            writeStoredTheme(theme);
        }

        applyTheme(theme, options = {}) {
            const { persist = true } = options;
            if (theme !== 'light' && theme !== 'dark') {
                console.warn('⚠️ Tema inválido:', theme);
                return;
            }

            console.log(`🎨 Aplicando tema: ${theme}`);

            applyThemeToDOM(theme);
            updateToggleIcon(theme);

            if (persist) {
                writeStoredTheme(theme);
            }

            this.currentTheme = theme;

            // Disparar evento personalizado para que otros scripts se enteren
            this.dispatchThemeChangeEvent(theme);
        }

        toggleTheme() {
            const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
            this.applyTheme(newTheme);
            return newTheme;
        }

        setupThemeToggle() {
            const themeToggle = document.getElementById('themeToggle') ||
                                document.getElementById('theme-toggle') ||
                                document.querySelector('.theme-toggle') ||
                                document.querySelector('[data-theme-toggle]');

            if (themeToggle && !themeToggle.dataset.themeBound) {
                themeToggle.dataset.themeBound = 'true';
                // Usamos la fase de CAPTURA y stopImmediatePropagation() para
                // ser el ÚNICO handler que responde al click. Varias páginas
                // (script-mapbox.js, chats.js, script-settings.js, etc.)
                // añadían su propio listener al mismo botón, provocando un
                // DOBLE toggle (el tema cambiaba dos veces y quedaba igual).
                // Al cortar la propagación aquí, el ThemeManager es la fuente
                // única de verdad y el tema cambia una sola vez.
                themeToggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    this.toggleTheme();
                }, true);
                console.log('🎨 Botón de tema encontrado, configurando...');
            } else if (!themeToggle) {
                console.log('⚠️ Botón de tema no encontrado en esta página');
            }
        }

        setupStorageListener() {
            // Escuchar cambios en localStorage desde otras pestañas
            window.addEventListener('storage', (e) => {
                if (e.key === STORAGE_KEY && e.newValue && e.newValue !== this.currentTheme) {
                    console.log('🔄 Tema cambiado desde otra pestaña:', e.newValue);
                    this.applyTheme(e.newValue, { persist: false });
                }
            });
        }

        dispatchThemeChangeEvent(theme) {
            const event = new CustomEvent('themeChanged', { detail: { theme } });
            window.dispatchEvent(event);
        }

        getCurrentTheme() {
            return this.currentTheme;
        }

        setTheme(theme) {
            this.applyTheme(theme);
        }
    }

    // ===== API GLOBAL =====
    // Se expone una API mínima para que cualquier script pueda leer/cambiar el tema
    // sin duplicar la lógica de localStorage.
    window.DeseoTheme = {
        STORAGE_KEY,
        get: () => (window.themeManager ? window.themeManager.getCurrentTheme() : readStoredTheme()),
        set: (theme) => {
            if (window.themeManager) {
                window.themeManager.setTheme(theme);
            } else {
                applyThemeToDOM(theme);
                writeStoredTheme(theme);
            }
        },
        toggle: () => {
            if (window.themeManager) {
                return window.themeManager.toggleTheme();
            }
            const next = readStoredTheme() === 'light' ? 'dark' : 'light';
            applyThemeToDOM(next);
            writeStoredTheme(next);
            return next;
        }
    };

    // Crear instancia global
    let themeManager;

    function initializeThemeManager() {
        if (!themeManager) {
            themeManager = new ThemeManager();
            window.themeManager = themeManager;
            console.log('✅ ThemeManager global creado');
        }
    }

    // Inicializar cuando el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeThemeManager);
    } else {
        initializeThemeManager();
    }

    // Exportar la clase para uso avanzado
    window.ThemeManager = ThemeManager;
})();
