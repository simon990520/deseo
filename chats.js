/**
 * Chats - Sistema de gestión de chats y notificaciones
 * Maneja la lista de chats, búsqueda, filtros y notificaciones
 */

class ChatsManager {
    constructor() {
        this.firebase = null;
        this.database = null;
        this.currentUser = null;
        this.chats = [];
        this.notifications = [];
        this.users = [];
        this.currentFilter = 'all';
        this.searchQuery = '';
        this.userFavorites = {}; // Favoritos del usuario actual
      // Cache de perfiles para resolver alias/apodo sin repetir lecturas
      this.userProfilesCache = {};
        
        // Notificaciones
        this.notificationPermission = false;
        
        this.init();
    }

    async init() {
        console.log('🔍 ChatsManager: Inicializando...');
        
        // Inicializar Firebase
        await this.initializeFirebase();
        
        // Cargar datos del usuario
        await this.loadCurrentUser();
        
        // Configurar listeners
        this.setupEventListeners();
        
        // Cargar datos
        await this.loadUserFavorites();
        await this.loadChats();
        await this.loadNotifications();
        
        // Inicializar tema
        this.initializeTheme();
        
        // Inicializar notificaciones
        await this.initializeNotifications();
        
        console.log('✅ ChatsManager: Inicializado correctamente');
    }

    async initializeFirebase() {
        try {
            console.log('🔍 Iniciando Firebase en chats...');
            
            if (typeof CONFIG === 'undefined' || !CONFIG.FIREBASE) {
                throw new Error('CONFIG.FIREBASE no está disponible');
            }

            this.firebase = firebase.initializeApp(CONFIG.FIREBASE.config);
            this.database = firebase.database();
            
            console.log('✅ Firebase inicializado en chats');
        } catch (error) {
            console.error('❌ Error inicializando Firebase:', error);
            throw error;
        }
    }

    async loadCurrentUser() {
        try {
            const userData = localStorage.getItem('deseo_user');
            console.log('🔍 Datos de usuario en localStorage:', userData);
            
            if (!userData) {
                throw new Error('Usuario no autenticado');
            }
            
            this.currentUser = JSON.parse(userData);
            console.log('👤 Usuario actual cargado:', {
                id: this.currentUser.id,
                name: this.currentUser.name,
                email: this.currentUser.email
            });
        } catch (error) {
            console.error('❌ Error cargando usuario:', error);
            this.showError('Error de autenticación');
        }
    }

    async loadUserFavorites() {
        if (!this.database || !this.currentUser) return;
        
        try {
            const favoritesRef = this.database.ref(`users/${this.currentUser.id}/favorites`);
            const snapshot = await favoritesRef.once('value');
            const favorites = snapshot.val() || {};
            
            this.userFavorites = favorites;
            console.log('⭐ Favoritos cargados:', Object.keys(favorites).length);
        } catch (error) {
            console.error('❌ Error cargando favoritos:', error);
            this.userFavorites = {};
        }
    }

