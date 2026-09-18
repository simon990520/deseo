/**
 * Chat Client - Lógica para usuarios que solicitan servicios
 * Maneja la funcionalidad específica de clientes en el chat
 */

class ChatClient {
    constructor() {
        this.firebase = null;
        this.database = null;
        this.currentUser = null;
        this.currentUserAlias = null;
        this.chatId = null;
        this.otherUser = null;
        this.messages = [];
        this.isTyping = false;
        this.typingTimeout = null;
        this.serviceData = null;
        
        // Notificaciones
        this.notificationPermission = false;
        
        this.init();
    }

    async init() {
        console.log('🔍 ChatClient: Inicializando...');
        
        // Delegación de envío lo ANTES posible (idempotente). Así el botón y
        // Enter funcionan desde el inicio sin esperar a loadMessages/perfil.
        this.setupRobustSendDelegation();
        
        // Inicializar Firebase
        await this.initializeFirebase();
        
        // Cargar datos del usuario PRIMERO (necesario para reconstruir parámetros
        // del chat desde Firebase si la URL llegó incompleta en deploy).
        await this.loadCurrentUser();
        
        // Obtener datos del chat desde URL (con respaldos handoff + Firebase)
        await this.getChatDataFromURL();
        
        // Cargar mensajes
        await this.loadMessages();
        
        // Cargar perfil del otro usuario
        await this.loadOtherUserProfileAndHeader();

        // Mostrar el saldo PROPIO del cliente (espejo del badge del proveedor).
        await this.loadMyBalanceBadge();
        
        // Configurar listeners DESPUÉS de cargar todo
        await new Promise(resolve => setTimeout(resolve, 100)); // Pequeño delay para asegurar DOM
        this.setupEventListeners();
        
        // Inicializar notificaciones
        await this.initializeNotifications();
        
        // Configurar listener para órdenes de encuentro en tiempo real
        this.setupEncounterOrdersListener();
        
        console.log('✅ ChatClient: Inicializado correctamente');
        // Ir al último mensaje al entrar
        this.scrollToBottom();
        // Mostrar control para finalizar encuentro si aplica
        this.ensureCompleteEncounterButton();
    }

    async initializeFirebase() {
        try {
            console.log('🔍 Iniciando Firebase en chat client...');
            
            if (typeof CONFIG === 'undefined' || !CONFIG.FIREBASE) {
                throw new Error('CONFIG.FIREBASE no está disponible');
            }

            this.firebase = firebase.initializeApp(CONFIG.FIREBASE.config);
            this.database = firebase.database();
            
            // Cargar precios globales (settings/pricing) antes de cobrar.
            // Se suscribe para reflejar cambios del admin en vivo.
            try {
                if (window.DeseoPricing && window.DeseoPricing.loadFromFirebase) {
                    await window.DeseoPricing.loadFromFirebase(this.database);
                }
                if (window.DeseoPricing && window.DeseoPricing.subscribe && !this._pricingUnsub) {
                    this._pricingUnsub = window.DeseoPricing.subscribe(this.database, function () {});
                }
            } catch (_) { /* usa defaults */ }
            
            console.log('✅ Firebase inicializado en chat client');
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
            if (h.target && h.target !== 'chat-client.html') return false;
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
            // SEGURIDAD: preferir la identidad verificada por Clerk sobre localStorage.
            if (window.DeseoSession) {
                const verified = window.DeseoSession.getUser();
                if (verified && verified.verified) {
                    this.currentUser = verified;
                    this.currentUserAlias = await this.getAliasForUser(this.currentUser.id);
                    return;
                }
            }
            const userData = localStorage.getItem('deseo_user');
            if (!userData) {
                throw new Error('Usuario no autenticado');
            }
            
            this.currentUser = JSON.parse(userData);
            console.log('👤 Usuario actual cargado:', this.currentUser.name);
            // Resolver alias del propio usuario para usar en senderName
            this.currentUserAlias = await this.getAliasForUser(this.currentUser.id);
        } catch (error) {
            console.error('❌ Error cargando usuario:', error);
            this.showError('Error de autenticación');
        }
    }

