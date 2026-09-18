/**
 * Chat Provider - Lógica para usuarios que ofrecen servicios
 * Maneja la funcionalidad específica de proveedores en el chat
 */

class ChatProvider {
    constructor() {
        this.firebase = null;
        this.database = null;
        this.currentUser = null;
        this.chatId = null;
        this.otherUser = null;
        this.messages = [];
        this.isTyping = false;
        this.typingTimeout = null;
        
        // Notificaciones
        this.notificationPermission = false;
        
        this.init();
    }

    async init() {
        console.log('🔍 ChatProvider: Inicializando...');
        
        // Inicializar Firebase
        await this.initializeFirebase();
        
        // Cargar datos del usuario PRIMERO (necesario para reconstruir parámetros
        // del chat desde Firebase si la URL llegó incompleta en deploy).
        await this.loadCurrentUser();
        
        // Obtener datos del chat desde URL (con respaldos handoff + Firebase)
        await this.getChatDataFromURL();
        
        // Configurar listeners
        this.setupEventListeners();
        
        // Cargar mensajes
        await this.loadMessages();
        // Cargar perfil del otro usuario y su balance
        await this.loadOtherUserProfileAndHeader();
        await this.loadClientBalanceBadge();
        
        // Inicializar notificaciones
        await this.initializeNotifications();

        // Configurar listener para órdenes de encuentro en tiempo real
        this.setupEncounterOrdersListener();

        // Configurar área de carga de fotos
        this.setupPhotoUploadArea();

        // Ir al último mensaje al entrar
        this.scrollToBottom();

        console.log('✅ ChatProvider: Inicializado correctamente');

        // Mostrar control para finalizar encuentro si aplica
        this.ensureCompleteEncounterButton();
    }

    async initializeFirebase() {
        try {
            console.log('🔍 Iniciando Firebase en chat provider...');
            
            if (typeof CONFIG === 'undefined' || !CONFIG.FIREBASE) {
                throw new Error('CONFIG.FIREBASE no está disponible');
            }

            this.firebase = firebase.initializeApp(CONFIG.FIREBASE.config);
            this.database = firebase.database();
            
            // Cargar precios globales (settings/pricing) antes de cobrar.
            try {
                if (window.DeseoPricing && window.DeseoPricing.loadFromFirebase) {
                    await window.DeseoPricing.loadFromFirebase(this.database);
                }
                if (window.DeseoPricing && window.DeseoPricing.subscribe && !this._pricingUnsub) {
                    this._pricingUnsub = window.DeseoPricing.subscribe(this.database, function () {});
                }
            } catch (_) { /* usa defaults */ }
            
            console.log('✅ Firebase inicializado en chat provider');
        } catch (error) {
            console.error('❌ Error inicializando Firebase:', error);
            throw error;
        }
    }

    async getChatDataFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        let chatId = urlParams.get('chatId');
        let otherUserId = urlParams.get('userId');

        // Normalizar valores "undefined"/"null" que llegan como texto cuando el
        // origen construyó la URL con variables vacías.
        const isBad = (v) => !v || v === 'undefined' || v === 'null';
        if (isBad(chatId)) chatId = null;
        if (isBad(otherUserId)) otherUserId = null;

        // RESPALDO 1 (robusto en deploy): si el host reescribió la URL y se perdió
        // el query string, recuperamos los datos del handoff guardado antes de
        // navegar. Probamos sessionStorage y, si no está, localStorage.
        if (!chatId || !otherUserId) {
            const handoff = this.readChatHandoff();
            if (handoff) {
                if (!chatId && handoff.chatId) chatId = String(handoff.chatId);
                if (!otherUserId && handoff.otherUserId) otherUserId = String(handoff.otherUserId);
                console.warn('⚠️ URL sin parámetros; recuperados del handoff:', { chatId, otherUserId });
            }
        }

        this.chatId = chatId;
        this.otherUserId = otherUserId;

        // RESPALDO 2: reconstruir desde Firebase (fuente de verdad) antes de rendirnos.
        await this.resolveChatParamsFromFirebase();

        if (!this.chatId || !this.otherUserId) {
            console.error('❌ Faltan parámetros en la URL', {
                chatId: urlParams.get('chatId'),
                userId: urlParams.get('userId'),
                search: window.location.search
            });
            // Recuperación: si se abrió el chat sin parámetros (p. ej. acceso
            // directo o enlace roto), volvemos a la lista de chats en lugar de
            // dejar la pantalla inutilizable.
            this.showError('Abriendo la lista de chats...');
            setTimeout(() => {
                window.location.replace('chats.html');
            }, 800);
            return;
        }
        
