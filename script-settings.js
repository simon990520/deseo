/**
 * Settings - Página de configuración
 * Maneja la configuración del usuario y preferencias de la aplicación
 */

class SettingsManager {
    constructor() {
        this.currentUser = null;
        this.init();
    }

    async init() {
        console.log('🔍 SettingsManager: Inicializando...');
        
        // Cargar datos del usuario
        await this.loadCurrentUser();
        
        // Configurar event listeners
        this.setupEventListeners();
        
        // Cargar configuración
        this.loadSettings();
        
        console.log('✅ SettingsManager: Inicializado correctamente');
    }

    async loadCurrentUser() {
        try {
            const userData = localStorage.getItem('deseo_user');
            if (userData) {
                this.currentUser = JSON.parse(userData);
                console.log('✅ Usuario cargado:', this.currentUser.name);
                
                // Llenar campos del formulario
                this.populateUserFields();
            } else {
                console.log('⚠️ No hay usuario logueado');
                this.showLoginPrompt();
            }
        } catch (error) {
            console.error('❌ Error cargando usuario:', error);
        }
    }

    populateUserFields() {
        if (!this.currentUser) return;

        const userNameField = document.getElementById('userName');
        const userEmailField = document.getElementById('userEmail');

        if (userNameField) userNameField.value = this.currentUser.name || '';
        if (userEmailField) userEmailField.value = this.currentUser.email || '';
    }

    showLoginPrompt() {
        const settingsContainer = document.querySelector('.settings-container');
        if (settingsContainer) {
            settingsContainer.innerHTML = `
                <div class="login-prompt">
                    <i class="fas fa-user-lock"></i>
                    <h2>Inicia sesión para acceder a la configuración</h2>
                    <p>Necesitas estar logueado para personalizar tu experiencia</p>
                    <button class="btn-primary" onclick="window.location.href='index.html'">
                        <i class="fas fa-sign-in-alt"></i> Ir al inicio
                    </button>
                </div>
            `;
        }
    }

    setupEventListeners() {
        // Event listeners para el sidebar
        const sidebarToggle = document.getElementById('sidebarToggle');
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', () => this.toggleSidebarMenu());
        }

        // Event listeners para campos de configuración
        const userNameField = document.getElementById('userName');
        const userEmailField = document.getElementById('userEmail');

        if (userNameField) {
            userNameField.addEventListener('change', () => this.saveUserSettings());
        }
        if (userEmailField) {
            userEmailField.addEventListener('change', () => this.saveUserSettings());
        }