    async getAliasForUser(userId) {
        try {
            if (!this.database || !userId) return null;
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

    // Muestra el SALDO PROPIO del cliente en el encabezado del chat (espejo del
    // badge que ve el proveedor). Fuente autoritativa: Supabase (getBalance, que
    // sí puede leer el saldo propio vía RLS); fallback: Firebase RTDB
    // users/{uid}/balance → wallet/{uid}/balance.
    async loadMyBalanceBadge() {
        try {
            const badge = document.getElementById('myBalanceBadge');
            const uid = this.currentUser && this.currentUser.id;
            if (!uid) return;
            // Esperar a Clerk/Supabase (sin token, getBalance daría null por RLS).
            if (window.DeseoAuth && window.DeseoAuth.waitForSupabase) {
                try { await window.DeseoAuth.waitForSupabase; } catch (_) { /* noop */ }
            }
            if (window.DeseoAuth && window.DeseoAuth.ready) {
                try { await Promise.race([window.DeseoAuth.ready, new Promise(r => setTimeout(r, 8000))]); } catch (_) { /* noop */ }
            }
            let balance = null;
            try {
                if (window.DeseoMoney && window.DeseoMoney.getBalance) {
                    const b = await window.DeseoMoney.getBalance(this.database, uid);
                    if (typeof b === 'number' && Number.isFinite(b)) balance = b;
                }
            } catch (_) { /* noop */ }
            if (balance === null && this.database) {
                try {
                    let snap = await this.database.ref(`users/${uid}/balance`).once('value');
                    let v = snap.val();
                    if (v === null || v === undefined) {
                        const alt = await this.database.ref(`wallet/${uid}/balance`).once('value');
                        v = alt.val();
                    }
                    balance = parseInt(v || '0', 10);
                } catch (_) { balance = 0; }
            }
            if (badge && balance !== null) {
                badge.textContent = `${balance} pesos`;
                badge.style.display = 'inline-block';
            }
            // Refresco periódico (el saldo puede cambiar por cobros fuera del chat).
            if (this._myBalanceTimer) clearInterval(this._myBalanceTimer);
            this._myBalanceTimer = setInterval(async () => {
                try {
                    if (!window.DeseoMoney || !window.DeseoMoney.getBalance || !badge) return;
                    const b = await window.DeseoMoney.getBalance(this.database, uid);
                    if (typeof b === 'number' && Number.isFinite(b)) badge.textContent = `${b} pesos`;
                } catch (_) { /* noop */ }
            }, 15000);
        } catch (e) {
            console.warn('No se pudo cargar el saldo propio:', e);
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

    // Eliminado: el cliente no ve balance

    setupEventListeners() {
        
        // Botón de envío
        const sendBtn = document.getElementById('sendBtn');
        const messageInput = document.getElementById('messageInput');
        
        // NOTA: el envío (clic en botón y tecla Enter) se maneja de forma
        // centralizada y robusta en setupRobustSendDelegation(). No se agregan
        // listeners directos aquí para evitar disparos duplicados (doble cobro).
        
        if (messageInput) {
            messageInput.addEventListener('input', () => this.handleTyping());
        }

        // Botones de acción rápida
        const quickActions = document.querySelectorAll('.quick-action-btn');
        
        quickActions.forEach((btn, index) => {
            console.log(`🔍 [DEBUG] Button ${index}:`, btn, 'action:', btn.dataset.action);
            
            // NUEVO ENFOQUE: Usar onclick directamente en el HTML
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = btn.dataset.action;
                        
                // SOLUCIÓN DIRECTA SIN MÉTODOS COMPLEJOS
                if (action === 'tip') {
                                const modal = document.getElementById('tipModal');
                                if (modal) {
                        modal.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 9999 !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0,0,0,0.5) !important;';
                                    } else {
                        console.error('❌ Modal not found!');
                    }
                }
                
                if (action === 'request') {
                    // Envío inmediato: cobrar 100 y notificar al proveedor (sin modal)
                    this.sendEncounterRequestImmediate();
                }
                
                if (action === 'favorite') {
                    alert('Añadido a favoritos');
                }
                
                if (action === 'report') {
                    const modal = document.getElementById('reportModal');
                    if (modal) {
                        modal.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 9999 !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0,0,0,0.5) !important;';
                    }
                }
                
                if (action === 'urgent') {
                    this.sendUrgentMessage();
                }
                
                if (action === 'rate') {
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

        // Modales
        this.setupModalListeners();
        
        // Tema
        this.initializeTheme();
        
        // DELEGACIÓN ROBUSTA (anti-fallo de binding): garantiza que el botón de
        // enviar y la tecla Enter funcionen SIEMPRE, aunque el nodo se recree o
        // el listener directo no llegue a engancharse. Se registra una sola vez.
        this.setupRobustSendDelegation();
        
        // Prueba inmediata
        this.testButtonFunctionality();
    }

    setupRobustSendDelegation() {
        if (this._sendDelegationReady) return;
        this._sendDelegationReady = true;

        // Clic: capturamos en fase de captura para no depender del nodo exacto.
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (!target) return;
            const btn = target.closest ? target.closest('#sendBtn, .send-btn') : null;
            if (btn) {
                e.preventDefault();
                this.sendMessage();
            }
        }, true);

        // Enter en el input de mensaje.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const t = e.target;
            if (t && t.id === 'messageInput') {
                e.preventDefault();
                this.sendMessage();
            }
        }, true);
    }

    testButtonFunctionality() {
        const tipBtn = document.querySelector('[data-action="tip"]');
        if (tipBtn) {
                }
        
        // Verificar si el modal existe
        const tipModal = document.getElementById('tipModal');
        if (tipModal) {
                }
        
        // Verificar todos los modales
        const allModals = document.querySelectorAll('.modal');
        allModals.forEach((modal, index) => {
            console.log(`🔍 [DEBUG] Modal ${index}:`, modal.id, modal);
        });
    }

    setupModalListeners() {
        
        // Modal de propina
        const sendTipBtn = document.getElementById('sendTipBtn');
        if (sendTipBtn) {
            sendTipBtn.addEventListener('click', () => this.sendTip());
            }

        // Modal de solicitar servicio
        const sendRequestServiceBtn = document.getElementById('sendRequestServiceBtn');
        if (sendRequestServiceBtn) {
            sendRequestServiceBtn.addEventListener('click', () => this.sendRequestService());
            }

        // Modal de reportar
        const sendReportBtn = document.getElementById('sendReportBtn');
        if (sendReportBtn) {
            sendReportBtn.addEventListener('click', () => this.sendReport());
            }

        // Modal de calificar
        const sendRateBtn = document.getElementById('sendRateBtn');
        if (sendRateBtn) {
            sendRateBtn.addEventListener('click', () => this.sendRating());
            }

        // Preview de imágenes en reporte
        const reportImages = document.getElementById('reportImages');
        if (reportImages) {
            reportImages.addEventListener('change', () => this.previewReportImages());
        }

        // Estrellas de calificación
        const stars = document.querySelectorAll('#starRating i');
        stars.forEach((star, index) => {
            star.addEventListener('click', () => this.setRating(index + 1));
            star.addEventListener('mouseenter', () => this.highlightStars(index + 1));
        });

        document.getElementById('starRating').addEventListener('mouseleave', () => {
            this.highlightStars(this.currentRating || 0);
        });
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
                console.log('🔄 [DEBUG] Nuevo mensaje recibido en chat-client:', message);
                
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
                                        setTimeout(() => this.checkForEvidenceRequest(), 100);
                        setTimeout(() => this.checkForEvidenceRequest(), 500);
                    }
                    
                    // Enviar notificación si el mensaje no es del usuario actual
                    if (message.senderId !== this.currentUser.id && 
                        message.senderId !== 'system' && 
                        message.senderName) {
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

    async loadServiceData() {
        if (!this.database || !this.chatId) return;

        try {
            const serviceRef = this.database.ref(`chats/${this.chatId}/serviceData`);
            const snapshot = await serviceRef.once('value');
            const serviceData = snapshot.val();
            

        } catch (error) {
            console.error('❌ Error cargando datos del servicio:', error);
        }
    }


    getStatusText(status) {
        const statusTexts = {
            'pending': 'Esperando respuesta',
            'accepted': 'Aceptado',
            'declined': 'Rechazado',
            'in_progress': 'En progreso',
            'completed': 'Completado',
            'cancelled': 'Cancelado'
        };
        return statusTexts[status] || 'Desconocido';
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

        // ANTI-DOBLE-COBRO: bloqueo de reentrada. Si ya hay un envío en curso,
        // ignorar el disparo extra (evita que el clic + Enter, o un doble clic
        // rápido, cobren dos veces el mismo mensaje).
        if (this._sendingMessage) {
            console.warn('⚠️ sendMessage reentrante ignorado (envío en curso).');
            return;
        }
        this._sendingMessage = true;
        // Deshabilitar el botón mientras se procesa (defensa adicional en UI).
        const _sendBtn = document.getElementById('sendBtn');
        if (_sendBtn) _sendBtn.disabled = true;

        // Red de seguridad: si por alguna razón el envío se cuelga (red/Firebase),
        // liberar el bloqueo tras un máximo de 15s para no dejar el chat bloqueado.
        const _lockGuard = setTimeout(() => { this._sendingMessage = false; }, 15000);

        try {
            // SEGURIDAD (anti-manipulación): el precio del mensaje NO se toma del
            // front ni de un valor global. Es el precio que el DUEÑO del perfil
            // destino definió (FUENTE AUTORITATIVA: Supabase message_prices).
            // Nota: aunque el cliente leyera un precio manipulado, el servidor
            // (rpc_send_message_charge) cobra SIEMPRE el precio real del dueño.
            const CLIENT_COST = await this.getProviderPrice();
            // El 100% del precio va al dueño del perfil. La comisión de plataforma
            // (50%) se aplica más adelante, en el retiro (no aquí).
            const PROVIDER_CREDIT = CLIENT_COST;

            // 1) Crear la referencia del mensaje con una push key única (evita colisiones Date.now).
            const tempRef = this.database.ref(`chats/${this.chatId}/messages`).push();
            const messageId = tempRef.key;
            const opId = `msg_${this.chatId}_${messageId}`;
            const messageData = {
                id: messageId,
                senderId: this.currentUser.id,
                senderName: this.currentUserAlias || this.currentUser.name,
                message: message,
                timestamp: new Date().toISOString(),
                type: 'text',
                price: CLIENT_COST
            };

            // 2) COBRAR PRIMERO, de forma atómica e idempotente (opId derivado del id).
            //    CRÍTICO: se cobra ANTES de persistir el mensaje. Motivo: el listener
            //    `child_added` renderiza el mensaje en cuanto se escribe en Firebase,
            //    y NO existe `child_removed` que lo borre de la UI. Si persistiéramos
            //    primero y el cobro fallara (saldo insuficiente), el mensaje quedaría
            //    visible como "enviado" aunque no se cobró (bug reportado). Cobrando
            //    primero, un cobro fallido NUNCA llega a escribir el mensaje.
            const canCharge = await this.chargeClient(CLIENT_COST, 'message', opId + '_out');
            if (!canCharge) {
                this.showError('Saldo insuficiente para enviar mensaje.');
                return;
            }

            // 3) Persistir el mensaje (ya cobrado). Si esta escritura falla es un
            //    caso excepcional (permisos/red); se registra el opId para soporte
            //    y se avisa al usuario. NO se intenta un auto-reembolso porque
            //    rpc_credit (acreditarse a sí mismo) está bloqueado por seguridad
            //    del lado servidor: ese saldo debe resolverse vía administración.
            try {
                await tempRef.set(messageData);
            } catch (setErr) {
                console.error('❌ No se pudo persistir el mensaje tras el cobro (opId=' + opId + '):', setErr);
                this.showError('Error enviando el mensaje. Contacta a soporte con el código: ' + opId);
                return;
            }

            // 4) Acreditar al dueño del perfil (el 100% del precio por ahora; la
            //    comisión de plataforma se descuenta en el retiro).
            await this.creditProvider(PROVIDER_CREDIT, 'message', opId + '_in');

            // Limpiar input
            messageInput.value = '';
            
            // Detener indicador de escritura
            this.stopTyping();

            // Scroll al final
            this.scrollToBottom();

        } catch (error) {
            console.error('❌ Error enviando mensaje:', error);
            this.showError('Error enviando mensaje');
        } finally {
            // Liberar el bloqueo SIEMPRE (éxito o error).
            clearTimeout(_lockGuard);
            this._sendingMessage = false;
            if (_sendBtn) _sendBtn.disabled = false;
        }
    }

    async sendServiceRequest() {
        const title = (document.getElementById('reqTitle') || {}).value || '';
        const description = (document.getElementById('reqDescription') || {}).value || '';
        const budgetStr = (document.getElementById('reqBudget') || {}).value || '0';
        const when = (document.getElementById('reqWhen') || {}).value || '';
        const budget = parseInt(budgetStr, 10) || 0;
        if (!title.trim()) { this.showError('Título requerido'); return; }
        if (!this.database || !this.chatId) return;
        try {
            const reqId = `request_${Date.now()}`;
            const payload = {
                id: reqId,
                senderId: this.currentUser.id,
                senderName: this.currentUserAlias || this.currentUser.name,
                type: 'service_request',
                title: title.trim(),
                description: description.trim(),
                budget: budget,
                when,
                // Texto legible para render genérico, notificaciones y compatibilidad.
                message: `Solicitud de servicio: ${title.trim()}` +
                    (description.trim() ? `\n${description.trim()}` : '') +
                    (budget ? `\nPresupuesto: $${budget.toLocaleString('es-CO')}` : '') +
                    (when ? `\nCuándo: ${when}` : ''),
                timestamp: new Date().toISOString()
            };
            await this.database.ref(`chats/${this.chatId}/messages/${reqId}`).set(payload);
            this.closeModalSafe('requestServiceModal');
        } catch (e) {
            console.error('❌ Error solicitando servicio:', e);
        }
    }

    async handleQuickAction(action) {
        
        // IMPLEMENTACIÓN DIRECTA - SIN SWITCH COMPLEJO
        if (action === 'tip') {
                const modal = document.getElementById('tipModal');
                if (modal) {
                modal.style.display = 'block';
                modal.style.visibility = 'visible';
                modal.style.opacity = '1';
                modal.style.zIndex = '9999';
                    } else {
                console.error('❌ Modal not found!');
            }
            return;
        }
        
        if (action === 'request') {
            const modal = document.getElementById('requestServiceModal');
            if (modal) {
                modal.style.display = 'block';
                modal.style.visibility = 'visible';
                modal.style.opacity = '1';
                modal.style.zIndex = '9999';
            }
            return;
        }
        
        if (action === 'favorite') {
            await this.toggleFavorite(true);
            return;
        }
        
        if (action === 'report') {
            const modal = document.getElementById('reportModal');
            if (modal) {
                modal.style.display = 'block';
                modal.style.visibility = 'visible';
                modal.style.opacity = '1';
                modal.style.zIndex = '9999';
            }
            return;
        }
        
        if (action === 'urgent') {
            await this.sendUrgentMessage();
            return;
        }
        
        if (action === 'rate') {
            const modal = document.getElementById('rateModal');
            if (modal) {
                modal.style.display = 'block';
                modal.style.visibility = 'visible';
                modal.style.opacity = '1';
                modal.style.zIndex = '9999';
            }
            return;
        }
        
    }

    async toggleFavorite(state) {
        if (!this.database || !this.chatId) return;
        try {
            await this.database.ref(`chats/${this.chatId}/favorites/${this.currentUser.id}`).set(!!state);
            this.showNotification(state ? 'Añadido a favoritos' : 'Eliminado de favoritos', 'success');
        } catch (e) {
            console.error('❌ Error guardando favorito:', e);
        }
    }

    async sendReport() {
        const reason = (document.getElementById('reportReason') || {}).value || '';
        const details = (document.getElementById('reportDetails') || {}).value || '';
        
        if (!reason || !details.trim()) {
            this.showError('Por favor completa todos los campos obligatorios');
            return;
        }
        
        if (!this.database || !this.chatId) return;
        
        try {
            // Procesar imágenes si las hay
            const images = await this.processReportImages();
            
            const reportId = `report_${Date.now()}`;
            const reportData = {
                id: reportId,
                reportedBy: this.currentUser.id,
                reportedUser: this.otherUserId,
                chatId: this.chatId,
                reason,
                details: details.trim(),
                images: images,
                status: 'pending',
                timestamp: new Date().toISOString()
            };
            
            // Guardar en reports globales para admin
            await this.database.ref(`reports/${reportId}`).set(reportData);
            
            // También en el chat para referencia
            await this.database.ref(`chats/${this.chatId}/reports/${reportId}`).set(reportData);
            
            this.closeModalSafe('reportModal');
            this.showNotification('Reporte enviado correctamente', 'success');
            
        } catch (e) {
            console.error('❌ Error enviando reporte:', e);
            this.showError('Error enviando reporte');
        }
    }

    async processReportImages() {
        const fileInput = document.getElementById('reportImages');
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            return [];
        }
        
        const images = [];
        const files = Array.from(fileInput.files).slice(0, 5); // Máximo 5 imágenes
        
        for (const file of files) {
            try {
                const base64 = await this.fileToBase64(file);
                images.push({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data: base64
                });
            } catch (e) {
                console.error('Error procesando imagen:', e);
            }
        }
        
        return images;
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async sendUrgentMessage() {
        try {
            const urgentMessage = `🚨 **URGENTE**\n\nSe solicita urgencia en el servicio. Por favor, responde lo antes posible.`;
            await this.sendSpecialMessage(urgentMessage, 'urgent');
            this.showNotification('Mensaje urgente enviado', 'success');
        } catch (error) {
            console.error('❌ Error enviando mensaje urgente:', error);
            this.showError('Error enviando mensaje urgente');
        }
    }

    async sendEncounterRequestImmediate() {
        try {
            const requestMessage = `🤝 **SOLICITUD DE ENCUENTRO**\n\nEl cliente solicita un encuentro contigo.`;
            await this.sendSpecialMessage(requestMessage, 'service_request');
            this.showNotification('Solicitud de encuentro enviada', 'success');
        } catch (error) {
            console.error('❌ Error enviando solicitud de encuentro:', error);
            this.showError('Error enviando solicitud');
        }
    }

    async sendRequestService() {
        const title = (document.getElementById('reqTitle') || {}).value || '';
        const description = (document.getElementById('reqDescription') || {}).value || '';
        const budget = (document.getElementById('reqBudget') || {}).value || '';
        const when = (document.getElementById('reqWhen') || {}).value || '';
        
        if (!title.trim() || !description.trim()) {
            this.showError('Por favor completa título y descripción');
            return;
        }
        
        try {
            const requestMessage = `🤝 **SOLICITUD DE ENCUENTRO**\n\n` +
                `Título: ${title}\n` +
                `Descripción: ${description}\n` +
                (budget ? `Presupuesto: $${budget}\n` : '') +
                (when ? `Cuándo: ${when}\n` : '') +
                `\nEl cliente quiere organizar un encuentro contigo.`;

            // Un único punto de cobro: sendSpecialMessage cobra con precios
            // configurables. Se evita el doble cargo que había antes
            // (sendRequestService cobraba y luego sendSpecialMessage volvía a
            // cobrar por 'service_request').
            const ok = await this.sendSpecialMessage(requestMessage, 'service_request');
            if (ok === false) return;

            this.closeModalSafe('requestServiceModal');
            this.showNotification('Solicitud de encuentro enviada', 'success');

        } catch (error) {
            console.error('❌ Error enviando solicitud:', error);
            this.showError('Error enviando solicitud');
        }
    }

    previewReportImages() {
        const fileInput = document.getElementById('reportImages');
        const preview = document.getElementById('reportImagePreview');
        
        if (!fileInput || !preview) return;
        
        preview.innerHTML = '';
        
        if (fileInput.files && fileInput.files.length > 0) {
            const files = Array.from(fileInput.files).slice(0, 5);
            
            files.forEach((file, index) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.style.width = '80px';
                    img.style.height = '80px';
                    img.style.objectFit = 'cover';
                    img.style.margin = '5px';
                    img.style.borderRadius = '8px';
                    img.style.border = '2px solid #ccc';
                    preview.appendChild(img);
                };
                reader.readAsDataURL(file);
            });
        }
    }

