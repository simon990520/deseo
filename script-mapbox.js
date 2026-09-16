/**
 * DESEO - Plataforma de Micro-Deseos con Mapbox
 * Aplicación web interactiva para conectar personas con deseos y servicios
 * 
 * Funcionalidades principales:
 * - Mapa real de Mapbox con geolocalización
 * - Chat con IA para crear deseos
 * - Sistema de chat privado entre usuarios
 * - Calificación y comentarios
 * - Filtros y búsqueda
 */

// ===== CONFIGURACIÓN DE MAPBOX (REQUIERE CONFIG.JS) =====
// La configuración se carga desde config.js
const MAPBOX_TOKEN = CONFIG.MAPBOX_TOKEN;
const MAP_CONFIG = CONFIG.MAP;

// Verificar si Mapbox GL JS está cargado
if (typeof mapboxgl === 'undefined') {
    console.error('Mapbox GL JS no está cargado');
    document.body.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; font-family: Arial, sans-serif;">
            <h1>Error de Carga</h1>
            <p>Mapbox GL JS no se pudo cargar. Verifica tu conexión a internet.</p>
            <button onclick="location.reload()" style="padding: 10px 20px; margin-top: 20px; background: #6366f1; color: white; border: none; border-radius: 5px; cursor: pointer;">
                Recargar Página
            </button>
        </div>
    `;
    throw new Error("Mapbox GL JS not loaded"); // Detener la ejecución del script
}

// ===== ESTADO GLOBAL DE LA APLICACIÓN =====
class DeseoApp {
    constructor() {
        this.map = null;
        this.wishes = []; // Vuelve a ser 'wishes'
        this.markers = [];
        this.availableProfiles = [];
        this.profileMarkers = [];
        this.currentUser = null; // Inicialmente null, se establecerá con Clerk
        this.activeChat = null;
        this.userLocation = null;
        this.userLocationMarker = null;
        // ===== FIREBASE =====
        this.firebase = null;
        this.database = null;
        this.wishesRef = null;
        // ===== IA =====
        this.conversationHistory = [];
        this.userProfile = this.loadUserProfile();
        this.emotionalState = this.loadEmotionalState();
        this.gemini = null; // Se inicializará después
        this.filters = {
            maxPrice: 1000000, // Filtro de precio para deseos (COP)
            category: '',
            distance: 10
        }; // Revertidos los filtros para deseos
        // Cache para perfiles completos de Firebase, clave: userId
        this.userProfilesCache = {};
        
        // Carrusel móvil
        this.currentSlide = 0;
        this.totalSlides = 0;
        this.aiResponses = this.initializeAIResponses();
        
        // Alerta de chats sin responder
        this.unreadChatsCount = 0;
        this.unreadChatsListener = null;
        
        // Notificación de mensajes nuevos
        this.newMessagesCount = 0;
        this.newMessagesListener = null;
        this.allMessages = new Map(); // Cache de mensajes para comparar nuevos
        
        this.exposeGetTopInterests();
        this.initializeApp();
    }

    // ===== MANEJO DE AUTENTICACIÓN CON CLERK =====
    async handleClerkSignIn(user) {
        console.log('Clerk Sign In - User:', user);
        this.currentUser = {
            id: user.id,
            name: user.fullName || (user.emailAddresses && user.emailAddresses[0] && user.emailAddresses[0].emailAddress) || 'Usuario',
            email: (user.emailAddresses && user.emailAddresses[0] && user.emailAddresses[0].emailAddress) || '',
            profileImageUrl: user.imageUrl || user.profileImageUrl || 'https://www.gravatar.com/avatar/?d=mp&f=y'
        };
        
        // Guardar datos de usuario en localStorage para que estén disponibles en otras páginas
        localStorage.setItem('deseo_user', JSON.stringify(this.currentUser));
        sessionStorage.setItem('deseo_user', JSON.stringify(this.currentUser));
        console.log('✅ Datos de usuario guardados en localStorage y sessionStorage');
        
        // Verificar si el perfil está completo
        await this.checkProfileCompletion();
        
        this.showNotification(`¡Bienvenido, ${this.currentUser.name}!`, 'success');
        // Cerrar el modal de autenticación si está abierto
        const authContainer = document.getElementById('authContainer');
        if (authContainer) {
            authContainer.classList.remove('active');
        }
        this.updateAuthUI(); // Actualizar la UI de tu app (e.g., botón de login/logout, mostrar datos de usuario)
        
        // Forzar actualización de todos los componentes que dependen de la autenticación
        this.forceAuthStateUpdate();
    }

    handleClerkSignOut() {
        console.log('Clerk Sign Out');
        this.currentUser = null;
        
        // Limpiar datos de autenticación
        localStorage.removeItem('deseo_user');
        sessionStorage.removeItem('deseo_user');
        console.log('✅ Datos de usuario eliminados de localStorage y sessionStorage');
        
        this.showNotification('Sesión cerrada exitosamente.', 'info');
        this.updateAuthUI();
    }

    // ===== MODAL DE AUTENTICACIÓN =====
    showAuthModal() {
        console.log('Mostrando modal de autenticación...');
        
        // Crear modal de autenticación
        const modal = document.createElement('div');
        modal.className = 'auth-modal';
        modal.innerHTML = `
            <div class="modal-overlay">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2><i class="fas fa-lock"></i> Iniciar Sesión</h2>
                        <button class="close-btn" onclick="this.closest('.auth-modal').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <p>Para acceder a esta función, necesitas iniciar sesión o registrarte.</p>
                        <div class="auth-options">
                            <button class="btn btn-primary" id="authModalBtn">
                                <i class="fas fa-sign-in-alt"></i>
                                Iniciar Sesión / Registrarse
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Agregar estilos
        const style = document.createElement('style');
        style.textContent = `
            .auth-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: modalFadeIn 0.3s ease;
            }
            .auth-modal .modal-overlay {
                background: rgba(0, 0, 0, 0.7);
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 2rem;
                backdrop-filter: blur(5px);
            }
            .auth-modal .modal-content {
                background: var(--background);
                border: 1px solid var(--border-color);
                border-radius: var(--border-radius-lg);
                box-shadow: var(--shadow-lg);
                max-width: 400px;
                width: 90%;
                animation: modalSlideIn 0.2s ease-out;
            }
            .auth-modal .modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 1rem 1.5rem;
                border-bottom: 1px solid var(--border-color);
            }
            .auth-modal .modal-header h2 {
                font-size: 1.25rem;
                font-weight: 700;
                color: var(--text-primary);
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }
            .auth-modal .modal-header h2 i {
                color: var(--primary-color);
            }
            .auth-modal .close-btn {
                background: none;
                border: none;
                font-size: 1.5rem;
                color: var(--text-light);
                cursor: pointer;
                padding: 0.5rem;
                border-radius: 50%;
                transition: var(--transition);
            }
            .auth-modal .close-btn:hover {
                background: var(--hover-bg);
                color: var(--text-primary);
            }
            .auth-modal .modal-body {
                padding: 1.5rem;
                text-align: center;
            }
            .auth-modal .modal-body p {
                color: var(--text-secondary);
                margin-bottom: 1.5rem;
                line-height: 1.5;
            }
            .auth-modal .auth-options {
                display: flex;
                flex-direction: column;
                gap: 1rem;
            }
            .auth-modal .btn {
                padding: 12px 24px;
                border-radius: 8px;
                font-weight: 500;
                transition: all 0.2s ease;
                border: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                background: var(--primary-color);
                color: white;
            }
            .auth-modal .btn:hover {
                background: var(--primary-hover);
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(modal);

        // Agregar event listener para el botón de autenticación
        const authBtn = modal.querySelector('#authModalBtn');
        if (authBtn) {
            authBtn.addEventListener('click', async () => {
                // Cerrar el modal personalizado
                modal.remove();
                
                // Abrir Clerk authentication
                await this.showAuthUI();
            });
        }
    }

    // ===== VERIFICACIÓN DE PERFIL COMPLETO =====
    async checkProfileCompletion() {
        try {
            // Solo verificar perfil si el usuario está autenticado
            if (!this.currentUser) {
                console.log('Usuario no autenticado - permitir navegación libre');
                return;
            }

            console.log('Usuario autenticado - verificando perfil completo...');

            // Asegurar que Firebase esté inicializado antes de verificar el perfil
            if (!this.database) {
                console.log('🔍 Firebase no inicializado, inicializando...');
                await this.initializeFirebase();
                
                // Esperar un poco para que Firebase se inicialice
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Verificar si el perfil está completo en Firebase
            const isProfileComplete = await this.isUserProfileComplete();
            
            if (!isProfileComplete) {
                console.log('Perfil incompleto, mostrando modal de completar perfil...');
                this.showProfileCompletionModal();
            } else {
                console.log('Perfil completo ✅');
            }
            
        } catch (error) {
            console.error('Error verificando perfil:', error);
            // En caso de error, solo mostrar modal si el usuario está autenticado
            if (this.currentUser) {
                this.showProfileCompletionModal();
            }
        }
    }

    async isUserProfileComplete() {
        try {
            if (!this.database) {
                console.warn('Firebase no disponible');
                return false;
            }

            const userRef = this.database.ref(`users/${this.currentUser.id}`);
            const snapshot = await userRef.once('value');
            const userData = snapshot.val();

            if (!userData) {
                console.log('Usuario no encontrado en Firebase');
                return false;
            }

            // Verificar si tiene perfil completo
            if (!userData.profileComplete) {
                console.log('Perfil no marcado como completo');
                return false;
            }

            // Verificar campos requeridos
            const profile = userData.profile;
            if (!profile) {
                console.log('No hay datos de perfil');
                return false;
            }

            const requiredFields = ['nickname', 'description', 'age', 'photos', 'sexualPoses'];
            const hasAllFields = requiredFields.every(field => {
                const value = profile[field];
                if (field === 'photos') {
                    return value && Object.keys(value).length >= 3;
                }
                if (field === 'sexualPoses') {
                    return value && value.length >= 1;
                }
                return value && value.toString().trim() !== '';
            });

            console.log('Verificación de perfil:', {
                hasAllFields,
                profile: profile,
                requiredFields: requiredFields.map(field => ({
                    field,
                    hasValue: !!profile[field],
                    value: profile[field]
                }))
            });

            return hasAllFields;

        } catch (error) {
            console.error('Error verificando perfil en Firebase:', error);
            return false;
        }
    }

    showProfileCompletionModal() {
        // Prevenir múltiples modales
        const existingModal = document.querySelector('.profile-completion-modal');
        if (existingModal) {
            console.log('Modal ya existe, no crear otra');
            return;
        }

        // Crear modal de completar perfil
        const modal = document.createElement('div');
        modal.className = 'profile-completion-modal';
        modal.innerHTML = `
            <div class="modal-overlay">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2><i class="fas fa-user-plus"></i> Completa tu perfil</h2>
                    </div>
                    <div class="modal-body">
                        <p class="modal-description">Para acceder a todas las funcionalidades de la plataforma</p>
                        <div class="profile-requirements">
                            <div class="requirement-item">
                                <i class="fas fa-user"></i>
                                <span>Información básica</span>
                            </div>
                            <div class="requirement-item">
                                <i class="fas fa-camera"></i>
                                <span>3-6 fotos de perfil</span>
                            </div>
                            <div class="requirement-item">
                                <i class="fas fa-heart"></i>
                                <span>Poses favoritas</span>
                            </div>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn-primary" id="completeProfileBtn">
                            <i class="fas fa-check"></i>
                            Completar registro
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Agregar estilos usando el diseño del sitio
        const style = document.createElement('style');
        style.textContent = `
            .profile-completion-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: modalFadeIn 0.3s ease;
            }
            @keyframes modalFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            .profile-completion-modal .modal-overlay {
                background: transparent;
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 2rem;
            }
            .profile-completion-modal .modal-content {
                background: var(--background);
                border: 1px solid var(--border-color);
                border-radius: var(--border-radius-lg);
                box-shadow: var(--shadow-lg);
                max-width: 500px;
                width: 90%;
                max-height: 80vh;
                overflow-y: auto;
                animation: modalSlideIn 0.2s ease-out;
            }
            @keyframes modalSlideIn {
                from {
                    opacity: 0;
                    transform: translateY(-20px) scale(0.95);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
            .profile-completion-modal .modal-header {
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 1rem 1.5rem;
                border-bottom: 1px solid var(--border-color);
            }
            .profile-completion-modal .modal-header h2 {
                font-size: 1.25rem;
                font-weight: 700;
                color: var(--text-primary);
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }
            .profile-completion-modal .modal-header h2 i {
                color: var(--primary-color);
            }
            .profile-completion-modal .modal-body {
                padding: 1.5rem;
            }
            .profile-completion-modal .modal-description {
                color: var(--text-secondary);
                margin-bottom: 1.5rem;
                font-size: 0.9rem;
                line-height: 1.5;
            }
            .profile-completion-modal .profile-requirements {
                display: flex;
                flex-direction: column;
                gap: 1rem;
            }
            .profile-completion-modal .requirement-item {
                display: flex;
                align-items: center;
                gap: 1rem;
                padding: 1rem;
                background: var(--background-secondary);
                border: 1px solid var(--border-color);
                border-radius: var(--border-radius-sm);
                transition: var(--transition);
            }
            .profile-completion-modal .requirement-item:hover {
                background: var(--hover-bg);
                border-color: var(--primary-color);
            }
            .profile-completion-modal .requirement-item i {
                color: var(--primary-color);
                font-size: 1.2rem;
                min-width: 20px;
            }
            .profile-completion-modal .requirement-item span {
                color: var(--text-primary);
                font-size: 0.9rem;
                line-height: 1.4;
            }
            .profile-completion-modal .modal-actions {
                display: flex;
                justify-content: center;
                margin-top: 24px;
                padding-top: 20px;
                border-top: 1px solid var(--border-color);
            }
            .profile-completion-modal .btn-primary {
                padding: 12px 24px;
                border-radius: 8px;
                font-weight: 500;
                transition: all 0.2s ease;
                border: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                background: var(--primary-color);
                color: white;
            }
            .profile-completion-modal .btn-primary:hover {
                background: var(--primary-hover);
            }
            @media (max-width: 640px) {
                .profile-completion-modal .modal-content {
                    margin: 1rem;
                    max-width: none;
                }
                .profile-completion-modal .btn-primary {
                    width: 100%;
                    justify-content: center;
                }
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(modal);

        // Event listeners - Usar event delegation para mayor confiabilidad
        modal.addEventListener('click', (e) => {
            console.log('🔍 Click detectado en modal:', e.target);
            
            // Verificar si es el botón o un elemento dentro del botón
            if (e.target.id === 'completeProfileBtn' || 
                e.target.closest('#completeProfileBtn') || 
                e.target.classList.contains('btn-primary') ||
                e.target.closest('.btn-primary')) {
                
                e.preventDefault();
                e.stopPropagation();
                console.log('✅ Botón de completar perfil clickeado - Redirigiendo...');
                
                // Cerrar modal primero
                this.closeProfileModal(modal, style);
                
                // Redirigir después de un pequeño delay
                setTimeout(() => {
                    window.location.href = 'profile-complete.html';
                }, 100);
            }
        });
        
        // También agregar event listener directo como backup
        setTimeout(() => {
            const completeBtn = document.getElementById('completeProfileBtn');
            if (completeBtn) {
                console.log('✅ Agregando event listener directo al botón');
                completeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('✅ Botón clickeado directamente - Redirigiendo...');
                    this.closeProfileModal(modal, style);
                    setTimeout(() => {
                        window.location.href = 'profile-complete.html';
                    }, 100);
                });
            }
        }, 100);

        // Modal persistente - no se puede cerrar con ESC o click fuera
    }
    
    closeProfileModal(modal, style) {
        try {
            if (modal && modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
            if (style && style.parentNode) {
                style.parentNode.removeChild(style);
            }
        } catch (error) {
            console.error('Error cerrando modal:', error);
        }
    }

    updateAuthUI() {
        console.log('⚙️ updateAuthUI called.');
        const authButton = document.getElementById('authButton');
        if (!authButton) {
            console.log('⚠️ authButton not found in updateAuthUI.');
            return;
        }
        
        // Limpiar onclick previo para evitar múltiples listeners
        authButton.onclick = null;

        if (this.currentUser) {
            console.log('User is signed in. Updating authButton for logout.');
            authButton.innerHTML = `<img src="${this.currentUser.profileImageUrl}" alt="${this.currentUser.name}" class="user-avatar-small"> ${this.currentUser.name}`;
            authButton.onclick = () => window.Clerk.signOut(); 
            authButton.title = 'Cerrar sesión';
        } else {
            console.log('User is signed out. Updating authButton for sign in.');
            authButton.innerHTML = '<i class="fas fa-user"></i> Iniciar Sesión';
            // El onclick ahora se maneja en setupEventListeners
            // authButton.onclick = () => this.showAuthUI(); 
            authButton.title = 'Iniciar sesión';
        }
    }

    forceAuthStateUpdate() {
        console.log('🔄 Forzando actualización del estado de autenticación...');
        
        // Disparar evento personalizado para notificar a otros componentes
        const authEvent = new CustomEvent('authStateChanged', {
            detail: { user: this.currentUser, isAuthenticated: !!this.currentUser }
        });
        window.dispatchEvent(authEvent);
        
        // Actualizar elementos que dependen de la autenticación
        this.updateAuthDependentElements();
    }

    updateAuthDependentElements() {
        // Actualizar elementos que cambian según el estado de autenticación
        const elements = document.querySelectorAll('[data-auth-required]');
        elements.forEach(el => {
            if (this.currentUser) {
                el.style.display = el.dataset.authRequired === 'true' ? 'block' : 'none';
            } else {
                el.style.display = el.dataset.authRequired === 'true' ? 'none' : 'block';
            }
        });
        
        // Actualizar botones de acción que requieren autenticación
        const actionButtons = document.querySelectorAll('[data-requires-auth]');
        actionButtons.forEach(btn => {
            if (this.currentUser) {
                btn.disabled = false;
                btn.style.opacity = '1';
            } else {
                btn.disabled = true;
                btn.style.opacity = '0.5';
            }
        });
    }

    async showAuthUI() {
        console.log('🚀 showAuthUI called.');
        
        if (!window.Clerk) {
            console.warn('❌ Clerk SDK not available. Waiting for it to load...');
            this.showNotification('Cargando sistema de autenticación...', 'info');
            
            // Intentar esperar un poco más para que Clerk se cargue
            setTimeout(() => {
                if (window.Clerk) {
                    console.log('✅ Clerk SDK now available, retrying...');
                    this.showAuthUI();
                } else {
                    console.error('❌ Clerk SDK still not available after retry');
                    this.showNotification('Error: Sistema de autenticación no disponible', 'error');
                }
            }, 2000);
            return;
        }
        
        console.log('✅ Clerk available. Opening sign-in...');
        
        try {
            // Clerk ya fue inicializado en index.html con su bundle de UI.
            // NO volver a llamar load() aquí (sin {ui} desactivaría los componentes).
            var clerk = window.__DESEO_CLERK__ || window.Clerk;

            if (clerk && typeof clerk.openSignIn === 'function') {
                console.log('✅ Abriendo modal de sign-in con Clerk...');
                clerk.openSignIn();
            } else {
                // Fallback: montar el componente sign-in en el contenedor dedicado.
                var target = document.getElementById('authContainer');
                if (clerk && typeof clerk.mountSignIn === 'function' && target) {
                    console.log('✅ Montando sign-in con mountSignIn...');
                    target.classList.add('active');
                    clerk.mountSignIn(target);
                } else {
                    throw new Error('Clerk.openSignIn no está disponible');
                }
            }
            
        } catch (error) {
            console.error('❌ Error opening Clerk sign-in:', error);
            this.showNotification('Error al abrir el formulario de autenticación', 'error');
        }
    }

    // ===== INICIALIZACIÓN DE LA APLICACIÓN =====
    async initializeApp() {
        try {
            this.loadSavedTheme();
            await this.initializeMapbox();
            this.setupEventListeners();
            this.initializeFirebase();
            this.initializeUnreadChatsAlert();
            this.initializeNewMessagesNotification();
            
            // Verificar sesión existente al inicializar
            this.checkExistingSession();
            
            // Limpiar chats con IDs incorrectos al inicializar
            setTimeout(() => {
                this.cleanupInvalidChats();
            }, 2000);
            
            // Solo generar deseos de muestra si Firebase no está habilitado
            if (!CONFIG.FIREBASE.enabled) {
            this.generateSampleWishes();
            }
            
            this.renderWishesOnMap();
            
            setTimeout(() => {
                this.gemini = this.initializeGeminiClient();
                console.log('Gemini client initialized:', !!this.gemini);
            }, 1000);

            this.showNotification('¡Bienvenido a Deseo! Explora deseos cerca de ti.', 'success');
        } catch (error) {
            console.error('Error inicializando la aplicación:', error);
            this.showNotification('Error al cargar el mapa. Verifica tu token de Mapbox.', 'error');
        }
    }

    checkExistingSession() {
        console.log('🔍 Verificando sesión existente...');
        
        // Verificar si hay datos de usuario en localStorage
        const userData = localStorage.getItem('deseo_user');
        if (userData) {
            try {
                this.currentUser = JSON.parse(userData);
                console.log('✅ Usuario encontrado en localStorage:', this.currentUser.name);
                this.updateAuthUI();
                this.forceAuthStateUpdate();
                return true;
            } catch (e) {
                console.error('❌ Error parseando datos de usuario:', e);
                localStorage.removeItem('deseo_user');
            }
        }
        
        // Si no hay datos locales, verificar con Clerk
        if (window.Clerk && window.Clerk.user) {
            console.log('✅ Usuario encontrado en Clerk');
            this.handleClerkSignIn(window.Clerk.user);
            return true;
        }
        
        console.log('⚠️ No hay sesión activa');
        this.updateAuthUI();
        return false;
    }

    // ===== INICIALIZACIÓN DE MAPBOX =====
    async initializeMapbox() {
        if (!isMapboxTokenConfigured()) {
            throw new Error('Token de Mapbox no configurado. Por favor, configura tu token en config.js');
        }

        // Configurar el token de Mapbox
        mapboxgl.accessToken = MAPBOX_TOKEN;

        // Crear el mapa
        this.map = new mapboxgl.Map({
            container: 'map',
            style: MAP_CONFIG.styles[MAP_CONFIG.defaultStyle],
            center: MAP_CONFIG.defaultCenter,
            zoom: MAP_CONFIG.defaultZoom,
            attributionControl: false
        });

        // Esperar a que el mapa se cargue
        await new Promise((resolve) => {
            this.map.on('load', resolve);
        });

        // Aplicar el estilo del mapa según el tema actual
        if (this.currentTheme) {
            this.updateMapStyle(this.currentTheme);
        }

        // Añadir controles de navegación
        this.map.addControl(new mapboxgl.NavigationControl(), 'top-right');
        
        // Añadir control de geolocalización
        this.map.addControl(new mapboxgl.GeolocateControl({
            positionOptions: {
                enableHighAccuracy: true
            },
            trackUserLocation: true,
            showUserHeading: true
        }), 'top-right');

        // Configurar eventos del mapa
        this.setupMapEvents();
        
        // Intentar geolocalización automática al cargar
        this.autoLocateUser();
    }

    setupMapEvents() {
        // Evento cuando el usuario hace clic en el mapa
        this.map.on('click', (e) => {
            console.log('Click en coordenadas:', e.lngLat);
        });

        // Evento cuando el mapa se mueve
        this.map.on('moveend', () => {
            const center = this.map.getCenter();
            console.log('Centro del mapa:', center);
        });
    }

    // ===== CONFIGURACIÓN DE EVENT LISTENERS (DeseoApp) =====
    setupEventListeners() {
        console.log('🔧 Setting up event listeners...');
        
        // Botones principales con verificaciones defensivas
        const floatingAvailabilityBtn = document.getElementById('floatingAvailabilityBtn');
        if (floatingAvailabilityBtn) {
            floatingAvailabilityBtn.addEventListener('click', () => this.openAvailabilityModal());
        } else {
            console.warn('⚠️ floatingAvailabilityBtn not found');
        }

        // Botón "Publicarme" en el sidebar
        const publishBtn = document.getElementById('publishBtn');
        if (publishBtn) {
            publishBtn.addEventListener('click', () => {
                if (!this.currentUser) {
                    this.showAuthModal();
                    return;
                }
                this.openAvailabilityModal();
            });
        } else {
            console.warn('⚠️ publishBtn not found');
        }

        // Botón de filtro móvil
        const mobileFilterBtn = document.getElementById('mobileFilterBtn');
        if (mobileFilterBtn) {
            mobileFilterBtn.addEventListener('click', () => this.openFilterModal());
        } else {
            console.warn('⚠️ mobileFilterBtn not found');
        }

        // Botón de filtro flotante (esquina superior izquierda)
        const filterFloatingBtn = document.getElementById('filterFloatingBtn');
        if (filterFloatingBtn) {
            filterFloatingBtn.addEventListener('click', () => this.openFilterModal());
        } else {
            console.warn('⚠️ filterFloatingBtn not found');
        }

        const filterBtn = document.getElementById('filterBtn');
        if (filterBtn) {
            filterBtn.addEventListener('click', () => this.openFilterModal());
        } else {
            console.warn('⚠️ filterBtn not found');
        }

        // NOTA: El botón #themeToggle es gestionado por theme-manager.js
        // (fuente única de verdad). Aquí NO añadimos otro listener de click
        // porque provocaba un DOBLE toggle (theme-manager + este script),
        // dejando el tema sin cambios visibles. En su lugar escuchamos el
        // evento 'themeChanged' que dispara el ThemeManager para actualizar
        // el estilo del mapa y mostrar la notificación.
        if (!this._themeChangeBound) {
            this._themeChangeBound = true;
            window.addEventListener('themeChanged', (e) => {
                const theme = e && e.detail ? e.detail.theme : null;
                if (!theme) return;
                this.updateMapStyle(theme);
                this.showNotification(`Tema cambiado a ${theme === 'light' ? 'claro' : 'oscuro'}`, 'success');
            });
        }
        if (!document.getElementById('themeToggle')) {
            console.warn('⚠️ themeToggle not found');
        }

        // Toggle del sidebar para ocultar/mostrar el menú
        // Usamos delegación en document para máxima fiabilidad (el botón puede
        // re-renderizarse o existir en distintos contenedores).
        if (!this._sidebarToggleBound) {
            this._sidebarToggleBound = true;
            document.addEventListener('click', (e) => {
                const toggle = e.target.closest && e.target.closest('#sidebarToggle');
                if (toggle) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleSidebarMenu();
                }
            }, true); // fase de captura para adelantarnos a otros handlers
        }
        const sidebarToggle = document.getElementById('sidebarToggle');
        if (!sidebarToggle) {
            console.warn('⚠️ sidebarToggle not found');
        }

        // Botón de cerrar del menú móvil (full screen)
        if (!this._mobileMenuCloseBound) {
            this._mobileMenuCloseBound = true;
            document.addEventListener('click', (e) => {
                const closeBtn = e.target.closest && e.target.closest('#mobileMenuClose');
                if (closeBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closeMobileMenu();
                }
            }, true); // fase de captura para adelantarnos a otros handlers
        }
        const mobileMenuClose = document.getElementById('mobileMenuClose');
        if (!mobileMenuClose) {
            console.warn('⚠️ mobileMenuClose not found');
        }

        // Botón "Publicarme" móvil
        const mobilePublishBtn = document.getElementById('mobilePublishBtn');
        if (mobilePublishBtn) {
            mobilePublishBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (!this.currentUser) {
                    this.showAuthModal();
                    this.closeMobileMenu();
                    return;
                }
                this.openAvailabilityModal();
                this.closeMobileMenu();
            });
        } else {
            console.warn('⚠️ mobilePublishBtn not found');
        }

        // Event listeners para cerrar menú móvil al hacer clic en enlaces
        this.setupMobileMenuLinks();
        
        // Configurar enlaces de navegación con verificación de autenticación
        this.setupNavigationLinks();

        const authButton = document.getElementById('authButton');
        if (authButton) {
            authButton.addEventListener('click', () => {
                if (this.currentUser) {
                    window.Clerk.signOut();
                } else {
                    this.showAuthUI();
                }
            });
        } else {
            console.warn('⚠️ authButton not found');
        }

        // Sidebar - Búsqueda y filtros con verificaciones defensivas
        const wishSearchInput = document.getElementById('wishSearchInput');
        if (wishSearchInput) {
            wishSearchInput.addEventListener('input', (e) => {
                console.log('Buscando deseos:', e.target.value);
                this.renderAvailableProfilesInSidebar();
                this.renderWishesOnMap();
            });
        } else {
            console.warn('⚠️ wishSearchInput not found');
        }

        const categoryFilterSidebar = document.getElementById('categoryFilterSidebar');
        if (categoryFilterSidebar) {
            categoryFilterSidebar.addEventListener('change', () => this.applySidebarFilters());
        } else {
            console.warn('⚠️ categoryFilterSidebar not found');
        }

        const priceFilterSidebar = document.getElementById('priceFilterSidebar');
        if (priceFilterSidebar) {
            priceFilterSidebar.addEventListener('input', (e) => {
                const priceValueSidebar = document.getElementById('priceValueSidebar');
                if (priceValueSidebar) {
                    priceValueSidebar.textContent = `$${e.target.value}`;
                }
            });
        } else {
            console.warn('⚠️ priceFilterSidebar not found');
        }

        const applySidebarFiltersBtn = document.getElementById('applySidebarFiltersBtn');
        if (applySidebarFiltersBtn) {
            applySidebarFiltersBtn.addEventListener('click', () => this.applySidebarFilters());
        } else {
            console.warn('⚠️ applySidebarFiltersBtn not found');
        }

        // Modales - botones de cerrar con verificaciones defensivas
        const closeCreateModal = document.getElementById('closeCreateModal');
        if (closeCreateModal) {
            closeCreateModal.addEventListener('click', () => this.closeModal('createWishModal'));
        } else {
            console.warn('⚠️ closeCreateModal not found');
        }

        const closeChatModal = document.getElementById('closeChatModal');
        if (closeChatModal) {
            closeChatModal.addEventListener('click', () => this.closeModal('privateChatModal'));
        } else {
            console.warn('⚠️ closeChatModal not found');
        }

        const closeRatingModal = document.getElementById('closeRatingModal');
        if (closeRatingModal) {
            closeRatingModal.addEventListener('click', () => this.closeModal('ratingModal'));
        } else {
            console.warn('⚠️ closeRatingModal not found');
        }

        const closeFilterModal = document.getElementById('closeFilterModal');
        if (closeFilterModal) {
            closeFilterModal.addEventListener('click', () => this.closeModal('filterModal'));
        } else {
            console.warn('⚠️ closeFilterModal not found');
        }

        // Chat con IA con verificaciones defensivas
        const sendAiMessage = document.getElementById('sendAiMessage');
        if (sendAiMessage) {
            sendAiMessage.addEventListener('click', () => this.sendAIMessage());
        } else {
            console.warn('⚠️ sendAiMessage not found');
        }

        const aiChatInput = document.getElementById('aiChatInput');
        if (aiChatInput) {
            aiChatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendAIMessage();
        });
        } else {
            console.warn('⚠️ aiChatInput not found');
        }

        // Publicar deseo con verificación defensiva
        const publishWish = document.getElementById('publishWish');
        if (publishWish) {
            publishWish.addEventListener('click', () => this.publishWish());
        } else {
            console.warn('⚠️ publishWish not found');
        }

        // Tarjeta de detalles del deseo (botones de acción) con verificaciones defensivas
        const acceptWishBtnCard = document.getElementById('acceptWishBtnCard');
        if (acceptWishBtnCard) {
            acceptWishBtnCard.addEventListener('click', () => this.acceptWishFromCard());
        } else {
            console.warn('⚠️ acceptWishBtnCard not found');
        }

        const viewChatBtnCard = document.getElementById('viewChatBtnCard');
        if (viewChatBtnCard) {
            viewChatBtnCard.addEventListener('click', () => this.openPrivateChatForCurrentWish());
        } else {
            console.warn('⚠️ viewChatBtnCard not found');
        }

        // Chat privado con verificaciones defensivas
        const sendPrivateMessage = document.getElementById('sendPrivateMessage');
        if (sendPrivateMessage) {
            sendPrivateMessage.addEventListener('click', () => this.sendPrivateMessage());
        } else {
            console.warn('⚠️ sendPrivateMessage not found');
        }

        const privateChatInput = document.getElementById('privateChatInput');
        if (privateChatInput) {
            privateChatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendPrivateMessage();
        });
        } else {
            console.warn('⚠️ privateChatInput not found');
        }

        // Completar deseo con verificación defensiva
        const completeWishBtn = document.getElementById('completeWishBtn');
        if (completeWishBtn) {
            completeWishBtn.addEventListener('click', () => this.completeWish());
        } else {
            console.warn('⚠️ completeWishBtn not found');
        }

        // Calificación con verificaciones defensivas
        const fulfilledBtn = document.getElementById('fulfilledBtn');
        if (fulfilledBtn) {
            fulfilledBtn.addEventListener('click', () => this.setFulfillmentStatus(true));
        } else {
            console.warn('⚠️ fulfilledBtn not found');
        }

        const unfulfilledBtn = document.getElementById('unfulfilledBtn');
        if (unfulfilledBtn) {
            unfulfilledBtn.addEventListener('click', () => this.setFulfillmentStatus(false));
        } else {
            console.warn('⚠️ unfulfilledBtn not found');
        }

        const submitRating = document.getElementById('submitRating');
        if (submitRating) {
            submitRating.addEventListener('click', () => this.submitRating());
        } else {
            console.warn('⚠️ submitRating not found');
        }

        // Estrellas de calificación con verificación defensiva
        const starRating = document.getElementById('starRating');
        if (starRating) {
            const stars = starRating.querySelectorAll('i');
            stars.forEach((star, index) => {
            star.addEventListener('click', () => this.setStarRating(index + 1));
            star.addEventListener('mouseenter', () => this.highlightStars(index + 1));
        });
            starRating.addEventListener('mouseleave', () => this.resetStarHighlight());
        } else {
            console.warn('⚠️ starRating not found');
        }

        // Filtros (solo categoría)
        const applyFiltersBtn = document.getElementById('applyFilters');
        if (applyFiltersBtn) {
            applyFiltersBtn.addEventListener('click', () => this.applyFilters());
        } else {
            console.warn('⚠️ applyFilters button not found');
        }

        // Botón limpiar filtros
        const clearFiltersBtn = document.getElementById('clearFilters');
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => this.clearFilters());
        } else {
            console.warn('⚠️ clearFilters button not found');
        }

        // Cerrar modales al hacer click fuera
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });
    }

    // ===== CONTROLES DEL MAPA =====
    autoLocateUser() {
        if (navigator.geolocation) {
            // Mostrar indicador de carga
            this.showNotification('Obteniendo tu ubicación...', 'info');
            
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude, longitude } = position.coords;
                    this.userLocation = { lat: latitude, lng: longitude };
                    
                    // Centrar el mapa en la ubicación del usuario con animación suave
                    this.map.flyTo({
                        center: [longitude, latitude],
                        zoom: 14,
                        essential: true,
                        duration: 2000 // 2 segundos de animación
                    });
                    
                    // Agregar marcador de ubicación del usuario
                    this.addUserLocationMarker(longitude, latitude);
                    
                    this.showNotification('¡Ubicación encontrada! Mapa centrado en tu posición', 'success');
                },
                (error) => {
                    console.warn('No se pudo obtener ubicación automáticamente:', error);
                    // No mostrar error al usuario, simplemente usar ubicación por defecto
                    this.showNotification('Usando ubicación por defecto. Puedes usar el botón de ubicación para centrar el mapa en tu posición', 'info');
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000, // 10 segundos máximo
                    maximumAge: 300000 // Cache por 5 minutos
                }
            );
        } else {
            console.warn('Geolocalización no soportada por el navegador');
            this.showNotification('Geolocalización no disponible. Usando ubicación por defecto', 'info');
        }
    }

    locateUser() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude, longitude } = position.coords;
                    this.userLocation = { lat: latitude, lng: longitude };
                    
                    this.map.flyTo({
                        center: [longitude, latitude],
                        zoom: 15,
                        essential: true
                    });
                    
                    // Agregar/actualizar marcador de ubicación del usuario
                    this.addUserLocationMarker(longitude, latitude);
                    
                    this.showNotification('Ubicación encontrada', 'success');
                },
                (error) => {
                    console.error('Error obteniendo ubicación:', error);
                    this.showNotification('No se pudo obtener tu ubicación', 'error');
                }
            );
        } else {
            this.showNotification('Geolocalización no soportada', 'error');
        }
    }

    zoomIn() {
        const currentZoom = this.map.getZoom();
        this.map.zoomTo(currentZoom + 1);
    }

    zoomOut() {
        const currentZoom = this.map.getZoom();
        this.map.zoomTo(currentZoom - 1);
    }

    // ===== MARCADOR DE UBICACIÓN DEL USUARIO =====
    addUserLocationMarker(lng, lat) {
        // Remover marcador anterior si existe
        if (this.userLocationMarker) {
            this.userLocationMarker.remove();
        }

        // Crear elemento HTML para el marcador del usuario
        const userMarkerElement = document.createElement('div');
        userMarkerElement.className = 'user-location-marker';
        userMarkerElement.innerHTML = `
            <div class="user-marker-pulse"></div>
            <div class="user-marker-icon">
                <i class="fas fa-map-marker-alt"></i>
            </div>
        `;

        // Crear marcador de Mapbox
        this.userLocationMarker = new mapboxgl.Marker({
            element: userMarkerElement,
            anchor: 'center'
        })
        .setLngLat([lng, lat])
        .addTo(this.map);

        // Agregar popup informativo
        const popup = new mapboxgl.Popup({
            offset: 25,
            closeButton: false,
            closeOnClick: false
        })
        .setHTML(`
            <div class="user-location-popup">
                <h4>📍 Tu ubicación</h4>
                <p>Estás aquí</p>
            </div>
        `);

        this.userLocationMarker.setPopup(popup);
    }

    // ===== GENERACIÓN DE DATOS DE PRUEBA (ADAPTADO PARA DESEOS) =====
    generateSampleWishes() { // Renombrado de generateSampleStores a generateSampleWishes
        // Sin datos de prueba: los deseos/perfiles se cargan solo desde Firebase.
        // Se mantiene el método para no romper llamadas existentes.
        this.wishes = [];
    }


    // ===== RENDERIZADO DEL MAPA =====
    renderWishesOnMap() { // Renombrado de renderStoresOnMap a renderWishesOnMap
        // Limpiar marcadores existentes
        this.clearMarkers();

        this.wishes
            .filter(wish => wish.status === 'active') // Filtrar deseos activos
            .filter(wish => this.passesWishFilters(wish)) // Cambiado de passesStoreFilters a passesWishFilters
            .forEach(wish => {
                this.addWishMarker(wish); // Cambiado de addStoreMarker a addWishMarker
            });
    }

    clearMarkers() {
        this.markers.forEach(marker => marker.remove());
        this.markers = [];
    }

    addWishMarker(wish) { // Renombrado de addStoreMarker a addWishMarker
        // Crear elemento HTML para el marcador
        const markerElement = document.createElement('div');
        markerElement.className = 'wish-marker'; // Nueva clase para marcadores de deseos
        
        // Icono según categoría y precio
        const categoryIcon = this.getCategoryIcon(wish.category); // Usar la función de icono de categoría

        markerElement.innerHTML = `
            <i class="${categoryIcon}"></i>
            <span class="marker-price">$${wish.price}</span>
        `;

        // Crear marcador de Mapbox
        const marker = new mapboxgl.Marker({
            element: markerElement,
            anchor: 'bottom'
        })
            .setLngLat([wish.location.lng, wish.location.lat])
            .addTo(this.map);

        // Crear popup (simple, la tarjeta flotante es para detalles)
        const popup = new mapboxgl.Popup({
            offset: 25,
            closeButton: false,
            closeOnClick: false
        }).setHTML(this.createWishPopupHTML(wish)); // Cambiado de createStorePopupHTML a createWishPopupHTML

        marker.setPopup(popup);

        // Evento de clic en el marcador para mostrar detalles del perfil
        markerElement.addEventListener('click', () => {
            this.showProfileDetails(wish); // Mostrar detalles del perfil en modal tipo Tinder
        });

        this.markers.push(marker);
    }

    createWishPopupHTML(wish) { // Renombrado de createStorePopupHTML a createWishPopupHTML
        const __title = (typeof escapeHtml === 'function') ? escapeHtml(wish.title) : wish.title;
        const __price = (typeof escapeInt === 'function') ? escapeInt(wish.price, '') : wish.price;
        const __cat = (typeof escapeHtml === 'function') ? escapeHtml(this.getCategoryName(wish.category)) : this.getCategoryName(wish.category);
        return `
            <div class="wish-marker-popup">
                <h3>${__title}</h3>
                <p>${__price} • ${__cat}</p>
            </div>
        `;
    }

    // ===== MODALES =====
    openModal(modalId) {
        document.getElementById(modalId).classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
        document.body.style.overflow = 'auto';
    }

    // ===== MODAL DE DISPONIBILIDAD =====
    openAvailabilityModal() {
        this.openModal('availabilityModal');
        this.setupAvailabilityModal();
    }

    setupAvailabilityModal() {
        // Prevenir múltiples event listeners
        if (this.availabilityModalSetup) {
            console.log('Modal de disponibilidad ya configurado');
            return;
        }
        this.availabilityModalSetup = true;

        const toggle = document.getElementById('availabilityToggle');
        const categorySelection = document.getElementById('categorySelection');
        const categoryCards = document.querySelectorAll('.category-card');
        const saveBtn = document.getElementById('saveAvailability');

        // Verificar si el usuario ya está disponible
        this.checkCurrentAvailabilityStatus();

        // Manejar toggle de disponibilidad
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    categorySelection.style.display = 'block';
                } else {
                    categorySelection.style.display = 'none';
                }
            });
        }

        // Manejar selección de categorías
        categoryCards.forEach(card => {
            card.addEventListener('click', () => {
                // Remover selección anterior
                categoryCards.forEach(c => c.classList.remove('selected'));
                // Seleccionar nueva categoría
                card.classList.add('selected');
            });
        });

        // Manejar botón guardar
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.saveAvailabilityStatus();
            });
        }

        // Manejar cancelar
        const cancelBtn = document.getElementById('cancelAvailability');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.closeModal('availabilityModal');
            });
        }
    }

    // ===== NUEVA FUNCIÓN UNIFICADA PARA GUARDAR DISPONIBILIDAD =====
    async saveAvailabilityStatus() {
        const saveBtn = document.getElementById('saveAvailability');
        
        // Función para restaurar el botón
        const restoreButton = () => {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Guardar';
            }
        };
        
        try {
            console.log('🔍 [DEBUG] saveAvailabilityStatus iniciado');
            
            // Verificar autenticación
            if (!this.currentUser) {
                console.log('❌ Usuario no autenticado');
                this.showAuthModal();
                restoreButton();
                return;
            }

            const toggle = document.getElementById('availabilityToggle');
            const isAvailable = toggle.checked;
            console.log('🔍 [DEBUG] Estado del switch:', isAvailable);

            // Deshabilitar botón para prevenir múltiples envíos
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
            }

            // Timeout de seguridad de 10 segundos
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error('Timeout: La operación tardó demasiado'));
                }, 10000);
            });

            // Ejecutar la operación con timeout
            await Promise.race([
                isAvailable ? this.setUserAvailable() : this.setUserUnavailable(),
                timeoutPromise
            ]);

            // Cerrar modal y mostrar notificación
            this.closeModal('availabilityModal');
            const message = isAvailable ? '¡Disponibilidad marcada exitosamente!' : '¡Ya no estás disponible!';
            this.showNotification(message, 'success');

            console.log('✅ saveAvailabilityStatus completado exitosamente');

        } catch (error) {
            console.error('❌ Error guardando estado de disponibilidad:', error);
            const errorMessage = error.message.includes('Timeout') ? 
                'La operación tardó demasiado. Inténtalo de nuevo.' : 
                'Error al guardar disponibilidad';
            this.showNotification(errorMessage, 'error');
        } finally {
            // Restaurar botón siempre
            restoreButton();
        }
    }

    async setUserAvailable() {
        console.log('🔍 [DEBUG] setUserAvailable iniciado');
        
        // Verificar si ya está disponible para evitar duplicados
        const existingProfile = this.availableProfiles.find(profile => profile.userId === this.currentUser.id);
        if (existingProfile) {
            console.log('⚠️ Usuario ya está disponible');
            throw new Error('Ya estás marcado como disponible');
        }

        // Obtener datos del formulario
        const selectedCategory = document.querySelector('.category-card.selected');
        if (!selectedCategory) {
            console.log('❌ No se seleccionó categoría');
            throw new Error('Por favor selecciona una categoría');
        }

        // Crear objeto de disponibilidad
        const availabilityData = {
            userId: this.currentUser.id,
            userName: this.currentUser.name,
            userEmail: this.currentUser.email,
            userProfileImage: this.currentUser.profileImageUrl,
            category: selectedCategory.dataset.category,
            location: this.userLocation,
            isAvailable: true,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };

        console.log('🔍 [DEBUG] Datos de disponibilidad:', availabilityData);

        // Guardar en Firebase
        const newProfileRef = await this.saveAvailabilityToFirebase(availabilityData);
        
        // Agregar localmente con el ID de Firebase
        const newProfile = {
            id: newProfileRef.key,
            ...availabilityData
        };
        this.availableProfiles.push(newProfile);
        
        // Actualizar UI inmediatamente
        this.renderAvailableProfilesOnMap();
        this.renderAvailableProfilesInSidebar();
        this.updateAvailabilityFabState();
        
        console.log('✅ setUserAvailable completado exitosamente');
    }

    async setUserUnavailable() {
        console.log('🔍 [DEBUG] setUserUnavailable iniciado');
        
        // Buscar el perfil del usuario en la lista de disponibles
        const existingProfile = this.availableProfiles.find(profile => profile.userId === this.currentUser.id);
        if (!existingProfile) {
            console.log('⚠️ Usuario no está marcado como disponible');
            throw new Error('No estás marcado como disponible');
        }

        console.log('🔍 [DEBUG] Perfil encontrado para eliminar:', existingProfile.id);

        // Eliminar de Firebase
        await this.removeAvailabilityFromFirebase(existingProfile.id);

        // Eliminar localmente también
        const localIndex = this.availableProfiles.findIndex(profile => profile.userId === this.currentUser.id);
        if (localIndex !== -1) {
            this.availableProfiles.splice(localIndex, 1);
            console.log('✅ Perfil eliminado localmente');
        }

        // Actualizar UI inmediatamente
        this.renderAvailableProfilesOnMap();
        this.renderAvailableProfilesInSidebar();
        this.updateAvailabilityFabState();
        
        console.log('✅ setUserUnavailable completado exitosamente');
    }

    async submitAvailability() {
        // Esta función se mantiene para compatibilidad pero ahora redirige a la nueva función
        console.log('⚠️ submitAvailability está deprecado, usando saveAvailabilityStatus');
        await this.saveAvailabilityStatus();
    }

    async saveAvailabilityToFirebase(availabilityData) {
        try {
            if (!this.database) {
                throw new Error('Firebase no disponible');
            }

            // Guardar en la colección de perfiles disponibles
            const availabilityRef = this.database.ref('availableProfiles').push();
            await availabilityRef.set(availabilityData);

            console.log('✅ Disponibilidad guardada en Firebase');
            return availabilityRef;
        } catch (error) {
            console.error('❌ Error guardando disponibilidad:', error);
            throw error;
        }
    }

    // ===== FUNCIONES PARA MANEJAR DISPONIBILIDAD =====
    checkCurrentAvailabilityStatus() {
        if (!this.currentUser) return;

        const existingProfile = this.availableProfiles.find(profile => profile.userId === this.currentUser.id);
        const toggle = document.getElementById('availabilityToggle');
        const categorySelection = document.getElementById('categorySelection');

        if (existingProfile) {
            // Usuario ya está disponible
            console.log('🔍 [DEBUG] Usuario ya está disponible, configurando UI');
            toggle.checked = true;
            categorySelection.style.display = 'block';
            
            // Preseleccionar la categoría actual si existe
            const currentCategory = existingProfile.category;
            if (currentCategory) {
                const categoryCard = document.querySelector(`[data-category="${currentCategory}"]`);
                if (categoryCard) {
                    // Remover selección anterior
                    document.querySelectorAll('.category-card').forEach(c => c.classList.remove('selected'));
                    // Seleccionar categoría actual
                    categoryCard.classList.add('selected');
                }
            }
        } else {
            // Usuario no está disponible
            console.log('🔍 [DEBUG] Usuario no está disponible, configurando UI');
            toggle.checked = false;
            categorySelection.style.display = 'none';
        }
    }

    async markAsUnavailable() {
        try {
            console.log('🔍 [DEBUG] Iniciando markAsUnavailable...');
            
            if (!this.currentUser) {
                console.log('❌ Usuario no autenticado');
                this.showAuthModal();
                return;
            }

            console.log('🔍 [DEBUG] Usuario actual:', this.currentUser.id);
            console.log('🔍 [DEBUG] Perfiles disponibles actuales:', this.availableProfiles.length);

            // Buscar el perfil del usuario en la lista de disponibles
            const existingProfile = this.availableProfiles.find(profile => profile.userId === this.currentUser.id);
            console.log('🔍 [DEBUG] Perfil existente encontrado:', existingProfile);
            
            if (!existingProfile) {
                console.log('❌ No se encontró perfil disponible');
                this.showNotification('No estás marcado como disponible', 'warning');
                return;
            }

            console.log('🔍 [DEBUG] ID del perfil a eliminar:', existingProfile.id);

            // Deshabilitar botón para prevenir múltiples clics
            const markUnavailableBtn = document.getElementById('markUnavailable');
            if (markUnavailableBtn) {
                markUnavailableBtn.disabled = true;
                markUnavailableBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
            }

            // Eliminar de Firebase
            console.log('🔍 [DEBUG] Eliminando de Firebase...');
            await this.removeAvailabilityFromFirebase(existingProfile.id);

            // Eliminar localmente también
            console.log('🔍 [DEBUG] Eliminando localmente...');
            const localIndex = this.availableProfiles.findIndex(profile => profile.userId === this.currentUser.id);
            if (localIndex !== -1) {
                this.availableProfiles.splice(localIndex, 1);
                console.log('✅ Perfil eliminado localmente');
            }

            // Actualizar UI inmediatamente
            this.renderAvailableProfilesOnMap();
            this.renderAvailableProfilesInSidebar();

            // Cerrar modal y mostrar notificación
            this.closeModal('availabilityModal');
            this.showNotification('¡Ya no estás disponible!', 'success');

            console.log('✅ markAsUnavailable completado exitosamente');

        } catch (error) {
            console.error('❌ Error marcándose como no disponible:', error);
            this.showNotification('Error al actualizar disponibilidad', 'error');
            
            // Restaurar botón en caso de error
            const markUnavailableBtn = document.getElementById('markUnavailable');
            if (markUnavailableBtn) {
                markUnavailableBtn.disabled = false;
                markUnavailableBtn.innerHTML = '<i class="fas fa-times"></i> No Disponible';
            }
        }
    }

    async removeAvailabilityFromFirebase(profileId) {
        try {
            console.log('🔍 [DEBUG] removeAvailabilityFromFirebase iniciado');
            console.log('🔍 [DEBUG] profileId:', profileId);
            
            if (!this.database) {
                console.log('❌ Firebase no disponible');
                throw new Error('Firebase no disponible');
            }

            console.log('🔍 [DEBUG] Firebase disponible, procediendo a eliminar...');

            // Eliminar de la colección de perfiles disponibles
            const profileRef = this.database.ref(`availableProfiles/${profileId}`);
            console.log('🔍 [DEBUG] Referencia creada:', profileRef.toString());
            
            await profileRef.remove();
            console.log('✅ Disponibilidad eliminada de Firebase exitosamente');
            
        } catch (error) {
            console.error('❌ Error eliminando disponibilidad:', error);
            console.error('🔍 [DEBUG] Error details:', error.message);
            console.error('🔍 [DEBUG] Error code:', error.code);
            throw error;
        }
    }

    // ===== CARGAR PERFILES DISPONIBLES =====
    async loadAvailableProfiles() {
        try {
            console.log('🔍 [DEBUG] loadAvailableProfiles iniciado');
            
            if (!this.database) {
                console.warn('Firebase no disponible para cargar perfiles');
                return;
            }

            // Limpiar array antes de cargar
            this.availableProfiles = [];
            console.log('🧹 Array de perfiles limpiado antes de cargar');

            console.log('🔍 Cargando perfiles disponibles...');
            
            const profilesRef = this.database.ref('availableProfiles');
            const snapshot = await profilesRef.once('value');
            const profilesData = snapshot.val();

            console.log('🔍 [DEBUG] Datos de Firebase:', profilesData);

            if (profilesData) {
                // Convertir a array y agregar IDs
                const profilesArray = Object.keys(profilesData).map(key => ({
                    id: key,
                    ...profilesData[key]
                }));
                
                console.log('🔍 [DEBUG] Perfiles con IDs:', profilesArray);
                
                // Filtrar solo los disponibles
                const availableProfiles = profilesArray.filter(profile => profile.isAvailable);
                console.log(`✅ ${availableProfiles.length} perfiles disponibles cargados`);
                
                // Limpiar duplicados por userId
                const uniqueProfiles = availableProfiles.reduce((acc, profile) => {
                    if (!acc.find(p => p.userId === profile.userId)) {
                        acc.push(profile);
                    } else {
                        console.log('⚠️ Duplicado encontrado y eliminado:', profile.userName, 'userId:', profile.userId);
                    }
                    return acc;
                }, []);
                
                this.availableProfiles = uniqueProfiles;
                console.log(`🧹 Después de limpiar duplicados: ${this.availableProfiles.length} perfiles únicos`);
                
                // Debug: Mostrar detalles de cada perfil
                this.availableProfiles.forEach((profile, index) => {
                    console.log(`🔍 Perfil ${index + 1}:`, {
                        id: profile.id,
                        userId: profile.userId,
                        userName: profile.userName,
                        category: profile.category,
                        isAvailable: profile.isAvailable
                    });
                });
                
                this.renderAvailableProfilesOnMap();
                this.renderAvailableProfilesInSidebar();
                this.updateAvailabilityFabState();
            } else {
                console.log('No hay perfiles disponibles');
                this.availableProfiles = [];
                this.renderAvailableProfilesOnMap();
                this.renderAvailableProfilesInSidebar();
                this.updateAvailabilityFabState();
            }

        } catch (error) {
            console.error('❌ Error cargando perfiles disponibles:', error);
        }
    }

    async renderAvailableProfilesOnMap() {
        // Limpiar marcadores existentes
        this.clearProfileMarkers();

        // Crear marcadores para cada perfil disponible
        for (const profile of this.availableProfiles) {
            if (profile.location && profile.location.lat && profile.location.lng) {
                await this.createProfileMarker(profile);
            }
        }

        // Actualizar estado visual del FAB según disponibilidad del usuario
        this.updateAvailabilityFabState();
    }

    async createProfileMarker(profile) {
        // Obtener datos completos del perfil desde Firebase (con cache) - misma lógica que navbar
        let userProfile = this.userProfilesCache && this.userProfilesCache[profile.userId] ? this.userProfilesCache[profile.userId] : null;
        if (!userProfile && this.database) {
            try {
                const userRef = this.database.ref(`users/${profile.userId}/profile`);
                const snapshot = await userRef.once('value');
                userProfile = snapshot.val();
                if (!userProfile) {
                    const userRootRef = this.database.ref(`users/${profile.userId}`);
                    const userRootSnapshot = await userRootRef.once('value');
                    userProfile = userRootSnapshot.val();
                }
                if (userProfile && this.userProfilesCache) {
                    this.userProfilesCache[profile.userId] = userProfile;
                }
            } catch (error) {
                console.warn('Error fetching profile for marker:', error);
            }
        }

        // Normalizar datos: soportar posibles nombres alternativos - misma lógica que navbar
        const nickname = userProfile?.nickname || userProfile?.alias || userProfile?.apodo || profile.userName || 'Usuario';
        
        // Procesar foto principal: usar la misma lógica que en navbar
        let mainPhoto = profile.userProfileImage;
        if (userProfile) {
            const photos = Array.isArray(userProfile.photos) ? userProfile.photos : (Array.isArray(userProfile.fotos) ? userProfile.fotos : []);
            if (photos.length > 0) {
                const toImageSrc = (input) => {
                    if (!input) return null;
                    let value = input;
                    if (typeof input === 'object') {
                        if (typeof input.url === 'string') value = input.url;
                        else if (typeof input.src === 'string') value = input.src;
                        else if (typeof input.base64 === 'string') value = input.base64;
                        else if (Array.isArray(input) && input.length > 0) value = input[0];
                        else return null;
                    }
                    if (typeof value !== 'string') return null;
                    if (value.startsWith('data:image/')) return value;
                    if (value.startsWith('http') || value.startsWith('https')) return value;
                    if (value.length > 100 && !value.includes('http')) return `data:image/jpeg;base64,${value}`;
                    return null;
                };
                const processed = photos.map(toImageSrc).filter((src) => typeof src === 'string' && src.length > 0);
                if (processed.length > 0) mainPhoto = processed[0];
            }
        }
        
        // Asegurar que la imagen sea consistente con la del navbar
        if (!mainPhoto) {
            mainPhoto = 'https://www.gravatar.com/avatar/?d=mp&f=y';
        }

        // Crear elemento personalizado para el marcador
        const markerElement = document.createElement('div');
        markerElement.className = 'custom-profile-marker';
        markerElement.innerHTML = `
            <div class="marker-container">
                <img src="${(typeof safeUrl==='function'?safeUrl(mainPhoto):mainPhoto)}" 
                     alt="${escapeHtml(nickname)}" class="marker-avatar">
                <div class="marker-alias">${escapeHtml(nickname)}</div>
                <div class="marker-category">${escapeHtml(this.getCategoryName(profile.category))}</div>
            </div>
        `;

        const marker = new mapboxgl.Marker(markerElement)
        .setLngLat([profile.location.lng, profile.location.lat])
        .addTo(this.map);

        // Agregar ID del perfil al marcador para referencia
        marker.profileId = profile.id;

        // Evento click para mostrar detalles
        markerElement.addEventListener('click', () => {
            const profileIndex = this.availableProfiles.findIndex(p => p.id === profile.id);
            this.showProfileDetails(profile, profileIndex);
        });

        this.profileMarkers.push(marker);
    }

    getCategoryColor(category) {
        const colors = {
            'escort': '#e91e63',
            'gigolo': '#2196f3',
            'masajes': '#4caf50',
            'trans': '#9c27b0',
            'chat': '#ff9800',
            'live': '#f44336'
        };
        return colors[category] || '#60c48e';
    }


    // ===== Actualizar estado visual del botón flotante de disponibilidad =====
    updateAvailabilityFabState() {
        const btn = document.getElementById('floatingAvailabilityBtn');
        if (!btn) return;
        const isAvailable = !!(this.currentUser && this.availableProfiles && this.availableProfiles.some(p => p.userId === this.currentUser.id));
        btn.classList.toggle('available', isAvailable);
        const icon = btn.querySelector('i');
        if (icon) icon.className = 'fas fa-power-off';
        btn.title = isAvailable ? 'Disponible (clic para cambiar)' : 'No disponible (clic para cambiar)';
    }

    clearProfileMarkers() {
        this.profileMarkers.forEach(marker => marker.remove());
        this.profileMarkers = [];
    }

    async updateProfileMarker(profile) {
        const existingMarker = this.profileMarkers.find(marker => marker.profileId === profile.id);
        if (existingMarker) {
            existingMarker.remove();
            const index = this.profileMarkers.indexOf(existingMarker);
            this.profileMarkers.splice(index, 1);
        }
        await this.createProfileMarker(profile);
    }

    removeProfileMarker(profileId) {
        const marker = this.profileMarkers.find(m => m.profileId === profileId);
        if (marker) {
            marker.remove();
            const index = this.profileMarkers.indexOf(marker);
            this.profileMarkers.splice(index, 1);
        }
    }

    resetAIChat() {
        const messagesContainer = document.getElementById('aiChatMessages');
        messagesContainer.innerHTML = `
            <div class="ai-message">
                <div class="ai-avatar">
                    <i class="fas fa-robot"></i>
                </div>
                <div class="message-content">
                    <p>¡Hola! Soy tu asistente de deseos. Cuéntame qué te gustaría que alguien haga por ti y te ayudo a crear el deseo perfecto con un precio justo.</p>
                </div>
            </div>
        `;
        document.getElementById('wishPreview').style.display = 'none';
        document.getElementById('aiChatInput').value = '';
        this.conversationHistory = [];
    }

    sendAIMessage() {
        const input = document.getElementById('aiChatInput');
        const message = input.value.trim();
        
        if (!message) return;

        // Agregar mensaje del usuario
        this.addMessageToChat('user', message);
        input.value = '';

        // Actualizar perfil del usuario por análisis de texto
        this.updateProfileFromText(message);

        // Analizar estado emocional
        const emotionalState = this.analyzeEmotionalState(message);

        // Guardar en historial de conversación
        this.conversationHistory.push({ role: 'user', content: message });

        // Verificar si Gemini está disponible y configurado correctamente
        const geminiAvailable = CONFIG.AI && 
                               CONFIG.AI.GEMINI && 
                               CONFIG.AI.GEMINI.enabled && 
                               CONFIG.AI.GEMINI.apiKey && 
                               CONFIG.AI.GEMINI.apiKey !== 'PON_AQUI_TU_API_KEY_DE_GEMINI' &&
                               CONFIG.AI.GEMINI.apiKey.length > 10 &&
                               this.gemini;

        console.log('=== AI CHAT DEBUG ===');
        console.log('Message:', message);
        console.log('Gemini available:', geminiAvailable);
        console.log('Gemini config:', CONFIG.AI?.GEMINI);
        console.log('Gemini client:', !!this.gemini);
        console.log('Conversation history:', this.conversationHistory);

        if (geminiAvailable) {
            console.log('Using Gemini for AI response...');
            
            // Mostrar indicador de carga
            this.addTypingIndicator();
            
            this.generateGeminiResponse(message)
                .then((text) => {
                    // Remover indicador de typing
                    this.removeTypingIndicator();
                    
                    const aiText = text || 'Estoy aquí para ayudarte. ¿Puedes contarme un poco más?';
                    this.addMessageToChat('ai', aiText);
                    this.conversationHistory.push({ role: 'assistant', content: aiText });
                    this.maybeShowSuggestions();
                })
                .catch((error) => {
                    console.error('Gemini error, falling back to local AI:', error);
                    
                    // Remover indicador de typing
                    this.removeTypingIndicator();
                    
                    // Fallback local
                    const aiResponse = this.generateAIResponse(message);
                    this.addMessageToChat('ai', aiResponse.text);
                    if (aiResponse.wishData) {
                        this.showWishPreview(aiResponse.wishData);
                    }
                    this.maybeShowSuggestions();
                });
        } else {
            console.log('Using local AI fallback...');
            // Fallback inmediato
        setTimeout(() => {
            const aiResponse = this.generateAIResponse(message);
            this.addMessageToChat('ai', aiResponse.text);
            if (aiResponse.wishData) {
                this.showWishPreview(aiResponse.wishData);
            }
                this.maybeShowSuggestions();
            }, CONFIG.AI.responseDelay || 1000);
        }
    }

    addMessageToChat(sender, message) {
        const messagesContainer = document.getElementById('aiChatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `${sender}-message`;
        
        const avatar = sender === 'ai' ? 
            '<div class="ai-avatar"><i class="fas fa-robot"></i></div>' :
            '<div class="user-avatar"><i class="fas fa-user"></i></div>';

        // Formatear el mensaje para mejor legibilidad
        const formattedMessage = this.formatMessage(message);

        messageDiv.innerHTML = `
            ${avatar}
            <div class="message-content">
                ${formattedMessage}
            </div>
        `;

        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    formatMessage(message) {
        if (!message) return '<p></p>';
        
        // Dividir en párrafos si hay saltos de línea
        const paragraphs = message.split('\n').filter(p => p.trim());
        
        if (paragraphs.length === 1) {
            return `<p>${this.escapeHtml(message)}</p>`;
        }
        
        // Si hay múltiples párrafos, formatearlos
        return paragraphs.map(p => `<p>${this.escapeHtml(p.trim())}</p>`).join('');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    generateAIResponse(userMessage) {
        const lowerMessage = userMessage.toLowerCase();
        
        // Verificar estado emocional
        if (this.emotionalState.current === 'negative') {
            return {
                text: "Entiendo que no estás pasando por un buen momento. ¿Hay algo en lo que pueda ayudarte o prefieres hablar de otra cosa?",
                wishData: null
            };
        }
        
        // Detectar tipo de deseo y generar respuesta más concisa
        if (lowerMessage.includes('café') || lowerMessage.includes('coffee') || lowerMessage.includes('bebida')) {
            return {
                text: "¡Perfecto! Un deseo de comida. Sugiero $8-12. ¿Qué tipo de café necesitas?",
                wishData: {
                    title: "Comprar café",
                    description: userMessage,
                    price: 10,
                    category: "comida"
                }
            };
        }
        
        if (lowerMessage.includes('perro') || lowerMessage.includes('mascota') || lowerMessage.includes('paseo')) {
            return {
                text: "¡Excelente! Servicio de mascotas. Sugiero $15-25. ¿Cuánto tiempo necesitas?",
                wishData: {
                    title: "Pasear mascota",
                    description: userMessage,
                    price: 20,
                    category: "servicios"
                }
            };
        }
        
        if (lowerMessage.includes('comprar') || lowerMessage.includes('tienda') || lowerMessage.includes('supermercado')) {
            return {
                text: "¡Genial! Deseo de compras. Sugiero $15-30. ¿Qué necesitas comprar?",
                wishData: {
                    title: "Comprar productos",
                    description: userMessage,
                    price: 20,
                    category: "compras"
                }
            };
        }
        
        if (lowerMessage.includes('llevar') || lowerMessage.includes('entregar') || lowerMessage.includes('paquete')) {
            return {
                text: "¡Perfecto! Servicio de entrega. Sugiero $10-20. ¿A dónde?",
                wishData: {
                    title: "Servicio de entrega",
                    description: userMessage,
                    price: 15,
                    category: "servicios"
                }
            };
        }
        
        // Respuesta genérica más concisa
        return {
            text: "Interesante deseo. ¿Podrías ser más específico sobre qué necesitas?",
            wishData: null
        };
    }

    // ===== GEMINI INTEGRATION (REST API) =====
    initializeGeminiClient() {
        try {
            const cfg = CONFIG.AI && CONFIG.AI.GEMINI;
            if (!cfg || !cfg.enabled || !cfg.proxyUrl) {
                console.log('Gemini config not available');
                return null;
            }
            console.log('Gemini proxy client initialized successfully');
            return {
                // La key de Gemini NO vive en el cliente: se llama al proxy serverless.
                proxyUrl: cfg.proxyUrl,
                model: cfg.model,
                apiUrl: cfg.apiUrl
            };
        } catch (e) {
            console.warn('Gemini client not initialized:', e);
            return null;
        }
    }

    async generateGeminiResponse(userMessage) {
        try {
            const client = this.gemini;
            if (!client) {
                console.log('Gemini client not available');
                return null;
            }

            console.log('Generating Gemini response for:', userMessage);
            
            // Construir prompt con historial de conversación
            const historyText = this.conversationHistory.map(m => 
                `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`
            ).join('\n');
            
            const systemPrompt = `Eres un asistente de deseos. Responde en español de forma breve y directa (máximo 2-3 oraciones).
            Ayuda a crear deseos claros y sugiere precios justos. 
            Solo sugiere deseos cuando el usuario esté en un estado emocional positivo.
            Si el usuario parece triste o negativo, ofrece apoyo emocional en lugar de sugerir deseos.`;
            
            const fullPrompt = `${systemPrompt}\n\nHistorial de conversación:\n${historyText}\n\nMensaje actual del usuario: ${userMessage}`;

            console.log('Sending request to Gemini REST API...');
            
            // La key de Gemini NO vive en el cliente. Se llama al proxy serverless,
            // que es el único que conoce GEMINI_API_KEY (env del servidor).
            const response = await fetch(client.proxyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: fullPrompt,
                    model: client.model
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data && data.success && data.text) {
                console.log('Gemini response received');
                return data.text;
            }
            
            console.log('No response text from Gemini');
            return null;
        } catch (e) {
            console.error('Gemini generation failed:', e);
            return null;
        }
    }

    // ===== USER PROFILE AND ANALYSIS =====
    loadUserProfile() {
        try {
            const raw = localStorage.getItem('deseo_user_profile');
            if (!raw) return { viajes: 0, comida: 0, ocio: 0, trabajo: 0, amor: 0, transporte: 0, servicios: 0, compras: 0 };
            const parsed = JSON.parse(raw);
            return Object.assign({ viajes: 0, comida: 0, ocio: 0, trabajo: 0, amor: 0, transporte: 0, servicios: 0, compras: 0 }, parsed);
        } catch {
            return { viajes: 0, comida: 0, ocio: 0, trabajo: 0, amor: 0, transporte: 0, servicios: 0, compras: 0 };
        }
    }

    saveUserProfile() {
        try {
            localStorage.setItem('deseo_user_profile', JSON.stringify(this.userProfile));
        } catch {}
    }

    // ===== EMOTIONAL STATE MANAGEMENT =====
    loadEmotionalState() {
        try {
            const raw = localStorage.getItem('deseo_emotional_state');
            return raw ? JSON.parse(raw) : {
                current: 'neutral',
                history: [],
                positiveCount: 0,
                negativeCount: 0,
                neutralCount: 0
            };
        } catch (e) {
            console.warn('Error loading emotional state:', e);
            return {
                current: 'neutral',
                history: [],
                positiveCount: 0,
                negativeCount: 0,
                neutralCount: 0
            };
        }
    }

    saveEmotionalState() {
        try {
            localStorage.setItem('deseo_emotional_state', JSON.stringify(this.emotionalState));
        } catch (e) {
            console.warn('Error saving emotional state:', e);
        }
    }

    analyzeEmotionalState(text) {
        const emotionalAnalysis = CONFIG.AI.EMOTIONAL_ANALYSIS;
        const words = text.toLowerCase().split(/\s+/);
        
        let positiveScore = 0;
        let negativeScore = 0;
        let neutralScore = 0;
        
        words.forEach(word => {
            if (emotionalAnalysis.positive.includes(word)) positiveScore++;
            if (emotionalAnalysis.negative.includes(word)) negativeScore++;
            if (emotionalAnalysis.neutral.includes(word)) neutralScore++;
        });
        
        // Determinar el estado emocional predominante
        let emotionalState = 'neutral';
        if (positiveScore > negativeScore && positiveScore > neutralScore) {
            emotionalState = 'positive';
        } else if (negativeScore > positiveScore && negativeScore > neutralScore) {
            emotionalState = 'negative';
        }
        
        // Actualizar el estado emocional
        this.emotionalState.current = emotionalState;
        this.emotionalState.history.push({
            text: text,
            state: emotionalState,
            timestamp: new Date().toISOString()
        });
        
        // Mantener solo los últimos 10 estados
        if (this.emotionalState.history.length > 10) {
            this.emotionalState.history = this.emotionalState.history.slice(-10);
        }
        
        // Actualizar contadores
        if (emotionalState === 'positive') this.emotionalState.positiveCount++;
        else if (emotionalState === 'negative') this.emotionalState.negativeCount++;
        else this.emotionalState.neutralCount++;
        
        this.saveEmotionalState();
        
        console.log('Emotional analysis:', {
            text: text,
            state: emotionalState,
            scores: { positive: positiveScore, negative: negativeScore, neutral: neutralScore }
        });
        
        return emotionalState;
    }

    updateProfileFromText(text) {
        if (!text) return;
        const matches = this.extractCategories(text);
        matches.forEach(cat => {
            if (this.userProfile[cat] === undefined) this.userProfile[cat] = 0;
            this.userProfile[cat] += 1;
        });
        this.saveUserProfile();
    }

    extractCategories(text) {
        const found = new Set();
        const lower = text.toLowerCase();
        const dict = (CONFIG.AI && CONFIG.AI.KEYWORDS) || {};
        Object.keys(dict).forEach(cat => {
            const words = dict[cat] || [];
            for (let i = 0; i < words.length; i++) {
                if (lower.includes(words[i])) { found.add(cat); break; }
            }
        });
        return Array.from(found);
    }

    getTopInterests() {
        const entries = Object.entries(this.userProfile || {});
        entries.sort((a, b) => b[1] - a[1]);
        return entries.slice(0, 3).map(([cat, count]) => ({ category: cat, count }));
    }

    // Exponer función globalmente
    exposeGetTopInterests() {
        window.getTopInterests = () => this.getTopInterests();
    }

    maybeShowSuggestions() {
        // Solo mostrar sugerencias si el estado emocional es positivo
        if (this.emotionalState.current !== 'positive') {
            console.log('Not showing suggestions due to emotional state:', this.emotionalState.current);
            return;
        }
        
        const top = this.getTopInterests().filter(item => item.count > 0);
        if (top.length === 0) return;
        const main = top[0].category;
        const suggestions = {
            viajes: 'Noto que te gustan los viajes, ¿quieres ver deseos relacionados con viajar?',
            comida: 'Veo que te interesa la comida, ¿te muestro deseos de comida cerca?',
            ocio: 'Te gusta el ocio. ¿Quieres ver actividades y entretenimiento cercanos?',
            trabajo: 'Parece que te interesan temas de trabajo. ¿Buscamos deseos de servicios profesionales?',
            amor: 'Veo interés en temas románticos. ¿Te muestro ideas de detalles y regalos?',
            transporte: 'Te interesa transporte. ¿Te muestro deseos de traslados cercanos?',
            servicios: 'Veo interés en servicios. ¿Quieres ver tareas que puedes solicitar o aceptar?',
            compras: 'Te interesan compras. ¿Te muestro deseos de compras y encargos?'
        };
        const text = suggestions[main];
        if (text) this.addMessageToChat('ai', text);
    }

    showWishPreview(wishData) {
        document.getElementById('previewTitle').textContent = wishData.title;
        document.getElementById('previewDescription').textContent = wishData.description;
        document.getElementById('previewPrice').textContent = `$${wishData.price}`;
        document.getElementById('previewCategory').textContent = this.getCategoryName(wishData.category);
        document.getElementById('wishPreview').style.display = 'block';
        
        // Guardar datos del deseo para publicación
        this.currentWishData = wishData;
    }

    publishWish() {
        if (!this.currentWishData) return;

        // Obtener ubicación actual del mapa
        const center = this.map.getCenter();
        const coordinates = [center.lng, center.lat];

        const newWish = {
            id: `wish${Date.now()}`,
            title: this.currentWishData.title,
            description: this.currentWishData.description,
            price: this.currentWishData.price,
            category: this.currentWishData.category,
            coordinates: coordinates,
            author: this.currentUser,
            status: 'active',
            createdAt: new Date()
        };

        this.wishes.push(newWish);
        this.renderWishesOnMap();
        this.closeModal('createWishModal');
        this.showNotification('¡Tu deseo ha sido publicado exitosamente!', 'success');
    }

    // ===== MODAL TIPO TINDER PARA PERFILES =====
    async showProfileDetails(profile, currentIndex = 0) {
        if (!profile) return;
        
        // Store current profile index for navigation
        this.currentProfileIndex = currentIndex;

        console.log('🎯 showProfileDetails llamado con:', profile);

        // Obtener datos completos del usuario desde Firebase (con cache)
        let userProfile = this.userProfilesCache && this.userProfilesCache[profile.userId] ? this.userProfilesCache[profile.userId] : null;
        try {
            if (!userProfile && this.database) {
                console.log('🔍 Buscando perfil del usuario:', profile.userId);
                // Buscar en users/{userId}/profile donde se guarda el perfil completo
                const userRef = this.database.ref(`users/${profile.userId}/profile`);
                const snapshot = await userRef.once('value');
                userProfile = snapshot.val();
                console.log('📊 Datos obtenidos de Firebase (users/{userId}/profile):', userProfile);
                
                // Si no se encuentra en /profile, intentar en la raíz del usuario
                if (!userProfile) {
                    console.log('🔍 No se encontró en /profile, buscando en users/{userId}');
                    const userRootRef = this.database.ref(`users/${profile.userId}`);
                    const userRootSnapshot = await userRootRef.once('value');
                    userProfile = userRootSnapshot.val();
                    console.log('📊 Datos obtenidos de Firebase (users/{userId}):', userProfile);
                }
                // Guardar en cache
                if (userProfile && this.userProfilesCache) {
                    this.userProfilesCache[profile.userId] = userProfile;
                }
            } else {
                console.warn('⚠️ Firebase database no disponible');
            }
        } catch (error) {
            console.error('❌ Error obteniendo perfil del usuario:', error);
        }

        // Normalizar datos: soportar posibles nombres alternativos según data.json
        const nickname = userProfile?.nickname || userProfile?.alias || userProfile?.apodo || profile.userName || 'Usuario';
        const description = userProfile?.description || userProfile?.descripcion || 'Descripción no disponible';
        const age = userProfile?.age || userProfile?.edad || 'No especificada';
        
        // Procesar fotos: verificar si son base64 o URLs
        let photos = [];
        if (Array.isArray(userProfile?.photos) && userProfile.photos.length > 0) {
            photos = userProfile.photos;
        } else if (Array.isArray(userProfile?.fotos) && userProfile.fotos.length > 0) {
            photos = userProfile.fotos;
        } else if (profile.userProfileImage) {
            photos = [profile.userProfileImage];
        }
        
        // Convertir fotos a formato correcto (base64 o URL)
        const toImageSrc = (input) => {
            if (!input) return null;
            let value = input;
            // Manejar objetos comunes { url, src, base64 }
            if (typeof input === 'object') {
                if (typeof input.url === 'string') value = input.url;
                else if (typeof input.src === 'string') value = input.src;
                else if (typeof input.base64 === 'string') value = input.base64;
                else if (Array.isArray(input) && input.length > 0) value = input[0];
                else return null;
            }
            if (typeof value !== 'string') return null;
            // Si ya es base64, usarlo directamente
            if (value.startsWith('data:image/')) return value;
            // Si es URL, usarla directamente
            if (value.startsWith('http') || value.startsWith('https')) return value;
            // Si parece base64 sin prefijo, agregarlo
            if (value.length > 100 && !value.includes('http')) return `data:image/jpeg;base64,${value}`;
            return null;
        };

        const processedPhotos = photos
            .map(toImageSrc)
            .filter((src) => typeof src === 'string' && src.length > 0);
        
        const favoritePoses = Array.isArray(userProfile?.sexualPoses) && userProfile.sexualPoses.length > 0
            ? userProfile.sexualPoses
            : (Array.isArray(userProfile?.favoritePoses) ? userProfile.favoritePoses : (Array.isArray(userProfile?.poses) ? userProfile.poses : (Array.isArray(userProfile?.posesFavoritas) ? userProfile.posesFavoritas : [])));

        console.log('🔧 Datos normalizados:', {
            nickname,
            description,
            age,
            processedPhotos,
            favoritePoses
        });

        const displayProfile = {
            ...profile,
            userName: nickname,
            userProfileImage: processedPhotos[0] || profile.userProfileImage,
            description,
            age,
            favoritePoses,
            photos: processedPhotos
        };

        console.log('🎯 Perfil final para mostrar:', displayProfile);

        // ===== Construir lista de fotos (sin tarjeta de info final) =====
        const storyPhotos = (displayProfile.photos && displayProfile.photos.length > 0)
            ? displayProfile.photos
            : [displayProfile.userProfileImage || 'https://www.gravatar.com/avatar/?d=mp&f=y'];
        const totalStories = storyPhotos.length;

        // ===== ALGORITMO DE DISTRIBUCIÓN DE INFO SOBRE LAS FOTOS =====
        // Se construye una lista de "bloques de información" y se reparten
        // entre las fotos disponibles. Si hay 1 sola foto, se muestran todos
        // los bloques en ella. Si hay N fotos, se distribuyen de forma
        // equilibrada (round-robin) para que ninguna quede sobrecargada.
        const infoBlocks = [];

        // Bloque 1: identidad (nombre + edad + categoría) — siempre primero
        infoBlocks.push({
            type: 'identity',
            html: `
                <div class="overlay-identity">
                    <div class="overlay-avatar-wrap">
                        <img src="${(typeof safeUrl==='function'?safeUrl(displayProfile.userProfileImage):displayProfile.userProfileImage) || 'https://www.gravatar.com/avatar/?d=mp&f=y'}"
                             alt="${escapeHtml(displayProfile.userName)}" class="overlay-avatar">
                    </div>
                    <div class="overlay-name-row">
                        <h2 class="overlay-name">${escapeHtml(displayProfile.userName || 'Usuario')}</h2>
                        ${displayProfile.age && displayProfile.age !== 'No especificada' ? `<span class="overlay-age">${escapeInt(displayProfile.age, '')}</span>` : ''}
                    </div>
                    <div class="overlay-badges">
                        <span class="category-badge ${escapeAttr(displayProfile.category)}">${escapeHtml(this.getCategoryName(displayProfile.category))}</span>
                        <span class="status-badge"><i class="fas fa-circle"></i> Disponible ahora</span>
                    </div>
                </div>
            `
        });

        // Bloque 2: descripción
        if (displayProfile.description && displayProfile.description !== 'Descripción no disponible') {
            infoBlocks.push({
                type: 'description',
                html: `<p class="overlay-description">${escapeHtml(displayProfile.description)}</p>`
            });
        }

        // Bloque 3: ubicación / disponibilidad
        infoBlocks.push({
            type: 'stats',
            html: `
                <div class="overlay-stats">
                    <div class="stat-item"><i class="fas fa-map-marker-alt"></i><span>Ubicación cercana</span></div>
                    <div class="stat-item"><i class="fas fa-clock"></i><span>Disponible ahora</span></div>
                </div>
            `
        });

        // Bloque 4: poses favoritas (si existen)
        if (displayProfile.favoritePoses && displayProfile.favoritePoses.length > 0) {
            infoBlocks.push({
                type: 'poses',
                html: `
                    <div class="overlay-poses">
                        <h4><i class="fas fa-heart"></i> Poses Favoritas</h4>
                        <div class="poses-tags">
                            ${displayProfile.favoritePoses.map(pose => `<span class="pose-tag">${this.getSexualPoseName(pose)}</span>`).join('')}
                        </div>
                    </div>
                `
            });
        }

        // Repartir los bloques entre las fotos (round-robin).
        // Con 1 foto => todos los bloques en esa foto.
        // Con N fotos => cada bloque cae en una foto distinta, ciclando.
        const blocksPerPhoto = storyPhotos.map(() => []);
        infoBlocks.forEach((block, i) => {
            blocksPerPhoto[i % storyPhotos.length].push(block);
        });

        // Crear modal tipo Instagram Stories (info superpuesta sobre cada foto)
        const modal = document.createElement('div');
        modal.className = 'tinder-profile-modal';
        modal.innerHTML = `
            <div class="modal-overlay">
                <div class="modal-content tinder-card">
                    <!-- Barra de progreso tipo stories -->
                    <div class="stories-progress" id="storiesProgress">
                        ${Array.from({ length: totalStories }).map((_, i) => `
                            <span class="story-segment" data-index="${i}"><i></i></span>
                        `).join('')}
                    </div>

                    <!-- Zonas de tap: izquierda = anterior, derecha = siguiente -->
                    <div class="story-tap-zone tap-left" id="storyTapLeft"></div>
                    <div class="story-tap-zone tap-right" id="storyTapRight"></div>

                    <!-- Slides (solo fotos, con info superpuesta) -->
                    <div class="stories-track" id="storiesTrack">
                        ${storyPhotos.map((src, idx) => `
                            <div class="story-slide story-photo-slide" data-index="${idx}">
                                <img src="${(typeof safeUrl==='function'?safeUrl(src):src)}" alt="${escapeHtml(displayProfile.userName)}" class="story-photo">
                                <div class="story-photo-gradient"></div>
                                <div class="story-overlay-info">
                                    ${blocksPerPhoto[idx].map(b => b.html).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <!-- Acciones flotantes: FUERA del track, siempre encima -->
                    <div class="tinder-actions overlay-actions" id="tinderOverlayActions">
                        <button class="action-btn pass-btn" id="tinderCloseBtn" title="Cerrar">
                            <i class="fas fa-times"></i>
                        </button>
                        <button class="action-btn contact-btn" id="tinderContactBtn" title="Contactar">
                            <i class="fas fa-comment"></i>
                        </button>
                    </div>

                    <!-- Botón cerrar -->
                    <button class="close-btn" onclick="window.deseoApp.closeTinderModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        `;

        // Agregar estilos
        const style = document.createElement('style');
        style.textContent = `
            .tinder-profile-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: modalFadeIn 0.3s ease;
                background: rgba(0, 0, 0, 0.8);
            }
            .tinder-card {
                /* Proporción tipo historia vertical (9:16) con límites de viewport */
                width: min(92vw, 460px);
                height: min(88vh, calc(min(92vw, 460px) * 16 / 9));
                max-height: 92vh;
                aspect-ratio: 9 / 16;
                background: linear-gradient(160deg, rgba(30, 32, 38, 0.92) 0%, rgba(18, 19, 24, 0.96) 100%);
                backdrop-filter: blur(24px) saturate(140%);
                -webkit-backdrop-filter: blur(24px) saturate(140%);
                border: 1px solid rgba(255, 255, 255, 0.10);
                border-radius: 28px;
                overflow: hidden;
                position: relative;
                box-shadow: 0 30px 70px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255,255,255,0.04) inset;
                display: flex;
                flex-direction: column;
            }
            /* Ajuste para pantallas bajas (laptops pequeñas / landscape) */
            @media (max-height: 700px) {
                .tinder-card {
                    height: 94vh;
                    max-height: 94vh;
                    width: auto;
                    aspect-ratio: 9 / 16;
                }
            }
            /* ===== Barra de progreso tipo stories ===== */
            .stories-progress {
                position: absolute;
                top: 12px;
                left: 12px;
                right: 12px;
                display: flex;
                gap: 4px;
                z-index: 30;
                pointer-events: none;
            }
            .story-segment {
                flex: 1;
                height: 3px;
                border-radius: 3px;
                background: rgba(255,255,255,0.28);
                overflow: hidden;
            }
            .story-segment i {
                display: block;
                height: 100%;
                width: 0%;
                background: #fff;
                border-radius: 3px;
                transition: width 0.25s ease;
            }
            .story-segment.active i { width: 100%; }
            .story-segment.viewed i { width: 100%; background: rgba(255,255,255,0.85); }

            /* ===== Zonas de tap (izquierda = anterior, derecha = siguiente) ===== */
            .story-tap-zone {
                position: absolute;
                top: 0;
                bottom: 0;
                width: 50%;
                z-index: 20;
                cursor: pointer;
            }
            .story-tap-zone.tap-left { left: 0; }
            .story-tap-zone.tap-right { right: 0; }

            /* ===== Track de slides ===== */
            .stories-track {
                position: absolute;
                inset: 0;
                display: flex;
                transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
                will-change: transform;
            }
            .story-slide {
                position: relative;
                min-width: 100%;
                width: 100%;
                height: 100%;
                overflow: hidden;
                background: #0d0e12;
            }
            .story-photo {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
                user-select: none;
                -webkit-user-drag: none;
            }
            .story-photo-gradient {
                position: absolute;
                inset: 0;
                background: linear-gradient(to top, rgba(10, 11, 15, 0.92) 0%, rgba(10, 11, 15, 0.55) 32%, rgba(10, 11, 15, 0.05) 62%, rgba(10, 11, 15, 0) 100%);
                pointer-events: none;
            }

            /* ===== Info superpuesta sobre cada foto ===== */
            .story-overlay-info {
                position: absolute;
                left: 0;
                right: 0;
                bottom: 96px; /* deja espacio para los botones de acción */
                padding: 0 20px;
                z-index: 15;
                display: flex;
                flex-direction: column;
                gap: 12px;
                pointer-events: none; /* no bloquea taps/swipes */
                max-height: calc(100% - 140px);
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
            }
            .story-overlay-info::-webkit-scrollbar { width: 0; }
            .overlay-identity {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .overlay-avatar-wrap {
                display: flex;
                align-items: center;
            }
            .overlay-avatar {
                width: 56px;
                height: 56px;
                border-radius: 50%;
                object-fit: cover;
                border: 2px solid rgba(255,255,255,0.35);
                box-shadow: 0 6px 18px rgba(0,0,0,0.5);
            }
            .overlay-name-row {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
            }
            .overlay-name {
                color: #fff;
                font-size: 1.7rem;
                margin: 0;
                font-weight: 700;
                line-height: 1.1;
                text-shadow: 0 2px 12px rgba(0,0,0,0.6);
            }
            .overlay-age {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 34px;
                height: 34px;
                padding: 0 9px;
                border-radius: 12px;
                background: rgba(255,255,255,0.16);
                border: 1px solid rgba(255,255,255,0.25);
                color: #fff;
                font-weight: 600;
                font-size: 0.95rem;
                backdrop-filter: blur(6px);
            }
            .overlay-badges {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .overlay-description {
                color: rgba(255,255,255,0.92);
                line-height: 1.55;
                margin: 0;
                font-size: 0.98rem;
                text-shadow: 0 1px 8px rgba(0,0,0,0.7);
            }
            .overlay-stats {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .overlay-stats .stat-item {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                color: rgba(255,255,255,0.9);
                font-size: 0.82rem;
                padding: 8px 12px;
                background: rgba(255,255,255,0.12);
                border: 1px solid rgba(255,255,255,0.16);
                border-radius: 14px;
                backdrop-filter: blur(8px);
            }
            .overlay-stats .stat-item i {
                color: var(--primary-color);
                font-size: 0.9rem;
            }
            .overlay-poses h4 {
                color: rgba(255,255,255,0.95);
                font-size: 0.9rem;
                margin: 0 0 8px;
                font-weight: 600;
                text-shadow: 0 1px 8px rgba(0,0,0,0.7);
            }
            .profile-badges {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .category-badge {
                padding: 6px 14px;
                border-radius: 24px;
                font-size: 0.78rem;
                font-weight: 700;
                color: white;
                text-transform: uppercase;
                letter-spacing: 0.6px;
                box-shadow: 0 4px 14px rgba(0,0,0,0.35);
            }
            .status-badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 6px 12px;
                border-radius: 24px;
                font-size: 0.78rem;
                font-weight: 600;
                color: #d1fae5;
                background: rgba(16, 185, 129, 0.18);
                border: 1px solid rgba(16, 185, 129, 0.4);
                backdrop-filter: blur(6px);
            }
            .status-badge i {
                font-size: 0.5rem;
                color: #34d399;
                animation: statusPulse 1.8s infinite;
            }
            @keyframes statusPulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.35; }
            }
            .category-badge.escort { background: linear-gradient(135deg, #e91e63, #c2185b); }
            .category-badge.gigolo { background: linear-gradient(135deg, #2196f3, #1976d2); }
            .category-badge.masajes { background: linear-gradient(135deg, #4caf50, #388e3c); }
            .category-badge.trans { background: linear-gradient(135deg, #9c27b0, #7b1fa2); }
            .category-badge.chat { background: linear-gradient(135deg, #ff9800, #f57c00); }
            .category-badge.live { background: linear-gradient(135deg, #f44336, #d32f2f); }
            .category-badge.comida { background: linear-gradient(135deg, #ff5722, #e64a19); }
            .category-badge.servicios { background: linear-gradient(135deg, #607d8b, #455a64); }
            .category-badge.compras { background: linear-gradient(135deg, #795548, #5d4037); }
            .category-badge.transporte { background: linear-gradient(135deg, #3f51b5, #303f9f); }
            .category-badge.entretenimiento { background: linear-gradient(135deg, #9c27b0, #7b1fa2); }
            .tinder-info {
                flex: 0 0 auto;
                max-height: 42%;
                display: flex;
                flex-direction: column;
                background: transparent;
            }
            .info-scroll {
                padding: 18px 22px 8px;
                overflow-y: auto;
                flex: 1 1 auto;
                min-height: 0;
            }
            .info-scroll::-webkit-scrollbar { width: 6px; }
            .info-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
            .profile-description {
                color: rgba(255,255,255,0.82);
                line-height: 1.6;
                margin: 0 0 16px;
                font-size: 0.98rem;
            }
            .profile-stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-bottom: 16px;
            }
            .stat-item {
                display: flex;
                align-items: center;
                gap: 10px;
                color: rgba(255,255,255,0.75);
                font-size: 0.85rem;
                padding: 10px 12px;
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.07);
                border-radius: 14px;
            }
            .stat-item i {
                color: var(--primary-color);
                width: 18px;
                font-size: 0.95rem;
            }
            .tinder-actions {
                display: flex;
                justify-content: center;
                gap: 28px;
                padding: 14px 22px 20px;
                border-top: 1px solid rgba(255,255,255,0.08);
            }
            /* ===== Botones flotantes superpuestos sobre cada foto ===== */
            .overlay-actions {
                position: absolute;
                left: 0;
                right: 0;
                bottom: 16px;
                z-index: 100; /* POR ENCIMA de tap-zones (20) y progress (30) */
                border-top: none;
                background: none;
                padding: 0;
                pointer-events: auto; /* sí permiten clic */
            }
            .overlay-actions .action-btn {
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255,255,255,0.12) inset;
            }
            .action-btn {
                width: 62px;
                height: 62px;
                border-radius: 50%;
                border: none;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.5rem;
                cursor: pointer;
                transition: all 0.25s ease;
                box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
            }
            .action-btn:hover {
                transform: scale(1.1) translateY(-2px);
                box-shadow: 0 12px 26px rgba(0, 0, 0, 0.45);
            }
            .action-btn:active { transform: scale(0.96); }
            .pass-btn {
                background: linear-gradient(135deg, #ff4757, #ff3742);
                color: white;
            }
            .contact-btn {
                background: linear-gradient(135deg, #10b981, #059669);
                color: white;
                box-shadow: 0 8px 20px rgba(16, 185, 129, 0.4);
            }
            .contact-btn:hover {
                background: linear-gradient(135deg, #059669, #047857);
                box-shadow: 0 12px 26px rgba(16, 185, 129, 0.5);
            }
            .favorite-poses {
                margin-top: 4px;
            }
            .favorite-poses h4 {
                color: rgba(255,255,255,0.9);
                font-size: 0.95rem;
                margin-bottom: 10px;
                font-weight: 600;
            }
            .poses-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .pose-tag {
                background: linear-gradient(135deg, rgba(16,185,129,0.9), rgba(5,150,105,0.9));
                color: white;
                padding: 6px 12px;
                border-radius: 16px;
                font-size: 0.78rem;
                font-weight: 500;
                box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
            }
            @keyframes modalFadeIn {
                from {
                    opacity: 0;
                    transform: scale(0.92);
                }
                to {
                    opacity: 1;
                    transform: scale(1);
                }
            }
            @keyframes modalFadeOut {
                from {
                    opacity: 1;
                    transform: scale(1);
                }
                to {
                    opacity: 0;
                    transform: scale(0.94);
                }
            }
            /* ===== Optimización móvil: NO fullscreen, respeta header y menú ===== */
            @media (max-width: 768px) {
                .tinder-profile-modal {
                    align-items: center;
                    justify-content: center;
                    padding: calc(var(--mobile-header-height, 64px) + 12px) 12px calc(12px + env(safe-area-inset-bottom, 0px));
                    animation: overlayFadeIn 0.25s ease;
                    box-sizing: border-box;
                }
                @keyframes overlayFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .tinder-card {
                    /* Ocupa solo el espacio disponible, sin tapar el header/menú */
                    width: min(94vw, 440px);
                    max-width: 94vw;
                    height: auto;
                    max-height: 100%;
                    aspect-ratio: 9 / 16;
                    border-radius: 24px;
                    animation: cardPopIn 0.3s cubic-bezier(0.22, 1, 0.36, 1);
                    will-change: transform;
                }
                @keyframes cardPopIn {
                    from { transform: scale(0.94); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .tinder-card.closing {
                    animation: cardPopOut 0.22s cubic-bezier(0.4, 0, 1, 1) forwards;
                }
                @keyframes cardPopOut {
                    from { transform: scale(1); opacity: 1; }
                    to { transform: scale(0.94); opacity: 0; }
                }
                .overlay-name { font-size: 1.45rem; }
                .story-overlay-info { bottom: 88px; padding: 0 16px; }
                .overlay-actions {
                    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
                    gap: 22px;
                }
                .overlay-actions .action-btn { width: 54px; height: 54px; font-size: 1.3rem; }
            }
            @media (max-width: 480px) {
                .tinder-card {
                    width: 94vw;
                    max-width: 94vw;
                }
                .overlay-name { font-size: 1.3rem; }
            }
            /* Pantallas muy bajas en móvil: permitir que la tarjeta use el alto disponible */
            @media (max-width: 768px) and (max-height: 640px) {
                .tinder-card {
                    aspect-ratio: auto;
                    height: 100%;
                }
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(modal);

        // ===== Interacciones tipo Instagram Stories =====
        try {
            const track = modal.querySelector('#storiesTrack');
            const segments = Array.from(modal.querySelectorAll('.story-segment'));
            const tapLeft = modal.querySelector('#storyTapLeft');
            const tapRight = modal.querySelector('#storyTapRight');
            const card = modal.querySelector('.tinder-card');

            let storyIndex = 0;
            const lastIndex = totalStories - 1;
            const STORY_DURATION = 2000; // 2 segundos por foto
            let autoTimer = null;

            const renderStory = () => {
                if (!track) return;
                track.style.transform = `translateX(-${storyIndex * 100}%)`;
                segments.forEach((seg, i) => {
                    seg.classList.toggle('active', i === storyIndex);
                    seg.classList.toggle('viewed', i < storyIndex);
                });
            };

            // Detener el temporizador de auto-avance
            const stopAuto = () => {
                if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
            };

            // Programar el auto-avance (solo en slides de foto, no en la de info)
            const scheduleAuto = () => {
                stopAuto();
                if (storyIndex < lastIndex) {
                    autoTimer = setTimeout(() => {
                        goNext();
                    }, STORY_DURATION);
                }
            };

            // Avanzar: si es la última slide, pasa a la SIGUIENTE PERSONA
            const goNext = () => {
                if (storyIndex < lastIndex) {
                    storyIndex++;
                    renderStory();
                    scheduleAuto();
                } else {
                    // Última slide -> siguiente persona
                    stopAuto();
                    this.passToNextProfile();
                }
            };

            // Retroceder: si es la primera slide, pasa a la PERSONA ANTERIOR
            const goPrev = () => {
                if (storyIndex > 0) {
                    storyIndex--;
                    renderStory();
                    scheduleAuto();
                } else {
                    stopAuto();
                    this.passToPreviousProfile();
                }
            };

            // Tap izquierda / derecha
            if (tapLeft) tapLeft.addEventListener('click', (e) => { e.stopPropagation(); goPrev(); });
            if (tapRight) tapRight.addEventListener('click', (e) => { e.stopPropagation(); goNext(); });

            // Click en segmentos de progreso para saltar a una slide
            segments.forEach((seg, i) => {
                seg.style.pointerEvents = 'auto';
                seg.addEventListener('click', (e) => {
                    e.stopPropagation();
                    storyIndex = i;
                    renderStory();
                });
            });

            // ===== Botones flotantes: stopPropagation para que las zonas
            // de tap NO los intercepten =====
            const closeBtn = modal.querySelector('#tinderCloseBtn');
            const contactBtn = modal.querySelector('#tinderContactBtn');
            if (closeBtn) {
                closeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closeTinderModal();
                });
            }
            if (contactBtn) {
                contactBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.contactProfile(profile.userId);
                });
            }

            // ===== Gestos: swipe horizontal =====
            // Deslizar SIEMPRE cambia de persona:
            //   izquierda -> siguiente perfil
            //   derecha   -> perfil anterior
            // (el TAP en las zonas izquierda/derecha sigue cambiando de foto)
            let startX = 0, startY = 0, isSwiping = false, moved = false;
            const SWIPE_THRESHOLD = 45;

            const onStart = (x, y) => { startX = x; startY = y; isSwiping = true; moved = false; };
            const onMove = (x, y) => {
                if (!isSwiping) return;
                if (Math.abs(x - startX) > 8 || Math.abs(y - startY) > 8) moved = true;
            };
            const onEnd = (x, y) => {
                if (!isSwiping) return;
                isSwiping = false;
                const dx = x - startX;
                const dy = y - startY;
                // Solo gestos predominantemente horizontales
                if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
                    stopAuto();
                    if (dx < 0) {
                        this.passToNextProfile(); // swipe izquierda -> siguiente persona
                    } else {
                        this.passToPreviousProfile(); // swipe derecha -> persona anterior
                    }
                }
            };

            const target = card || modal;
            target.addEventListener('touchstart', (e) => {
                const t = e.touches[0];
                onStart(t.clientX, t.clientY);
            }, { passive: true });
            target.addEventListener('touchmove', (e) => {
                const t = e.touches[0];
                onMove(t.clientX, t.clientY);
            }, { passive: true });
            target.addEventListener('touchend', (e) => {
                const t = e.changedTouches[0];
                onEnd(t.clientX, t.clientY);
            }, { passive: true });

            // Soporte mouse (desktop) para arrastrar
            target.addEventListener('mousedown', (e) => onStart(e.clientX, e.clientY));
            target.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
            target.addEventListener('mouseup', (e) => onEnd(e.clientX, e.clientY));

            renderStory();
        } catch (err) { console.warn('Stories interactions init failed:', err); }
    }

    async contactProfile(userId) {
        console.log('Contactando usuario:', userId);
        
        try {
            // Verificar que el usuario esté autenticado
            if (!this.currentUser || !this.currentUser.id) {
                this.showAuthModal();
                return;
            }

            // No permitir contactarse a sí mismo
            if (userId === this.currentUser.id) {
                this.showNotification('No puedes contactarte a ti mismo', 'error');
                return;
            }

            // Crear o obtener ID del chat
            const chatId = await this.createOrGetChat(userId);

            // Validar que tengamos ambos parámetros antes de redirigir; si no,
            // evitamos abrir una URL con "undefined" (que provoca el error
            // "Faltan parámetros en la URL" en chat-client.html).
            if (!chatId || !userId) {
                console.error('❌ No se puede abrir el chat: faltan datos', { chatId, userId });
                this.showNotification('No se pudo abrir el chat (datos incompletos)', 'error');
                return;
            }
            
            // LÓGICA CORREGIDA:
            // El usuario actual (que presiona "Contactar") es el CLIENTE
            // El usuario contactado (que está en el mapa) es el PROVEEDOR
            // Por lo tanto, el usuario actual va a chat-client.html
            // Y el usuario contactado debe ir a chat-provider.html cuando abra el chat
            
            window.location.href = `chat-client.html?chatId=${encodeURIComponent(chatId)}&userId=${encodeURIComponent(userId)}`;


        } catch (error) {
            console.error('❌ Error contactando usuario:', error);
            this.showNotification('Error al contactar usuario', 'error');
        }
    }

    // ===== CERRAR MODAL TIPO TINDER =====
    closeTinderModal() {
        const modal = document.querySelector('.tinder-profile-modal');
        if (!modal) return;
        const card = modal.querySelector('.tinder-card');
        const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

        if (isMobile && card) {
            // Animación suave de salida tipo bottom-sheet
            card.classList.add('closing');
            modal.style.transition = 'opacity 0.26s ease';
            modal.style.opacity = '0';
            setTimeout(() => modal.remove(), 260);
        } else {
            modal.style.animation = 'modalFadeOut 0.2s ease forwards';
            setTimeout(() => modal.remove(), 180);
        }
    }

    // ===== NAVEGACIÓN ENTRE PERFILES =====
    passToNextProfile() {
        console.log('Pasando al siguiente perfil...');
        
        // Get current modal
        const currentModal = document.querySelector('.tinder-profile-modal');
        if (!currentModal) {
            console.warn('No se encontró modal actual');
            return;
        }
        
        // Get available profiles
        if (!this.availableProfiles || this.availableProfiles.length === 0) {
            console.warn('No hay perfiles disponibles');
            currentModal.remove();
            return;
        }
        
        // Calculate next index (circular navigation)
        const nextIndex = (this.currentProfileIndex + 1) % this.availableProfiles.length;
        const nextProfile = this.availableProfiles[nextIndex];
        
        console.log(`Navegando del perfil ${this.currentProfileIndex} al ${nextIndex} (${nextProfile.userName})`);
        
        // Close current modal
        currentModal.remove();
        
        // Show next profile
        this.showProfileDetails(nextProfile, nextIndex);
    }

    passToPreviousProfile() {
        console.log('Pasando al perfil anterior...');
        
        const currentModal = document.querySelector('.tinder-profile-modal');
        if (!currentModal) {
            console.warn('No se encontró modal actual');
            return;
        }
        
        if (!this.availableProfiles || this.availableProfiles.length === 0) {
            console.warn('No hay perfiles disponibles');
            currentModal.remove();
            return;
        }
        
        // Calculate previous index (circular navigation)
        const prevIndex = (this.currentProfileIndex - 1 + this.availableProfiles.length) % this.availableProfiles.length;
        const prevProfile = this.availableProfiles[prevIndex];
        
        console.log(`Navegando del perfil ${this.currentProfileIndex} al ${prevIndex} (${prevProfile.userName})`);
        
        // Close current modal
        currentModal.remove();
        
        // Show previous profile
        this.showProfileDetails(prevProfile, prevIndex);
    }

    async createOrGetChat(userId) {
        if (!this.database) {
            throw new Error('Firebase no inicializado');
        }

        // Validar que tenemos los IDs necesarios
        if (!this.currentUser || !this.currentUser.id) {
            throw new Error('Usuario actual no válido');
        }
        
        if (!userId) {
            throw new Error('ID de usuario contactado no válido');
        }

        console.log('🔍 [DEBUG] currentUser.id:', this.currentUser.id);
        console.log('🔍 [DEBUG] userId:', userId);

        // Crear ID único para el chat usando strings para evitar NaN
        const currentUserId = String(this.currentUser.id);
        const contactUserId = String(userId);
        
        // Ordenar IDs para crear un ID único consistente
        const sortedIds = [currentUserId, contactUserId].sort();
        const chatId = `chat_${sortedIds[0]}_${sortedIds[1]}`;
        
        console.log('🔍 [DEBUG] chatId generado:', chatId);
        
        try {
            // Verificar si el chat ya existe
            const chatRef = this.database.ref(`chats/${chatId}`);
            const snapshot = await chatRef.once('value');
            
            if (!snapshot.exists()) {
                console.log('📝 Creando nuevo chat:', chatId);
                
                // Obtener información del usuario contactado
                let contactUserInfo = {
                    id: contactUserId,
                    name: 'Usuario',
                    type: 'contacted'
                };
                
                try {
                    const userRef = this.database.ref(`users/${contactUserId}`);
                    const userSnapshot = await userRef.once('value');
                    const userData = userSnapshot.val();
                    
                    if (userData && userData.name) {
                        contactUserInfo.name = userData.name;
                    }
                } catch (error) {
                    console.warn('⚠️ No se pudo obtener información del usuario contactado:', error);
                }
                
                // Crear nuevo chat
                const chatData = {
                    id: chatId,
                    participants: {
                        [currentUserId]: {
                            id: currentUserId,
                            name: this.currentUser.name || 'Usuario',
                            role: 'client', // Quien presiona "Contactar" es el CLIENTE
                            type: 'contacting'
                        },
                        [contactUserId]: {
                            ...contactUserInfo,
                            role: 'provider' // Quien es contactado es el PROVEEDOR
                        }
                    },
                    createdAt: new Date().toISOString(),
                    lastMessage: null,
                    status: 'active'
                };
                
                await chatRef.set(chatData);
                console.log('✅ Chat creado exitosamente');
                
                // Crear mensaje inicial del sistema
                const systemMessage = {
                    id: `msg_${Date.now()}`,
                    senderId: 'system',
                    senderName: 'Sistema',
                    message: `Chat iniciado entre ${this.currentUser.name || 'Usuario'} y ${contactUserInfo.name}.`,
                    timestamp: new Date().toISOString(),
                    type: 'system'
                };
                
                await chatRef.child('messages').child(systemMessage.id).set(systemMessage);
                
                // Notificar al usuario contactado
                await this.notifyUserContacted(contactUserId, chatId);
            } else {
                console.log('✅ Chat existente encontrado:', chatId);
            }
            
            return chatId;
            
        } catch (error) {
            console.error('❌ Error creando/obteniendo chat:', error);
            throw error;
        }
    }

    async determineUserType(userId) {
        // LÓGICA CORREGIDA:
        // El usuario actual (que presiona "Contactar") es siempre el CLIENTE
        // El usuario contactado (que está en el mapa) es siempre el PROVEEDOR
        // Esta función ya no es necesaria, pero la mantenemos por compatibilidad
        
        try {
            // Obtener información del usuario contactado para verificar que existe
            const userRef = this.database.ref(`users/${userId}`);
            const snapshot = await userRef.once('value');
            const userData = snapshot.val();
            
            if (userData) {
                console.log('✅ Usuario contactado encontrado:', userData.name);
                // El usuario contactado es el proveedor
                return 'provider';
            } else {
                console.warn('⚠️ Usuario contactado no encontrado');
                return 'provider'; // Por defecto asumir que es proveedor
            }
        } catch (error) {
            console.error('❌ Error determinando tipo de usuario:', error);
            return 'provider'; // Por defecto asumir que es proveedor
        }
    }

    async notifyUserContacted(userId, chatId) {
        try {
            // Crear notificación para el usuario contactado
            const notificationRef = this.database.ref(`notifications/${userId}`);
            const notification = {
                id: `notif_${Date.now()}`,
                type: 'chat_request',
                title: 'Nuevo contacto',
                message: `${this.currentUser.name} quiere contactarte`,
                chatId: chatId,
                senderId: this.currentUser.id,
                senderName: this.currentUser.name,
                timestamp: new Date().toISOString(),
                read: false
            };
            
            await notificationRef.push().set(notification);
            
            console.log('✅ Notificación enviada al usuario contactado');
            
        } catch (error) {
            console.error('❌ Error enviando notificación:', error);
        }
    }

    // Función para limpiar chats con IDs incorrectos (NaN)
    async cleanupInvalidChats() {
        if (!this.database) return;

        try {
            console.log('🧹 Limpiando chats con IDs incorrectos...');
            
            const chatsRef = this.database.ref('chats');
            const snapshot = await chatsRef.once('value');
            const chatsData = snapshot.val();
            
            if (chatsData) {
                const invalidChats = Object.keys(chatsData).filter(chatId => 
                    chatId.includes('NaN') || chatId.includes('undefined') || chatId.includes('null')
                );
                
                console.log(`🔍 Encontrados ${invalidChats.length} chats con IDs incorrectos:`, invalidChats);
                
                // Eliminar chats inválidos
                for (const invalidChatId of invalidChats) {
                    await chatsRef.child(invalidChatId).remove();
                    console.log(`🗑️ Chat eliminado: ${invalidChatId}`);
                }
                
                if (invalidChats.length > 0) {
                    console.log(`✅ Limpieza completada: ${invalidChats.length} chats eliminados`);
                } else {
                    console.log('✅ No se encontraron chats con IDs incorrectos');
                }
            }
            
        } catch (error) {
            console.error('❌ Error limpiando chats inválidos:', error);
        }
    }

    // ===== FUNCIÓN PARA IR AL MAPA DESDE SIDEBAR =====
    focusOnProfileMarker(profile) {
        if (!profile || !profile.location) {
            console.warn('Perfil sin ubicación válida');
            return;
        }

        // Centrar el mapa en la ubicación del perfil
        this.map.flyTo({
            center: [profile.location.lng, profile.location.lat],
            zoom: 16,
            essential: true,
            duration: 1500
        });

        // Agregar animación de pulso al marcador
        const marker = this.profileMarkers.find(m => m.profileId === profile.id);
        if (marker) {
            const markerElement = marker.getElement();
            if (markerElement) {
                markerElement.classList.add('pulse-animation');
                setTimeout(() => {
                    markerElement.classList.remove('pulse-animation');
                }, 3000);
            }
        }

        this.showNotification(`Centrando en ${profile.userName}`, 'info');
    }

    // ===== CHAT PRIVADO =====
    openPrivateChat(wishId) { // Modificar para aceptar un ID de deseo
        const wish = this.wishes.find(w => w.id === wishId);
        if (!wish) return;

        this.activeChat = {
            wishId: wish.id,
            otherUser: wish.author,
            messages: [
                {
                    sender: 'system',
                    message: `Has aceptado el deseo "${wish.title}" de ${wish.author.name}. ¡Coordina los detalles aquí!`,
                    timestamp: new Date()
                }
            ]
        };

        this.renderPrivateChatMessages();
        this.openModal('privateChatModal');
    }

    renderPrivateChatMessages() {
        const messagesContainer = document.getElementById('privateChatMessages');
        messagesContainer.innerHTML = '';

        this.activeChat.messages.forEach(msg => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${msg.sender === this.currentUser.id ? 'sent' : ''}`;
            
            const avatar = msg.sender === 'system' ? 
                '<div class="ai-avatar"><i class="fas fa-info-circle"></i></div>' :
                msg.sender === this.currentUser.id ?
                '<div class="user-avatar"><i class="fas fa-user"></i></div>' :
                '<div class="ai-avatar"><i class="fas fa-user"></i></div>';

            messageDiv.innerHTML = `
                ${avatar}
                <div class="message-content">
                    <p>${escapeHtml(msg.message)}</p>
                    <small>${this.formatTime(msg.timestamp)}</small>
                </div>
            `;

            messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
    }

    sendPrivateMessage() {
        const input = document.getElementById('privateChatInput');
        const message = input.value.trim();
        
        if (!message || !this.activeChat) return;

        const newMessage = {
            sender: this.currentUser.id,
            message: message,
            timestamp: new Date()
        };

        this.activeChat.messages.push(newMessage);
        this.renderPrivateChatMessages();
        input.value = '';

        // Simular respuesta del otro usuario
        setTimeout(() => {
            const responses = [
                "Perfecto, ¿cuándo te parece bien?",
                "¡Excelente! ¿En qué lugar nos encontramos?",
                "De acuerdo, ¿tienes alguna preferencia especial?",
                "Perfecto, ¿cuál es tu número de teléfono?",
                "¡Genial! ¿A qué hora te conviene?"
            ];
            
            const response = responses[Math.floor(Math.random() * responses.length)];
            const replyMessage = {
                sender: this.activeChat.otherUser.id,
                message: response,
                timestamp: new Date()
            };

            this.activeChat.messages.push(replyMessage);
            this.renderPrivateChatMessages();
        }, 2000);
    }

    completeWish() {
        this.closeModal('privateChatModal');
        this.openRatingModal();
    }

    // ===== SISTEMA DE CALIFICACIÓN =====
    openRatingModal() {
        this.currentRating = {
            fulfilled: null,
            stars: 0,
            comment: ''
        };
        this.openModal('ratingModal');
    }

    setFulfillmentStatus(fulfilled) {
        this.currentRating.fulfilled = fulfilled;
        
        // Actualizar estilos de botones
        document.getElementById('fulfilledBtn').classList.toggle('active', fulfilled);
        document.getElementById('unfulfilledBtn').classList.toggle('active', !fulfilled);
    }

    setStarRating(rating) {
        this.currentRating.stars = rating;
        this.updateStarDisplay(rating);
    }

    highlightStars(rating) {
        this.updateStarDisplay(rating, true);
    }

    resetStarHighlight() {
        this.updateStarDisplay(this.currentRating.stars || 0);
    }

    updateStarDisplay(rating, isHighlight = false) {
        const stars = document.querySelectorAll('#starRating i');
        stars.forEach((star, index) => {
            if (index < rating) {
                star.classList.add('active');
            } else {
                star.classList.remove('active');
            }
        });
    }

    submitRating() {
        if (this.currentRating.fulfilled === null) {
            this.showNotification('Por favor selecciona si el deseo fue cumplido o no.', 'warning');
            return;
        }

        if (this.currentRating.stars === 0) {
            this.showNotification('Por favor califica con estrellas.', 'warning');
            return;
        }

        const comment = document.getElementById('ratingComment').value;
        this.currentRating.comment = comment;

        // Marcar deseo como completado
        if (this.currentWish) {
            this.currentWish.status = 'completed';
            this.currentWish.rating = this.currentRating;
        }

        this.closeModal('ratingModal');
        this.showNotification('¡Gracias por tu calificación! El deseo ha sido marcado como completado.', 'success');
        
        // Limpiar estado
        this.currentWish = null;
        this.activeChat = null;
        this.renderWishesOnMap();
    }

    // ===== RENDERIZAR LISTA DE PERFILES DISPONIBLES EN SIDEBAR =====
    async renderAvailableProfilesInSidebar() {
        // Prevenir múltiples renderizados simultáneos
        if (this.isRenderingSidebar) {
            console.log('⚠️ [DEBUG] Renderizado ya en progreso, saltando...');
            return;
        }
        this.isRenderingSidebar = true;

        const wishList = document.getElementById('wishList');
        if (!wishList) {
            console.warn('wishList element not found');
            this.isRenderingSidebar = false;
            return;
        }

        // Limpiar la lista actual
        wishList.innerHTML = '';

        // Debug: Mostrar estado actual del array
        console.log(`🔍 [DEBUG] availableProfiles.length: ${this.availableProfiles.length}`);
        console.log(`🔍 [DEBUG] availableProfiles content:`, this.availableProfiles.map(p => ({ id: p.id, userId: p.userId, userName: p.userName })));

        // Eliminar duplicados por userId antes de renderizar
        const uniqueProfiles = this.availableProfiles.reduce((acc, profile) => {
            const existing = acc.find(p => p.userId === profile.userId);
            if (!existing) {
                acc.push(profile);
            } else {
                console.log(`⚠️ [DEBUG] Duplicado encontrado en renderizado: ${profile.userName} (userId: ${profile.userId})`);
            }
            return acc;
        }, []);

        console.log(`🔍 [DEBUG] Perfiles únicos para renderizar: ${uniqueProfiles.length} de ${this.availableProfiles.length}`);

        // Aplicar filtros a los perfiles
        const filteredProfiles = uniqueProfiles.filter(profile => this.passesProfileFilters(profile));
        console.log(`🔍 [DEBUG] Perfiles después del filtro: ${filteredProfiles.length} de ${uniqueProfiles.length}`);
        console.log(`🔍 [DEBUG] Filtro activo: categoría = "${this.filters.category}"`);

        // Renderizar cada perfil disponible
        for (const profile of filteredProfiles) {
            // Obtener datos completos del perfil desde Firebase (con cache)
            let userProfile = this.userProfilesCache && this.userProfilesCache[profile.userId] ? this.userProfilesCache[profile.userId] : null;
            if (!userProfile && this.database) {
                try {
                    const userRef = this.database.ref(`users/${profile.userId}/profile`);
                    const snapshot = await userRef.once('value');
                    userProfile = snapshot.val();
                    if (!userProfile) {
                        const userRootRef = this.database.ref(`users/${profile.userId}`);
                        const userRootSnapshot = await userRootRef.once('value');
                        userProfile = userRootSnapshot.val();
                    }
                    if (userProfile && this.userProfilesCache) {
                        this.userProfilesCache[profile.userId] = userProfile;
                    }
                } catch (error) {
                    console.warn('Error fetching profile for sidebar:', error);
                }
            }

            // Normalizar datos: soportar posibles nombres alternativos según data.json
            const nickname = userProfile?.nickname || userProfile?.alias || userProfile?.apodo || profile.userName || 'Usuario';
            // Procesar foto principal: usar la misma lógica que en showProfileDetails
            let mainPhoto = profile.userProfileImage;
            if (userProfile) {
                const photos = Array.isArray(userProfile.photos) ? userProfile.photos : (Array.isArray(userProfile.fotos) ? userProfile.fotos : []);
                if (photos.length > 0) {
                    const toImageSrc = (input) => {
                        if (!input) return null;
                        let value = input;
                        if (typeof input === 'object') {
                            if (typeof input.url === 'string') value = input.url;
                            else if (typeof input.src === 'string') value = input.src;
                            else if (typeof input.base64 === 'string') value = input.base64;
                            else if (Array.isArray(input) && input.length > 0) value = input[0];
                            else return null;
                        }
                        if (typeof value !== 'string') return null;
                        if (value.startsWith('data:image/')) return value;
                        if (value.startsWith('http') || value.startsWith('https')) return value;
                        if (value.length > 100 && !value.includes('http')) return `data:image/jpeg;base64,${value}`;
                        return null;
                    };
                    const processed = photos.map(toImageSrc).filter((src) => typeof src === 'string' && src.length > 0);
                    if (processed.length > 0) mainPhoto = processed[0];
                }
            }
            
            // Asegurar que la imagen sea consistente con la del mapa
            if (!mainPhoto) {
                mainPhoto = 'https://www.gravatar.com/avatar/?d=mp&f=y';
            }

            const profileItem = document.createElement('div');
            profileItem.className = 'wish-item profile-item';
            profileItem.innerHTML = `
                <div class="wish-logo">
                    <img src="${(typeof safeUrl==='function'?safeUrl(mainPhoto):mainPhoto) || 'https://www.gravatar.com/avatar/?d=mp&f=y'}" 
                         alt="${escapeHtml(nickname)}" class="profile-avatar-small">
                </div>
                <div class="wish-info">
                    <h3>${escapeHtml(nickname)}</h3>
                    <p><span class="category-badge ${profile.category}">${this.getCategoryName(profile.category)}</span> • Disponible</p>
                </div>
                <div class="wish-actions">
                    <i class="fas fa-heart"></i>
                </div>
            `;
            
            // Añadir evento de clic para ir al mapa
            profileItem.addEventListener('click', () => {
                this.focusOnProfileMarker(profile);
            });
            
            wishList.appendChild(profileItem);
        }

        console.log(`✅ Rendered ${uniqueProfiles.length} unique profiles in sidebar (from ${this.availableProfiles.length} total)`);
        
        // Renderizar carrusel móvil
        this.renderMobileCarousel(uniqueProfiles);
        
        // Liberar el flag de renderizado
        this.isRenderingSidebar = false;
    }

    // ===== CARRUSEL MÓVIL =====
    renderMobileCarousel(profiles) {
        // Asegurar que exista el contenedor overlay en móvil
        let overlay = document.getElementById('mobileCarouselOverlay');
        if (!overlay) {
            const mapArea = document.querySelector('.map-area');
            let overlays = mapArea && mapArea.querySelector('.mobile-overlays');
            if (!overlays && mapArea) {
                overlays = document.createElement('div');
                overlays.className = 'mobile-overlays';
                mapArea.appendChild(overlays);
            }
            if (overlays) {
                overlays.insertAdjacentHTML('beforeend', `
                    <div class="mobile-carousel overlay" id="mobileCarouselOverlay">
                        <div class="carousel-container">
                            <div class="carousel-track" id="carouselTrack"></div>
                            <div class="carousel-controls">
                                <button class="carousel-btn prev-btn" id="prevBtn">
                                    <i class="fas fa-chevron-left"></i>
                                </button>
                                <div class="carousel-indicators" id="carouselIndicators"></div>
                                <button class="carousel-btn next-btn" id="nextBtn">
                                    <i class="fas fa-chevron-right"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `);
            }
        }

        const carouselTrack = document.getElementById('carouselTrack');
        const carouselIndicators = document.getElementById('carouselIndicators');
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        
        // Si los elementos aún no existen (por timing), reintentar una vez después de un breve delay
        if (!carouselTrack || !carouselIndicators || !prevBtn || !nextBtn) {
            console.warn('Elementos del carrusel móvil no encontrados aún. Reintentando...');
            clearTimeout(this._carouselRetryTimer);
            this._carouselRetryTimer = setTimeout(() => {
                this.renderMobileCarousel(profiles);
            }, 300);
            return;
        }

        // Limpiar carrusel
        carouselTrack.innerHTML = '';
        carouselIndicators.innerHTML = '';

        if (profiles.length === 0) {
            carouselTrack.innerHTML = `
                <div class="carousel-slide">
                    <div class="carousel-profile">
                        <div class="carousel-profile-info">
                            <div class="carousel-profile-name">No hay perfiles disponibles</div>
                            <div class="carousel-profile-category">Intenta más tarde</div>
                        </div>
                    </div>
                </div>
            `;
            // Estado base
            this.currentSlide = 0;
            this.totalSlides = 0;
            this.updateCarouselButtons();
            return;
        }

        // Crear slides del carrusel
        profiles.forEach((profile, index) => {
            // Obtener foto principal usando la misma lógica que navbar/mapa
            let mainPhoto = profile.userProfileImage;
            try {
                const userProfile = this.userProfilesCache && this.userProfilesCache[profile.userId] ? this.userProfilesCache[profile.userId] : null;
                if (userProfile) {
                    const photos = Array.isArray(userProfile.photos) ? userProfile.photos : (Array.isArray(userProfile.fotos) ? userProfile.fotos : []);
                    if (photos.length > 0) {
                        const toImageSrc = (input) => {
                            if (!input) return null;
                            let value = input;
                            if (typeof input === 'object') {
                                if (typeof input.url === 'string') value = input.url;
                                else if (typeof input.src === 'string') value = input.src;
                                else if (typeof input.base64 === 'string') value = input.base64;
                                else if (Array.isArray(input) && input.length > 0) value = input[0];
                                else return null;
                            }
                            if (typeof value !== 'string') return null;
                            if (value.startsWith('data:image/')) return value;
                            if (value.startsWith('http') || value.startsWith('https')) return value;
                            if (value.length > 100 && !value.includes('http')) return `data:image/jpeg;base64,${value}`;
                            return null;
                        };
                        const processed = photos.map(toImageSrc).filter((src) => typeof src === 'string' && src.length > 0);
                        if (processed.length > 0) mainPhoto = processed[0];
                    }
                }
            } catch (e) { /* noop */ }
            if (!mainPhoto) mainPhoto = 'https://www.gravatar.com/avatar/?d=mp&f=y';

            const slide = document.createElement('div');
            slide.className = 'carousel-slide';
            slide.innerHTML = `
                <div class="carousel-profile" data-profile-id="${escapeAttr(profile.id)}">
                    <img src="${(typeof safeUrl==='function'?safeUrl(mainPhoto):mainPhoto)}" 
                         alt="${escapeHtml(profile.userName)}" class="carousel-profile-avatar">
                    <div class="carousel-profile-info">
                        <div class="carousel-profile-name">${escapeHtml(profile.userName || 'Usuario')}</div>
                        <div class="carousel-profile-category">${escapeHtml(this.getCategoryName(profile.category))}</div>
                        <div class="carousel-profile-status">
                            <i></i>
                            <span>Disponible ahora</span>
                        </div>
                    </div>
                </div>
            `;
            
            // Agregar evento de clic para mostrar detalles
            slide.addEventListener('click', () => {
                const profileIndex = this.availableProfiles.findIndex(p => p.id === profile.id);
                this.showProfileDetails(profile, profileIndex);
            });
            
            carouselTrack.appendChild(slide);
        });

        // Crear indicadores
        profiles.forEach((_, index) => {
            const indicator = document.createElement('div');
            indicator.className = `carousel-indicator ${index === 0 ? 'active' : ''}`;
            indicator.addEventListener('click', () => {
                this.goToSlide(index);
            });
            carouselIndicators.appendChild(indicator);
        });

        // Evitar listeners duplicados en controles
        if (!this._carouselControlsBound) {
            this.setupCarouselControls(profiles.length);
            this._carouselControlsBound = true;
        }
        
        // Inicializar estado del carrusel
        this.currentSlide = 0;
        this.totalSlides = profiles.length;
        this.goToSlide(0);
    }

    setupCarouselControls(totalSlides) {
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        
        if (!prevBtn || !nextBtn) return;

        prevBtn.addEventListener('click', () => {
            this.previousSlide();
        });

        nextBtn.addEventListener('click', () => {
            this.nextSlide();
        });

        // Actualizar estado inicial de los botones
        this.updateCarouselButtons();
        
        // Agregar soporte para gestos táctiles
        this.setupCarouselTouchEvents();
    }

    goToSlide(slideIndex) {
        const carouselTrack = document.getElementById('carouselTrack');
        const indicators = document.querySelectorAll('.carousel-indicator');
        
        if (!carouselTrack || slideIndex < 0 || slideIndex >= this.totalSlides) return;

        this.currentSlide = slideIndex;
        carouselTrack.style.transform = `translateX(-${slideIndex * 100}%)`;

        // Actualizar indicadores
        indicators.forEach((indicator, index) => {
            indicator.classList.toggle('active', index === slideIndex);
        });

        this.updateCarouselButtons();

        // Mover el mapa al perfil correspondiente
        try {
            const slideEl = carouselTrack.children[slideIndex];
            if (slideEl) {
                const profileEl = slideEl.querySelector('.carousel-profile');
                const profileId = profileEl && profileEl.getAttribute('data-profile-id');
                const profile = this.availableProfiles.find(p => p.id === profileId);
                if (profile && profile.location) {
                    this.focusOnProfileMarker(profile);
                }
            }
        } catch (e) { console.warn('No se pudo centrar el mapa en el slide actual:', e); }
    }

    nextSlide() {
        if (this.currentSlide < this.totalSlides - 1) {
            this.goToSlide(this.currentSlide + 1);
        }
    }

    previousSlide() {
        if (this.currentSlide > 0) {
            this.goToSlide(this.currentSlide - 1);
        }
    }

    updateCarouselButtons() {
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        
        if (!prevBtn || !nextBtn) return;

        prevBtn.disabled = this.currentSlide === 0;
        nextBtn.disabled = this.currentSlide === this.totalSlides - 1;
    }

    setupCarouselTouchEvents() {
        const carouselTrack = document.getElementById('carouselTrack');
        if (!carouselTrack) return;

        let startX = 0;
        let startY = 0;
        let isDragging = false;
        let currentX = 0;

        const onTouchStart = (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isDragging = true;
            carouselTrack.style.transition = 'none';
        };

        const onTouchMove = (e) => {
            if (!isDragging) return;
            
            currentX = e.touches[0].clientX;
            const diffX = currentX - startX;
            const diffY = Math.abs(e.touches[0].clientY - startY);
            
            // Solo procesar si el movimiento horizontal es mayor que el vertical
            if (Math.abs(diffX) > diffY) {
                const deltaPercent = (diffX / carouselTrack.clientWidth) * 100;
                const basePercent = -this.currentSlide * 100;
                carouselTrack.style.transform = `translateX(${basePercent + deltaPercent}%)`;
            }
        };

        const onTouchEnd = () => {
            if (!isDragging) return;
            
            isDragging = false;
            carouselTrack.style.transition = 'transform 0.3s ease';
            
            const diffX = currentX - startX;
            const threshold = carouselTrack.clientWidth * 0.15; // 15% del ancho
            
            if (Math.abs(diffX) > threshold) {
                if (diffX > 0 && this.currentSlide > 0) {
                    this.previousSlide();
                } else if (diffX < 0 && this.currentSlide < this.totalSlides - 1) {
                    this.nextSlide();
                } else {
                    this.goToSlide(this.currentSlide);
                }
            } else {
                this.goToSlide(this.currentSlide);
            }
        };

        // Escuchas pasivos para evitar bloquear scroll
        carouselTrack.addEventListener('touchstart', onTouchStart, { passive: true });
        carouselTrack.addEventListener('touchmove', onTouchMove, { passive: true });
        carouselTrack.addEventListener('touchend', onTouchEnd, { passive: true });
    }

    // ===== FILTROS (ADAPTADO PARA DESEOS) =====
    openFilterModal() {
        // Configurar las opciones de categoría seleccionadas
        this.setupFilterModal();
        this.openModal('filterModal');
    }

    setupFilterModal() {
        // Configurar el select con la categoría actual
        const categorySelect = document.getElementById('categoryFilterModal');
        if (categorySelect) {
            categorySelect.value = this.filters.category || '';
        }
    }

    applyFilters() {
        console.log('🔍 [DEBUG] applyFilters llamado');
        
        // Obtener la categoría seleccionada del select
        const categorySelect = document.getElementById('categoryFilterModal');
        if (categorySelect) {
            this.filters.category = categorySelect.value;
            console.log('🔍 [DEBUG] Categoría seleccionada:', this.filters.category);
        } else {
            console.error('❌ categoryFilterModal no encontrado');
            return;
        }

        this.renderWishesOnMap();
        this.renderAvailableProfilesInSidebar();
        this.renderMobileCarousel(this.availableProfiles.filter(profile => this.passesProfileFilters(profile))); // Filtrar carousel-slide
        this.closeModal('filterModal');
        this.showNotification('Filtro de categoría aplicado correctamente.', 'success');
    }

    clearFilters() {
        console.log('🔍 [DEBUG] clearFilters llamado');
        
        this.filters.category = '';
        
        // Limpiar selección del select
        const categorySelect = document.getElementById('categoryFilterModal');
        if (categorySelect) {
            categorySelect.value = '';
        }
        
        this.renderWishesOnMap();
        this.renderAvailableProfilesInSidebar();
        this.renderMobileCarousel(this.availableProfiles); // Limpiar filtro de carousel-slide
        this.closeModal('filterModal');
        this.showNotification('Filtros limpiados correctamente.', 'success');
    }

    applySidebarFilters() {
        // Solo aplicar filtro de categoría
        this.filters.category = document.getElementById('categoryFilterSidebar').value;

        this.renderWishesOnMap();
        this.renderAvailableProfilesInSidebar();
        this.showNotification('Filtro de categoría aplicado correctamente.', 'success');
    }

    passesWishFilters(wish) { // Solo filtra por categorías
        // Solo aplicar filtro de categoría
        if (this.filters.category && wish.category !== this.filters.category) return false;
        
        return true;
    }

    passesProfileFilters(profile) { // Filtra perfiles disponibles por categoría
        // Solo aplicar filtro de categoría
        if (this.filters.category && profile.category !== this.filters.category) return false;
        
        return true;
    }

    // ===== UTILIDADES =====
    getCategoryIcon(category) {
        // Helper para obtener ícono según la categoría (re-introducido y adaptado)
        switch (category) {
            case 'comida': return 'fas fa-utensils';
            case 'servicios': return 'fas fa-handshake';
            case 'compras': return 'fas fa-shopping-bag';
            case 'transporte': return 'fas fa-car';
            case 'entretenimiento': return 'fas fa-gamepad';
            default: return 'fas fa-map-marker-alt';
        }
    }

    getCategoryLogo(category) {
        // Helper para obtener un logo por categoría (si se usa en la tarjeta de detalles)
        switch (category) {
            case 'comida': return 'https://www.flaticon.es/svg/vstatic/svg/1046/1046788.svg?token=1646788';
            case 'servicios': return 'https://www.flaticon.es/svg/vstatic/svg/2923/2923946.svg?token=1646788';
            case 'compras': return 'https://www.flaticon.es/svg/vstatic/svg/3002/3002046.svg?token=1646788';
            case 'transporte': return 'https://www.flaticon.es/svg/vstatic/svg/2972/2972986.svg?token=1646788';
            case 'entretenimiento': return 'https://www.flaticon.es/svg/vstatic/svg/2917/2917714.svg?token=1646788';
            default: return 'https://www.flaticon.es/svg/vstatic/svg/3082/3082000.svg?token=1646788'; // Icono por defecto
        }
    }

    getCategoryName(category) {
        // Función para obtener el nombre de la categoría (actualizada con todas las categorías)
        switch (category) {
            case 'comida': return 'Comida';
            case 'servicios': return 'Servicios';
            case 'compras': return 'Compras';
            case 'transporte': return 'Transporte';
            case 'entretenimiento': return 'Entretenimiento';
            case 'escort': return 'Escort';
            case 'gigolo': return 'Gigolo';
            case 'masajes': return 'Masajes';
            case 'trans': return 'Trans';
            case 'chat': return 'Chat';
            case 'live': return 'Live';
            default: return 'General';
        }
    }

    // Mapear IDs de poses sexuales a nombres de visualización
    getSexualPoseName(poseId) {
        const poseMap = {
            'missionary': 'Misionero',
            'cowgirl': 'Vaquera',
            'doggy': 'Perrito',
            'spooning': 'Cucharita',
            'reverse_cowgirl': 'Vaquera Inversa',
            'standing': 'De Pie',
            'lotus': 'Loto',
            'scissors': 'Tijeras',
            'butterfly': 'Mariposa',
            'reverse_spooning': 'Cucharita Inversa',
            'crab': 'Cangrejo',
            'wheelbarrow': 'Carretilla',
            'pretzel': 'Pretzel',
            'yab_yum': 'Yab Yum',
            'bridge': 'Puente',
            'spread_eagle': 'Águila Extendida',
            'reverse_spread': 'Águila Inversa',
            'side_by_side': 'Lado a Lado',
            'kneeling': 'Arrodillados',
            'lotus_standing': 'Loto de Pie'
        };
        return poseMap[poseId] || poseId;
    }

    formatTime(date) {
        return date.toLocaleTimeString('es-ES', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }

    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Radio de la Tierra en km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 4000);
    }

    // ===== RESPUESTAS DE IA PREDEFINIDAS =====
    initializeAIResponses() {
        return {
            greetings: [
                "¡Hola! Soy tu asistente de deseos. ¿En qué puedo ayudarte hoy?",
                "¡Perfecto! Cuéntame qué necesitas y te ayudo a crear el deseo ideal.",
                "¡Excelente! Vamos a crear un deseo que alguien pueda cumplir fácilmente."
            ],
            priceSuggestions: {
                comida: "Para deseos de comida, sugiero entre $5-15 dependiendo de lo que necesites.",
                servicios: "Para servicios, el precio típico es $10-30 según la complejidad.",
                compras: "Para compras, considera $10-25 más el costo de los productos.",
                transporte: "Para transporte, $8-20 es un rango justo según la distancia.",
                entretenimiento: "Para entretenimiento, $15-40 es apropiado según la actividad."
            }
        };
    }

    // ===== TOGGLE DE TEMA =====
    // Delegamos en el ThemeManager global (fuente única de verdad) para que
    // el tema se guarde con la clave canónica 'deseo_theme' y se aplique a
    // <html> y <body> de forma consistente en toda la app.
    toggleTheme() {
        let newTheme;
        if (window.themeManager) {
            newTheme = window.themeManager.toggleTheme();
        } else if (window.DeseoTheme) {
            newTheme = window.DeseoTheme.toggle();
        } else {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            newTheme = currentTheme === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            document.body.setAttribute('data-theme', newTheme);
            document.body.classList.toggle('dark-mode', newTheme === 'dark');
            localStorage.setItem('deseo_theme', newTheme);
        }

        // Actualizar estilo del mapa según el tema
        this.updateMapStyle(newTheme);

        this.showNotification(`Tema cambiado a ${newTheme === 'light' ? 'claro' : 'oscuro'}`, 'success');
    }


    // ===== ACTUALIZAR ESTILO DEL MAPA =====
    updateMapStyle(theme) {
        if (!this.map) {
            console.warn('⚠️ Map not initialized, cannot update style');
        return;
    }

        try {
            const mapStyle = theme === 'light' ? 'mapbox://styles/mapbox/light-v11' : 'mapbox://styles/mapbox/dark-v11';
            this.map.setStyle(mapStyle);
            console.log(`✅ Map style updated to ${theme} theme`);
        } catch (error) {
            console.error('❌ Error updating map style:', error);
        }
    }

    // ===== TOGGLE DEL SIDEBAR MENU =====
    toggleSidebarMenu() {
        console.log('🔄 Toggling sidebar menu...');
        const mainNav = document.querySelector('.main-nav');
        const sidebarToggle = document.getElementById('sidebarToggle');
        
        if (!mainNav || !sidebarToggle) {
            console.warn('⚠️ main-nav or sidebarToggle not found');
            return;
        }

        const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
        // En móvil el estado real lo manda body.mobile-menu-open; en desktop, la clase .hidden
        const isOpen = isMobile
            ? document.body.classList.contains('mobile-menu-open')
            : !mainNav.classList.contains('hidden');

        if (!isOpen) {
            // Abrir menú
            mainNav.classList.remove('hidden');
            if (isMobile) {
                // Medir la altura real del header para posicionar el menú justo debajo
                const header = document.querySelector('.sidebar-header');
                if (header) {
                    const h = Math.round(header.getBoundingClientRect().height);
                    document.documentElement.style.setProperty('--mobile-header-height', h + 'px');
                }
                document.body.classList.add('mobile-menu-open');
                this.disableMapInteractions();
            }
            sidebarToggle.innerHTML = '<i class="fas fa-times"></i>';
            sidebarToggle.setAttribute('aria-expanded', 'true');
            console.log('✅ Sidebar menu shown');
        } else {
            // Cerrar menú
            mainNav.classList.add('hidden');
            if (isMobile) {
                document.body.classList.remove('mobile-menu-open');
                this.enableMapInteractions();
            }
            sidebarToggle.innerHTML = '<i class="fas fa-bars"></i>';
            sidebarToggle.setAttribute('aria-expanded', 'false');
            console.log('✅ Sidebar menu hidden');
        }
    }

    // ===== CONFIGURACIÓN DE ENLACES DE NAVEGACIÓN =====
    setupNavigationLinks() {
        // Enlaces de navegación que requieren autenticación
        const navigationLinks = [
            { selector: 'a[href="chats.html"]', name: 'Chats' },
            { selector: 'a[href="wallet.html"]', name: 'Billetera' },
            { selector: 'a[href="settings.html"]', name: 'Configuración' }
        ];

        navigationLinks.forEach(({ selector, name }) => {
            const links = document.querySelectorAll(selector);
            links.forEach(link => {
                link.addEventListener('click', (e) => {
                    if (!this.currentUser) {
                        e.preventDefault();
                        this.showAuthModal();
                        return;
                    }
                    // Si está autenticado, permitir la navegación normal
                });
            });
        });

        console.log('✅ Enlaces de navegación configurados con verificación de autenticación');
    }

    // ===== CONFIGURACIÓN DE ENLACES DEL MENÚ MÓVIL =====
    setupMobileMenuLinks() {
        const mainNav = document.querySelector('.main-nav');
        if (!mainNav) {
            console.warn('⚠️ main-nav not found for mobile menu links');
            return;
        }

        // Obtener todos los enlaces del menú
        const menuLinks = mainNav.querySelectorAll('a');
        
        menuLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
                
                if (isMobile) {
                    const href = link.getAttribute('href');
                    const linkId = link.getAttribute('id');
                    
                    console.log('🔍 [DEBUG] Click en enlace móvil:', href || link.textContent);
                    console.log('🔍 [DEBUG] Link href:', href);
                    console.log('🔍 [DEBUG] Link ID:', linkId);
                    
                    // Manejar diferentes tipos de enlaces
                    if (linkId === 'authButton' || linkId === 'themeToggle') {
                        console.log('🔍 [DEBUG] Botón especial - no cerrar menú');
                        // No cerrar el menú para botones especiales
                        return;
                    } else if (linkId === 'mobilePublishBtn') {
                        // Verificar autenticación para Publicarme
                        if (!this.currentUser) {
                            e.preventDefault();
                            this.showAuthModal();
                            this.closeMobileMenu();
                            return;
                        }
                        // Si está autenticado, permitir la acción
                        return;
                    } else if (href && href !== '#' && !href.includes('javascript:')) {
                        // Verificar autenticación para navegación
                        if (!this.currentUser) {
                            e.preventDefault();
                            this.showAuthModal();
                            this.closeMobileMenu();
                            return;
                        }
                        
                        console.log('🔍 [DEBUG] Enlace de navegación detectado - cerrando menú y navegando');
                        
                        // Cerrar el menú inmediatamente
                        this.closeMobileMenu();
                        
                        // Permitir que el enlace funcione normalmente
                        // NO usar preventDefault() ni stopPropagation()
                        
                    } else {
                        console.log('🔍 [DEBUG] Enlace interno o especial, no cerrando menú');
                        e.stopPropagation(); // Solo para enlaces especiales
                    }
                }
            });
        });

        console.log('✅ Event listeners configurados para', menuLinks.length, 'enlaces del menú móvil');
        
        // Event listener específico para el área del mapa (no global)
        const mapArea = document.querySelector('.map-area');
        if (mapArea) {
            mapArea.addEventListener('click', (e) => {
                const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
                const mainNav = document.querySelector('.main-nav');
                
                // Solo si es móvil y el menú está abierto
                if (isMobile && mainNav && !mainNav.classList.contains('hidden')) {
                    console.log('🔍 [DEBUG] Click en el mapa, cerrando menú...');
                    this.closeMobileMenu();
                }
            });
        }
    }

    // ===== CERRAR MENÚ MÓVIL =====
    closeMobileMenu() {
        const mainNav = document.querySelector('.main-nav');
        const sidebarToggle = document.getElementById('sidebarToggle');
        
        if (mainNav && sidebarToggle) {
            mainNav.classList.add('hidden');
            document.body.classList.remove('mobile-menu-open');
            this.enableMapInteractions(); // Reactivar interacciones del mapa
            sidebarToggle.innerHTML = '<i class="fas fa-bars"></i>';
            console.log('✅ Menú móvil cerrado');
        }
    }

    // ===== CONTROL DE INTERACCIONES DEL MAPA =====
    disableMapInteractions() {
        if (this.map) {
            // Desactivar todas las interacciones del mapa
            this.map.boxZoom.disable();
            this.map.scrollZoom.disable();
            this.map.dragPan.disable();
            this.map.dragRotate.disable();
            this.map.keyboard.disable();
            this.map.doubleClickZoom.disable();
            this.map.touchZoomRotate.disable();
            
            // Desactivar pointer-events en el canvas
            const canvas = this.map.getCanvasContainer();
            if (canvas) {
                canvas.style.pointerEvents = 'none';
            }
            
            console.log('🔒 Interacciones del mapa desactivadas');
        }
    }

    enableMapInteractions() {
        if (this.map) {
            // Reactivar todas las interacciones del mapa
            this.map.boxZoom.enable();
            this.map.scrollZoom.enable();
            this.map.dragPan.enable();
            this.map.dragRotate.enable();
            this.map.keyboard.enable();
            this.map.doubleClickZoom.enable();
            this.map.touchZoomRotate.enable();
            
            // Reactivar pointer-events en el canvas
            const canvas = this.map.getCanvasContainer();
            if (canvas) {
                canvas.style.pointerEvents = 'auto';
            }
            
            console.log('🔓 Interacciones del mapa reactivadas');
        }
    }

    // ===== INICIALIZACIÓN DE FIREBASE =====
    initializeFirebase() {
        console.log('🔍 [DEBUG] Iniciando Firebase...');
        console.log('🔍 [DEBUG] CONFIG disponible:', typeof CONFIG);
        console.log('🔍 [DEBUG] CONFIG.FIREBASE disponible:', typeof CONFIG.FIREBASE);
        console.log('🔍 [DEBUG] CONFIG.FIREBASE.enabled:', CONFIG.FIREBASE.enabled);
        console.log('🔍 [DEBUG] CONFIG.FIREBASE.config disponible:', typeof CONFIG.FIREBASE.config);
        
        // Log completo de la configuración para debug
        console.log('🔍 [DEBUG] CONFIG.FIREBASE completo:', CONFIG.FIREBASE);
        console.log('🔍 [DEBUG] CONFIG.FIREBASE.config completo:', CONFIG.FIREBASE.config);
        console.log('🔍 [DEBUG] databaseURL desde CONFIG:', CONFIG.FIREBASE.config.databaseURL);
        
        if (!CONFIG.FIREBASE.enabled) {
            console.log('❌ Firebase está deshabilitado en la configuración');
            return;
        }

        // Verificar si Firebase está disponible
        console.log('🔍 [DEBUG] typeof firebase:', typeof firebase);
        if (typeof firebase === 'undefined') {
            console.warn('⚠️ Firebase SDK no está cargado, reintentando en 2 segundos...');
            setTimeout(() => this.initializeFirebase(), 2000);
            return;
        }

        try {
            // Verificar si ya está inicializado
            if (this.firebase) {
                console.log('✅ Firebase ya está inicializado');
                return;
            }

            // Verificar que firebase.database esté disponible
            console.log('🔍 [DEBUG] typeof firebase.database:', typeof firebase.database);
            if (typeof firebase.database === 'undefined') {
                console.warn('⚠️ Firebase Database no está cargado, reintentando en 2 segundos...');
                setTimeout(() => this.initializeFirebase(), 2000);
                return;
            }

            // Verificar configuración
            console.log('🔍 [DEBUG] Configuración Firebase:', CONFIG.FIREBASE.config);
            console.log('🔍 [DEBUG] databaseURL:', CONFIG.FIREBASE.config.databaseURL);
            console.log('🔍 [DEBUG] CONFIG.FIREBASE completo:', CONFIG.FIREBASE);
            console.log('🔍 [DEBUG] Verificando estructura de CONFIG:', {
                'CONFIG.FIREBASE': CONFIG.FIREBASE,
                'CONFIG.FIREBASE.config': CONFIG.FIREBASE.config,
                'CONFIG.FIREBASE.config.databaseURL': CONFIG.FIREBASE.config.databaseURL,
                'typeof CONFIG.FIREBASE.config.databaseURL': typeof CONFIG.FIREBASE.config.databaseURL
            });
            
            // Verificar si la configuración es válida
            if (!CONFIG.FIREBASE.config.databaseURL) {
                console.warn('⚠️ databaseURL no está definido en la configuración');
                console.warn('⚠️ databaseURL:', CONFIG.FIREBASE.config.databaseURL);
                console.log('🔍 [DEBUG] Firebase deshabilitado por databaseURL faltante, usando modo local');
                this.showNotification('Configuración de Firebase incompleta. Usando modo local.', 'warning');
                return;
            }
            
            // Verificar si es una configuración válida
            if (CONFIG.FIREBASE.config.databaseURL.includes('parcero-6b971')) {
                console.log('🔍 [DEBUG] Usando configuración de Firebase real del proyecto parcero');
            } else if (CONFIG.FIREBASE.config.databaseURL.includes('samplep-d6b68')) {
                console.log('🔍 [DEBUG] Usando configuración de Firebase de prueba válida');
            } else if (CONFIG.FIREBASE.config.databaseURL.includes('firebaseio.com')) {
                console.warn('⚠️ Configuración de Firebase parece ser placeholder/falsa');
                console.warn('⚠️ databaseURL:', CONFIG.FIREBASE.config.databaseURL);
                console.log('🔍 [DEBUG] Firebase deshabilitado por configuración placeholder, usando modo local');
                this.showNotification('Configuración de Firebase no válida. Usando modo local.', 'warning');
                return;
            }

            // Inicializar Firebase
            console.log('🔍 [DEBUG] Intentando inicializar Firebase...');
            this.firebase = firebase.initializeApp(CONFIG.FIREBASE.config);
            this.database = firebase.database();
            this.wishesRef = this.database.ref(CONFIG.FIREBASE.database.wishes);
            
            console.log('✅ Firebase Realtime Database inicializado');
            console.log('📊 Database URL:', CONFIG.FIREBASE.config.databaseURL);
            
            // Cargar perfiles disponibles
            this.loadAvailableProfiles();
            
            // Escuchar cambios en tiempo real
            this.setupRealtimeListeners();
            
            // Escuchar cambios en perfiles disponibles
            this.setupAvailableProfilesListeners();

            // Marcar presencia del usuario (en línea / desconectado)
            this.setupPresence();
            
        } catch (error) {
            console.error('❌ Error inicializando Firebase:', error);
            console.error('🔍 [DEBUG] Error details:', error.message);
            console.error('🔍 [DEBUG] Error code:', error.code);
            console.error('🔍 [DEBUG] Error stack:', error.stack);
            console.error('🔍 [DEBUG] Configuración Firebase:', CONFIG.FIREBASE.config);
            console.error('🔍 [DEBUG] Firebase object:', firebase);
            console.error('🔍 [DEBUG] firebase.database:', firebase.database);
            this.showNotification(`Error Firebase: ${error.message} (${error.code || 'Sin código'})`, 'error');
        }
    }

    // ===== PRESENCIA (EN LÍNEA / DESCONECTADO) =====
    // NUEVO ENFOQUE: nodo DEDICADO `users/{id}/presence` con { online, lastActive }.
    // Antes se escribía dentro de `users/{id}/profile`, pero ese nodo se
    // SOBRESCRIBE al guardar el perfil (script-profile-complete.js hace
    // update({ profile: ... })), borrando isOnline/lastActive y dejando a
    // todos como desconectados. El nodo dedicado no se toca al guardar perfil.
    // Marca al usuario como en línea y lo marca como desconectado
    // automáticamente al cerrar la pestaña o perder conexión.
    setupPresence() {
        if (!this.database || !this.currentUser || !this.currentUser.id) {
            // Si aún no hay usuario (login tardío), reintentar cuando cambie la sesión
            if (!this._presenceRetryBound) {
                this._presenceRetryBound = true;
                window.addEventListener('authStateChanged', () => {
                    if (this.currentUser && this.currentUser.id) {
                        this.setupPresence();
                    }
                });
            }
            return;
        }
        try {
            const uid = String(this.currentUser.id);
            const presenceRef = this.database.ref(`users/${uid}/presence`);
            const connectedRef = this.database.ref('.info/connected');

            connectedRef.on('value', (snap) => {
                if (snap.val() === true) {
                    presenceRef.onDisconnect().set({
                        online: false,
                        lastActive: firebase.database.ServerValue.TIMESTAMP
                    });
                    presenceRef.set({
                        online: true,
                        lastActive: firebase.database.ServerValue.TIMESTAMP
                    });
                }
            });

            // Refrescar lastActive periódicamente mientras la pestaña está abierta
            if (this.presenceInterval) clearInterval(this.presenceInterval);
            this.presenceInterval = setInterval(() => {
                try {
                    presenceRef.update({
                        online: true,
                        lastActive: firebase.database.ServerValue.TIMESTAMP
                    });
                } catch (_) {}
            }, 60000);

            window.addEventListener('beforeunload', () => {
                try { presenceRef.set({ online: false, lastActive: firebase.database.ServerValue.TIMESTAMP }); } catch (_) {}
            });
        } catch (e) {
            console.warn('⚠️ No se pudo inicializar la presencia:', e);
        }
    }

    // ===== CARGA INICIAL DE DESEOS =====
    async loadExistingWishes() {
        if (!this.wishesRef) return;
        
        try {
            console.log('🔍 Cargando deseos existentes desde Firebase...');
            
            const snapshot = await this.wishesRef.once('value');
            const wishesData = snapshot.val();
            
            if (wishesData) {
                // Limpiar array de deseos existente
                this.wishes = [];
                
                // Procesar cada deseo
                Object.keys(wishesData).forEach(key => {
                    const wish = wishesData[key];
                    wish.id = key;
                    
                    // Normalizar datos del deseo
                    this.normalizeWishData(wish);
                    
                    // Agregar al array
                    this.wishes.push(wish);
                });
                
                console.log(`✅ Cargados ${this.wishes.length} deseos desde Firebase`);
                
                // Renderizar en el mapa y sidebar
                this.renderWishesOnMap();
                this.renderAvailableProfilesInSidebar();
            } else {
                console.log('ℹ️ No hay deseos en Firebase aún');
            }
            
        } catch (error) {
            console.error('❌ Error cargando deseos existentes:', error);
            this.showNotification('Error cargando deseos existentes', 'error');
        }
    }

    // ===== NORMALIZACIÓN DE DATOS =====
    normalizeWishData(wish) {
        // Asegurar que el deseo tenga la estructura correcta
        if (!wish.author) {
            wish.author = { id: 'anonymous', name: 'Usuario Anónimo' };
        }
        
        if (!wish.author.id) {
            wish.author.id = 'anonymous';
        }
        
        if (!wish.author.name) {
            wish.author.name = 'Usuario Anónimo';
        }
        
        if (!wish.status) {
            wish.status = 'active';
        }
        
        if (!wish.priceFormatted && wish.price) {
            wish.priceFormatted = this.formatPrice(wish.price);
        }
        
        if (!wish.location && wish.coordinates) {
            wish.location = {
                lat: wish.coordinates[1],
                lng: wish.coordinates[0]
            };
        }
        
        return wish;
    }

    // ===== LISTENERS DE TIEMPO REAL =====
    setupRealtimeListeners() {
        if (!this.wishesRef) return;

        // Escuchar nuevos deseos
        this.wishesRef.on('child_added', (snapshot) => {
            const wish = snapshot.val();
            wish.id = snapshot.key;
            
            // Asegurar que el deseo tenga la estructura correcta
            this.normalizeWishData(wish);
            
            // Solo agregar si no existe ya
            if (!this.wishes.find(w => w.id === wish.id)) {
                this.wishes.push(wish);
                this.addWishMarker(wish);
                console.log('✅ Nuevo deseo agregado en tiempo real:', wish.title);
            }
        });

        // Escuchar cambios en deseos existentes
        this.wishesRef.on('child_changed', (snapshot) => {
            const updatedWish = snapshot.val();
            updatedWish.id = snapshot.key;
            
            // Asegurar que el deseo tenga la estructura correcta
            this.normalizeWishData(updatedWish);
            
            const index = this.wishes.findIndex(w => w.id === updatedWish.id);
            if (index !== -1) {
                this.wishes[index] = updatedWish;
                this.updateWishMarker(updatedWish);
                console.log('✅ Deseo actualizado en tiempo real:', updatedWish.title);
            }
        });

        // Escuchar eliminación de deseos
        this.wishesRef.on('child_removed', (snapshot) => {
            const wishId = snapshot.key;
            const index = this.wishes.findIndex(w => w.id === wishId);
            
            if (index !== -1) {
                this.wishes.splice(index, 1);
                this.removeWishMarker(wishId);
                console.log('✅ Deseo eliminado en tiempo real:', wishId);
            }
        });
    }

    // ===== LISTENERS DE PERFILES DISPONIBLES =====
    setupAvailableProfilesListeners() {
        if (!this.database) return;

        // Prevenir múltiples configuraciones de listeners
        if (this.availableProfilesListenersSetup) {
            console.log('⚠️ [DEBUG] Listeners ya configurados, saltando...');
            return;
        }
        this.availableProfilesListenersSetup = true;

        const profilesRef = this.database.ref('availableProfiles');
        
        // Escuchar nuevos perfiles disponibles
        profilesRef.on('child_added', async (snapshot) => {
            const profile = snapshot.val();
            profile.id = snapshot.key;
            
            console.log(`🔍 [DEBUG] child_added event - Profile: ${profile.userName}, ID: ${profile.id}, userId: ${profile.userId}, isAvailable: ${profile.isAvailable}`);
            
            if (profile.isAvailable) {
                // Verificar duplicados por userId Y por id
                const existingById = this.availableProfiles.find(p => p.id === profile.id);
                const existingByUserId = this.availableProfiles.find(p => p.userId === profile.userId);
                
                console.log(`🔍 [DEBUG] Verificando duplicados - existingById: ${!!existingById}, existingByUserId: ${!!existingByUserId}`);
                console.log(`🔍 [DEBUG] availableProfiles actual length: ${this.availableProfiles.length}`);
                
                if (!existingById && !existingByUserId) {
                    this.availableProfiles.push(profile);
                    await this.createProfileMarker(profile);
                    this.renderAvailableProfilesInSidebar();
                    console.log('✅ Nuevo perfil disponible agregado:', profile.userName, 'ID:', profile.id);
                } else {
                    console.log('⚠️ Perfil duplicado ignorado:', profile.userName, 'ID:', profile.id, 'userId:', profile.userId);
                }
            } else {
                console.log('⚠️ Perfil no disponible ignorado:', profile.userName, 'ID:', profile.id);
            }
        });

        // Escuchar cambios en perfiles existentes
        profilesRef.on('child_changed', async (snapshot) => {
            const updatedProfile = snapshot.val();
            updatedProfile.id = snapshot.key;
            
            const index = this.availableProfiles.findIndex(p => p.id === updatedProfile.id);
            if (index !== -1) {
                this.availableProfiles[index] = updatedProfile;
                await this.updateProfileMarker(updatedProfile);
                this.renderAvailableProfilesInSidebar();
                console.log('✅ Perfil disponible actualizado:', updatedProfile.userName);
            }
        });

        // Escuchar eliminación de perfiles
        profilesRef.on('child_removed', (snapshot) => {
            const profileId = snapshot.key;
            const index = this.availableProfiles.findIndex(p => p.id === profileId);
            
            if (index !== -1) {
                this.availableProfiles.splice(index, 1);
                this.removeProfileMarker(profileId);
                this.renderAvailableProfilesInSidebar();
                console.log('✅ Perfil disponible eliminado:', profileId);
            }
        });
    }

    // ===== CREACIÓN DE DESEOS =====
    async createWish(wishData) {
        console.log('🔍 [DEBUG] createWish llamado con:', wishData);
        console.log('🔍 [DEBUG] CONFIG.FIREBASE.enabled:', CONFIG.FIREBASE.enabled);
        console.log('🔍 [DEBUG] this.wishesRef:', this.wishesRef);
        
        // Validar que el usuario esté autenticado
        if (!this.currentUser || !this.currentUser.id) {
            this.showNotification('Debes iniciar sesión para crear un deseo', 'error');
            this.showAuthUI();
            return;
        }
        
        // Si Firebase está deshabilitado, ir directamente al modo local
        if (!CONFIG.FIREBASE.enabled) {
            console.log('🔍 [DEBUG] Firebase deshabilitado en configuración, usando modo local');
            return this.createWishLocally(wishData);
        }
        
        // Si Firebase está habilitado pero no inicializado, intentar inicializar
        if (!this.wishesRef) {
            console.log('🔍 [DEBUG] Firebase habilitado pero no inicializado, intentando inicializar...');
            this.initializeFirebase();
            
            // Esperar un poco y verificar de nuevo
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            if (!this.wishesRef) {
                // Modo fallback: crear deseo localmente sin Firebase
                console.warn('⚠️ Firebase no disponible después de intentar inicializar, creando deseo localmente');
                return this.createWishLocally(wishData);
            }
        }

        try {
            console.log('🔍 [DEBUG] Iniciando creación de deseo en Firebase...');
            
            // Obtener ubicación actual del usuario
            console.log('🔍 [DEBUG] Obteniendo ubicación del usuario...');
            const location = await this.getCurrentLocation();
            console.log('🔍 [DEBUG] Ubicación obtenida:', location);
            
            const wish = {
                title: wishData.title,
                description: wishData.description,
                category: wishData.category,
                price: parseInt(wishData.price),
                priceFormatted: this.formatPrice(wishData.price),
                address: wishData.address,
                urgency: wishData.urgency,
                location: {
                    lat: location.lat,
                    lng: location.lng
                },
                author: {
                    id: this.currentUser?.id || 'anonymous',
                    name: this.currentUser?.name || 'Usuario Anónimo',
                    email: this.currentUser?.email || 'anonymous@example.com'
                },
                status: 'active', // active, completed, cancelled
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                updatedAt: firebase.database.ServerValue.TIMESTAMP,
                acceptedBy: null,
                completedAt: null
            };

            console.log('🔍 [DEBUG] Deseo creado:', wish);
            console.log('🔍 [DEBUG] this.wishesRef:', this.wishesRef);
            console.log('🔍 [DEBUG] Intentando guardar en Firebase...');

            // Guardar en Firebase
            const newWishRef = this.wishesRef.push();
            console.log('🔍 [DEBUG] Referencia creada:', newWishRef);
            
            await newWishRef.set(wish);
            console.log('🔍 [DEBUG] Deseo guardado exitosamente en Firebase');
            
            console.log('✅ Deseo creado exitosamente:', wish.title);
            this.showNotification(`¡Deseo "${wish.title}" creado exitosamente!`, 'success');
            
            return newWishRef.key;
            
        } catch (error) {
            console.error('❌ Error creando deseo:', error);
            console.error('🔍 [DEBUG] Error details:', error.message);
            console.error('🔍 [DEBUG] Error code:', error.code);
            console.error('🔍 [DEBUG] Error stack:', error.stack);
            console.error('🔍 [DEBUG] Firebase error details:', error.details);
            console.error('🔍 [DEBUG] this.wishesRef:', this.wishesRef);
            console.error('🔍 [DEBUG] this.database:', this.database);
            console.error('🔍 [DEBUG] this.firebase:', this.firebase);
            this.showNotification(`Error Firebase: ${error.message} (${error.code || 'Sin código'})`, 'error');
            throw error;
        }
    }

    // ===== OBTENER UBICACIÓN ACTUAL =====
    async getCurrentLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                // Ubicación por defecto (Bogotá, Colombia)
                resolve({ lat: 4.6097, lng: -74.0817 });
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    });
                },
                (error) => {
                    console.warn('No se pudo obtener ubicación:', error);
                    // Ubicación por defecto
                    resolve({ lat: 4.6097, lng: -74.0817 });
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 300000
                }
            );
        });
    }

    // ===== FORMATEO DE PRECIOS =====
    formatPrice(price) {
        const numPrice = parseInt(price);
        return new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: 'COP',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(numPrice);
    }

    // ===== MANEJO DEL MODAL DE CREACIÓN =====
    openCreateWishModal() {
        const modal = document.getElementById('createWishModal');
        if (modal) {
            modal.classList.add('active');
            this.setupCreateWishModal();
        }
    }

    setupCreateWishModal() {
        const form = document.getElementById('createWishForm');
        const useCurrentLocationBtn = document.getElementById('useCurrentLocation');
        const priceInput = document.getElementById('wishPrice');
        const cancelBtn = document.getElementById('cancelCreateWish');
        const closeBtn = document.getElementById('closeCreateModal');

        // Formatear precio en tiempo real
        if (priceInput) {
            priceInput.addEventListener('input', (e) => {
                const value = e.target.value;
                if (value) {
                    const formatted = this.formatPrice(value);
                    e.target.title = formatted;
                }
            });
        }

        // Usar ubicación actual
        if (useCurrentLocationBtn) {
            useCurrentLocationBtn.addEventListener('click', async () => {
                try {
                    // Mostrar estado de carga
                    useCurrentLocationBtn.disabled = true;
                    useCurrentLocationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Obteniendo ubicación...';
                    
                    this.showNotification('Obteniendo tu ubicación...', 'info');
                    const location = await this.getCurrentLocation();
                    
                    // Usar geocodificación inversa para obtener dirección
                    const address = await this.reverseGeocode(location.lat, location.lng);
                    document.getElementById('wishAddress').value = address;
                    
                    this.showNotification('Ubicación actual obtenida', 'success');
                } catch (error) {
                    console.error('Error obteniendo ubicación:', error);
                    this.showNotification('Error al obtener ubicación', 'error');
                } finally {
                    // Restaurar botón
                    useCurrentLocationBtn.disabled = false;
                    useCurrentLocationBtn.innerHTML = '<i class="fas fa-map-marker-alt"></i> Usar mi ubicación actual';
                }
            });
        }

        // Enviar formulario
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const formData = new FormData(form);
                const wishData = {
                    title: formData.get('wishTitle') || document.getElementById('wishTitle').value,
                    description: formData.get('wishDescription') || document.getElementById('wishDescription').value,
                    category: formData.get('wishCategory') || document.getElementById('wishCategory').value,
                    price: formData.get('wishPrice') || document.getElementById('wishPrice').value,
                    address: formData.get('wishAddress') || document.getElementById('wishAddress').value,
                    urgency: formData.get('wishUrgency') || document.getElementById('wishUrgency').value
                };

                try {
                    await this.createWish(wishData);
                    this.closeCreateWishModal();
                } catch (error) {
                    console.error('Error creando deseo:', error);
                }
            });
        }

        // Botones de cerrar
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.closeCreateWishModal());
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeCreateWishModal());
        }
    }

    closeCreateWishModal() {
        const modal = document.getElementById('createWishModal');
        if (modal) {
            modal.classList.remove('active');
            // Limpiar formulario
            const form = document.getElementById('createWishForm');
            if (form) form.reset();
        }
    }

    // ===== GEOCODIFICACIÓN INVERSА =====
    async reverseGeocode(lat, lng) {
        try {
            const response = await fetch(
                `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}`
            );
            const data = await response.json();
            
            if (data.features && data.features.length > 0) {
                return data.features[0].place_name;
            }
            return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        } catch (error) {
            console.error('Error en geocodificación inversa:', error);
            return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }
    }

    // ===== MODO FALLBACK - CREAR DESEO LOCALMENTE =====
    async createWishLocally(wishData) {
        console.log('🔍 [DEBUG] createWishLocally llamado con:', wishData);
        
        try {
            // Obtener ubicación actual del usuario
            console.log('🔍 [DEBUG] Obteniendo ubicación actual...');
            const location = await this.getCurrentLocation();
            console.log('🔍 [DEBUG] Ubicación obtenida:', location);
            
            const wish = {
                id: 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                title: wishData.title,
                description: wishData.description,
                category: wishData.category,
                price: parseInt(wishData.price),
                priceFormatted: this.formatPrice(wishData.price),
                address: wishData.address,
                urgency: wishData.urgency,
                location: {
                    lat: location.lat,
                    lng: location.lng
                },
                author: {
                    id: this.currentUser?.id || 'anonymous',
                    name: this.currentUser?.name || 'Usuario Anónimo',
                    email: this.currentUser?.email || 'anonymous@example.com'
                },
                status: 'active',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                acceptedBy: null,
                completedAt: null
            };

            console.log('🔍 [DEBUG] Deseo creado:', wish);

            // Agregar localmente
            this.wishes.push(wish);
            console.log('🔍 [DEBUG] Deseo agregado a la lista local');
            
            // Agregar marcador al mapa
            this.addWishMarker(wish);
            console.log('🔍 [DEBUG] Marcador agregado al mapa');
            
            // Actualizar lista en sidebar
            this.renderAvailableProfilesInSidebar();
            console.log('🔍 [DEBUG] Lista actualizada en sidebar');
            
            console.log('✅ Deseo creado localmente:', wish.title);
            this.showNotification(`¡Deseo "${wish.title}" creado exitosamente!`, 'success');
            
            return wish.id;
            
        } catch (error) {
            console.error('❌ Error creando deseo localmente:', error);
            console.error('🔍 [DEBUG] Error details:', error.message);
            console.error('🔍 [DEBUG] Error stack:', error.stack);
            this.showNotification('Error al crear el deseo localmente', 'error');
            throw error;
        }
    }

    // ===== CARGAR TEMA GUARDADO =====
    // El ThemeManager global ya aplica el tema al cargar. Aquí solo
    // sincronizamos el estado local para el estilo del mapa.
    loadSavedTheme() {
        let savedTheme = null;
        if (window.themeManager) {
            savedTheme = window.themeManager.getCurrentTheme();
        } else if (window.DeseoTheme) {
            savedTheme = window.DeseoTheme.get();
        } else {
            savedTheme = localStorage.getItem('deseo_theme') ||
                          localStorage.getItem('deseo-theme') || 'dark';
        }

        if (savedTheme !== 'light' && savedTheme !== 'dark') {
            savedTheme = 'dark';
        }

        // Guardar el tema actual para usar después de que el mapa se cargue
        this.currentTheme = savedTheme;
    }


    // ===== INDICADOR DE TYPING =====
    addTypingIndicator() {
        const messagesContainer = document.getElementById('aiChatMessages');
        const typingDiv = document.createElement('div');
        typingDiv.className = 'ai-message typing-message';
        typingDiv.innerHTML = `
            <div class="ai-avatar">
                <i class="fas fa-robot"></i>
            </div>
            <div class="message-content">
                <div class="typing-indicator">
                    <span>IA está escribiendo</span>
                    <div class="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
            </div>
        `;
        messagesContainer.appendChild(typingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // ===== REMOVER INDICADOR DE TYPING =====
    removeTypingIndicator() {
        const typingMessage = document.querySelector('.typing-message');
        if (typingMessage) {
            typingMessage.remove();
        }
    }

    // ===== ALERTA DE CHATS SIN RESPONDER =====
    initializeUnreadChatsAlert() {
        // Configurar botón para marcar todos como leídos
        const markAllReadBtn = document.getElementById('markAllReadBtn');
        if (markAllReadBtn) {
            markAllReadBtn.addEventListener('click', () => {
                this.markAllChatsAsRead();
            });
        }

        // Solicitar permisos de notificación
        this.requestNotificationPermission();

        // Iniciar listener de chats sin responder
        this.setupUnreadChatsListener();
    }

    setupUnreadChatsListener() {
        if (!this.database || !this.currentUser) {
            console.log('⚠️ Firebase o usuario no disponible para alerta de chats');
            return;
        }

        // Detener listener anterior si existe
        if (this.unreadChatsListener) {
            this.unreadChatsListener.off();
        }

        console.log('🔍 Configurando listener de chats sin responder...');

        // Escuchar todos los chats del usuario
        const chatsRef = this.database.ref('chats');
        this.unreadChatsListener = chatsRef.on('value', (snapshot) => {
            const chatsData = snapshot.val();
            console.log('🔍 [DEBUG] Chats data recibida:', chatsData);
            
            if (!chatsData) {
                console.log('🔍 [DEBUG] No hay chats, ocultando alerta');
                this.updateUnreadChatsAlert(0);
                return;
            }

            let unreadCount = 0;
            const currentUserId = this.currentUser.id;
            const unreadChats = [];

            console.log('🔍 [DEBUG] Usuario actual ID:', currentUserId);

            // Contar chats sin responder
            Object.values(chatsData).forEach(chat => {
                console.log('🔍 [DEBUG] Procesando chat:', chat.id);
                
                if (chat.participants && chat.participants[currentUserId]) {
                    const userParticipant = chat.participants[currentUserId];
                    console.log('🔍 [DEBUG] Participante del usuario:', userParticipant);
                    
                    // Solo contar si el usuario es proveedor (debe responder)
                    if (userParticipant.role === 'provider') {
                        console.log('🔍 [DEBUG] Usuario es proveedor, verificando mensajes...');
                        
                        // Verificar si hay mensajes sin responder
                        if (chat.messages) {
                            const messages = Object.values(chat.messages);
                            const lastMessage = messages[messages.length - 1];
                            
                            console.log('🔍 [DEBUG] Último mensaje:', lastMessage);
                            
                            // Si el último mensaje no es del usuario actual y no es del sistema
                            if (lastMessage && 
                                lastMessage.senderId !== currentUserId && 
                                lastMessage.senderId !== 'system' &&
                                !lastMessage.responded) {
                                
                                unreadCount++;
                                unreadChats.push({
                                    chatId: chat.id,
                                    senderName: lastMessage.senderName,
                                    message: lastMessage.message
                                });
                                
                                console.log('🔍 [DEBUG] Chat sin responder encontrado:', {
                                    chatId: chat.id,
                                    senderName: lastMessage.senderName,
                                    message: lastMessage.message
                                });
                                
                                // Enviar notificación del navegador
                                this.sendBrowserNotification(lastMessage.senderName, lastMessage.message);
                            }
                        }
                    } else {
                        console.log('🔍 [DEBUG] Usuario no es proveedor, rol:', userParticipant.role);
                    }
                } else {
                    console.log('🔍 [DEBUG] Usuario no participa en este chat');
                }
            });

            console.log('🔍 [DEBUG] Total chats sin responder:', unreadCount);
            console.log('🔍 [DEBUG] Chats sin responder:', unreadChats);
            
            this.updateUnreadChatsAlert(unreadCount);
        });
    }

    updateUnreadChatsAlert(count) {
        const alert = document.getElementById('unreadChatsAlert');
        const countElement = document.getElementById('unreadChatsCount');
        
        console.log('🔍 [DEBUG] Actualizando alerta de chats:', count);
        console.log('🔍 [DEBUG] Elementos encontrados:', { alert: !!alert, countElement: !!countElement });
        
        if (!alert || !countElement) {
            console.error('❌ Elementos de alerta no encontrados');
            return;
        }

        this.unreadChatsCount = count;

        if (count > 0) {
            countElement.textContent = count;
            alert.style.display = 'block';
            
            console.log('🔍 [DEBUG] Mostrando alerta con', count, 'chats sin responder');
            
            // Agregar animación de pulso si hay muchos chats
            if (count >= 3) {
                alert.classList.add('pulse');
            } else {
                alert.classList.remove('pulse');
            }
        } else {
            alert.style.display = 'none';
            alert.classList.remove('pulse');
            console.log('🔍 [DEBUG] Ocultando alerta - no hay chats sin responder');
        }
    }

    // Solicitar permisos de notificación del navegador
    async requestNotificationPermission() {
        if (!('Notification' in window)) {
            console.log('❌ Este navegador no soporta notificaciones');
            return false;
        }

        if (Notification.permission === 'granted') {
            return true;
        }

        if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            return permission === 'granted';
        }

        return false;
    }

    // Enviar notificación del navegador
    async sendBrowserNotification(senderName, message) {
        try {
            const hasPermission = await this.requestNotificationPermission();
            
            if (!hasPermission) {
                console.log('⚠️ Permisos de notificación denegados');
                return;
            }

            const notification = new Notification('Nuevo mensaje de ' + senderName, {
                body: message.length > 50 ? message.substring(0, 50) + '...' : message,
                icon: 'https://www.gravatar.com/avatar/?d=mp&f=y',
                badge: 'https://www.gravatar.com/avatar/?d=mp&f=y',
                tag: 'deseo-chat',
                requireInteraction: false,
                silent: false
            });

            // Cerrar la notificación después de 5 segundos
            setTimeout(() => {
                notification.close();
            }, 5000);

            // Al hacer click en la notificación, abrir la página de chats
            notification.onclick = () => {
                window.focus();
                window.location.href = 'chats.html';
                notification.close();
            };

            console.log('✅ Notificación del navegador enviada para:', senderName);
            
        } catch (error) {
            console.error('❌ Error enviando notificación del navegador:', error);
        }
    }

    async markAllChatsAsRead() {
        if (!this.database || !this.currentUser) {
            console.error('❌ Firebase o usuario no disponible');
            return;
        }

        try {
            const currentUserId = this.currentUser.id;
            const chatsRef = this.database.ref('chats');
            const snapshot = await chatsRef.once('value');
            const chatsData = snapshot.val();

            if (!chatsData) return;

            const updatePromises = [];

            Object.entries(chatsData).forEach(([chatId, chat]) => {
                if (chat.participants && chat.participants[currentUserId]) {
                    const userParticipant = chat.participants[currentUserId];
                    
                    // Solo marcar como leídos si el usuario es proveedor
                    if (userParticipant.role === 'provider' && chat.messages) {
                        const messages = Object.values(chat.messages);
                        
                        messages.forEach(message => {
                            if (message.senderId !== currentUserId && 
                                message.senderId !== 'system' && 
                                !message.responded) {
                                
                                // Marcar mensaje como respondido
                                const messageRef = this.database.ref(`chats/${chatId}/messages/${message.id}`);
                                updatePromises.push(
                                    messageRef.update({ responded: true, respondedAt: new Date().toISOString() })
                                );
                            }
                        });
                    }
                }
            });

            await Promise.all(updatePromises);
            
            this.showNotification('Todos los chats marcados como leídos', 'success');
            console.log('✅ Todos los chats marcados como leídos');
            
        } catch (error) {
            console.error('❌ Error marcando chats como leídos:', error);
            this.showNotification('Error al marcar chats como leídos', 'error');
        }
    }

    // ===== NOTIFICACIÓN DE MENSAJES NUEVOS =====
    initializeNewMessagesNotification() {
        console.log('🔍 [DEBUG] Inicializando notificación de mensajes nuevos...');
        
        const notificationElement = document.getElementById('newMessagesNotification');
        if (!notificationElement) {
            console.error('❌ Elemento newMessagesNotification no encontrado');
            return;
        }

        // Event listener para click en la notificación
        notificationElement.addEventListener('click', () => {
            console.log('🔍 [DEBUG] Click en notificación de mensajes nuevos');
            this.markNewMessagesAsRead();
        });

        // Cargar mensajes existentes y establecer listener
        this.loadAllMessages();
        this.setupNewMessagesListener();
        
        console.log('✅ [DEBUG] Notificación de mensajes nuevos inicializada');
    }

    async loadAllMessages() {
        if (!this.database || !this.currentUser) return;

        try {
            const chatsRef = this.database.ref('chats');
            const snapshot = await chatsRef.once('value');
            const chatsData = snapshot.val();

            if (!chatsData) return;

            const currentUserId = this.currentUser.id;

            console.log('🔍 [DEBUG] Cargando mensajes existentes para establecer línea base...');

            // Cargar todos los mensajes de chats donde participa el usuario
            Object.entries(chatsData).forEach(([chatId, chat]) => {
                if (chat.participants && chat.participants[currentUserId]) {
                    if (chat.messages) {
                        Object.values(chat.messages).forEach(message => {
                            this.allMessages.set(message.id, message);
                        });
                    }
                }
            });

            console.log('🔍 [DEBUG] Mensajes cargados en cache:', this.allMessages.size);
            console.log('🔍 [DEBUG] Línea base establecida - solo nuevos mensajes activarán notificación');
            
            // NO mostrar notificación inicial - solo establecer línea base
            this.newMessagesCount = 0;
            this.updateNewMessagesNotification(0);
        } catch (error) {
            console.error('❌ Error cargando mensajes:', error);
        }
    }

    setupNewMessagesListener() {
        if (!this.database || !this.currentUser) {
            console.error('❌ Firebase o usuario no disponible');
            return;
        }

        // Limpiar listener anterior si existe
        if (this.newMessagesListener) {
            this.newMessagesListener.off();
        }

        const chatsRef = this.database.ref('chats');

        this.newMessagesListener = chatsRef.on('value', (snapshot) => {
            const chatsData = snapshot.val();
            
            if (!chatsData) {
                this.updateNewMessagesNotification(0);
                return;
            }

            console.log('🔍 [DEBUG] Verificando mensajes nuevos en chats...');
            
            let newMessagesCount = 0;
            const currentUserId = this.currentUser.id;

            Object.values(chatsData).forEach(chat => {
                if (chat.participants && chat.participants[currentUserId]) {
                    if (chat.messages) {
                        const messages = Object.values(chat.messages);
                        
                        messages.forEach(message => {
                            const messageId = message.id;
                            const previouslyKnown = this.allMessages.has(messageId);
                            
                            // Si es un mensaje nuevo Y no es del usuario actual Y no es del sistema
                            if (!previouslyKnown && 
                                message.senderId !== currentUserId && 
                                message.senderId !== 'system') {
                                console.log('🔍 [DEBUG] Nuevo mensaje detectado:', message);
                                console.log('🔍 [DEBUG] - Chat ID:', chat.id);
                                console.log('🔍 [DEBUG] - Sender ID:', message.senderId);
                                console.log('🔍 [DEBUG] - Current User ID:', currentUserId);
                                console.log('🔍 [DEBUG] - Message:', message.message);
                                newMessagesCount++;
                            }
                            
                            // Actualizar cache
                            this.allMessages.set(messageId, message);
                        });
                    }
                }
            });

            console.log('🔍 [DEBUG] Mensajes nuevos encontrados en esta verificación:', newMessagesCount);
            console.log('🔍 [DEBUG] Total mensajes en cache:', this.allMessages.size);

            if (newMessagesCount > 0) {
                this.newMessagesCount += newMessagesCount;
                console.log('🔍 [DEBUG] Total mensajes nuevos acumulados:', this.newMessagesCount);
                this.updateNewMessagesNotification(this.newMessagesCount);
            }
        });
    }

    updateNewMessagesNotification(count) {
        const notificationElement = document.getElementById('newMessagesNotification');
        const countElement = document.getElementById('newMessagesCount');

        if (!notificationElement || !countElement) {
            console.error('❌ Elementos de notificación no encontrados');
            return;
        }

        if (count > 0) {
            countElement.textContent = count;
            notificationElement.style.display = 'block';
            
            // Añadir animación de pulso si hay 3 o más mensajes nuevos
            if (count >= 3) {
                notificationElement.classList.add('pulse');
                setTimeout(() => {
                    notificationElement.classList.remove('pulse');
                }, 2000);
            }
            
            console.log('🔍 [DEBUG] Notificación mostrada con', count, 'mensajes nuevos');
        } else {
            notificationElement.style.display = 'none';
            notificationElement.classList.remove('pulse');
            console.log('🔍 [DEBUG] Notificación ocultada - contador en 0');
        }
    }

    markNewMessagesAsRead() {
        console.log('🔍 [DEBUG] Marcando todos los mensajes nuevos como leídos...');
        
        const notificationElement = document.getElementById('newMessagesNotification');
        if (notificationElement) {
            notificationElement.style.display = 'none';
            notificationElement.classList.remove('pulse');
        }

        // Limpiar el cache de mensajes conocidos para que los mensajes actuales
        // no se consideren "nuevos" en futuras verificaciones
        this.allMessages.clear();
        
        // Recargar mensajes para establecer nueva línea base
        this.loadAllMessages();

        // Resetear contador a 0
        this.newMessagesCount = 0;
        
        this.showNotification('Mensajes marcados como leídos', 'success');
        console.log('✅ [DEBUG] Mensajes nuevos marcados como leídos - contador en 0');
    }
}

// ===== INICIALIZACIÓN DE LA APLICACIÓN =====
// La inicialización de DeseoApp ahora se maneja en index.html dentro del window.addEventListener('load')
// para asegurar que el DOM esté completamente cargado antes de la inicialización