        // Event listeners para checkboxes
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => this.saveSettings());
        });

        // Event listener para tema
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        }
    }

    toggleSidebarMenu() {
        console.log('🔄 Toggling sidebar menu...');
        const mainNav = document.querySelector('.main-nav');
        const sidebarToggle = document.getElementById('sidebarToggle');
        
        if (mainNav && sidebarToggle) {
            const isHidden = mainNav.classList.contains('hidden');
            const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
            
            if (isHidden) {
                mainNav.classList.remove('hidden');
                if (isMobile) document.body.classList.add('mobile-menu-open');
                console.log('✅ Sidebar menu shown');
            } else {
                mainNav.classList.add('hidden');
                if (isMobile) document.body.classList.remove('mobile-menu-open');
                console.log('✅ Sidebar menu hidden');
            }
        }
    }

    loadSettings() {
        try {
            const settings = JSON.parse(localStorage.getItem('deseo_settings') || '{}');
            
            // Cargar configuración de notificaciones
            const chatNotifications = document.getElementById('chatNotifications');
            const wishNotifications = document.getElementById('wishNotifications');
            
            if (chatNotifications) chatNotifications.checked = settings.chatNotifications !== false;
            if (wishNotifications) wishNotifications.checked = settings.wishNotifications !== false;

            console.log('✅ Configuración cargada');
        } catch (error) {
            console.error('❌ Error cargando configuración:', error);
        }
    }

    saveSettings() {
        try {
            const settings = {
                chatNotifications: document.getElementById('chatNotifications')?.checked ?? true,
                wishNotifications: document.getElementById('wishNotifications')?.checked ?? true
            };

            localStorage.setItem('deseo_settings', JSON.stringify(settings));
            console.log('✅ Configuración guardada');
            this.showNotification('Configuración guardada', 'success');
        } catch (error) {
            console.error('❌ Error guardando configuración:', error);
            this.showNotification('Error al guardar configuración', 'error');
        }
    }

    saveUserSettings() {
        if (!this.currentUser) return;

        try {
            const userNameField = document.getElementById('userName');
            const userEmailField = document.getElementById('userEmail');

            if (userNameField) this.currentUser.name = userNameField.value;
            if (userEmailField) this.currentUser.email = userEmailField.value;

            localStorage.setItem('deseo_user', JSON.stringify(this.currentUser));
            console.log('✅ Datos de usuario actualizados');
            this.showNotification('Perfil actualizado', 'success');
                } catch (error) {
            console.error('❌ Error actualizando perfil:', error);
            this.showNotification('Error al actualizar perfil', 'error');
        }
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('deseo_theme', newTheme);
        
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            const icon = themeToggle.querySelector('i');
            if (icon) {
                icon.className = newTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
        }
        
        console.log('✅ Tema cambiado a:', newTheme);
    }

    showNotification(message, type = 'info') {
        // Crear notificación temporal
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Funciones globales
function goBack() {
    window.history.back();
}

function clearCache() {
    if (confirm('¿Estás seguro de que quieres limpiar el caché? Esto eliminará todos los datos temporales.')) {
        localStorage.clear();
        sessionStorage.clear();
        alert('Caché limpiado correctamente');
        window.location.reload();
    }
}

// ===== PRECIOS (configurables por cualquier usuario) =====
// La sección de precios está disponible para TODOS los usuarios: cualquiera
// puede definir el precio de sus mensajes. Los valores se guardan en Firebase
// RTDB ('settings/pricing') y los usan los chats al cobrar y acreditar.
// Ya NO se usa localStorage para precios.
//
// UI: dos controles principales (precio por mensaje y pago al proveedor) con
// slider + input numérico sincronizados, una tarjeta "hero" con el desglose en
// vivo, y un bloque de "ajustes avanzados" colapsable con el resto de campos.

// Database compartido para settings (precio por mensaje). Reutiliza la instancia si existe.
var _settingsDb = null;
function getSettingsDatabase() {
    if (_settingsDb) return _settingsDb;
    try {
        if (typeof firebase === 'undefined' || !window.CONFIG || !CONFIG.FIREBASE || !CONFIG.FIREBASE.enabled) return null;
        try { firebase.app(); } catch (_) { firebase.initializeApp(CONFIG.FIREBASE.config); }
        _settingsDb = firebase.database();
        return _settingsDb;
    } catch (e) {
        console.error('❌ No se pudo inicializar Firebase en settings:', e);
        return null;
    }
}

// Devuelve el id del usuario logueado (Clerk verificado o localStorage).
function getCurrentUserId() {
    try {
        if (window.DeseoSession && typeof window.DeseoSession.getUser === 'function') {
            var verified = window.DeseoSession.getUser();
            if (verified && verified.verified && verified.id) return String(verified.id);
        }
    } catch (_) { /* noop */ }
    try {
        var raw = localStorage.getItem('deseo_user');
        if (raw) {
            var u = JSON.parse(raw);
            if (u && (u.id || u.uid)) return String(u.id || u.uid);
        }
    } catch (_) { /* noop */ }
    return null;
}

// Precio por defecto (COP) por mensaje, usado solo como valor inicial en la UI.
var DEFAULT_MESSAGE_PRICE = 390;

// Ruta canónica del precio por mensaje del dueño del perfil.
function messagePriceRef(db, userId) {
    return db.ref('users/' + userId + '/profile/messagePrice');
}

function setPricingStatus(msg, type) {
    var el = document.getElementById('pricingSummary');
    if (el && msg) {
        el.setAttribute('data-status', type || 'info');
        el.textContent = msg;
    }
    if (window.settingsManager && window.settingsManager.showNotification) {
        window.settingsManager.showNotification(msg, type || 'info');
    }
}

// Formatea un número como moneda COP sin decimales.
function formatCOP(n) {
    var v = parseInt(n, 10);
    if (!Number.isFinite(v)) v = 0;
    return '$' + v.toLocaleString('es-CO');
}

// Sincroniza la tarjeta "hero" con el precio por mensaje del usuario.
// No hay reparto ni comisión aquí: el precio es lo que cobra el dueño del
// perfil por cada mensaje recibido. La comisión de plataforma se aplica más
// adelante, en el retiro (fuera del alcance de esta pantalla).
function updatePricingHero() {
    var costEl = document.getElementById('messageClientCost');
    var cost = costEl ? parseInt(costEl.value, 10) : 0;
    if (!Number.isFinite(cost) || cost < 0) cost = 0;

    var heroPrice = document.getElementById('heroMessagePrice');
    var heroClient = document.getElementById('heroClientPays');
    var heroProvider = document.getElementById('heroProviderGets');
    var heroFee = document.getElementById('heroPlatformFee');

    if (heroPrice) heroPrice.textContent = cost.toLocaleString('es-CO');
    if (heroClient) heroClient.textContent = formatCOP(cost);
    if (heroProvider) heroProvider.textContent = formatCOP(cost);
    if (heroFee) heroFee.textContent = formatCOP(0);
}

// Pinta el resumen textual inferior.
function updatePricingSummary() {
    var el = document.getElementById('pricingSummary');
    if (!el) return;
    var costEl = document.getElementById('messageClientCost');
    var cost = costEl ? parseInt(costEl.value, 10) : 0;
    if (!Number.isFinite(cost) || cost < 0) cost = 0;
    el.innerHTML = 'Cobras <strong>' + formatCOP(cost) +
        '</strong> por cada mensaje que te envíen. La comisión de plataforma se aplica al retirar.';
}

// Rellena el input principal con el precio por mensaje del usuario logueado.
function renderPricingFields() {
    var section = document.getElementById('pricingSection');
    var host = document.getElementById('pricingFields');
    if (!section) return;

    // Ocultar los ajustes avanzados: el reparto proveedor/comisión ya no se
    // define aquí (se hará en el retiro). La UI principal queda según diseño.
    if (host) host.innerHTML = '';
    var advanced = document.querySelector('.pricing-advanced');
    if (advanced) advanced.style.display = 'none';

    // El segundo control (pago al proveedor) tampoco aplica al precio propio.
    var creditControl = document.getElementById('messageProviderCredit');
    if (creditControl) {
        var wrap = creditControl.closest('.pricing-control');
        if (wrap) wrap.style.display = 'none';
    }

    var costInput = document.getElementById('messageClientCost');
    var costRange = document.getElementById('messageClientCostRange');
    var cost = (costInput && Number.isFinite(parseInt(costInput.value, 10)))
        ? parseInt(costInput.value, 10) : DEFAULT_MESSAGE_PRICE;
    if (costInput && !costInput.value) costInput.value = cost;
    if (costRange && costInput) costRange.value = Math.min(cost, parseInt(costRange.max, 10) || 5000);

    updatePricingHero();
    updatePricingSummary();
}

// Conecta sliders <-> inputs numéricos y actualiza la vista en vivo.
function setupPricingControls() {
    function link(rangeId, inputId) {
        var range = document.getElementById(rangeId);
        var input = document.getElementById(inputId);
        if (!range || !input) return;

        range.addEventListener('input', function () {
            input.value = range.value;
            updatePricingHero();
            updatePricingSummary();
        });
        input.addEventListener('input', function () {
            var v = parseInt(input.value, 10);
            if (Number.isFinite(v)) {
                range.value = Math.min(Math.max(v, parseInt(range.min, 10) || 0), parseInt(range.max, 10) || 5000);
            }
            updatePricingHero();
            updatePricingSummary();
        });
    }
    link('messageClientCostRange', 'messageClientCost');
    link('messageProviderCreditRange', 'messageProviderCredit');
}

// Carga el precio por mensaje del usuario desde Firebase
// (users/{uid}/profile/messagePrice) y lo refleja en la UI.
async function loadPricingFromFirebase() {
    var db = getSettingsDatabase();
    var userId = getCurrentUserId();
    if (!db || !userId) { renderPricingFields(); return; }

    var snap = null;
    try {
        snap = await messagePriceRef(db, userId).once('value');
    } catch (e) {
        console.warn('⚠️ No se pudo leer el precio por mensaje:', e);
    }
    var price = snap ? snap.val() : null;
    var costInput = document.getElementById('messageClientCost');
    var costRange = document.getElementById('messageClientCostRange');
    if (typeof price === 'number' && price >= 0) {
        if (costInput) costInput.value = price;
        if (costRange) costRange.value = Math.min(price, parseInt(costRange.max, 10) || 5000);
    }
    renderPricingFields();
}

// Guarda el precio por mensaje del usuario en Firebase (ruta del perfil).
async function savePricing() {
    var db = getSettingsDatabase();
    var userId = getCurrentUserId();
    if (!db) {
        setPricingStatus('Sin conexión a Firebase: no se pudo guardar el precio', 'error');
        return;
    }
    if (!userId) {
        setPricingStatus('Debes iniciar sesión para guardar tu precio', 'error');
        return;
    }

    var costInput = document.getElementById('messageClientCost');
    var value = costInput ? parseInt(costInput.value, 10) : NaN;
    if (!Number.isFinite(value) || value < 0) {
        setPricingStatus('Ingresa un precio válido (0 o mayor)', 'error');
        return;
    }

    var btn = document.getElementById('savePricingBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; }
    try {
        await messagePriceRef(db, userId).set(value);
        updatePricingHero();
        updatePricingSummary();
        setPricingStatus('Precio guardado correctamente', 'success');
    } catch (e) {
        console.error('❌ Error guardando precio por mensaje:', e);
        setPricingStatus('No se pudo guardar el precio', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar precios'; }
    }
}

// Restaura el precio por defecto en la UI y lo persiste en Firebase.
async function resetPricing() {
    if (!confirm('¿Restaurar el precio por defecto (' + formatCOP(DEFAULT_MESSAGE_PRICE) + ')?')) return;
    var db = getSettingsDatabase();
    var userId = getCurrentUserId();
    var costInput = document.getElementById('messageClientCost');
    var costRange = document.getElementById('messageClientCostRange');
    if (costInput) costInput.value = DEFAULT_MESSAGE_PRICE;
    if (costRange) costRange.value = DEFAULT_MESSAGE_PRICE;
    if (db && userId) {
        try {
            await messagePriceRef(db, userId).set(DEFAULT_MESSAGE_PRICE);
            setPricingStatus('Precio restaurado', 'success');
        } catch (e) {
            setPricingStatus('No se pudo restaurar el precio', 'error');
        }
    }
    renderPricingFields();
}

// ===== PERFIL (nombre del perfil guardado en Firebase) =====
// El nombre del perfil vive en users/{uid}/profile/nickname. Se carga al abrir
// la página y se puede actualizar con el botón "Guardar perfil".

function setProfileStatus(msg, type) {
    var el = document.getElementById('profileSummary');
    if (el && msg) {
        el.setAttribute('data-status', type || 'info');
        el.textContent = msg;
    }
    if (window.settingsManager && window.settingsManager.showNotification) {
        window.settingsManager.showNotification(msg, type || 'info');
    }
}

// Carga el nombre del perfil (nickname) y el email desde Firebase.
async function loadProfileFromFirebase() {
    var db = getSettingsDatabase();
    var userId = getCurrentUserId();

    // Email: intentar desde Clerk o localStorage mientras tanto.
    var emailEl = document.getElementById('profileEmail');
    try {
        var raw = localStorage.getItem('deseo_user');
        if (raw && emailEl) {
            var u = JSON.parse(raw);
            if (u && u.email) emailEl.textContent = u.email;
        }
    } catch (_) { /* noop */ }

    if (!db || !userId) return;

    try {
        var snap = await db.ref('users/' + userId + '/profile').once('value');
        var profile = snap ? snap.val() : null;
        var nicknameEl = document.getElementById('profileNickname');
        if (profile && nicknameEl && typeof profile.nickname === 'string') {
            nicknameEl.value = profile.nickname;
        }
        // Email desde userInfo si existe.
        var infoSnap = await db.ref('users/' + userId + '/userInfo').once('value');
        var info = infoSnap ? infoSnap.val() : null;
        if (info && info.email && emailEl) emailEl.textContent = info.email;
    } catch (e) {
        console.warn('⚠️ No se pudo leer el perfil:', e);
    }
}

// Guarda el nombre del perfil en Firebase (users/{uid}/profile/nickname).
async function saveProfileName() {
    var db = getSettingsDatabase();
    var userId = getCurrentUserId();
    if (!db) { setProfileStatus('Sin conexión a Firebase: no se pudo guardar el perfil', 'error'); return; }
    if (!userId) { setProfileStatus('Debes iniciar sesión para guardar tu perfil', 'error'); return; }

    var nicknameEl = document.getElementById('profileNickname');
    var nickname = nicknameEl ? nicknameEl.value.trim() : '';
    if (!nickname) { setProfileStatus('Ingresa un nombre de perfil válido', 'error'); return; }

    var btn = document.getElementById('saveProfileBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; }
    try {
        await db.ref('users/' + userId + '/profile/nickname').set(nickname);
        // Mantener sincronizado el nombre en userInfo y en localStorage.
        try { await db.ref('users/' + userId + '/userInfo/name').set(nickname); } catch (_) {}
        try {
            var raw = localStorage.getItem('deseo_user');
            if (raw) {
                var u = JSON.parse(raw);
                u.name = nickname;
                localStorage.setItem('deseo_user', JSON.stringify(u));
            }
        } catch (_) {}
        setProfileStatus('Perfil actualizado correctamente', 'success');
    } catch (e) {
        console.error('❌ Error guardando perfil:', e);
        setProfileStatus('No se pudo guardar el perfil', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar perfil'; }
    }
}

// ===== FOTOS DEL PERFIL (users/{uid}/profile/photos) =====
// Las fotos se guardan como array de objetos { base64, name, size, type }.
// Aquí se listan, se pueden reemplazar (input file) o eliminar, y se persisten.

var _profilePhotos = [];

function setPhotosStatus(msg, type) {
    var el = document.getElementById('photosSummary');
    if (el && msg) {
        el.setAttribute('data-status', type || 'info');
        el.textContent = msg;
    }
    if (window.settingsManager && window.settingsManager.showNotification) {
        window.settingsManager.showNotification(msg, type || 'info');
    }
}

function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Renderiza la cuadrícula de fotos con opción de agregar/reemplazar/eliminar.
function renderProfilePhotos() {
    var grid = document.getElementById('photosGrid');
    if (!grid) return;
    grid.innerHTML = '';

    _profilePhotos.forEach(function (photo, index) {
        if (!photo) return;
        var item = document.createElement('div');
        item.className = 'settings-photo-item';
        item.setAttribute('data-index', index);
        item.innerHTML =
            '<img src="' + (photo.base64 || '') + '" alt="Foto ' + (index + 1) + '">' +
            '<div class="settings-photo-actions">' +
                '<label class="settings-photo-btn" title="Reemplazar">' +
                    '<i class="fas fa-sync-alt"></i>' +
                    '<input type="file" accept="image/*" class="settings-photo-input" data-index="' + index + '">' +
                '</label>' +
                '<button type="button" class="settings-photo-btn danger" data-remove="' + index + '" title="Eliminar">' +
                    '<i class="fas fa-trash"></i>' +
                '</button>' +
            '</div>';
        grid.appendChild(item);
    });

    // Tarjeta "Agregar foto" (siempre visible al final de la cuadrícula).
    var addTile = document.createElement('label');
    addTile.className = 'settings-photo-add';
    addTile.setAttribute('title', 'Agregar foto');
    addTile.innerHTML =
        '<i class="fas fa-plus"></i>' +
        '<span>Agregar foto</span>' +
        '<input type="file" accept="image/*" class="settings-photo-add-input" multiple>';
    grid.appendChild(addTile);

    // Listener para agregar una o varias fotos.
    var addInput = addTile.querySelector('.settings-photo-add-input');
    if (addInput) {
        addInput.addEventListener('change', async function (e) {
            var files = Array.prototype.slice.call(e.target.files || []);
            if (!files.length) return;
            var added = 0;
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                if (!file.type.startsWith('image/')) { setPhotosStatus('Solo se permiten imágenes', 'error'); continue; }
                if (file.size > 5 * 1024 * 1024) { setPhotosStatus('Cada imagen debe ser menor a 5MB', 'error'); continue; }
                try {
                    var base64 = await fileToBase64(file);
                    _profilePhotos.push({ base64: base64, name: file.name, size: file.size, type: file.type });
                    added++;
                } catch (err) {
                    console.error('Error procesando foto:', err);
                }
            }
            renderProfilePhotos();
            if (added > 0) {
                setPhotosStatus(added + ' foto(s) agregada(s). Recuerda guardar los cambios.', 'info');
            }
        });
    }

    // Listeners de reemplazo.
    grid.querySelectorAll('.settings-photo-input').forEach(function (input) {
        input.addEventListener('change', async function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) { setPhotosStatus('Solo se permiten imágenes', 'error'); return; }
            if (file.size > 5 * 1024 * 1024) { setPhotosStatus('La imagen debe ser menor a 5MB', 'error'); return; }
            try {
                var base64 = await fileToBase64(file);
                var idx = parseInt(input.dataset.index, 10);
                _profilePhotos[idx] = { base64: base64, name: file.name, size: file.size, type: file.type };
                renderProfilePhotos();
                setPhotosStatus('Foto reemplazada. Recuerda guardar los cambios.', 'info');
            } catch (err) {
                console.error('Error procesando foto:', err);
                setPhotosStatus('Error al procesar la foto', 'error');
            }
        });
    });

    // Listeners de eliminación.
    grid.querySelectorAll('[data-remove]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var idx = parseInt(btn.dataset.remove, 10);
            _profilePhotos.splice(idx, 1);
            renderProfilePhotos();
            setPhotosStatus('Foto eliminada. Recuerda guardar los cambios.', 'info');
        });
    });
}