        console.log('📋 Datos del chat:', { chatId: this.chatId, otherUserId: this.otherUserId });
    }

    // Lee el handoff guardado por chats.js antes de navegar (resiste el borrado
    // del query string por parte del host de deploy).
    readChatHandoff() {
        const parse = (raw) => {
            if (!raw) return null;
            try { return JSON.parse(raw); } catch (_) { return null; }
        };
        // Solo aceptamos un handoff RECIENTE y destinado a esta pantalla. Un
        // handoff viejo (de una conversación anterior) NO debe usarse, porque
        // abría al usuario equivocado cuando la URL llegaba sin parámetros.
        const MAX_AGE_MS = 2 * 60 * 1000; // 2 minutos
        const isUsable = (h) => {
            if (!h || !h.chatId || !h.otherUserId) return false;
            if (h.target && h.target !== 'chat-provider.html') return false;
            if (h.ts && (Date.now() - Number(h.ts)) > MAX_AGE_MS) return false;
            return true;
        };
        try {
            const s = parse(sessionStorage.getItem('deseo_chat_handoff'));
            if (isUsable(s)) return s;
        } catch (_) { /* noop */ }
        try {
            const l = parse(localStorage.getItem('deseo_chat_handoff'));
            if (isUsable(l)) return l;
        } catch (_) { /* noop */ }
        return null;
    }

    // Reconstruye chatId/otherUserId consultando el chat en Firebase cuando la
    // URL llegó incompleta. Firebase es la fuente de verdad de los participantes.
    async resolveChatParamsFromFirebase() {
        try {
            if (!this.database || !this.currentUser || !this.currentUser.id) return;
            const currentId = String(this.currentUser.id);

            // Caso A: tenemos chatId, reconstruimos el otro usuario.
            if (this.chatId && !this.otherUserId) {
                const snap = await this.database.ref(`chats/${this.chatId}`).once('value');
                const chat = snap.val();
                const otherFromChat = this.pickOtherParticipant(chat, currentId);
                if (otherFromChat) {
                    this.otherUserId = otherFromChat;
                    console.warn('🔁 otherUserId reconstruido desde el chat:', otherFromChat);
                }
            }

            // Caso B: tenemos el otro usuario, reconstruimos el chatId determinista.
            if (!this.chatId && this.otherUserId) {
                const sortedIds = [currentId, String(this.otherUserId)].sort();
                this.chatId = `chat_${sortedIds[0]}_${sortedIds[1]}`;
                console.warn('🔁 chatId reconstruido:', this.chatId);
            }

            // VALIDACIÓN DE CONSISTENCIA (fuente de verdad = Firebase):
            // Si tenemos ambos parámetros, verificamos contra el chat real que
            // (1) el usuario actual sea participante y (2) otherUserId sea el
            // otro participante. Evita abrir a la persona equivocada si la URL
            // o el handoff venían desajustados.
            if (this.chatId && this.otherUserId) {
                const snap = await this.database.ref(`chats/${this.chatId}`).once('value');
                const chat = snap.val();
                if (chat && chat.participants) {
                    const meParticipant = !!chat.participants[currentId] ||
                        Object.values(chat.participants).some(p => p && p.id != null && String(p.id) === currentId);
                    const realOther = this.pickOtherParticipant(chat, currentId);
                    if (!meParticipant) {
                        console.warn('⚠️ El usuario actual no pertenece a este chat; se descarta.', { chatId: this.chatId });
                        this.chatId = null;
                        this.otherUserId = null;
                    } else if (realOther && String(realOther) !== String(this.otherUserId)) {
                        console.warn('🔁 otherUserId desajustado; corregido desde el chat:', {
                            antes: this.otherUserId, ahora: realOther
                        });
                        this.otherUserId = String(realOther);
                    }
                }
            }
        } catch (e) {
            console.warn('No se pudieron reconstruir parámetros del chat:', e && e.message);
        }
    }

    pickOtherParticipant(chat, currentId) {
        if (!chat || !chat.participants) return null;
        const entries = Object.entries(chat.participants);
        const found = entries.find(([key, p]) => {
            const pid = p && p.id != null ? String(p.id) : String(key);
            return pid !== String(currentId);
        });
        if (!found) return null;
        const [key, p] = found;
        return p && p.id != null ? String(p.id) : String(key);
    }



    async loadCurrentUser() {
        try {
            const userData = localStorage.getItem('deseo_user');
            if (!userData) {
                throw new Error('Usuario no autenticado');
            }
            
            this.currentUser = JSON.parse(userData);
            console.log('👤 Usuario actual cargado:', this.currentUser.name);
        } catch (error) {
            console.error('❌ Error cargando usuario:', error);
            this.showError('Error de autenticación');
        }
    }

    async loadOtherUserProfileAndHeader() {
        try {
            if (!this.database || !this.otherUserId) return;
            const profileRef = this.database.ref(`users/${this.otherUserId}/profile`);
            let snap = await profileRef.once('value');
            let profile = snap.val();
            if (!profile) {
                const rootRef = this.database.ref(`users/${this.otherUserId}`);
                snap = await rootRef.once('value');
                profile = snap.val();
            }
            const alias = profile?.nickname || profile?.alias || profile?.apodo || profile?.userInfo?.name || profile?.name || 'Usuario';
            const avatarEl = document.getElementById('chatUserAvatar');
            const nameEl = document.getElementById('chatUserName');
            if (nameEl) nameEl.firstChild && (nameEl.firstChild.nodeValue = alias + ' ');
            // Foto: usar primera imagen; soporta base64 u objetos guardados en Firebase
            if (avatarEl) {
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

                let rawPhoto = null;
                if (profile?.photos && Array.isArray(profile.photos) && profile.photos.length > 0) {
                    rawPhoto = profile.photos[0];
                } else if (profile?.profileImageUrl) {
                    rawPhoto = profile.profileImageUrl;
                }
                const photoSrc = toImageSrc(rawPhoto);
                if (photoSrc) {
                    avatarEl.innerHTML = '';
                    const img = document.createElement('img');
                    img.src = photoSrc;
                    img.alt = alias;
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'cover';
                    img.style.borderRadius = '50%';
                    avatarEl.appendChild(img);
                }
            }
        } catch (e) {
            console.warn('No se pudo cargar perfil del otro usuario:', e);
        }
    }

    async loadClientBalanceBadge() {
        try {
            if (!this.database || !this.otherUserId) return;
            const badge = document.getElementById('clientBalanceBadge');

            // Esperar a que Clerk/Supabase estén listos: sin token, la RPC
            // devolvería not_authenticated y el badge saldría vacío.
            if (window.DeseoAuth && window.DeseoAuth.waitForSupabase) {
                try { await window.DeseoAuth.waitForSupabase; } catch (_) { /* noop */ }
            }
            if (window.DeseoAuth && window.DeseoAuth.ready) {
                try { await Promise.race([window.DeseoAuth.ready, new Promise(r => setTimeout(r, 8000))]); } catch (_) { /* noop */ }
            }

            // FUENTE AUTORITATIVA: Supabase (balances). La RLS solo permite leer
            // el saldo PROPIO, por lo que el saldo del OTRO usuario (el cliente) se
            // consulta vía RPC acotada rpc_public_balance (expone solo el número).
            // Fallback: Firebase RTDB heredado.
            let balance = null;
            try {
                if (window.DeseoMoney && window.DeseoMoney.getPublicBalance) {
                    const b = await window.DeseoMoney.getPublicBalance(this.database, this.otherUserId);
                    if (typeof b === 'number' && Number.isFinite(b)) balance = b;
                } else if (window.DeseoMoney && window.DeseoMoney.getBalance) {
                    const b = await window.DeseoMoney.getBalance(this.database, this.otherUserId);
                    if (typeof b === 'number' && Number.isFinite(b)) balance = b;
                }
            } catch (_) { /* noop */ }

            if (balance === null) {
                // Fallback RTDB: users/{id}/balance, con fallback a wallet/{id}/balance.
                const balanceRef = this.database.ref(`users/${this.otherUserId}/balance`);
                let snap = await balanceRef.once('value');
                let balanceValue = snap.val();
                if (balanceValue === null || balanceValue === undefined) {
                    const alt = await this.database.ref(`wallet/${this.otherUserId}/balance`).once('value');
                    balanceValue = alt.val();
                }
                balance = parseInt(balanceValue || '0', 10);
            }

            if (badge) {
                badge.textContent = `${balance} pesos`;
                badge.style.display = 'inline-block';
            }

            // Refresco periódico desde la fuente de verdad (Supabase).
            if (this._clientBalanceTimer) clearInterval(this._clientBalanceTimer);
            this._clientBalanceTimer = setInterval(async () => {
                try {
                    if (!window.DeseoMoney || !window.DeseoMoney.getPublicBalance) return;
                    const b = await window.DeseoMoney.getPublicBalance(this.database, this.otherUserId);
                    if (badge && typeof b === 'number' && Number.isFinite(b)) badge.textContent = `${b} pesos`;
                } catch (_) { /* noop */ }
            }, 15000);
        } catch (e) {
            console.warn('No se pudo cargar balance del cliente:', e);
        }
    }

    setupEventListeners() {
        // Botón de envío
        const sendBtn = document.getElementById('sendBtn');
        const messageInput = document.getElementById('messageInput');
        
        if (sendBtn) {
            sendBtn.addEventListener('click', () => this.sendMessage());
        }
        
        if (messageInput) {
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendMessage();
                }
            });
            
            messageInput.addEventListener('input', () => this.handleTyping());
        }

        // Botones de acción rápida - ENFOQUE DIRECTO COMO CHAT CLIENTE
        const quickActions = document.querySelectorAll('.quick-action-btn');
        console.log('🔍 [PROV] Found quick action buttons:', quickActions.length);
        
        quickActions.forEach((btn, index) => {
            console.log(`🔍 [PROV] Button ${index}:`, btn, 'action:', btn.dataset.action);
            
            // ENFOQUE DIRECTO: onclick sin métodos complejos
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = btn.dataset.action;
                console.log('🔍 [PROV] Button onclick triggered:', action);
                
                // SOLUCIÓN DIRECTA SIN MÉTODOS COMPLEJOS
                if (action === 'favorite') {
                    console.log('🔍 [PROV] Toggle favorite');
                    this.toggleFavorite(true);
                }
                
                if (action === 'paid-photo') {
                    console.log('🔍 [PROV] Opening paid photo modal');
                    const modal = document.getElementById('paidPhotoModal');
                    console.log('🔍 [PROV] Modal found:', modal);
                    if (modal) {
                        modal.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 9999 !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0,0,0,0.5) !important;';
                        console.log('🔍 [PROV] Modal CSS applied');
                    } else {
                        console.error('❌ Paid photo modal not found!');
                    }
                }
                
                if (action === 'offer-service') {
                    console.log('🔍 [PROV] Opening offer service modal');
                    const modal = document.getElementById('offerServiceModal');
                    if (modal) {
                        modal.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 9999 !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0,0,0,0.5) !important;';
                    }
                }
                
                if (action === 'tips') {
                    console.log('🔍 [PROV] Sending direct tips request');
                    this.sendTipsRequestDirect();
                }
                
                if (action === 'rate') {
                    console.log('🔍 [PROV] Opening rate modal');
                    const modal = document.getElementById('rateModal');
                    if (modal) {
                        modal.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 9999 !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0,0,0,0.5) !important;';
                    }
                }
                
                if (action === 'evidence') {
                    this.showEvidenceModal();
                }
            };
        });

        // Acciones nuevas proveedor
        const sendOfferServiceBtn = document.getElementById('sendOfferServiceBtn');
        if (sendOfferServiceBtn) {
            sendOfferServiceBtn.addEventListener('click', () => this.sendOfferService());
        }

        const sendTipsBtn = document.getElementById('sendTipsBtn');
        if (sendTipsBtn) {
            sendTipsBtn.addEventListener('click', () => this.sendTipsRequest());
        }
        const paidPhotoInput = document.getElementById('paidPhotoFile');
        if (paidPhotoInput) {
            paidPhotoInput.addEventListener('change', () => this.previewPaidPhotos());
        }
        const sendPaidPhotoBtn = document.getElementById('sendPaidPhotoBtn');
        if (sendPaidPhotoBtn) {
            sendPaidPhotoBtn.addEventListener('click', () => this.sendPaidPhoto());
        }
        const sendRatingBtn = document.getElementById('sendRatingBtn');
        if (sendRatingBtn) {
            sendRatingBtn.addEventListener('click', () => this.sendRating());
        }

        // Modales
        this.setupModalListeners();
        
        // Tema
        this.initializeTheme();
    }

    setupModalListeners() {
        // No-op aquí; listeners arriba
    }

    async loadMessages() {
        if (!this.database || !this.chatId) return;

        try {
            const messagesRef = this.database.ref(`chats/${this.chatId}/messages`);
            
            // Cargar mensajes existentes
            const snapshot = await messagesRef.once('value');
            const messagesData = snapshot.val();
            
            if (messagesData) {
                this.messages = Object.values(messagesData)
                    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                this.renderMessages();
                this.checkForEvidenceRequest();
                
                // Force check after a short delay to ensure DOM is ready
                setTimeout(() => this.checkForEvidenceRequest(), 100);
            }

            // Escuchar nuevos mensajes
            messagesRef.on('child_added', (snapshot) => {
                const message = snapshot.val();
                console.log('🔄 [DEBUG] Nuevo mensaje recibido en chat-provider:', message);
                
                // Verificar si el mensaje ya existe (mejorar detección de duplicados)
                const messageExists = this.messages.some(m => 
                    m.timestamp === message.timestamp && 
                    m.senderId === message.senderId &&
                    m.message === message.message
                );
                
                if (!messageExists) {
                    this.messages.push(message);
                    this.renderMessages();
                    this.scrollToBottom();
                    this.checkForEvidenceRequest();
                    
                    // Force check for evidence request if admin message
                    if (message.senderId === 'admin') {
                        console.log('🔍 [DEBUG] Mensaje de admin detectado, verificando botón de evidencias...');
                        setTimeout(() => this.checkForEvidenceRequest(), 100);
                        setTimeout(() => this.checkForEvidenceRequest(), 500);
                    }
                    
                    // Enviar notificación si el mensaje no es del usuario actual
                    if (message.senderId !== this.currentUser.id && 
                        message.senderId !== 'system' && 
                        message.senderName) {
                        console.log('🔍 [DEBUG] Nuevo mensaje recibido en chat-provider:', message);
                        this.sendBrowserNotification(message.senderName, message.message);
                    }
                }
            });

            // Escuchar cambios en estado de escritura
            this.setupTypingListener();

        } catch (error) {
            console.error('❌ Error cargando mensajes:', error);
        }
    }

    setupTypingListener() {
        if (!this.database || !this.chatId) return;

        const typingRef = this.database.ref(`chats/${this.chatId}/typing/${this.otherUserId}`);
        
        typingRef.on('value', (snapshot) => {
            const isTyping = snapshot.val();
            this.showTypingIndicator(isTyping);
        });
    }

    async sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();
        
        if (!message || !this.database || !this.chatId) return;

        try {
            const messageData = {
                id: this.database.ref(`chats/${this.chatId}/messages`).push().key,
                senderId: this.currentUser.id,
                senderName: this.currentUser.name,
                message: message,
                timestamp: new Date().toISOString(),
                type: 'text'
            };

            // Guardar mensaje en Firebase
            const messagesRef = this.database.ref(`chats/${this.chatId}/messages/${messageData.id}`);
            await messagesRef.set(messageData);

            // Limpiar input
            messageInput.value = '';
            
            // Detener indicador de escritura
            this.stopTyping();

            // Scroll al final
            this.scrollToBottom();

        } catch (error) {
            console.error('❌ Error enviando mensaje:', error);
            this.showError('Error enviando mensaje');
        }
    }

    async handleQuickAction(action) {
        if (action === 'favorite') {
            await this.toggleFavorite(true);
            return;
        }
        if (action === 'paid-photo') {
            this.openModal('paidPhotoModal');
            return;
        }
        if (action === 'offer-service') {
            this.openModal('offerServiceModal');
            return;
        }
        if (action === 'tips') {
            // Para proveedor, solo abre un recordatorio/toast de que las propinas llegan del cliente
            this.showNotification('Pide al cliente una propina con amabilidad 😉', 'info');
            return;
        }
        if (action === 'rate') {
            this.openModal('rateModal');
            return;
        }
        if (action === 'client-balance') {
            await this.viewClientBalance();
            return;
        }
    }

    async toggleFavorite(state) {
        try {
            if (!this.database || !this.chatId || !this.currentUser) return;
            // Guardar favorito por usuario actual en el chat
            await this.database.ref(`chats/${this.chatId}/favorites/${this.currentUser.id}`).set(!!state);
            this.showNotification(state ? 'Añadido a favoritos' : 'Eliminado de favoritos', 'success');
        } catch (e) {
            console.error('❌ Error al cambiar favorito:', e);
            this.showError('No se pudo actualizar favorito');
        }
    }

    async viewClientBalance() {
        if (!this.database || !this.otherUserId) return;
        try {
            // FUENTE AUTORITATIVA: Supabase. Para el saldo del cliente (otro
            // usuario) se usa la RPC acotada rpc_public_balance; fallback RTDB.
            let balance = null;
            try {
                if (window.DeseoMoney && window.DeseoMoney.getPublicBalance) {
                    const b = await window.DeseoMoney.getPublicBalance(this.database, this.otherUserId);
                    if (typeof b === 'number' && Number.isFinite(b)) balance = b;
                } else if (window.DeseoMoney && window.DeseoMoney.getBalance) {
                    const b = await window.DeseoMoney.getBalance(this.database, this.otherUserId);
                    if (typeof b === 'number' && Number.isFinite(b)) balance = b;
                }
            } catch (_) { /* noop */ }
            if (balance === null) {
                const snap = await this.database.ref(`users/${this.otherUserId}/balance`).once('value');
                balance = parseInt(snap.val() || '0', 10);
            }
            this.showNotification(`Balance del cliente: ${balance} pesos`, 'info');
        } catch (e) {
            console.error('❌ Error consultando balance del cliente:', e);
            this.showError('No se pudo obtener el balance del cliente');
        }
    }

    async sendOfferService() {
        const priceStr = (document.getElementById('offerPrice') || {}).value || '0';
        const description = (document.getElementById('offerDescription') || {}).value || '';
        const time = (document.getElementById('offerTime') || {}).value || '';
        const price = parseInt(priceStr, 10) || 0;
        if (!this.database || !this.chatId) return;
        try {
            const msgId = `offer_${Date.now()}`;
            await this.database.ref(`chats/${this.chatId}/messages/${msgId}`).set({
                id: msgId,
                senderId: this.currentUser.id,
                senderName: this.currentUser.name,
                type: 'service_offer',
                price,
                description: description.trim(),
                time,
                // Texto legible para render genérico, notificaciones y compatibilidad.
                message: `Oferta de servicio: $${price.toLocaleString('es-CO')}` +
                    (description.trim() ? `\n${description.trim()}` : '') +
                    (time ? `\nDisponible: ${time}` : ''),
                timestamp: new Date().toISOString()
            });
            this.closeModalSafe('offerServiceModal');
        } catch (e) {
            console.error('❌ Error enviando oferta:', e);
        }
    }

    setupEncounterOrdersListener() {
        try {
            const ordersRef = this.database.ref('encounterOrders');
            ordersRef.orderByChild('chatId').equalTo(this.chatId).on('value', (snapshot) => {
                console.log('🔄 Actualizando botón de encuentro en tiempo real (proveedor)...');
                this.ensureCompleteEncounterButton();
            });
        } catch (e) {
            console.error('❌ Error configurando listener de órdenes (proveedor):', e);
        }
    }

    // Proveedor: botón flotante para marcar encuentro como finalizado o abrir disputa
    async ensureCompleteEncounterButton() {
        try {
            const existing = document.getElementById('completeEncounterBtn');
            if (existing) existing.remove();

            // Solo mostrar botón si hay órdenes aceptadas por el cliente
            const ordersRef = this.database.ref('encounterOrders');
            const snap = await ordersRef.orderByChild('chatId').equalTo(this.chatId).once('value');
            const all = snap.val() || {};
            const acceptedOrders = Object.values(all).filter(o => 
                o.status === 'escrowed' && 
                o.providerId === this.currentUser.id && 
                !o.providerConfirmed
            );
            
            if (acceptedOrders.length === 0) return;

            // Barra de acción integrada al diseño del chat (no un botón suelto)
            const bar = document.createElement('div');
            bar.id = 'completeEncounterBtn';
            bar.className = 'encounter-action-bar';
            bar.innerHTML = `
                <div class="encounter-bar-icon"><i class="fas fa-handshake"></i></div>
                <div class="encounter-bar-text">
                    <div class="encounter-bar-title">Encuentro en curso</div>
                    <div class="encounter-bar-sub">Marca el encuentro como finalizado cuando termines.</div>
                </div>
                <button class="encounter-bar-btn" type="button">Finalizar encuentro</button>
            `;
            bar.querySelector('.encounter-bar-btn').addEventListener('click', () => this.openCompleteEncounterDialog());
            document.body.appendChild(bar);
        } catch (_) {}
    }

    async openCompleteEncounterDialog() {
        try {
            const ordersRef = this.database.ref('encounterOrders');
            const snap = await ordersRef.orderByChild('chatId').equalTo(this.chatId).once('value');
            const all = snap.val() || {};
            const activeOrders = Object.values(all).filter(o => o.status === 'escrowed');
            if (activeOrders.length === 0) {
                this.showNotification('No hay órdenes activas para finalizar', 'info');
                return;
            }
            const order = activeOrders.sort((a,b) => (a.createdAt||'').localeCompare(b.createdAt||''))[activeOrders.length-1];

            // Modal de confirmación con diseño propio (reemplaza confirm/prompt nativos)
            const modal = document.createElement('div');
            modal.className = 'encounter-confirm-modal';
            modal.innerHTML = `
                <div class="encounter-confirm-card">
                    <div class="encounter-confirm-header">
                        <div class="encounter-confirm-icon"><i class="fas fa-handshake"></i></div>
                        <h3>¿Finalizar el encuentro?</h3>
                        <p>Confirma que el encuentro se realizó correctamente. El cliente tendrá 5 minutos para confirmar y liberar el pago.</p>
                    </div>
                    <div class="encounter-confirm-body" style="display:none;">
                        <textarea class="encounter-dispute-reason" placeholder="Describe brevemente el problema..."></textarea>
                    </div>
                    <div class="encounter-confirm-footer">
                        <button class="confirm-ok-btn" type="button"><i class="fas fa-check"></i> Sí, finalizar encuentro</button>
                        <button class="confirm-dispute-btn" type="button"><i class="fas fa-flag"></i> Reportar un problema</button>
                        <button class="confirm-cancel-btn" type="button">Cancelar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const close = () => modal.remove();
            const body = modal.querySelector('.encounter-confirm-body');
            const reasonInput = modal.querySelector('.encounter-dispute-reason');

            modal.querySelector('.confirm-ok-btn').addEventListener('click', async () => {
                close();
                await this.providerConfirmOrder(order.id);
            });

            modal.querySelector('.confirm-dispute-btn').addEventListener('click', async () => {
                if (body.style.display === 'none') {
                    body.style.display = 'block';
                    reasonInput.focus();
                    return;
                }
                const reason = (reasonInput.value || '').trim() || 'El cliente no confirma / Incumplimiento';
                close();
                await this.raiseDispute(order.id, reason);
            });

            modal.querySelector('.confirm-cancel-btn').addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        } catch (e) {
            console.error('❌ Error abriendo finalización (proveedor):', e);
            this.showError('No se pudo abrir la finalización');
        }
    }

    async providerConfirmOrder(orderId) {
        // Deshabilitar botón inmediatamente para evitar múltiples clicks
        const btn = document.getElementById('completeEncounterBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Finalizando...';
            btn.style.background = '#6b7280';
            btn.style.cursor = 'not-allowed';
        }

        const ref = this.database.ref(`encounterOrders/${orderId}`);
        const snap = await ref.once('value');
        const order = snap.val();
        if (!order) return;
        const nowIso = new Date().toISOString();
        await ref.update({ providerConfirmed: true, providerConfirmedAt: nowIso, updatedAt: nowIso });
        await this.checkOrderCompletion(orderId);
        this.showNotification('Has confirmado la finalización. El cliente tiene 5 minutos para confirmar.', 'success');

        // Aviso en el chat con contador de 5 minutos
        const sysId = `system_${Date.now()}`;
        await this.database.ref(`chats/${order.chatId}/messages/${sysId}`).set({
            id: sysId,
            type: 'system',
            message: '⏳ El proveedor marcó el encuentro como finalizado. El cliente tiene 5 minutos para confirmar antes de que se solicite revisión de pago.',
            timestamp: new Date().toISOString()
        });
        this.renderCountdownBanner(orderId, nowIso);
    }

    async checkOrderCompletion(orderId) {
        const ref = this.database.ref(`encounterOrders/${orderId}`);
        // Reclamo ATÓMICO escrowed→completed (una sola transición gana).
        let claimed = false;
        let order = null;
        try {
            const res = await ref.transaction(function (cur) {
                if (!cur) return cur;
                if (cur.status !== 'escrowed') return;
                if (!(cur.clientConfirmed && cur.providerConfirmed)) return;
                cur.status = 'completed';
                cur.completedAt = new Date().toISOString();
                cur.updatedAt = new Date().toISOString();
                return cur;
            });
            claimed = !!(res && res.committed);
            order = (res && res.snapshot) ? res.snapshot.val() : null;
        } catch (e) {
            console.error('❌ Error reclamando finalización (proveedor):', e);
        }
        if (!claimed || !order) return;
        await this.sendCompletionMessage(order);
        await this.promptOptionalRatings(order);
        this.showNotification('Encuentro finalizado. El cliente verá que debe liberar los fondos (automático cuando ambos confirman).', 'success');
        const btn = document.getElementById('completeEncounterBtn');
        if (btn) btn.remove();
    }

    renderCountdownBanner(orderId, providerConfirmedAt) {
        try {
            let banner = document.getElementById('orderCountdownBanner');
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'orderCountdownBanner';
                banner.className = 'order-countdown-banner';
                banner.innerHTML = `
                    <span class="countdown-icon"><i class="fas fa-hourglass-half"></i></span>
                    <span class="countdown-text"></span>
                    <span class="countdown-time"></span>
                `;
                document.body.appendChild(banner);
            }
            const textEl = banner.querySelector('.countdown-text');
            const timeEl = banner.querySelector('.countdown-time');

            const start = new Date(providerConfirmedAt).getTime();
            const deadline = start + 5 * 60 * 1000;
            const tick = () => {
                const now = Date.now();
                const remaining = Math.max(0, deadline - now);
                const m = Math.floor(remaining / 60000);
                const s = Math.floor((remaining % 60000) / 1000);
                if (remaining > 0) {
                    banner.classList.remove('expired');
                    textEl.textContent = 'Esperando confirmación del cliente.';
                    timeEl.textContent = `${m}:${String(s).padStart(2,'0')}`;
                } else {
                    clearInterval(timerId);
                    banner.classList.add('expired');
                    textEl.textContent = 'Tiempo agotado. El cliente no confirmó. Puedes reclamar el pago.';
                    timeEl.textContent = '0:00';
                    // Mostrar botón de reclamar pago al proveedor
                    this.showClaimPaymentButton(orderId);
                }
            };
            tick();
            const timerId = setInterval(tick, 1000);
        } catch (_) {}
    }

    showClaimPaymentButton(orderId) {
        try {
            const existing = document.getElementById('claimPaymentBtn');
            if (existing) return;

            // Reutilizar la barra de acción existente en modo "reclamar pago"
            const bar = document.getElementById('completeEncounterBtn');
            if (bar) {
                bar.classList.add('danger');
                const icon = bar.querySelector('.encounter-bar-icon i');
                if (icon) icon.className = 'fas fa-triangle-exclamation';
                const title = bar.querySelector('.encounter-bar-title');
                if (title) title.textContent = 'El cliente no confirmó';
                const sub = bar.querySelector('.encounter-bar-sub');
                if (sub) sub.textContent = 'Puedes reclamar el pago para revisión del administrador.';
                const btn = bar.querySelector('.encounter-bar-btn');
                if (btn) {
                    btn.textContent = 'Reclamar pago';
                    btn.onclick = () => this.claimPaymentAsProvider(orderId);
                }
                return;
            }

            // Si no existe la barra, crear una nueva
            const newBar = document.createElement('div');
            newBar.id = 'claimPaymentBtn';
            newBar.className = 'encounter-action-bar danger';
            newBar.innerHTML = `
                <div class="encounter-bar-icon"><i class="fas fa-triangle-exclamation"></i></div>
                <div class="encounter-bar-text">
                    <div class="encounter-bar-title">El cliente no confirmó</div>
                    <div class="encounter-bar-sub">Puedes reclamar el pago para revisión del administrador.</div>
                </div>
                <button class="encounter-bar-btn" type="button">Reclamar pago</button>
            `;
            newBar.querySelector('.encounter-bar-btn').addEventListener('click', () => this.claimPaymentAsProvider(orderId));
            document.body.appendChild(newBar);
        } catch (_) {}
    }

    async claimPaymentAsProvider(orderId) {
        try {
            // Modal de confirmación con diseño propio (reemplaza prompt nativo)
            const modal = document.createElement('div');
            modal.className = 'encounter-confirm-modal';
            modal.innerHTML = `
                <div class="encounter-confirm-card">
                    <div class="encounter-confirm-header">
                        <div class="encounter-confirm-icon" style="background:linear-gradient(135deg,#f59e0b,#d97706);box-shadow:0 10px 26px rgba(245,158,11,.4);"><i class="fas fa-hand-holding-dollar"></i></div>
                        <h3>Reclamar pago</h3>
                        <p>El cliente no confirmó en el tiempo establecido. Describe por qué reclamas el pago; un administrador revisará el caso.</p>
                    </div>
                    <div class="encounter-confirm-body">
                        <textarea class="encounter-dispute-reason" placeholder="Describe por qué reclamas el pago...">El cliente no confirmó la finalización del encuentro en el tiempo establecido</textarea>
                    </div>
                    <div class="encounter-confirm-footer">
                        <button class="confirm-ok-btn" type="button" style="background:linear-gradient(135deg,#f59e0b,#d97706);box-shadow:0 6px 16px rgba(245,158,11,.35);"><i class="fas fa-paper-plane"></i> Enviar reclamo</button>
                        <button class="confirm-cancel-btn" type="button">Cancelar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const close = () => modal.remove();
            const reasonInput = modal.querySelector('.encounter-dispute-reason');

            modal.querySelector('.confirm-ok-btn').addEventListener('click', async () => {
                const reason = (reasonInput.value || '').trim();
                if (!reason) { reasonInput.focus(); return; }
                close();
                await this.raiseDispute(orderId, reason);
                this.showNotification('Disputa creada. El administrador revisará el caso.', 'info');
                // Limpiar UI
                const btn = document.getElementById('claimPaymentBtn');
                const bar = document.getElementById('completeEncounterBtn');
                const banner = document.getElementById('orderCountdownBanner');
                if (btn) btn.remove();
                if (bar) bar.remove();
                if (banner) banner.remove();
            });

            modal.querySelector('.confirm-cancel-btn').addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        } catch (e) {
            console.error('❌ Error creando disputa:', e);
            this.showError('Error creando disputa');
        }
    }

    async sendCompletionMessage(order) {
        const sysId = `system_${Date.now()}`;
        await this.database.ref(`chats/${order.chatId}/messages/${sysId}`).set({
            id: sysId,
            type: 'system',
            message: '✅ El proveedor marcó el encuentro como finalizado. A la espera de confirmación del cliente.',
            timestamp: new Date().toISOString()
        });
    }

    async promptOptionalRatings(order) {
        try {
            this.showRatingModal(order, 'cliente');
        } catch (_) {}
    }

    showRatingModal(order, userType) {
        const modal = document.createElement('div');
        modal.className = 'rating-modal';
        modal.innerHTML = `
            <div class="rating-card">
                <div class="rating-card-header">
                    <h3><i class="fas fa-star"></i> Calificar ${userType}</h3>
                    <button class="close-btn" type="button" aria-label="Cerrar">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="rating-card-body">
                    <p>¿Cómo fue tu experiencia? Califica del 1 al 5 (opcional).</p>
                    <div class="rating-stars">
                        <span class="star" data-rating="1">★</span>
                        <span class="star" data-rating="2">★</span>
                        <span class="star" data-rating="3">★</span>
                        <span class="star" data-rating="4">★</span>
                        <span class="star" data-rating="5">★</span>
                    </div>
                    <textarea placeholder="Comentario (opcional)" class="rating-comment"></textarea>
                </div>
                <div class="rating-card-footer">
                    <button class="rating-skip-btn" type="button">Omitir</button>
                    <button class="rating-submit-btn" type="button">Enviar</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();

        // Configurar estrellas (usando clase .active en vez de estilos inline)
        const stars = modal.querySelectorAll('.star');
        let selectedRating = 0;
        stars.forEach((star, index) => {
            star.addEventListener('click', () => {
                selectedRating = index + 1;
                stars.forEach((s, i) => {
                    s.classList.toggle('active', i < selectedRating);
                });
            });
        });

        modal.querySelector('.close-btn').addEventListener('click', close);
        modal.querySelector('.rating-skip-btn').addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

        modal.querySelector('.rating-submit-btn').addEventListener('click', async () => {
            const comment = modal.querySelector('.rating-comment').value;
            if (selectedRating > 0) {
                const ratingId = `rating_${Date.now()}`;
                await this.database.ref(`users/${order.clientId}/encounterRatings/${ratingId}`).set({
                    id: ratingId,
                    from: order.providerId,
                    chatId: order.chatId,
                    orderId: order.id,
                    rating: selectedRating,
                    comment,
                    createdAt: new Date().toISOString()
                });
                this.showNotification('Calificación enviada', 'success');
            }
            close();
        });
    }

    async raiseDispute(orderId, reason) {
        const ref = this.database.ref(`encounterOrders/${orderId}`);
        // Transición atómica escrowed→disputed (evita disputar orden ya liberada).
        const disputeId = `dispute_${orderId}`;
        let order = null;
        let claimed = false;
        try {
            const res = await ref.transaction(function (cur) {
                if (!cur) return cur;
                if (cur.status !== 'escrowed') return;
                cur.status = 'disputed';
                cur.disputeId = disputeId;
                cur.updatedAt = new Date().toISOString();
                return cur;
            });
            claimed = !!(res && res.committed);
            order = (res && res.snapshot) ? res.snapshot.val() : null;
        } catch (e) {
            console.error('❌ Error abriendo disputa (proveedor):', e);
        }
        if (!claimed || !order) {
            this.showNotification('No se puede abrir disputa: la orden ya no está en garantía.', 'info');
            return;
        }
        const dispute = {
            id: disputeId,
            orderId: order.id,
            chatId: order.chatId,
            providerId: order.providerId,
            clientId: order.clientId,
            amount: order.escrowAmount,
            reason,
            createdBy: this.currentUser.id,
            status: 'open', // open | resolving | resolved | rejected
            createdAt: new Date().toISOString()
        };
        await this.database.ref(`disputes/${disputeId}`).set(dispute);
        await this.database.ref(`chats/${order.chatId}/messages/system_${disputeId}`).set({
            id: `system_${disputeId}`,
            type: 'system',
            message: '⚠️ Se abrió una disputa para esta orden. Un administrador revisará el caso.',
            timestamp: new Date().toISOString()
        });
        this.showNotification('Disputa creada. El administrador revisará el caso.', 'info');
        const btn = document.getElementById('completeEncounterBtn');
        if (btn) btn.remove();
    }

    async sendTipsRequest() {
        try {
            // Cambio: enviar directo sin descripción (mensaje fijo)
            const tipsMessage = '💝 El proveedor solicita una propina para continuar con contenido exclusivo.';
            await this.sendSpecialMessage(tipsMessage, 'tips_request');
            this.closeModal('tipsModal');
            this.showNotification('Solicitud de propina enviada', 'success');
        } catch (error) {
            console.error('❌ Error enviando solicitud de propina:', error);
            this.showError('Error enviando solicitud de propina');
        }
    }

    async sendTipsRequestDirect() {
        try {
            // Obtener alias del proveedor
            const providerAlias = await this.getAliasForUser(this.currentUser.id);
            const tipsMessage = `💝 ${providerAlias} ha solicitado una propina para continuar con contenido exclusivo.`;
            await this.sendSpecialMessage(tipsMessage, 'tips_request');
            this.showNotification('Solicitud de propina enviada', 'success');
        } catch (error) {
            console.error('❌ Error enviando solicitud de propina:', error);
            this.showError('Error enviando solicitud de propina');
        }
    }

    async getAliasForUser(userId) {
        try {
            if (!this.database || !userId) return 'Usuario';
            const profileRef = this.database.ref(`users/${userId}/profile`);
            let snap = await profileRef.once('value');
            let profile = snap.val();
            if (!profile) {
                const rootRef = this.database.ref(`users/${userId}`);
                snap = await rootRef.once('value');
                profile = snap.val();
            }
            const alias = profile?.nickname || profile?.alias || profile?.apodo || profile?.userInfo?.name || profile?.name || this.currentUser?.name || 'Usuario';
            return alias;
        } catch (_) {
            return this.currentUser?.name || 'Usuario';
        }
    }

    async creditProvider(amount, reason, opId) {
        try {
            if (!this.database || !this.currentUser) return;
            const amt = parseInt(amount, 10);
            if (!Number.isFinite(amt) || amt <= 0) return;
            // Acreditación ATÓMICA e idempotente vía DeseoMoney.
            if (!window.DeseoMoney) {
                console.error('❌ DeseoMoney no disponible; abortando crédito por seguridad.');
                return;
            }
            await window.DeseoMoney.credit(this.database, this.currentUser.id, amt, {
                reason: reason,
                from: this.otherUserId,
                chatId: this.chatId,
                opId: opId
            });
        } catch (e) {
            console.error('❌ Error acreditando al proveedor:', e);
        }
    }

    async     fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async compressAndConvertToBase64(file, maxWidth = 800, quality = 0.7) {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            img.onload = () => {
                // Calcular nuevas dimensiones manteniendo proporción
                let { width, height } = img;
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // Dibujar imagen redimensionada
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convertir a base64 con compresión
                const base64 = canvas.toDataURL('image/jpeg', quality);
                resolve(base64);
            };
            
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }

    previewPaidPhotos() {
        const container = document.getElementById('paidPhotoPreview');
        const fileInput = document.getElementById('paidPhotoFile');
        if (!container || !fileInput || !fileInput.files) return;
        container.innerHTML = '';
        Array.from(fileInput.files).forEach((f) => {
            const thumb = document.createElement('div');
            thumb.style.width = '72px';
            thumb.style.height = '72px';
            thumb.style.borderRadius = '10px';
            thumb.style.overflow = 'hidden';
            thumb.style.filter = 'blur(6px)';
            const img = document.createElement('img');
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.src = URL.createObjectURL(f);
            thumb.appendChild(img);
            container.appendChild(thumb);
        });
    }

    setupPhotoUploadArea() {
        const uploadArea = document.getElementById('photoUploadArea');
        const fileInput = document.getElementById('paidPhotoFile');
        
        if (!uploadArea || !fileInput) return;

        // Click en el área para abrir selector de archivos
        uploadArea.addEventListener('click', () => {
            fileInput.click();
        });

        // Cambio en el input de archivos
        fileInput.addEventListener('change', () => {
            this.previewPaidPhotos();
        });

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = Array.from(e.dataTransfer.files).filter(file => 
                file.type.startsWith('image/')
            );
            
            if (files.length > 0) {
                // Crear un nuevo FileList
                const dt = new DataTransfer();
                files.forEach(file => dt.items.add(file));
                fileInput.files = dt.files;
                
                this.previewPaidPhotos();
            }
        });
    }

    async sendPaidPhoto() {
        const priceStr = (document.getElementById('paidPhotoPrice') || {}).value || '0';
        const fileInput = document.getElementById('paidPhotoFile');
        const price = parseInt(priceStr, 10) || 0;
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) { this.showError('Selecciona al menos una imagen'); return; }
        if (!this.database || !this.chatId) return;
        try {
            // Convertir múltiples imágenes a base64 comprimidas
            const base64Images = [];
            for (const file of Array.from(fileInput.files)) {
                const compressedB64 = await this.compressAndConvertToBase64(file);
                base64Images.push(compressedB64);
            }
            const count = base64Images.length;
            const msgId = `photo_${Date.now()}`;
            await this.database.ref(`chats/${this.chatId}/messages/${msgId}`).set({
                id: msgId,
                senderId: this.currentUser.id,
                senderName: this.currentUser.name,
                type: 'paid_photo_bundle',
                price,
                images: base64Images,
                count,
                locked: true,
                timestamp: new Date().toISOString()
            });
            this.closeModalSafe('paidPhotoModal');
            this.showNotification(`${count} foto(s) enviadas como paquete pagado`, 'success');
        } catch (e) {
            console.error('❌ Error enviando foto pagada:', e);
        }
    }

    openModal(id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
    }

    closeModalSafe(id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }

    // ===== CALIFICACIÓN =====
    openRateModal() {
        const modal = document.getElementById('rateModal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    setRating(rating) {
        this.currentRating = rating;
        this.highlightStars(rating);
    }

    highlightStars(rating) {
        const stars = document.querySelectorAll('#starRating i');
        stars.forEach((star, index) => {
            if (index < rating) {
                star.classList.add('active');
            } else {
                star.classList.remove('active');
            }
        });
    }

    async sendRating() {
        if (!this.currentRating) {
            this.showError('Por favor selecciona una calificación');
            return;
        }

        const comment = document.getElementById('rateComment').value;
        
        try {
            const ratingMessage = `⭐ **CALIFICACIÓN DEL CLIENTE**\n\n` +
                `Calificación: ${this.currentRating}/5 estrellas\n` +
                (comment ? `Comentario: ${comment}` : 'Sin comentarios');
            
            await this.sendSpecialMessage(ratingMessage, 'rating');
            
            // Guardar calificación en Firebase
            await this.saveRating({
                rating: this.currentRating,
                comment: comment,
                ratedAt: new Date().toISOString(),
                ratedBy: this.currentUser.id,
                ratedTo: this.otherUserId
            });
            
            this.closeModalSafe('rateModal');

        } catch (error) {
            console.error('❌ Error enviando calificación:', error);
            this.showError('Error enviando calificación');
        }
    }

    async saveRating(ratingData) {
        if (!this.database || !this.chatId) return;

        try {
            // Guardar en el chat
            const ratingRef = this.database.ref(`chats/${this.chatId}/providerRating`);
            await ratingRef.set(ratingData);
            
            // Guardar en el perfil del usuario (igual que en chat cliente)
            const userRatingRef = this.database.ref(`users/${this.otherUserId}/providerRatings/${ratingData.ratedBy}`);
            await userRatingRef.set({
                rating: ratingData.rating,
                comment: ratingData.comment,
                ratedAt: ratingData.ratedAt,
                raterId: ratingData.ratedBy,
                raterName: this.currentUser.name
            });
            
            // Actualizar promedio de calificaciones del usuario
            await this.updateUserRatingAverage(this.otherUserId);
            
        } catch (error) {
            console.error('❌ Error guardando calificación:', error);
        }
    }

    async updateUserRatingAverage(userId) {
        try {
            const ratingsRef = this.database.ref(`users/${userId}/providerRatings`);
            const snapshot = await ratingsRef.once('value');
            const ratings = snapshot.val() || {};
            
            // Calcular promedio y total de calificaciones
            const ratingValues = Object.values(ratings);
            const totalRatings = ratingValues.length;
            const averageRating = totalRatings > 0 
                ? ratingValues.reduce((sum, rating) => sum + (rating.rating || 0), 0) / totalRatings 
                : 0;
            
            // Guardar en el perfil del usuario
            const userRef = this.database.ref(`users/${userId}`);
            await userRef.update({
                providerReliability: {
                    average: Math.round(averageRating * 10) / 10,
                    total: totalRatings,
                    lastUpdated: new Date().toISOString()
                }
            });
            
        } catch (error) {
            console.error('❌ Error actualizando promedio de calificaciones:', error);
        }
    }

    handleTyping() {
        if (!this.database || !this.chatId) return;

        // Indicar que está escribiendo
        this.startTyping();

        // Limpiar timeout anterior
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }

        // Detener indicador después de 3 segundos
        this.typingTimeout = setTimeout(() => {
            this.stopTyping();
        }, 3000);
    }

    startTyping() {
        if (this.isTyping) return;
        
        this.isTyping = true;
        const typingRef = this.database.ref(`chats/${this.chatId}/typing/${this.currentUser.id}`);
        typingRef.set(true);
    }

    stopTyping() {
        if (!this.isTyping) return;
        
        this.isTyping = false;
        const typingRef = this.database.ref(`chats/${this.chatId}/typing/${this.currentUser.id}`);
        typingRef.set(false);
    }

    showTypingIndicator(isTyping) {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            indicator.style.display = isTyping ? 'flex' : 'none';
            if (isTyping) {
                this.scrollToBottom();
            }
        }
    }

    renderMessages() {
        const messagesContainer = document.getElementById('chatMessages');
        if (!messagesContainer) return;

        messagesContainer.innerHTML = '';

        this.messages.forEach(message => {
            const messageElement = this.createMessageElement(message);
            messagesContainer.appendChild(messageElement);
        });
    }

    createMessageElement(message) {
        const div = document.createElement('div');
        const isSent = message.senderId === this.currentUser.id;
        const isAdmin = message.senderId === 'admin';
        
        // Mensajes del admin se muestran en el centro
        if (isAdmin) {
            div.className = 'chat-message admin-message';
        } else {
            div.className = `chat-message ${isSent ? 'sent' : 'received'}`;
        }
        
        // Contenido del mensaje
        const content = document.createElement('div');
        content.className = 'message-content';
        
        let messageHtml = '';
        
        // Manejar diferentes tipos de mensajes
        if (isAdmin) {
            // Mensaje del administrador - no agregar avatar
            messageHtml = `<div class="admin-message-content">
                <div class="admin-badge">👨‍💼 Mensaje del administrador</div>
                <p>${this.escapeHtml(message.message)}</p>
            </div>`;
        } else if (message.type === 'paid_photo_bundle') {
            // Fotos pagadas - mostrar según estado de desbloqueo
            if (message.unlocked) {
                messageHtml = this.createUnlockedPhotosHTML(message);
            } else {
                messageHtml = this.createPaidPhotoBundleHTML(message);
            }
        } else if (message.type === 'service_offer') {
            // Oferta de encuentro
            if (message.senderId === this.currentUser.id) {
                // El proveedor ve su propia oferta como tarjeta informativa
                messageHtml = `<div class="encounter-offer sent-offer">
                    <div class="offer-header"><h4>💼 Oferta de servicio enviada</h4></div>
                    <div class="offer-details">
                        <p><strong>Precio:</strong> $${(message.price || 0).toLocaleString('es-CO')} pesos</p>
                        ${message.description ? `<p><strong>Descripción:</strong> ${this.escapeHtml(message.description)}</p>` : ''}
                        ${message.time ? `<p><strong>Tiempo:</strong> ${this.escapeHtml(message.time)}</p>` : ''}
                    </div>
                </div>`;
            } else {
                messageHtml = this.createEncounterOfferHTML(message);
            }
        } else if (message.type === 'service_request') {
            // Solicitud de servicio enviada por el cliente
            messageHtml = `<div class="service-request-card">
                <div class="offer-header"><h4>🛠️ Solicitud de servicio</h4></div>
                <div class="offer-details">
                    <p><strong>Título:</strong> ${this.escapeHtml(message.title || '')}</p>
                    ${message.description ? `<p><strong>Detalles:</strong> ${this.escapeHtml(message.description)}</p>` : ''}
                    ${message.budget ? `<p><strong>Presupuesto:</strong> $${Number(message.budget).toLocaleString('es-CO')}</p>` : ''}
                    ${message.when ? `<p><strong>Cuándo:</strong> ${this.escapeHtml(message.when)}</p>` : ''}
                </div>
            </div>`;
        } else if (message.type === 'tips_request') {
            // Solicitud de propina
            messageHtml = `<div class="tips-request">
                <p>💝 <strong>Solicitud de propina</strong></p>
                <p>${this.escapeHtml(message.message || 'El proveedor solicita una propina para continuar con contenido exclusivo.')}</p>
            </div>`;
        } else if (message.type === 'encounter_response') {
            // Respuesta a oferta de encuentro
            const status = message.accepted ? '✅ Aceptada' : '❌ Rechazada';
            messageHtml = `<div class="encounter-response ${message.accepted ? 'accepted' : 'rejected'}">
                <p><strong>Respuesta a oferta de encuentro: ${status}</strong></p>
                <p>${this.escapeHtml(message.message)}</p>
            </div>`;
        } else {
            // Mensaje normal
            messageHtml = `<p>${this.escapeHtml(message.message)}</p>`;
        }
        
        // Agregar timestamp
        const timestamp = new Date(message.timestamp);
        messageHtml += `<small>${timestamp.toLocaleTimeString('es-ES', { 
            hour: '2-digit', 
            minute: '2-digit' 
        })}</small>`;
        
        content.innerHTML = messageHtml;

        // Delegación de eventos: abrir foto del bloque desbloqueado sin onclick inline.
        content.querySelectorAll('.photo-item[data-photo-index]').forEach((el) => {
            el.addEventListener('click', () => {
                const img = el.querySelector('img');
                const idx = parseInt(el.getAttribute('data-photo-index'), 10) || 1;
                if (img && typeof window.showPhotoModal === 'function') {
                    window.showPhotoModal(img.src, idx);
                }
            });
        });
        
        // Agregar elementos al mensaje
        if (!isAdmin) {
            // Solo agregar avatar si no es admin
            const avatar = document.createElement('div');
            avatar.className = 'message-avatar';
            avatar.innerHTML = `<i class="fas fa-user"></i>`;
            div.appendChild(avatar);
        }
        div.appendChild(content);
        
        return div;
    }

    createPaidPhotoBundleHTML(message) {
        const count = message.count || 1;
        const price = message.price || 0;
        
        return `
            <div class="paid-photo-bundle">
                <div class="photo-preview" style="display: flex; gap: 8px; margin: 10px 0;">
                    ${Array.from({length: count}, (_, i) => `
                        <div class="blurred-photo" style="width: 60px; height: 60px; border-radius: 8px; overflow: hidden; filter: blur(8px); background: #333;">
                            <div style="width: 100%; height: 100%; background: linear-gradient(45deg, #666, #999);"></div>
                        </div>
                    `).join('')}
                </div>
                <div class="unlock-info">
                    <p><strong>📸 ${count} foto(s) enviada(s)</strong></p>
                    <p>Precio: $${price} pesos</p>
                    <p style="font-size: 12px; color: var(--text-secondary);">Esperando pago del cliente...</p>
                </div>
            </div>
        `;
    }

    createUnlockedPhotosHTML(message) {
        const count = message.count || 1;
        const price = message.price || 0;
        const images = message.images || [];
        
        return `
            <div class="unlocked-photos">
                <div class="photos-header" style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    <span style="font-size: 20px;">📸</span>
                    <div>
                        <p style="margin: 0; font-weight: bold;">${count} foto(s) desbloqueada(s)</p>
                        <p style="margin: 0; font-size: 12px; color: var(--text-secondary);">Precio pagado: $${price} pesos</p>
                    </div>
                </div>
                <div class="photos-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 8px;">
                    ${images.map((imageData, index) => {
                        const safeSrc = (typeof safeUrl === 'function') ? safeUrl(imageData) : '';
                        return `
                        <div class="photo-item" style="position: relative; cursor: pointer;" data-photo-index="${index + 1}">
                            <img src="${safeSrc}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 6px; border: 2px solid #10b981;" alt="Foto ${index + 1}">
                            <div style="position: absolute; bottom: 2px; right: 2px; background: rgba(0,0,0,0.7); color: white; font-size: 10px; padding: 2px 4px; border-radius: 3px;">${index + 1}</div>
                        </div>
                    `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    createEncounterOfferHTML(message) {
        const price = message.price || 0;
        const description = message.description || '';
        const time = message.time || '';
        
        return `
            <div class="encounter-offer">
                <div class="offer-header">
                    <h4>💼 Oferta de encuentro enviada</h4>
                </div>
                <div class="offer-details">
                    <p><strong>Precio:</strong> $${price} pesos</p>
                    <p><strong>Descripción:</strong> ${this.escapeHtml(description)}</p>
                    <p><strong>Tiempo:</strong> ${this.escapeHtml(time)}</p>
                </div>
                <p style="font-size: 12px; color: var(--text-secondary); margin: 10px 0 0 0;">Esperando respuesta del cliente...</p>
            </div>
        `;
    }

    handleChatMenuAction(action) {
        switch (action) {
            case 'quote':
                this.openQuoteModal();
                break;
            case 'schedule':
                this.openScheduleModal();
                break;
            case 'location':
                this.sendLocation();
                break;
            case 'complete':
                this.completeService();
                break;
        }
    }

    openQuoteModal() {
        const modal = document.getElementById('quoteModal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    openScheduleModal() {
        const modal = document.getElementById('scheduleModal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    async sendQuote() {
        const amount = document.getElementById('quoteAmount').value;
        const description = document.getElementById('quoteDescription').value;
        const time = document.getElementById('quoteTime').value;
        
        if (!amount || !description) {
            this.showError('Por favor completa todos los campos');
            return;
        }

        try {
            const quoteMessage = `💰 **COTIZACIÓN**\n\n` +
                `Precio: $${amount}\n` +
                `Tiempo estimado: ${time}\n\n` +
                `Descripción: ${description}`;

            await this.sendSpecialMessage(quoteMessage, 'quote');
            this.closeModal('quoteModal');
            
            // Limpiar formulario
            document.getElementById('quoteAmount').value = '';
            document.getElementById('quoteDescription').value = '';
            document.getElementById('quoteTime').value = '';

        } catch (error) {
            console.error('❌ Error enviando cotización:', error);
            this.showError('Error enviando cotización');
        }
    }

    async sendSchedule() {
        const date = document.getElementById('scheduleDate').value;
        const time = document.getElementById('scheduleTime').value;
        const location = document.getElementById('scheduleLocation').value;
        const notes = document.getElementById('scheduleNotes').value;
        
        if (!date || !time || !location) {
            this.showError('Por favor completa los campos obligatorios');
            return;
        }

        try {
            const scheduleMessage = `📅 **PROPUESTA DE AGENDA**\n\n` +
                `Fecha: ${date}\n` +
                `Hora: ${time}\n` +
                `Ubicación: ${location}\n\n` +
                (notes ? `Notas: ${notes}` : '');

            await this.sendSpecialMessage(scheduleMessage, 'schedule');
            this.closeModal('scheduleModal');
            
            // Limpiar formulario
            document.getElementById('scheduleDate').value = '';
            document.getElementById('scheduleTime').value = '';
            document.getElementById('scheduleLocation').value = '';
            document.getElementById('scheduleNotes').value = '';

        } catch (error) {
            console.error('❌ Error enviando agenda:', error);
            this.showError('Error enviando agenda');
        }
    }

    async sendLocation() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    
                    const locationMessage = `📍 **MI UBICACIÓN**\n\n` +
                        `Latitud: ${lat}\n` +
                        `Longitud: ${lng}\n\n` +
                        `[Ver en mapa](https://maps.google.com/?q=${lat},${lng})`;
                    
                    await this.sendSpecialMessage(locationMessage, 'location');
                },
                (error) => {
                    console.error('Error obteniendo ubicación:', error);
                    this.showError('No se pudo obtener la ubicación');
                }
            );
        } else {
            this.showError('Geolocalización no soportada');
        }
    }

    async sendSpecialMessage(message, type) {
        if (!this.database || !this.chatId) return;

        const messageData = {
            id: this.database.ref(`chats/${this.chatId}/messages`).push().key,
            senderId: this.currentUser.id,
            senderName: this.currentUser.name,
            message: message,
            timestamp: new Date().toISOString(),
            type: type
        };

        const messagesRef = this.database.ref(`chats/${this.chatId}/messages/${messageData.id}`);
        await messagesRef.set(messageData);
    }

    async acceptService() {
        try {
            const acceptMessage = `✅ **SERVICIO ACEPTADO**\n\n` +
                `He aceptado tu solicitud. ¡Empecemos a coordinar los detalles!`;
            
            await this.sendSpecialMessage(acceptMessage, 'system');
            
            // Actualizar estado del servicio
            await this.updateServiceStatus('accepted');
            
            // Ocultar botones de aceptar/rechazar
            const serviceActions = document.querySelector('.service-actions');
            if (serviceActions) {
                serviceActions.style.display = 'none';
            }

        } catch (error) {
            console.error('❌ Error aceptando servicio:', error);
            this.showError('Error aceptando servicio');
        }
    }

    async declineService() {
        try {
            const declineMessage = `❌ **SERVICIO RECHAZADO**\n\n` +
                `Lamento informarte que no puedo realizar este servicio en este momento.`;
            
            await this.sendSpecialMessage(declineMessage, 'system');
            
            // Actualizar estado del servicio
            await this.updateServiceStatus('declined');
            
            // Ocultar botones de aceptar/rechazar
            const serviceActions = document.querySelector('.service-actions');
            if (serviceActions) {
                serviceActions.style.display = 'none';
            }

        } catch (error) {
            console.error('❌ Error rechazando servicio:', error);
            this.showError('Error rechazando servicio');
        }
    }

    async updateServiceStatus(status) {
        if (!this.database || !this.chatId) return;

        try {
            const serviceRef = this.database.ref(`chats/${this.chatId}/serviceStatus`);
            await serviceRef.set({
                status: status,
                updatedBy: this.currentUser.id,
                updatedAt: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error actualizando estado del servicio:', error);
        }
    }

    async completeService() {
        try {
            const completeMessage = `🎉 **SERVICIO COMPLETADO**\n\n` +
                `¡El servicio ha sido completado exitosamente! Espero que estés satisfecho con el resultado.`;
            
            await this.sendSpecialMessage(completeMessage, 'system');
            
            // Actualizar estado del servicio
            await this.updateServiceStatus('completed');

        } catch (error) {
            console.error('❌ Error completando servicio:', error);
            this.showError('Error completando servicio');
        }
    }

    scrollToBottom() {
        const messagesContainer = document.getElementById('chatMessages');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    }

    showNotification(message, type = 'info') {
        console.log(`🔔 [${type.toUpperCase()}] ${message}`);

        // Contenedor de toasts (se crea una sola vez y apila las notificaciones)
        let container = document.getElementById('chatToastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'chatToastContainer';
            container.className = 'chat-toast-container';
            document.body.appendChild(container);
        }

        const icons = {
            success: 'fa-check',
            error: 'fa-times',
            warning: 'fa-exclamation',
            info: 'fa-info'
        };
        const titles = {
            success: 'Listo',
            error: 'Error',
            warning: 'Atención',
            info: 'Información'
        };
        const safeType = icons[type] ? type : 'info';

        const toast = document.createElement('div');
        toast.className = `chat-toast ${safeType}`;
        toast.innerHTML = `
            <div class="chat-toast-icon"><i class="fas ${icons[safeType]}"></i></div>
            <div class="chat-toast-body">
                <div class="chat-toast-title">${titles[safeType]}</div>
                <div class="chat-toast-msg"></div>
            </div>
            <button class="chat-toast-close" aria-label="Cerrar"><i class="fas fa-times"></i></button>
        `;
        // Insertar el mensaje como texto (evita inyección de HTML)
        toast.querySelector('.chat-toast-msg').textContent = message;

        const remove = () => {
            if (!toast.parentNode) return;
            toast.classList.add('hiding');
            setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 250);
        };
        toast.querySelector('.chat-toast-close').addEventListener('click', remove);

        container.appendChild(toast);
        setTimeout(remove, 4000);
    }

    showError(message) {
        // Crear notificación de error
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f44336;
            color: white;
            padding: 15px 20px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            max-width: 300px;
            animation: slideInRight 0.3s ease-out;
        `;
        
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-exclamation-triangle" style="font-size: 18px;"></i>
                <div>
                    <strong>Error</strong>
                    <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">${this.escapeHtml(message)}</p>
                </div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease-in';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    initializeTheme() {
        // Cargar tema guardado
        const savedTheme = localStorage.getItem('deseo_theme') || 'light';
        this.setTheme(savedTheme);
        
        // Configurar botón de tema
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const currentTheme = document.documentElement.getAttribute('data-theme');
                const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                this.setTheme(newTheme);
            });
        }
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('deseo_theme', theme);
        
        // Actualizar icono del botón
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            const icon = themeToggle.querySelector('i');
            if (icon) {
                icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
        }
    }

    // ===== NOTIFICACIONES =====
    async initializeNotifications() {
        console.log('🔍 [DEBUG] Inicializando notificaciones en chat-provider...');
        this.notificationPermission = await this.requestNotificationPermission();
        console.log('🔍 [DEBUG] Permisos de notificación:', this.notificationPermission);
    }

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

    async sendBrowserNotification(senderName, message) {
        try {
            if (!this.notificationPermission) {
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

            // Al hacer click en la notificación, enfocar la ventana
            notification.onclick = () => {
                window.focus();
                notification.close();
            };

            console.log('✅ [DEBUG] Notificación del navegador enviada desde chat-provider para:', senderName);
            
        } catch (error) {
            console.error('❌ Error enviando notificación del navegador:', error);
        }
    }

    // Evidence System Methods
    showEvidenceModal() {
        const modal = document.getElementById('evidenceModal');
        if (modal) {
            modal.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 9999 !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0,0,0,0.5) !important;';
            
            // Setup evidence upload listeners
            this.setupEvidenceListeners();
        }
    }

    setupEvidenceListeners() {
        const selectBtn = document.getElementById('selectEvidenceFiles');
        const fileInput = document.getElementById('evidenceFiles');
        const uploadBtn = document.getElementById('uploadEvidenceBtn');
        
        if (selectBtn && fileInput) {
            selectBtn.onclick = () => fileInput.click();
            
            fileInput.onchange = (e) => this.handleEvidenceFiles(e.target.files);
        }
        
        if (uploadBtn) {
            uploadBtn.onclick = () => this.uploadEvidence();
        }
    }

    handleEvidenceFiles(files) {
        const preview = document.getElementById('evidencePreview');
        const uploadBtn = document.getElementById('uploadEvidenceBtn');
        
        preview.innerHTML = '';
        
        Array.from(files).forEach((file, index) => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const item = document.createElement('div');
                    item.className = 'evidence-preview-item';
                    const img = document.createElement('img');
                    img.src = e.target.result; // resultado local de FileReader (data URL, no controlado por atacante)
                    img.alt = `Evidence ${index + 1}`;
                    const btn = document.createElement('button');
                    btn.className = 'remove-btn';
                    btn.textContent = '×';
                    btn.addEventListener('click', () => item.remove());
                    item.appendChild(img);
                    item.appendChild(btn);
                    preview.appendChild(item);
                };
                reader.readAsDataURL(file);
            }
        });
        
        if (files.length > 0) {
            uploadBtn.disabled = false;
        }
    }

    async uploadEvidence() {
        const previewItems = document.querySelectorAll('.evidence-preview-item img');
        const evidenceData = [];
        
        previewItems.forEach((img, index) => {
            evidenceData.push({
                id: `evidence_${Date.now()}_${index}`,
                data: img.src,
                uploadedAt: Date.now(),
                uploadedBy: this.currentUser.id,
                uploadedByName: this.currentUserAlias || 'Proveedor'
            });
        });
        
        if (evidenceData.length === 0) {
            alert('Selecciona al menos una imagen');
            return;
        }
        
        try {
            // Find active dispute for this chat
            const disputesRef = this.database.ref('disputes');
            const snapshot = await disputesRef.orderByChild('chatId').equalTo(this.chatId).once('value');
            const disputes = snapshot.val() || {};
            
            const disputeId = Object.keys(disputes)[0];
            if (!disputeId) {
                alert('No hay disputa activa para este chat');
                return;
            }
            
            // Get existing evidence and add new evidence (accumulate)
            const evidenceRef = this.database.ref(`disputes/${disputeId}/evidence/provider`);
            const existingSnapshot = await evidenceRef.once('value');
            const existingEvidence = existingSnapshot.val() || [];
            
            // Combine existing and new evidence
            const allEvidence = [...existingEvidence, ...evidenceData];
            
            // Save combined evidence to Firebase
            await evidenceRef.set(allEvidence);
            
            // Send confirmation message
            const message = {
                senderId: this.currentUser.id,
                message: `He subido ${evidenceData.length} evidencia(s) adicional(es) para la disputa. Total: ${allEvidence.length} evidencias.`,
                timestamp: Date.now(),
                type: 'evidence_uploaded'
            };
            
            // Add message to local array immediately for real-time display
            this.messages.push(message);
            this.renderMessages();
            this.scrollToBottom();
            
            // Send to Firebase
            await this.database.ref(`chats/${this.chatId}/messages`).push(message);
            
            // Close modal and reset
            this.closeEvidenceModal();
            
            // Force check evidence button immediately after upload
            setTimeout(() => {
                this.checkForEvidenceRequest();
            }, 100);
            
            alert('Evidencias subidas correctamente');
            
        } catch (error) {
            console.error('Error subiendo evidencias:', error);
            alert('Error subiendo evidencias');
        }
    }

    closeEvidenceModal() {
        const modal = document.getElementById('evidenceModal');
        if (modal) {
            modal.style.display = 'none';
            
            // Reset form
            document.getElementById('evidencePreview').innerHTML = '';
            document.getElementById('uploadEvidenceBtn').disabled = true;
            document.getElementById('evidenceFiles').value = '';
        }
    }

    // Check for evidence request messages
    checkForEvidenceRequest() {
        const evidenceBtn = document.getElementById('evidenceBtn');
        if (!evidenceBtn) {
            console.log('❌ [DEBUG] Botón de evidencias no encontrado');
            return;
        }
        
        // Check if there's an admin request for evidence (check both type and message content)
        const hasEvidenceRequest = this.messages.some(msg => 
            msg.senderId === 'admin' && (
                msg.type === 'admin_request_evidence' || 
                (msg.message && msg.message.includes('solicita evidencias'))
            )
        );
        
        // Check if user has already uploaded evidence (only for the most recent admin request)
        const adminRequests = this.messages.filter(msg => 
            msg.senderId === 'admin' && (
                msg.type === 'admin_request_evidence' || 
                (msg.message && msg.message.includes('solicita evidencias'))
            )
        );
        
        const mostRecentAdminRequest = adminRequests.length > 0 ? 
            adminRequests[adminRequests.length - 1] : null;
        
        const hasUploadedEvidence = mostRecentAdminRequest ? 
            this.messages.some(msg => 
                msg.senderId === this.currentUser.id && 
                msg.type === 'evidence_uploaded' &&
                msg.timestamp > mostRecentAdminRequest.timestamp
            ) : false;
        
        console.log('🔍 [DEBUG] Verificando solicitud de evidencias:', {
            hasEvidenceRequest,
            hasUploadedEvidence,
            messagesCount: this.messages.length,
            adminMessages: this.messages.filter(msg => msg.senderId === 'admin'),
            mostRecentAdminRequest: mostRecentAdminRequest ? {
                timestamp: mostRecentAdminRequest.timestamp,
                message: mostRecentAdminRequest.message
            } : null
        });
        
        // Show button only if admin requested evidence AND user hasn't uploaded yet
        if (hasEvidenceRequest && !hasUploadedEvidence) {
            evidenceBtn.style.display = 'block';
            console.log('✅ [DEBUG] Botón de evidencias mostrado');
        } else {
            evidenceBtn.style.display = 'none';
            console.log('❌ [DEBUG] Botón de evidencias oculto');
        }
    }
}

// Funciones globales
function goBack() {
    window.history.back();
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

function setRating(rating) {
    if (window.chatProvider) {
        window.chatProvider.setRating(rating);
    }
}

// Función global para mostrar fotos en modal
window.showPhotoModal = function(imageData, photoNumber) {
    const modal = document.createElement('div');
    modal.id = 'photoModal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 10001; display: flex; align-items: center; justify-content: center;';
    
    const content = document.createElement('div');
    content.style.cssText = 'position: relative; max-width: 90%; max-height: 90%;';
    
    const img = document.createElement('img');
    img.src = imageData;
    img.style.cssText = 'max-width: 100%; max-height: 100%; border-radius: 8px;';
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = 'position: absolute; top: -40px; right: 0; background: rgba(255,255,255,0.8); border: none; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; font-size: 16px;';
    closeBtn.onclick = () => modal.remove();
    
    const photoLabel = document.createElement('div');
    photoLabel.innerHTML = `Foto ${photoNumber}`;
    photoLabel.style.cssText = 'position: absolute; bottom: -30px; left: 0; color: white; font-size: 14px;';
    
    content.appendChild(img);
    content.appendChild(closeBtn);
    content.appendChild(photoLabel);
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // Cerrar al hacer clic fuera de la imagen
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
};

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    window.chatProvider = new ChatProvider();
});