    // Precio por mensaje del DUEÑO del perfil destino.
    // Fuente AUTORITATIVA: Supabase (tabla message_prices). Fallback: Firebase.
    // El servidor cobra igualmente el precio real, así que manipular esto solo
    // afecta a lo que el cliente "cree" pagar — nunca al cobro real.
    async getProviderPrice() {
        const DEFAULT = 390;
        // 1) Supabase (fuente de verdad).
        try {
            let sb = null;
            if (window.DeseoAuth && window.DeseoAuth.waitForSupabase) sb = await window.DeseoAuth.waitForSupabase;
            if (!sb && window.DeseoSupabase) sb = window.DeseoSupabase;
            if (sb && this.otherUserId) {
                const res = await sb.from('message_prices')
                    .select('message_price').eq('user_id', this.otherUserId).maybeSingle();
                if (!res.error && res.data && Number.isFinite(res.data.message_price)) {
                    return parseInt(res.data.message_price, 10);
                }
            }
        } catch (_) { /* noop */ }
        // 2) Fallback Firebase (mientras se migra).
        try {
            if (this.otherUserId && this.database) {
                const snap = await this.database.ref(`users/${this.otherUserId}/profile/messagePrice`).once('value');
                const p = snap.val();
                if (typeof p === 'number' && p >= 0) return p;
            }
        } catch (_) { /* noop */ }
        return DEFAULT;
    }