// Carga las fotos del perfil desde Firebase.
async function loadProfilePhotos() {
    var db = getSettingsDatabase();
    var userId = getCurrentUserId();
    if (!db || !userId) { renderProfilePhotos(); return; }
    try {
        var snap = await db.ref('users/' + userId + '/profile/photos').once('value');
        var photos = snap ? snap.val() : null;
        if (Array.isArray(photos)) {
            _profilePhotos = photos.filter(Boolean);
        } else if (photos && typeof photos === 'object') {
            // Firebase puede devolver un objeto si hay huecos en los índices.
            _profilePhotos = Object.keys(photos).sort(function (a, b) { return a - b; }).map(function (k) { return photos[k]; }).filter(Boolean);
        } else {
            _profilePhotos = [];
        }
    } catch (e) {
        console.warn('⚠️ No se pudieron leer las fotos del perfil:', e);
        _profilePhotos = [];
    }
    renderProfilePhotos();
}

// Guarda las fotos del perfil en Firebase.
async function saveProfilePhotos() {
    var db = getSettingsDatabase();
    var userId = getCurrentUserId();
    if (!db) { setPhotosStatus('Sin conexión a Firebase: no se pudieron guardar las fotos', 'error'); return; }
    if (!userId) { setPhotosStatus('Debes iniciar sesión para guardar tus fotos', 'error'); return; }

    var btn = document.getElementById('savePhotosBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; }
    try {
        await db.ref('users/' + userId + '/profile/photos').set(_profilePhotos);
        setPhotosStatus('Fotos guardadas correctamente', 'success');
    } catch (e) {
        console.error('❌ Error guardando fotos:', e);
        setPhotosStatus('No se pudieron guardar las fotos', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar fotos'; }
    }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    window.settingsManager = new SettingsManager();

    // Conectar sliders/inputs y renderizar la sección de precio por mensaje.
    setupPricingControls();
    renderPricingFields();
    loadPricingFromFirebase();

    // Cargar perfil (nombre) y fotos desde Firebase.
    loadProfileFromFirebase();
    loadProfilePhotos();

    // Si Clerk resuelve después, recargar los datos del usuario verificado.
    function reloadUserData() {
        try { loadPricingFromFirebase(); } catch (_) {}
        try { loadProfileFromFirebase(); } catch (_) {}
        try { loadProfilePhotos(); } catch (_) {}
    }
    if (window.__DESEO_CLERK_READY__ && typeof window.__DESEO_CLERK_READY__.then === 'function') {
        window.__DESEO_CLERK_READY__.then(reloadUserData).catch(function () {});
    }
    document.addEventListener('deseoClerkReady', reloadUserData);

    // Reintentos por si Firebase/Clerk resuelven tarde.
    setTimeout(reloadUserData, 1500);
    setTimeout(reloadUserData, 3500);
});