    setupEventListeners() {
        // Botón de búsqueda
        const searchBtn = document.getElementById('searchBtn');
        const closeSearch = document.getElementById('closeSearch');
        const searchBar = document.getElementById('searchBar');
        const searchInput = document.getElementById('searchInput');
        
        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                searchBar.style.display = searchBar.style.display === 'none' ? 'flex' : 'none';
                if (searchBar.style.display !== 'none') {
                    searchInput.focus();
                }
            });
        }
        
        if (closeSearch) {
            closeSearch.addEventListener('click', () => {
                searchBar.style.display = 'none';
                searchInput.value = '';
                this.searchQuery = '';
                this.renderChats();
            });
        }
        
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.renderChats();
            });
        }

        // Filtros
        const filterTabs = document.querySelectorAll('.filter-tab');
        filterTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                // Remover clase active de todos los tabs
                filterTabs.forEach(t => t.classList.remove('active'));
                // Agregar clase active al tab clickeado
                e.target.classList.add('active');
                
                this.currentFilter = e.target.dataset.filter;
                this.renderChats();
            });
        });

        // Botón flotante
        const newChatFab = document.getElementById('newChatFab');
        if (newChatFab) {
            newChatFab.addEventListener('click', () => {
                this.openNewChatModal();
            });
        }

        // Modales
        this.setupModalListeners();
    }

    setupModalListeners() {
        // Modal de nuevo chat
        const searchUserInput = document.getElementById('searchUser');
        if (searchUserInput) {
            searchUserInput.addEventListener('input', (e) => {
                this.searchUsers(e.target.value);
            });
        }

        // Cerrar modales al hacer click fuera
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });

        // Tema
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const currentTheme = document.documentElement.getAttribute('data-theme');
                const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                this.setTheme(newTheme);
            });
        }
    }

    async loadChats() {
        if (!this.database || !this.currentUser) {
            console.error('❌ Firebase o usuario no inicializado');
            return;
        }

        try {
            console.log('🔍 Cargando chats para usuario:', this.currentUser.id);
            
            const chatsRef = this.database.ref('chats');
            const snapshot = await chatsRef.once('value');
            const chatsData = snapshot.val();
            
            console.log('📊 Datos de chats desde Firebase:', chatsData);
            
            if (chatsData) {
                // Filtrar chats donde el usuario actual es participante.
                // IMPORTANTE: inyectar la clave de Firebase como `id` para que los
                // chats antiguos (que no guardaban el campo id) siempre tengan id.
                const allChats = Object.entries(chatsData).map(([key, chat]) => ({
                    ...chat,
                    id: chat.id || key
                }));
                console.log('📋 Total de chats en Firebase:', allChats.length);
                
                this.chats = allChats
                    .filter(chat => {
                        const hasParticipant = chat.participants && chat.participants[this.currentUser.id];
                        console.log(`🔍 Chat ${chat.id}:`, {
                            hasParticipants: !!chat.participants,
                            hasCurrentUser: hasParticipant,
                            participants: chat.participants
                        });
                        return hasParticipant;
                    })

                    .sort((a, b) => {
                        const aTime = a.lastMessage ? new Date(a.lastMessage.timestamp) : new Date(a.createdAt);
                        const bTime = b.lastMessage ? new Date(b.lastMessage.timestamp) : new Date(b.createdAt);
                        return bTime - aTime;
                    });
                
                console.log('✅ Chats filtrados para usuario actual:', this.chats.length);
                this.renderChats();
            } else {
                console.log('ℹ️ No hay chats en Firebase');
                this.chats = [];
                this.renderChats();
            }

            // Escuchar cambios en tiempo real
            this.setupChatsListener();

        } catch (error) {
            console.error('❌ Error cargando chats:', error);
            this.chats = [];
            this.renderChats();
        }
    }

    setupChatsListener() {
        if (!this.database || !this.currentUser) return;

        const chatsRef = this.database.ref('chats');
        
        chatsRef.on('value', (snapshot) => {
            const chatsData = snapshot.val();
            
            if (chatsData) {
                const newChats = Object.entries(chatsData)
                    .map(([key, chat]) => ({ ...chat, id: chat.id || key }))
                    .filter(chat => chat.participants && chat.participants[this.currentUser.id])
                    .sort((a, b) => {

                        const aTime = a.lastMessage ? new Date(a.lastMessage.timestamp) : new Date(a.createdAt);
                        const bTime = b.lastMessage ? new Date(b.lastMessage.timestamp) : new Date(b.createdAt);
                        return bTime - aTime;
                    });
                
                // Verificar si hay nuevos mensajes para notificar
                this.checkForNewMessages(newChats);
                
                this.chats = newChats;
                this.renderChats();
            }
        });
    }

    async loadNotifications() {
        if (!this.database || !this.currentUser) return;

        try {
            const notificationsRef = this.database.ref(`notifications/${this.currentUser.id}`);
            const snapshot = await notificationsRef.once('value');
            const notificationsData = snapshot.val();
            
            if (notificationsData) {
                this.notifications = Object.values(notificationsData)
                    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                
                console.log('✅ Notificaciones cargadas:', this.notifications.length);
            }

            // Escuchar nuevas notificaciones
            this.setupNotificationsListener();

        } catch (error) {
            console.error('❌ Error cargando notificaciones:', error);
        }
    }

    setupNotificationsListener() {
        if (!this.database || !this.currentUser) return;

        const notificationsRef = this.database.ref(`notifications/${this.currentUser.id}`);
        
        notificationsRef.on('child_added', (snapshot) => {
            const notification = snapshot.val();
            if (!this.notifications.find(n => n.id === notification.id)) {
                this.notifications.unshift(notification);
                this.showNotificationToast(notification);
            }
        });
    }

    renderChats() {
        const chatsList = document.getElementById('chatsList');
        const emptyState = document.getElementById('emptyState');
        
        if (!chatsList) {
            console.error('❌ Elemento chatsList no encontrado');
            return;
        }

        // Filtrar chats
        let filteredChats = this.chats;
        
        // Aplicar filtro
        switch (this.currentFilter) {
            case 'active':
                filteredChats = filteredChats.filter(chat => chat.status === 'active');
                break;
            case 'unread':
                filteredChats = filteredChats.filter(chat => this.hasUnreadMessages(chat));
                break;
            case 'archived':
                filteredChats = filteredChats.filter(chat => chat.status === 'archived');
                break;
            case 'favorites':
                filteredChats = filteredChats.filter(chat => {
                    try {
                        const otherParticipant = this.getOtherParticipant(chat);
                        return !!this.userFavorites[otherParticipant.id];
                    } catch (_) {
                        return false;
                    }
                });
                break;
        }
        
        // Aplicar búsqueda
        if (this.searchQuery) {
            filteredChats = filteredChats.filter(chat => {
                const otherParticipant = this.getOtherParticipant(chat);
                return otherParticipant.name.toLowerCase().includes(this.searchQuery) ||
                       (chat.lastMessage && chat.lastMessage.message.toLowerCase().includes(this.searchQuery));
            });
        }

        // Limpiar lista
        chatsList.innerHTML = '';

        if (filteredChats.length === 0) {
            if (emptyState) {
                emptyState.style.display = 'flex';
            }
            return;
        }

        if (emptyState) {
            emptyState.style.display = 'none';
        }

        // Renderizar chats
        filteredChats.forEach(chat => {
            const chatElement = this.createChatElement(chat);
            chatsList.appendChild(chatElement);
        });
    }

    createChatElement(chat) {
        const div = document.createElement('div');
        div.className = 'chat-item';
        
      const otherParticipant = this.getOtherParticipant(chat);
        const hasUnread = this.hasUnreadMessages(chat);
        
        if (hasUnread) {
            div.classList.add('unread');
        }
        
        if (chat.status === 'archived') {
            div.classList.add('archived');
        }

      const lastMessage = chat.lastMessage ? chat.lastMessage.message : 'No hay mensajes';
        const lastMessageTime = chat.lastMessage ? 
            this.formatTime(chat.lastMessage.timestamp) : 
            this.formatTime(chat.createdAt);

        div.innerHTML = `
            <div class="chat-avatar">
                <i class="fas fa-user"></i>
            </div>
            <div class="chat-info">
              <h3 class="chat-name">${this.escapeHtml(otherParticipant.name || 'Usuario')}</h3>
                <p class="chat-last-message">${this.escapeHtml(lastMessage)}</p>
            </div>
            <div class="chat-meta">
                <span class="chat-time">${lastMessageTime}</span>
                ${hasUnread ? '<div class="chat-unread-badge">!</div>' : ''}
                <div class="chat-status ${otherParticipant.isOnline ? 'online' : 'offline'}">
                    <i class="fas fa-circle"></i>
                </div>
            </div>
        `;

      // Resolver alias/apodo desde Firebase y actualizar el nombre mostrado
      const nameEl = div.querySelector('.chat-name');
      const fallbackName = otherParticipant.name || 'Usuario';
      if (nameEl && otherParticipant && otherParticipant.id) {
          this.getDisplayNameForUser(otherParticipant.id, fallbackName)
              .then((displayName) => {
                  nameEl.textContent = displayName;
              })
              .catch(() => {
                  // Mantener fallback silenciosamente
              });
      }

        // Agregar evento de click
        div.addEventListener('click', () => {
            this.openChat(chat);
        });

        return div;
    }

    getOtherParticipant(chat) {
        // Usar las CLAVES del objeto participants (que son siempre los userIds)
        // en lugar de confiar en el campo `id` interno, que puede faltar o venir
        // con tipo distinto (string vs number). Así siempre devolvemos el otro
        // participante con un id válido.
        const participants = chat && chat.participants ? chat.participants : {};
        const currentId = this.currentUser ? String(this.currentUser.id) : '';

        const entries = Object.entries(participants);
        const otherEntry = entries.find(([key, p]) => {
            const pid = p && p.id != null ? String(p.id) : String(key);
            return pid !== currentId;
        });

        if (otherEntry) {
            const [key, p] = otherEntry;
            return {
                ...(p || {}),
                id: (p && p.id != null) ? p.id : key,
                name: (p && p.name) || 'Usuario',
                isOnline: !!(p && p.isOnline)
            };
        }

        // Fallback: no hay otro participante identificable
        return { id: null, name: 'Usuario', isOnline: false };
    }


    hasUnreadMessages(chat) {
        // Implementar lógica para detectar mensajes no leídos
        // Por ahora, asumir que hay mensajes no leídos si el último mensaje no es del usuario actual
        if (!chat.lastMessage) return false;
        return chat.lastMessage.senderId !== this.currentUser.id;
    }

    openChat(chat) {
        const otherParticipant = this.getOtherParticipant(chat);
        
        // LÓGICA CORREGIDA:
        // Determinar si el usuario actual es proveedor o cliente basándose en el rol guardado
        
        const userType = this.determineUserType(chat);
        
        console.log('🔍 [DEBUG] Tipo de usuario determinado:', userType);
        console.log('🔍 [DEBUG] Redirigiendo a:', userType === 'provider' ? 'chat-provider.html' : 'chat-client.html');

        // Validar que tengamos los parámetros necesarios antes de redirigir.
        // Si falta el id del chat o del otro usuario, avisamos en vez de abrir
        // una URL con "undefined" (que provoca "Faltan parámetros en la URL").
        const chatId = chat && chat.id ? String(chat.id) : '';
        const otherUserId = otherParticipant && otherParticipant.id != null ? String(otherParticipant.id) : '';

        if (!chatId || !otherUserId) {
            console.error('❌ No se puede abrir el chat: faltan datos', { chatId, otherUserId, chat });
            this.showError('No se pudo abrir el chat (datos incompletos)');
            return;
        }

        const targetPage = userType === 'provider' ? 'chat-provider.html' : 'chat-client.html';

        // Handoff robusto: guardamos los parámetros en sessionStorage antes de
        // navegar. Algunos hosts de deploy (y servidores de dev con "clean URLs")
        // reescriben la URL y eliminan el query string (?chatId=...&userId=...),
        // lo que dejaba la pantalla de chat sin datos. Con este respaldo, el chat
        // puede recuperar el chatId/usuario aunque la URL llegue sin parámetros.
        this.rememberChatHandoff({ chatId: chatId, otherUserId: otherUserId, target: targetPage });

        window.location.href = `${targetPage}?chatId=${encodeURIComponent(chatId)}&userId=${encodeURIComponent(otherUserId)}`;
    }

    rememberChatHandoff(data) {
        try {
            const payload = {
                chatId: data && data.chatId ? String(data.chatId) : null,
                otherUserId: data && data.otherUserId ? String(data.otherUserId) : null,
                target: data && data.target ? String(data.target) : null,
                ts: Date.now()
            };
            sessionStorage.setItem('deseo_chat_handoff', JSON.stringify(payload));
            localStorage.setItem('deseo_chat_handoff', JSON.stringify(payload));
        } catch (_) {
            // sessionStorage/localStorage pueden no estar disponibles (modo privado estricto).
        }
    }


    determineUserType(chat) {
        // Determinar si el usuario actual es el proveedor o el cliente
        // basándose en el rol guardado en el chat
        
        if (!chat.participants || !this.currentUser) {
            return 'client'; // Por defecto asumir que es cliente
        }
        
        const currentUserParticipant = chat.participants[this.currentUser.id];
        
        if (currentUserParticipant && currentUserParticipant.role) {
            console.log('🔍 [DEBUG] Rol del usuario en el chat:', currentUserParticipant.role);
            return currentUserParticipant.role; // 'client' o 'provider'
        }
        
        // Fallback: usar la lógica anterior si no hay rol guardado
        if (currentUserParticipant && currentUserParticipant.type === 'contacting') {
            return 'client';
        } else {
            return 'provider';
        }
    }

    // ===== PERFIL/ALIAS =====
    async getDisplayNameForUser(userId, fallbackName = 'Usuario') {
        try {
            // Cache primero
            if (this.userProfilesCache[userId]) {
                return this.resolveAliasFromProfile(this.userProfilesCache[userId], fallbackName);
            }

            if (!this.database) return fallbackName;
            // Intentar bajo users/{userId}/profile
            const profileRef = this.database.ref(`users/${userId}/profile`);
            const snap = await profileRef.once('value');
            let profileData = snap.val();
            
            // Fallback: users/{userId}
            if (!profileData) {
                const userRootRef = this.database.ref(`users/${userId}`);
                const rootSnap = await userRootRef.once('value');
                profileData = rootSnap.val();
            }

            if (profileData) {
                this.userProfilesCache[userId] = profileData;
                return this.resolveAliasFromProfile(profileData, fallbackName);
            }
        } catch (e) {
            // Silencioso; usaremos fallback
        }
        return fallbackName;
    }

    resolveAliasFromProfile(profileData, fallbackName = 'Usuario') {
        // Soportar múltiples campos posibles para el alias
        // Estructuras posibles:
        // - profileData.nickname / alias / apodo
        // - profileData.userInfo.name (si no hay alias)
        // - profileData.name
        const alias = profileData?.nickname || profileData?.alias || profileData?.apodo;
        const userInfoName = profileData?.userInfo?.name || profileData?.name;
        return alias || userInfoName || fallbackName;
    }

    async searchUsers(query) {
        if (!this.database || !query.trim()) {
            document.getElementById('usersList').innerHTML = '';
            return;
        }

        try {
            const usersRef = this.database.ref('users');
            const snapshot = await usersRef.once('value');
            const usersData = snapshot.val();
            
            if (usersData) {
                const users = Object.values(usersData)
                    .filter(user => 
                        user.id !== this.currentUser.id &&
                        (user.name.toLowerCase().includes(query.toLowerCase()) ||
                         user.email.toLowerCase().includes(query.toLowerCase()))
                    )
                    .slice(0, 10); // Limitar a 10 resultados
                
                this.renderUsersList(users);
            }
        } catch (error) {
            console.error('❌ Error buscando usuarios:', error);
        }
    }

    renderUsersList(users) {
        const usersList = document.getElementById('usersList');
        if (!usersList) return;

        usersList.innerHTML = '';

        if (users.length === 0) {
            usersList.innerHTML = '<p style="text-align: center; color: var(--text-light); padding: 1rem;">No se encontraron usuarios</p>';
            return;
        }

        users.forEach(user => {
            const userElement = this.createUserElement(user);
            usersList.appendChild(userElement);
        });
    }

    createUserElement(user) {
        const div = document.createElement('div');
        div.className = 'user-item';
        
        div.innerHTML = `
            <div class="user-avatar">
                <i class="fas fa-user"></i>
            </div>
            <div class="user-info">
                <h4 class="user-name">${this.escapeHtml(user.name)}</h4>
                <p class="user-status">${user.isAvailable ? 'Disponible' : 'No disponible'}</p>
            </div>
        `;

        div.addEventListener('click', () => {
            this.startChatWithUser(user);
        });

        return div;
    }

    async startChatWithUser(user) {
        try {
            // Crear chat con el usuario seleccionado
            const chatId = await this.createChatWithUser(user.id);
            
            // Cerrar modal
            this.closeModal('newChatModal');
            
            // Redirigir al chat
            this.openChat({ id: chatId, participants: { [user.id]: user } });
            
        } catch (error) {
            console.error('❌ Error iniciando chat:', error);
            this.showError('Error iniciando chat');
        }
    }

    async createChatWithUser(userId) {
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
                console.log('📝 Creando nuevo chat desde chats.js:', chatId);
                
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
                            role: 'client', // Quien inicia el chat es el CLIENTE
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
                console.log('✅ Chat creado exitosamente desde chats.js');
            } else {
                console.log('✅ Chat existente encontrado en chats.js:', chatId);
            }
            
            return chatId;
            
        } catch (error) {
            console.error('❌ Error creando chat:', error);
            throw error;
        }
    }

    openNewChatModal() {
        const modal = document.getElementById('newChatModal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    showNotificationToast(notification) {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--primary-color);
            color: white;
            padding: 15px 20px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            max-width: 300px;
            animation: slideInRight 0.3s ease-out;
        `;
        
        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-bell" style="font-size: 18px;"></i>
                <div>
                    <strong>${this.escapeHtml(notification.title)}</strong>
                    <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">${this.escapeHtml(notification.message)}</p>
                </div>
            </div>
        `;
        
        document.body.appendChild(toast);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease-in';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 5000);
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) { // Menos de 1 minuto
            return 'Ahora';
        } else if (diff < 3600000) { // Menos de 1 hora
            return `${Math.floor(diff / 60000)}m`;
        } else if (diff < 86400000) { // Menos de 1 día
            return `${Math.floor(diff / 3600000)}h`;
        } else {
            return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
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

    checkForNewMessages(newChats) {
        if (!this.chats || this.chats.length === 0) return;

        newChats.forEach(newChat => {
            const oldChat = this.chats.find(old => old.id === newChat.id);
            
            if (oldChat && newChat.lastMessage && oldChat.lastMessage) {
                // Si hay un nuevo mensaje y no es del usuario actual
                if (newChat.lastMessage.id !== oldChat.lastMessage.id && 
                    newChat.lastMessage.senderId !== this.currentUser.id &&
                    newChat.lastMessage.senderId !== 'system') {
                    
                    console.log('🔍 [DEBUG] Nuevo mensaje detectado en chats:', newChat.lastMessage);
                    this.sendBrowserNotification(newChat.lastMessage.senderName, newChat.lastMessage.message);
                }
            }
        });
    }

    // ===== NOTIFICACIONES =====
    async initializeNotifications() {
        console.log('🔍 [DEBUG] Inicializando notificaciones en chats...');
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

            console.log('✅ [DEBUG] Notificación del navegador enviada desde chats para:', senderName);
            
        } catch (error) {
            console.error('❌ Error enviando notificación del navegador:', error);
        }
    }
}

// Funciones globales
function goBack() {
    window.history.back();
}

function goToMap() {
    window.location.href = 'index.html';
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    window.chatsManager = new ChatsManager();
});