    // Cobro al cliente + crédito al proveedor en UNA sola operación atómica
    // (Supabase rpc_transfer). Antes se hacía charge() y luego credit() por
    // separado; con el modelo autoritativo eso causaba DOBLE DÉBITO al cliente
    // (charge debita A, credit→transfer vuelve a debitar A). Ahora el cargo ya
    // deja el dinero en el proveedor, así que creditProvider se vuelve no-op.
    async chargeClient(amount, reason, opId) {
        return this._chargeOrTransfer(amount, reason, opId, false);
    }

    // Cobro tipo ESCROW (encuentros): retiene el dinero en custodia hasta liberarlo.
    async chargeClientEscrow(amount, reason, orderId) {
        try {
            const amt = parseInt(amount, 10);
            if (!Number.isFinite(amt) || amt <= 0) return false;
            if (!window.DeseoMoney || !window.DeseoMoney.escrowHold) {
                console.error('❌ DeseoMoney.escrowHold no disponible; abortando.');
                return false;
            }
            const res = await window.DeseoMoney.escrowHold(this.database, orderId, amt, { reason: reason });
            if (!res.ok) { console.warn('⚠️ Escrow no aplicado:', res.reason); return false; }
            return true;
        } catch (e) {
            console.error('❌ Error reteniendo escrow:', e);
            return false;
        }
    }

    async _chargeOrTransfer(amount, reason, opId, escrow) {
        try {
            const amt = parseInt(amount, 10);
            if (!Number.isFinite(amt) || amt <= 0) return false;
            if (!window.DeseoMoney) {
                console.error('❌ DeseoMoney no disponible; abortando cobro por seguridad.');
                return false;
            }
            const baseOp = String(opId || '').replace(/_(out|in)$/, '') || undefined;
            // Si hay destinatario, mover dinero al proveedor (cobro + crédito),
            // salvo en escrow (que solo retiene en custodia).
            if (this.otherUserId && !escrow) {
                const res = await window.DeseoMoney.transfer(
                    this.database, this.currentUser.id, this.otherUserId, amt,
                    { reason: reason, chatId: this.chatId, opId: baseOp }
                );
                if (!res.ok) {
                    console.warn('⚠️ Transferencia no aplicada:', res.reason);
                    return false;
                }
                this._providerCreditedFor = baseOp || null;
                return true;
            }
            // Sin destinatario: solo cobrar al cliente.
            const res = await window.DeseoMoney.charge(this.database, this.currentUser.id, amt, {
                reason: reason, to: this.otherUserId, chatId: this.chatId, opId: opId
            });
            if (!res.ok) {
                console.warn('⚠️ Cobro no aplicado:', res.reason);
                return false;
            }
            return true;
        } catch (e) {
            console.error('❌ Error cobrando al cliente:', e);
            return false;
        }
    }

    // Crédito al proveedor. NO-OP si el dinero ya se movió en chargeClient
    // (evita doble débito). Solo acredita de verdad cuando se le llama aislado
    // (p.ej. liberar escrow de un encuentro ya cobrado).
    async creditProvider(amount, reason, opId) {
        try {
            if (!this.otherUserId) return false;
            const amt = parseInt(amount, 10);
            if (!Number.isFinite(amt) || amt <= 0) return true; // nada que acreditar = no es error
            const baseOp = String(opId || '').replace(/_(out|in)$/, '');
            // Si el cargo ya transfirió a este proveedor con el mismo opId base, no repetir.
            if (this._providerCreditedFor && this._providerCreditedFor === baseOp) {
                return true;
            }
            if (!window.DeseoMoney) {
                console.error('❌ DeseoMoney no disponible; abortando crédito por seguridad.');
                return false;
            }
            const res = await window.DeseoMoney.transfer(
                this.database, this.currentUser.id, this.otherUserId, amt,
                { reason: reason, chatId: this.chatId, opId: baseOp }
            );
            if (res && res.ok === false) {
                console.warn('⚠️ Crédito no aplicado:', res.reason);
                return false;
            }
            return true;
        } catch (e) {
            console.error('❌ Error acreditando al proveedor:', e);
            return false;
        }
    }

    openModal(id) {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = 'block';
                                
            // Forzar visibilidad
            el.style.visibility = 'visible';
            el.style.opacity = '1';
        } else {
            console.error('❌ Modal not found:', id);
            console.error('❌ Available modals:', document.querySelectorAll('.modal').length);
        }
    }

    async sendTip() {
        const amount = parseInt((document.getElementById('tipAmount') || {}).value || '0', 10);
        const note = (document.getElementById('tipNote') || {}).value || '';
        
        if (amount <= 0) {
            this.showError('Por favor ingresa un monto válido');
            return;
        }

        // ANTI-DOBLE-COBRO: bloqueo de reentrada (evita doble propina por doble clic).
        if (this._sendingTip) {
            console.warn('⚠️ sendTip reentrante ignorado (envío en curso).');
            return;
        }
        this._sendingTip = true;
        
        try {
            // Propina 1:1: el proveedor recibe EXACTAMENTE el monto que paga el
            // cliente. NO usar un valor configurable distinto (eso causaba que el
            // proveedor recibiera más de lo cobrado, p.ej. 100 cuando se pagaban 80).
            // La comisión de plataforma se aplica después, en el retiro.
            const providerCredit = amount;
            const opId = `tip_${this.chatId}_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;

            // 1) COBRAR PRIMERO (evita mensaje visible sin cobro; mismo motivo que sendMessage).
            const messageId = this.database.ref(`chats/${this.chatId}/messages`).push().key;
            const tipMessage = `💰 **PROPINA ENVIADA**\n\n` +
                `Monto: $${amount.toLocaleString('es-CO')}\n` +
                (note ? `Nota: ${note}` : 'Gracias por tu excelente servicio!');
            const msgRef = this.database.ref(`chats/${this.chatId}/messages/${messageId}`);

            const charged = await this.chargeClient(amount, 'Propina', opId + '_out');
            if (!charged) {
                this.showError('Saldo insuficiente para enviar propina');
                return;
            }

            // 2) Persistir el mensaje de propina (ya cobrado).
            try {
                await msgRef.set({
                    id: messageId,
                    senderId: this.currentUser.id,
                    senderName: this.currentUserAlias || this.currentUser.name,
                    message: tipMessage,
                    timestamp: new Date().toISOString(),
                    type: 'tip'
                });
            } catch (setErr) {
                console.error('❌ No se pudo persistir la propina tras el cobro (opId=' + opId + '):', setErr);
                this.showError('Error enviando la propina. Contacta a soporte con el código: ' + opId);
                return;
            }

            // 3) Acreditar al proveedor (atómico, mismo opId).
            await this.creditProvider(providerCredit, 'Propina recibida', opId + '_in');

            this.closeModalSafe('tipModal');
            this.showNotification(`Propina de $${amount.toLocaleString('es-CO')} enviada`, 'success');

        } catch (error) {
            console.error('❌ Error enviando propina:', error);
            this.showError('Error enviando propina');
        } finally {
            this._sendingTip = false;
        }
    }

    closeModalSafe(id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
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
        
        // Agregar clase especial para mensajes del sistema
        if (message.type === 'system' || message.type === 'quote' || message.type === 'schedule') {
            div.classList.add(message.type);
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
        } else {
            if (message.type === 'paid_photo_bundle' && !isSent) {
                // Fotos pagadas del proveedor - mostrar según estado de desbloqueo
                if (message.unlocked) {
                    messageHtml = this.createUnlockedPhotosHTML(message);
                } else {
                    messageHtml = this.createPaidPhotoBundleHTML(message);
                }
            } else if (message.type === 'service_offer' && !isSent) {
                // Oferta de encuentro del proveedor - mostrar con botones aceptar/rechazar
                messageHtml = this.createEncounterOfferHTML(message);
            } else if (message.type === 'service_offer' && isSent) {
                // Oferta ya enviada por mí: tarjeta informativa (sin botones)
                messageHtml = `<div class="encounter-offer sent-offer">
                    <div class="offer-header"><h4>💼 Oferta de servicio enviada</h4></div>
                    <div class="offer-details">
                        <p><strong>Precio:</strong> $${(message.price || 0).toLocaleString('es-CO')} pesos</p>
                        ${message.description ? `<p><strong>Descripción:</strong> ${this.escapeHtml(message.description)}</p>` : ''}
                        ${message.time ? `<p><strong>Tiempo:</strong> ${this.escapeHtml(message.time)}</p>` : ''}
                    </div>
                </div>`;
            } else if (message.type === 'service_request') {
                // Solicitud de servicio (enviada o recibida)
                messageHtml = `<div class="service-request-card">
                    <div class="offer-header"><h4>🛠️ ${isSent ? 'Solicitud enviada' : 'Solicitud de servicio'}</h4></div>
                    <div class="offer-details">
                        <p><strong>Título:</strong> ${this.escapeHtml(message.title || '')}</p>
                        ${message.description ? `<p><strong>Detalles:</strong> ${this.escapeHtml(message.description)}</p>` : ''}
                        ${message.budget ? `<p><strong>Presupuesto:</strong> $${Number(message.budget).toLocaleString('es-CO')}</p>` : ''}
                        ${message.when ? `<p><strong>Cuándo:</strong> ${this.escapeHtml(message.when)}</p>` : ''}
                    </div>
                </div>`;
            } else if (message.type === 'tips_request' && !isSent) {
                // Solicitud de propina del proveedor
                messageHtml = `<div class="tips-request">
                    <p>💝 <strong>Solicitud de propina</strong></p>
                    <p>${this.escapeHtml(message.message || 'El proveedor solicita una propina para continuar con contenido exclusivo.')}</p>
                </div>`;
            } else {
                // Mensaje normal
                messageHtml = `<p>${this.escapeHtml(message.message)}</p>`;
            }
        }
        
        // Agregar timestamp
        const timestamp = new Date(message.timestamp);
        messageHtml += `<small>${timestamp.toLocaleTimeString('es-ES', { 
            hour: '2-digit', 
            minute: '2-digit' 
        })}</small>`;
        
        content.innerHTML = messageHtml;
        
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
        const messageId = message.id;
        
        return `
            <div class="paid-photo-bundle" data-message-id="${messageId}" data-price="${price}">
                <div class="photo-preview" style="display: flex; gap: 8px; margin: 10px 0;">
                    ${Array.from({length: count}, (_, i) => `
                        <div class="blurred-photo" style="width: 60px; height: 60px; border-radius: 8px; overflow: hidden; filter: blur(8px); background: #333;">
                            <div style="width: 100%; height: 100%; background: linear-gradient(45deg, #666, #999);"></div>
                        </div>
                    `).join('')}
                </div>
                <div class="unlock-info">
                    <p><strong>📸 ${count} foto(s) bloqueada(s)</strong></p>
                    <p>Precio: $${price} pesos</p>
                    <button class="unlock-btn" onclick="unlockPaidPhotos('${messageId}', ${price})">
                        🔓 Desbloquear fotos
                    </button>
                </div>
            </div>
        `;
    }

    createEncounterOfferHTML(message) {
        const price = message.price || 0;
        const description = message.description || '';
        const time = message.time || '';
        const messageId = message.id;
        
        return `
            <div class="encounter-offer" data-message-id="${messageId}">
                <div class="offer-header">
                    <h4>💼 Oferta de encuentro</h4>
                </div>
                <div class="offer-details">
                    <p><strong>Precio:</strong> $${price} pesos</p>
                    <p><strong>Descripción:</strong> ${this.escapeHtml(description)}</p>
                    <p><strong>Tiempo:</strong> ${this.escapeHtml(time)}</p>
                </div>
                <div class="offer-actions" style="margin-top: 10px;">
                    <button class="accept-btn" onclick="respondToEncounterOffer('${messageId}', true)">
                        ✅ Aceptar
                    </button>
                    <button class="reject-btn" onclick="respondToEncounterOffer('${messageId}', false)">
                        ❌ Rechazar
                    </button>
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
                    ${images.map((imageData, index) => `
                        <div class="photo-item" style="position: relative; cursor: pointer;" onclick="showPhotoModal('${imageData}', ${index + 1})">
                            <img src="${imageData}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 6px; border: 2px solid #10b981;" alt="Foto ${index + 1}">
                            <div style="position: absolute; bottom: 2px; right: 2px; background: rgba(0,0,0,0.7); color: white; font-size: 10px; padding: 2px 4px; border-radius: 3px;">${index + 1}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // Funciones globales para manejar interacciones
    async unlockPaidPhotos(messageId, price) {
        try {
            if (!this.database || !this.chatId) return;

            // 1) Leer el mensaje ANTES de cobrar: validar que exista, que tenga
            //    imágenes, que no esté ya desbloqueado y que el precio coincida.
            const messageRef = this.database.ref(`chats/${this.chatId}/messages/${messageId}`);
            const snapshot = await messageRef.once('value');
            const message = snapshot.val();
            if (!message || !message.images || !message.images.length) {
                this.showError('Este mensaje no tiene fotos para desbloquear.');
                return;
            }
            if (message.unlocked) {
                this.showNotification('Estas fotos ya están desbloqueadas.', 'info');
                await this.loadMessages();
                return;
            }

            // Precio autoritativo del mensaje (no confiar en el pasado por URL/onclick).
            const authoritativePrice = (typeof message.price === 'number' && message.price > 0)
                ? message.price : parseInt(price, 10);
            if (!Number.isFinite(authoritativePrice) || authoritativePrice <= 0) {
                this.showError('Precio inválido para desbloquear.');
                return;
            }

            // opId determinista → idempotencia real (no doble cobro con doble clic).
            const opId = `photos_${this.chatId}_${messageId}`;

            // 2) Reservar el desbloqueo de forma atómica ANTES de mover dinero.
            //    Si otra pestaña ya lo reclamó, abortamos sin cobrar.
            let claimed = false;
            try {
                const claimRes = await messageRef.transaction(function (cur) {
                    if (!cur) return cur;
                    if (cur.unlocked) return; // aborta (ya desbloqueado)
                    cur.unlocked = true;
                    cur.unlockedAt = new Date().toISOString();
                    cur.unlockedBy = 'pending';
                    return cur;
                });
                claimed = !!(claimRes && claimRes.committed);
            } catch (_) { claimed = false; }
            if (!claimed) {
                this.showNotification('Estas fotos ya están desbloqueadas.', 'info');
                await this.loadMessages();
                return;
            }

            // 3) Cobrar al cliente (opId fijo → reintentos no duplican).
            const canCharge = await this.chargeClient(authoritativePrice, 'paid_photos', opId + '_out');
            if (!canCharge) {
                // Revertir el claim para que pueda reintentar con saldo.
                try { await messageRef.update({ unlocked: false, unlockedAt: null, unlockedBy: null }); } catch (_) {}
                this.showError('Saldo insuficiente para desbloquear fotos.');
                return;
            }

            // 4) Acreditar al proveedor.
            await this.creditProvider(authoritativePrice, 'paid_photos', opId + '_in');

            // 5) Confirmar el desbloqueo (ya quedó marcado en el claim).
            try { await messageRef.update({ unlockedBy: this.currentUser.id }); } catch (_) {}
            await this.loadMessages();
            this.showNotification('Fotos desbloqueadas correctamente', 'success');
        } catch (error) {
            console.error('❌ Error desbloqueando fotos:', error);
            this.showError('Error desbloqueando fotos');
        }
    }

    showUnlockedPhotos(images, messageId) {
        // Crear modal para mostrar fotos desbloqueadas
        const modal = document.createElement('div');
        modal.id = 'unlockedPhotosModal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 10000; display: flex; align-items: center; justify-content: center;';
        
        const content = document.createElement('div');
        content.style.cssText = 'background: white; padding: 20px; border-radius: 10px; max-width: 90%; max-height: 90%; overflow-y: auto;';
        
        let photosHtml = '<h3>📸 Fotos desbloqueadas</h3><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">';
        
        images.forEach((imageData, index) => {
            const safeSrc = (typeof safeUrl === 'function') ? safeUrl(imageData) : '';
            photosHtml += `
                <div style="text-align: center;">
                    <img src="${safeSrc}" style="width: 100%; max-width: 200px; height: 200px; object-fit: cover; border-radius: 8px;" alt="Foto ${index + 1}">
                    <p>Foto ${index + 1}</p>
                </div>
            `;
        });
        
        photosHtml += '</div><button onclick="closeUnlockedPhotosModal()" style="margin-top: 15px; padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 5px; cursor: pointer;">Cerrar</button>';
        
        content.innerHTML = photosHtml;
        modal.appendChild(content);
        document.body.appendChild(modal);
    }

    async respondToEncounterOffer(messageId, accepted) {
        try {
            if (!this.database || !this.chatId) return;

            // ANTI-DOBLE-COBRO: bloqueo de reentrada. Aceptar la misma oferta dos
            // veces crearía dos órdenes y cobraría dos escrows. Evitarlo.
            if (this._respondingOffer) {
                console.warn('⚠️ respondToEncounterOffer reentrante ignorado.');
                return;
            }
            this._respondingOffer = true;
            
            if (accepted) {
                // Obtener detalles de la oferta
                const messageRef = this.database.ref(`chats/${this.chatId}/messages/${messageId}`);
                const snapshot = await messageRef.once('value');
                const offer = snapshot.val();
                
                if (offer) {
                    // Id de orden único PRIMERO (para usarlo como opId idempotente del escrow).
                    const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
                    const escrowOpId = `escrow_${this.chatId}_${orderId}`;

                    // 1) RESERVAR la orden en estado 'pending_escrow' ANTES de cobrar.
                    //    Si el cobro falla, se elimina la orden (no queda dinero sin orden).
                    const orderData = {
                        id: orderId,
                        chatId: this.chatId,
                        messageId,
                        providerId: this.otherUserId,
                        clientId: this.currentUser.id,
                        price: offer.price || 0,
                        description: offer.description || '',
                        time: offer.time || '',
                        escrowAmount: offer.price || 0,
                        escrowOpId: escrowOpId,
                        status: 'pending_escrow', // pending_escrow | escrowed | completed | disputed | cancelled
                        clientConfirmed: false,
                        providerConfirmed: false,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                    const orderRef = this.database.ref(`encounterOrders/${orderId}`);

                    // 1) RETENER el monto en ESCROW PRIMERO (custodia server-authoritative,
                    //    idempotente por orderId). Se hace antes de crear la orden para
                    //    que, si el cobro falla, NUNCA exista una orden visible sin pago.
                    const canCharge = await this.chargeClientEscrow(offer.price, 'encounter_escrow', orderId);
                    if (!canCharge) {
                        this.showError('Saldo insuficiente para aceptar la oferta.');
                        return;
                    }

                    // 2) Crear la orden (ya retenido el escrow) en estado 'escrowed'.
                    orderData.status = 'escrowed';
                    try {
                        await orderRef.set(orderData);
                    } catch (setErr) {
                        console.error('❌ No se pudo crear la orden tras retener el escrow (orderId=' + orderId + '):', setErr);
                        this.showError('Error creando la orden. Contacta a soporte con el código: ' + orderId);
                        return;
                    }

                    // 3) Marcar la orden como 'escrowed' y vincularla al chat.
                    await orderRef.update({
                        status: 'escrowed',
                        escrowedAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                    await this.database.ref(`chats/${this.chatId}/orders/${orderId}`).set(true);
                }
            }
            
            // Enviar respuesta
            const responseId = `response_${Date.now()}`;
            const responseData = {
                id: responseId,
                senderId: this.currentUser.id,
                senderName: this.currentUserAlias || this.currentUser.name,
                type: 'encounter_response',
                originalMessageId: messageId,
                accepted: accepted,
                message: accepted ? '✅ He aceptado tu oferta de encuentro. El dinero quedó en garantía (escrow) hasta finalizar.' : '❌ He rechazado tu oferta de encuentro',
                timestamp: new Date().toISOString()
            };
            
            await this.database.ref(`chats/${this.chatId}/messages/${responseId}`).set(responseData);
            
            if (accepted) {
                this.ensureCompleteEncounterButton();
                this.showNotification('Oferta aceptada. Fondos retenidos en garantía.', 'success');
            } else {
                this.showNotification('Oferta rechazada', 'success');
            }
        } catch (error) {
            console.error('❌ Error respondiendo a oferta:', error);
            this.showError('Error procesando respuesta');
        } finally {
            this._respondingOffer = false;
        }
    }

    // Mostrar botón flotante para finalizar encuentro si hay órdenes activas
    setupEncounterOrdersListener() {
        try {
            const ordersRef = this.database.ref('encounterOrders');
            ordersRef.orderByChild('chatId').equalTo(this.chatId).on('value', (snapshot) => {
                console.log('🔄 Actualizando botón de encuentro en tiempo real...');
                this.ensureCompleteEncounterButton();
            });
        } catch (e) {
            console.error('❌ Error configurando listener de órdenes:', e);
        }
    }

    async ensureCompleteEncounterButton() {
        try {
            const existing = document.getElementById('completeEncounterBtn');
            if (existing) existing.remove();

            // Mostrar barra solo si el proveedor ya confirmó hace < 5 minutos
            const ordersRef = this.database.ref('encounterOrders');
            const snap = await ordersRef.orderByChild('chatId').equalTo(this.chatId).once('value');
            const all = snap.val() || {};
            const activeOrders = Object.values(all).filter(o => o.status === 'escrowed' && o.providerConfirmed);
            if (activeOrders.length === 0) return;

            // Tomar la última
            const order = activeOrders.sort((a,b) => (a.providerConfirmedAt||'').localeCompare(b.providerConfirmedAt||''))[activeOrders.length-1];
            const start = new Date(order.providerConfirmedAt).getTime();
            const deadline = start + 5 * 60 * 1000;
            const now = Date.now();
            const expired = now >= deadline;

            // Barra de acción integrada al diseño del chat (no un botón suelto)
            const bar = document.createElement('div');
            bar.id = 'completeEncounterBtn';
            bar.className = 'encounter-action-bar' + (expired ? ' danger' : '');
            bar.innerHTML = `
                <div class="encounter-bar-icon"><i class="fas ${expired ? 'fa-triangle-exclamation' : 'fa-handshake'}"></i></div>
                <div class="encounter-bar-text">
                    <div class="encounter-bar-title">${expired ? 'Tiempo de confirmación agotado' : 'El proveedor finalizó el encuentro'}</div>
                    <div class="encounter-bar-sub">${expired ? 'Si hubo un problema, puedes reportarlo.' : 'Confirma que todo salió bien para liberar el pago.'}</div>
                </div>
                <button class="encounter-bar-btn" type="button">
                    ${expired ? 'Reportar problema' : 'Confirmar finalizado'}
                </button>
            `;
            bar.querySelector('.encounter-bar-btn').addEventListener('click', () => {
                if (expired) {
                    this.reportEncounterProblem(order.id);
                } else {
                    this.openCompleteEncounterDialog(order.id);
                }
            });
            document.body.appendChild(bar);

            // Banner con contador
            this.renderCountdownBanner(order);
        } catch (_) {}
    }

    async openCompleteEncounterDialog(orderId) {
        try {
            let order = null;
            if (orderId) {
                const snap = await this.database.ref(`encounterOrders/${orderId}`).once('value');
                order = snap.val();
            }
            if (!order) {
                // Buscar órdenes en escrow para este chat
                const ordersRef = this.database.ref('encounterOrders');
                const snap = await ordersRef.orderByChild('chatId').equalTo(this.chatId).once('value');
                const all = snap.val() || {};
                const activeOrders = Object.values(all).filter(o => o.status === 'escrowed' && o.providerConfirmed);
                if (activeOrders.length === 0) {
                    this.showNotification('No hay órdenes activas para finalizar', 'info');
                    return;
                }
                order = activeOrders.sort((a,b) => (a.createdAt||'').localeCompare(b.createdAt||''))[activeOrders.length-1];
            }

            // Modal de confirmación con diseño propio (reemplaza confirm/prompt nativos)
            const modal = document.createElement('div');
            modal.className = 'encounter-confirm-modal';
            modal.innerHTML = `
                <div class="encounter-confirm-card">
                    <div class="encounter-confirm-header">
                        <div class="encounter-confirm-icon"><i class="fas fa-handshake"></i></div>
                        <h3>¿Finalizar el encuentro?</h3>
                        <p>Confirma que el encuentro se realizó correctamente. Al confirmar, el pago en garantía se liberará al proveedor.</p>
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
                await this.clientConfirmOrder(order.id);
            });

            modal.querySelector('.confirm-dispute-btn').addEventListener('click', async () => {
                // Primer clic: revela el campo de motivo. Segundo clic: envía la disputa.
                if (body.style.display === 'none') {
                    body.style.display = 'block';
                    reasonInput.focus();
                    return;
                }
                const reason = (reasonInput.value || '').trim() || 'No se realizó el encuentro / Incumplimiento';
                close();
                await this.raiseDispute(order.id, reason);
            });

            modal.querySelector('.confirm-cancel-btn').addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        } catch (e) {
            console.error('❌ Error abriendo finalización:', e);
            this.showError('No se pudo abrir la finalización');
        }
    }

    async clientConfirmOrder(orderId) {
        const ref = this.database.ref(`encounterOrders/${orderId}`);
        const snap = await ref.once('value');
        const order = snap.val();
        if (!order) return;
        await ref.update({ clientConfirmed: true, updatedAt: new Date().toISOString() });
        await this.checkOrderCompletion(orderId);
        this.showNotification('Has confirmado la finalización. Esperando confirmación del proveedor o liberación.', 'success');
    }

    async checkOrderCompletion(orderId) {
        const ref = this.database.ref(`encounterOrders/${orderId}`);
        // Reclamo ATÓMICO del paso escrowed→completed: solo UNA pestaña/lado
        // gana, evitando doble liberación de escrow.
        let claimed = false;
        let order = null;
        try {
            const res = await ref.transaction(function (cur) {
                if (!cur) return cur;
                if (cur.status !== 'escrowed') return; // aborta (ya no está en escrow)
                if (!(cur.clientConfirmed && cur.providerConfirmed)) return; // faltan confirmaciones
                cur.status = 'completed';
                cur.completedAt = new Date().toISOString();
                cur.updatedAt = new Date().toISOString();
                return cur;
            });
            claimed = !!(res && res.committed);
            order = (res && res.snapshot) ? res.snapshot.val() : null;
        } catch (e) {
            console.error('❌ Error reclamando finalización de orden:', e);
        }
        if (!claimed || !order) return;

        await this.releaseEscrow(order);
        await this.sendCompletionMessage(order);
        await this.promptOptionalRatings(order);
        this.showNotification('Encuentro finalizado. Fondos liberados al proveedor.', 'success');
        const btn = document.getElementById('completeEncounterBtn');
        if (btn) btn.remove();
    }

    async releaseEscrow(order) {
        // Liberar la custodia al proveedor (idempotente por orderId).
        const opId = `release_${order.escrowOpId || order.id}`;
        let ok = false;
        try {
            if (window.DeseoMoney && window.DeseoMoney.escrowRelease) {
                const res = await window.DeseoMoney.escrowRelease(
                    this.database, order.id, this.otherUserId || order.providerId, { opId: opId }
                );
                ok = !!res.ok;
            } else {
                // Fallback: transferencia directa del cliente al proveedor.
                ok = await this.creditProvider(order.escrowAmount, 'encounter_release', opId);
            }
        } catch (e) {
            console.error('❌ Error liberando escrow:', e);
            ok = false;
        }
        if (!ok) {
            // El escrow ya quedó 'completed' atómicamente; si el crédito falla,
            // se marca para revisión admin en vez de perder el rastro.
            console.error('❌ Falló la liberación del escrow de la orden', order.id);
            try {
                await this.database.ref(`encounterOrders/${order.id}`).update({
                    releaseFailed: true,
                    releaseFailedAt: new Date().toISOString()
                });
            } catch (_) {}
        }
        return ok;
    }

    async sendCompletionMessage(order) {
        const sysId = `system_${Date.now()}`;
        await this.database.ref(`chats/${order.chatId}/messages/${sysId}`).set({
            id: sysId,
            type: 'system',
            message: '✅ Encuentro finalizado. Los fondos han sido liberados al proveedor.',
            timestamp: new Date().toISOString()
        });
    }

    async promptOptionalRatings(order) {
        try {
            this.showRatingModal(order, 'proveedor');
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
                await this.database.ref(`users/${order.providerId}/encounterRatings/${ratingId}`).set({
                    id: ratingId,
                    from: order.clientId,
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
        // Transición atómica escrowed→disputed: evita disputar una orden ya
        // completada/liberada (liberar sobre dinero en disputa).
        const disputeId = `dispute_${orderId}`;
        let order = null;
        let claimed = false;
        try {
            const res = await ref.transaction(function (cur) {
                if (!cur) return cur;
                if (cur.status !== 'escrowed') return; // solo desde escrow
                cur.status = 'disputed';
                cur.disputeId = disputeId;
                cur.updatedAt = new Date().toISOString();
                return cur;
            });
            claimed = !!(res && res.committed);
            order = (res && res.snapshot) ? res.snapshot.val() : null;
        } catch (e) {
            console.error('❌ Error abriendo disputa:', e);
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

    renderCountdownBanner(order) {
        try {
            const start = new Date(order.providerConfirmedAt).getTime();
            const deadline = start + 5 * 60 * 1000;
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

            const tick = () => {
                const now = Date.now();
                const remaining = Math.max(0, deadline - now);
                const m = Math.floor(remaining / 60000);
                const s = Math.floor((remaining % 60000) / 1000);
                if (remaining > 0) {
                    banner.classList.remove('expired');
                    textEl.textContent = 'El proveedor finalizó el encuentro. Confirma que todo está bien.';
                    timeEl.textContent = `${m}:${String(s).padStart(2,'0')}`;
                } else {
                    banner.classList.add('expired');
                    textEl.textContent = 'Tiempo agotado. Si hay algún problema, puedes reportarlo.';
                    timeEl.textContent = '0:00';
                    // Actualizar la barra de acción a modo "reportar problema"
                    const bar = document.getElementById('completeEncounterBtn');
                    if (bar) {
                        bar.classList.add('danger');
                        const icon = bar.querySelector('.encounter-bar-icon i');
                        if (icon) icon.className = 'fas fa-triangle-exclamation';
                        const title = bar.querySelector('.encounter-bar-title');
                        if (title) title.textContent = 'Tiempo de confirmación agotado';
                        const sub = bar.querySelector('.encounter-bar-sub');
                        if (sub) sub.textContent = 'Si hubo un problema, puedes reportarlo.';
                        const btn = bar.querySelector('.encounter-bar-btn');
                        if (btn) {
                            btn.textContent = 'Reportar problema';
                            btn.onclick = () => this.reportEncounterProblem(order.id);
                        }
                    }
                    clearInterval(timerId);
                }
            };
            tick();
            const timerId = setInterval(tick, 1000);
        } catch (_) {}
    }

    async reportEncounterProblem(orderId) {
        // Cliente reporta problema real con el encuentro
        const reason = prompt('Describe el problema con el encuentro:', 'El encuentro no se realizó correctamente');
        if (reason) {
            await this.raiseDispute(orderId, reason);
        }
    }

    async markAsUrgent() {
        try {
            const urgentMessage = `🚨 **URGENTE**\n\n` +
                `Necesito que este servicio se realice con la mayor urgencia posible. Por favor, confirma si puedes hacerlo pronto.`;
            
            await this.sendSpecialMessage(urgentMessage, 'urgent');

        } catch (error) {
            console.error('❌ Error marcando como urgente:', error);
            this.showError('Error marcando como urgente');
        }
    }

    openModifyModal() {
        // Llenar el modal con datos actuales
        if (this.serviceData) {
            const titleInput = document.getElementById('modifyTitle');
            const descInput = document.getElementById('modifyDescription');
            const budgetInput = document.getElementById('modifyBudget');
            const locationInput = document.getElementById('modifyLocation');
            
            if (titleInput) titleInput.value = this.serviceData.title || '';
            if (descInput) descInput.value = this.serviceData.description || '';
            if (budgetInput) budgetInput.value = this.serviceData.budget || '';
            if (locationInput) locationInput.value = this.serviceData.location || '';
        }

        const modal = document.getElementById('modifyModal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    async sendModification() {
        const title = document.getElementById('modifyTitle').value;
        const description = document.getElementById('modifyDescription').value;
        const budget = document.getElementById('modifyBudget').value;
        const location = document.getElementById('modifyLocation').value;
        
        if (!title || !description) {
            this.showError('Por favor completa los campos obligatorios');
            return;
        }

        try {
            const modifyMessage = `✏️ **SOLICITUD MODIFICADA**\n\n` +
                `Título: ${title}\n` +
                `Descripción: ${description}\n` +
                `Presupuesto: $${budget}\n` +
                `Ubicación: ${location}`;

            await this.sendSpecialMessage(modifyMessage, 'modification');
            
            // Actualizar datos del servicio
            await this.updateServiceData({
                title: title,
                description: description,
                budget: budget,
                location: location,
                modifiedAt: new Date().toISOString()
            });
            
            this.closeModal('modifyModal');

        } catch (error) {
            console.error('❌ Error enviando modificación:', error);
            this.showError('Error enviando modificación');
        }
    }

    openCancelModal() {
        const modal = document.getElementById('cancelModal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    async confirmCancellation() {
        const reason = document.getElementById('cancelReason').value;
        
        try {
            const cancelMessage = `❌ **SOLICITUD CANCELADA**\n\n` +
                `He decidido cancelar esta solicitud.` +
                (reason ? `\n\nMotivo: ${reason}` : '');
            
            await this.sendSpecialMessage(cancelMessage, 'cancellation');
            
            // Actualizar estado del servicio
            await this.updateServiceStatus('cancelled');
            
            this.closeModal('cancelModal');

        } catch (error) {
            console.error('❌ Error cancelando solicitud:', error);
            this.showError('Error cancelando solicitud');
        }
    }

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
            const ratingMessage = `⭐ **CALIFICACIÓN**\n\n` +
                `Calificación: ${this.currentRating}/5 estrellas\n` +
                (comment ? `Comentario: ${comment}` : 'Sin comentarios');
            
            await this.sendSpecialMessage(ratingMessage, 'rating');
            
            // Guardar calificación en Firebase
            await this.saveRating({
                rating: this.currentRating,
                comment: comment,
                ratedAt: new Date().toISOString()
            });
            
            this.closeModal('rateModal');

        } catch (error) {
            console.error('❌ Error enviando calificación:', error);
            this.showError('Error enviando calificación');
        }
    }

    async sendSpecialMessage(message, type, options) {
        if (!this.database || !this.chatId) return;
        options = options || {};

        // ANTI-DOBLE-COBRO: bloqueo de reentrada para mensajes especiales
        // (urgente / solicitud). Evita doble cobro por doble disparo rápido.
        if (this._sendingSpecial) {
            console.warn('⚠️ sendSpecialMessage reentrante ignorado (envío en curso).');
            return false;
        }
        this._sendingSpecial = true;
        try {
        // Tipos que requieren pago. El cobro se hace AQUÍ (único punto),
        // salvo que el llamador ya haya pagado (options.alreadyPaid) para evitar
        // doble cobro (p.ej. sendRequestService o sendTip ya cobraron).
        const paidMessageTypes = ['urgent', 'service_request'];
        const requiresPayment = paidMessageTypes.includes(type) && !options.alreadyPaid;

        // SEGURIDAD (anti-manipulación): igual que el mensaje normal, el precio
        // se toma del DUEÑO del perfil destino (FUENTE AUTORITATIVA: Supabase).
        const CLIENT_COST = await this.getProviderPrice();
        // El 100% del precio va al dueño del perfil. La comisión (50%) se aplica
        // más adelante, en el retiro (no aquí).
        const PROVIDER_CREDIT = CLIENT_COST;
        const PLATFORM_FEE = 0;

        // Id de mensaje y opId deterministas (idempotencia real por mensaje).
        const messageId = this.database.ref(`chats/${this.chatId}/messages`).push().key;
        const payOpId = options.opId || `special_${this.chatId}_${messageId}`;

        const messageData = {
            id: messageId,
            senderId: this.currentUser.id,
            senderName: this.currentUserAlias || this.currentUser.name,
            message: message,
            timestamp: new Date().toISOString(),
            type: type,
            price: requiresPayment ? CLIENT_COST : 0
        };

        // 1) COBRAR PRIMERO (si aplica) ANTES de persistir. Motivo idéntico al de
        //    sendMessage: el listener child_added pinta el mensaje al instante y
        //    no hay child_removed que lo quite de la UI; si se persiste primero y
        //    el cobro falla, queda un mensaje "enviado" sin cobrar (bug reportado).
        const messagesRef = this.database.ref(`chats/${this.chatId}/messages/${messageId}`);
        if (requiresPayment) {
            const canCharge = await this.chargeClient(CLIENT_COST, type || 'message', payOpId + '_out');
            if (!canCharge) {
                this.showError('Saldo insuficiente para enviar mensaje.');
                return false;
            }
        }

        // 2) Persistir el mensaje (ya cobrado si aplicaba).
        try {
            await messagesRef.set(messageData);
        } catch (setErr) {
            console.error('❌ No se pudo persistir el mensaje especial tras el cobro (opId=' + payOpId + '):', setErr);
            this.showError('Error enviando el mensaje. Contacta a soporte con el código: ' + payOpId);
            return false;
        }

        // 3) Acreditar al dueño del perfil (el 100%; comisión se aplica en el retiro).
        if (requiresPayment) {
            await this.creditProvider(PROVIDER_CREDIT, type || 'message', payOpId + '_in');
        }
        return true;
        } finally {
            // Liberar el bloqueo SIEMPRE (éxito o error).
            this._sendingSpecial = false;
        }
    }

    async updateServiceData(updates) {
        if (!this.database || !this.chatId) return;

        try {
            const serviceRef = this.database.ref(`chats/${this.chatId}/serviceData`);
            await serviceRef.update(updates);
        } catch (error) {
            console.error('❌ Error actualizando datos del servicio:', error);
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

    async saveRating(ratingData) {
        if (!this.database || !this.otherUserId) return;

        try {
            // Guardar calificación en el perfil del usuario calificado
            const ratingId = Date.now().toString();
            const ratingRef = this.database.ref(`users/${this.otherUserId}/ratings/${ratingId}`);
            
            const fullRatingData = {
                ...ratingData,
                raterId: this.currentUser.id,
                raterName: this.currentUserAlias || this.currentUser.name,
                ratedUserId: this.otherUserId,
                chatId: this.chatId
            };
            
            await ratingRef.set(fullRatingData);
            
            // Actualizar estadísticas de confiabilidad del usuario
            await this.updateUserReliability();
            
        } catch (error) {
            console.error('❌ Error guardando calificación:', error);
        }
    }
    
    async updateUserReliability() {
        try {
            // Obtener todas las calificaciones del usuario
            const ratingsRef = this.database.ref(`users/${this.otherUserId}/ratings`);
            const snapshot = await ratingsRef.once('value');
            const ratings = snapshot.val() || {};
            
            // Calcular promedio y total de calificaciones
            const ratingValues = Object.values(ratings);
            const totalRatings = ratingValues.length;
            const averageRating = totalRatings > 0 
                ? ratingValues.reduce((sum, rating) => sum + (rating.rating || 0), 0) / totalRatings 
                : 0;
            
            // Actualizar estadísticas en el perfil
            const statsRef = this.database.ref(`users/${this.otherUserId}/reliability`);
            await statsRef.set({
                averageRating: Math.round(averageRating * 10) / 10,
                totalRatings: totalRatings,
                lastUpdated: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Error actualizando confiabilidad:', error);
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
        this.notificationPermission = await this.requestNotificationPermission();
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

            // Validar que message sea string y no esté vacío
            const messageText = (message && typeof message === 'string') ? message : 'Nuevo mensaje';
            const sender = (senderName && typeof senderName === 'string') ? senderName : 'Usuario';

            const notification = new Notification('Nuevo mensaje de ' + sender, {
                body: messageText.length > 50 ? messageText.substring(0, 50) + '...' : messageText,
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

            console.log('✅ [DEBUG] Notificación del navegador enviada desde chat-client para:', senderName);
            
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
                    item.innerHTML = `
                        <img src="${e.target.result}" alt="Evidence ${index + 1}">
                        <button class="remove-btn" onclick="this.parentElement.remove()">×</button>
                    `;
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
                uploadedByName: this.currentUserAlias || 'Cliente'
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
            const evidenceRef = this.database.ref(`disputes/${disputeId}/evidence/client`);
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

// Funciones globales para los botones
window.unlockPaidPhotos = function(messageId, price) {
    if (window.chatClient) {
        window.chatClient.unlockPaidPhotos(messageId, price);
    }
};

window.respondToEncounterOffer = function(messageId, accepted) {
    if (window.chatClient) {
        window.chatClient.respondToEncounterOffer(messageId, accepted);
    }
};

window.closeUnlockedPhotosModal = function() {
    const modal = document.getElementById('unlockedPhotosModal');
    if (modal) {
        modal.remove();
    }
};

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
    window.chatClient = new ChatClient();
});