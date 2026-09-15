/**
 * DESEO - Plataforma de Micro-Deseos
 * Aplicación web interactiva para conectar personas con deseos y servicios
 * 
 * Funcionalidades principales:
 * - Mapa interactivo con pines de deseos
 * - Chat con IA para crear deseos
 * - Sistema de chat privado entre usuarios
 * - Calificación y comentarios
 * - Filtros y búsqueda
 */

// ===== ESTADO GLOBAL DE LA APLICACIÓN =====
class DeseoApp {
    constructor() {
        this.wishes = [];
        this.currentUser = { id: 'user1', name: 'Usuario Actual' };
        this.activeChat = null;
        this.filters = {
            maxPrice: 1000,
            category: '',
            distance: 10
        };
        this.aiResponses = this.initializeAIResponses();
        this.initializeApp();
    }

    // ===== INICIALIZACIÓN =====
    initializeApp() {
        this.setupEventListeners();
        this.generateSampleWishes();
        this.renderWishesOnMap();
        this.showNotification('¡Bienvenido a Deseo! Explora deseos cerca de ti.', 'success');
    }

    // ===== CONFIGURACIÓN DE EVENT LISTENERS =====
    setupEventListeners() {
        // Botones principales
        document.getElementById('createWishBtn').addEventListener('click', () => this.openCreateWishModal());
        document.getElementById('floatingCreateBtn').addEventListener('click', () => this.openCreateWishModal());
        document.getElementById('filterBtn').addEventListener('click', () => this.openFilterModal());

        // Modales - botones de cerrar
        document.getElementById('closeCreateModal').addEventListener('click', () => this.closeModal('createWishModal'));
        document.getElementById('closeDetailsModal').addEventListener('click', () => this.closeModal('wishDetailsModal'));
        document.getElementById('closeChatModal').addEventListener('click', () => this.closeModal('privateChatModal'));
        document.getElementById('closeRatingModal').addEventListener('click', () => this.closeModal('ratingModal'));
        document.getElementById('closeFilterModal').addEventListener('click', () => this.closeModal('filterModal'));

        // Chat con IA
        document.getElementById('sendAiMessage').addEventListener('click', () => this.sendAIMessage());
        document.getElementById('aiChatInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendAIMessage();
        });

        // Publicar deseo
        document.getElementById('publishWish').addEventListener('click', () => this.publishWish());

        // Detalles del deseo
        document.getElementById('acceptWishBtn').addEventListener('click', () => this.acceptWish());
        document.getElementById('viewDetailsBtn').addEventListener('click', () => this.viewWishDetails());

        // Chat privado
        document.getElementById('sendPrivateMessage').addEventListener('click', () => this.sendPrivateMessage());
        document.getElementById('privateChatInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendPrivateMessage();
        });

        // Completar deseo
        document.getElementById('completeWishBtn').addEventListener('click', () => this.completeWish());

        // Calificación
        document.getElementById('fulfilledBtn').addEventListener('click', () => this.setFulfillmentStatus(true));
        document.getElementById('unfulfilledBtn').addEventListener('click', () => this.setFulfillmentStatus(false));
        document.getElementById('submitRating').addEventListener('click', () => this.submitRating());

        // Estrellas de calificación
        document.querySelectorAll('#starRating i').forEach((star, index) => {
            star.addEventListener('click', () => this.setStarRating(index + 1));
            star.addEventListener('mouseenter', () => this.highlightStars(index + 1));
        });
        document.getElementById('starRating').addEventListener('mouseleave', () => this.resetStarHighlight());

        // Filtros
        document.getElementById('priceFilter').addEventListener('input', (e) => {
            document.getElementById('priceValue').textContent = `$${e.target.value}`;
        });
        document.getElementById('applyFilters').addEventListener('click', () => this.applyFilters());

        // Cerrar modales al hacer click fuera
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });
    }

    // ===== GENERACIÓN DE DATOS DE PRUEBA =====
    generateSampleWishes() {
        const sampleWishes = [
            {
                id: 'wish1',
                title: 'Comprar café en Starbucks',
                description: 'Necesito que alguien me compre un café grande de vainilla en Starbucks y me lo traiga a mi oficina.',
                price: 8,
                category: 'comida',
                location: { x: 25, y: 30 },
                author: { id: 'user2', name: 'María García' },
                status: 'active',
                createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 horas atrás
            },
            {
                id: 'wish2',
                title: 'Pasear a mi perro',
                description: 'Busco alguien que pueda pasear a mi perro Golden Retriever por 30 minutos en el parque.',
                price: 15,
                category: 'servicios',
                location: { x: 60, y: 45 },
                author: { id: 'user3', name: 'Carlos López' },
                status: 'active',
                createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000) // 1 hora atrás
            },
            {
                id: 'wish3',
                title: 'Llevar paquete a correos',
                description: 'Necesito que alguien lleve un paquete pequeño a la oficina de correos más cercana.',
                price: 12,
                category: 'servicios',
                location: { x: 40, y: 70 },
                author: { id: 'user4', name: 'Ana Martínez' },
                status: 'active',
                createdAt: new Date(Date.now() - 30 * 60 * 1000) // 30 minutos atrás
            },
            {
                id: 'wish4',
                title: 'Comprar ingredientes para cena',
                description: 'Necesito que alguien compre los ingredientes para hacer pasta: tomates, cebolla, ajo y queso parmesano.',
                price: 20,
                category: 'compras',
                location: { x: 75, y: 25 },
                author: { id: 'user5', name: 'Roberto Silva' },
                status: 'active',
                createdAt: new Date(Date.now() - 45 * 60 * 1000) // 45 minutos atrás
            },
            {
                id: 'wish5',
                title: 'Dar un paseo en bicicleta',
                description: 'Busco compañía para dar un paseo en bicicleta por el centro de la ciudad este fin de semana.',
                price: 25,
                category: 'entretenimiento',
                location: { x: 30, y: 60 },
                author: { id: 'user6', name: 'Laura Fernández' },
                status: 'active',
                createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) // 3 horas atrás
            }
        ];

        this.wishes = sampleWishes;
    }

    // ===== RENDERIZADO DEL MAPA =====
    renderWishesOnMap() {
        const map = document.getElementById('map');
        map.innerHTML = ''; // Limpiar pines existentes

        this.wishes
            .filter(wish => wish.status === 'active')
            .filter(wish => this.passesFilters(wish))
            .forEach(wish => {
                const pin = this.createWishPin(wish);
                map.appendChild(pin);
            });
    }

    createWishPin(wish) {
        const pin = document.createElement('div');
        pin.className = 'wish-pin';
        pin.style.left = `${wish.location.x}%`;
        pin.style.top = `${wish.location.y}%`;
        
        // Icono según categoría
        const categoryIcons = {
            comida: 'fas fa-utensils',
            transporte: 'fas fa-car',
            entretenimiento: 'fas fa-gamepad',
            servicios: 'fas fa-tools',
            compras: 'fas fa-shopping-bag'
        };

        pin.innerHTML = `
            <i class="${categoryIcons[wish.category] || 'fas fa-star'}"></i>
            <span class="pin-price">$${escapeInt(wish.price, '')}</span>
            <span class="pin-category">${escapeHtml(this.getCategoryName(wish.category))}</span>
        `;

        pin.addEventListener('click', () => this.showWishDetails(wish));
        return pin;
    }

    // ===== MODALES =====
    openModal(modalId) {
        document.getElementById(modalId).classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Mobile-specific enhancements for AI chat modal
        if (modalId === 'createWishModal' && this.isMobile()) {
            this.enhanceMobileChat();
        }
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
        document.body.style.overflow = 'auto';
        
        // Clean up mobile enhancements
        if (modalId === 'createWishModal') {
            this.cleanupMobileChat();
        }
    }

    // Mobile detection utility
    isMobile() {
        return window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    // Enhance mobile chat experience
    enhanceMobileChat() {
        const modal = document.getElementById('createWishModal');
        const input = document.getElementById('aiChatInput');
        
        // Add mobile-specific class
        modal.classList.add('mobile-fullscreen');
        
        // Focus input after a short delay to ensure modal is fully open
        setTimeout(() => {
            if (input) {
                input.focus();
                // Scroll to bottom of messages
                const messagesContainer = document.getElementById('aiChatMessages');
                if (messagesContainer) {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }
            }
        }, 300);
        
        // Prevent body scroll on mobile
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
    }

    // Clean up mobile enhancements
    cleanupMobileChat() {
        const modal = document.getElementById('createWishModal');
        modal.classList.remove('mobile-fullscreen');
        
        // Restore body scroll
        document.body.style.position = '';
        document.body.style.width = '';
    }

    // ===== CREAR DESEO CON IA =====
    openCreateWishModal() {
        this.openModal('createWishModal');
        this.resetAIChat();
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
    }

    sendAIMessage() {
        const input = document.getElementById('aiChatInput');
        const message = input.value.trim();
        
        if (!message) return;

        // Agregar mensaje del usuario
        this.addMessageToChat('user', message);
        input.value = '';

        // Simular respuesta de IA
        setTimeout(() => {
            const aiResponse = this.generateAIResponse(message);
            this.addMessageToChat('ai', aiResponse.text);
            
            if (aiResponse.wishData) {
                this.showWishPreview(aiResponse.wishData);
            }
        }, 1000);
    }

    addMessageToChat(sender, message) {
        const messagesContainer = document.getElementById('aiChatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `${sender}-message`;
        
        const avatar = sender === 'ai' ? 
            '<div class="ai-avatar"><i class="fas fa-robot"></i></div>' :
            '<div class="user-avatar"><i class="fas fa-user"></i></div>';

        messageDiv.innerHTML = `
            ${avatar}
            <div class="message-content">
                <p>${escapeHtml(message)}</p>
            </div>
        `;

        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    generateAIResponse(userMessage) {
        const lowerMessage = userMessage.toLowerCase();
        
        // Detectar tipo de deseo y generar respuesta
        if (lowerMessage.includes('café') || lowerMessage.includes('coffee') || lowerMessage.includes('bebida')) {
            return {
                text: "¡Perfecto! Un deseo de comida. Basándome en tu solicitud, sugiero un precio de $8-12. ¿Te parece bien? También podrías especificar el tipo de café y la ubicación donde lo necesitas.",
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
                text: "¡Excelente! Un servicio de cuidado de mascotas. Para pasear un perro, recomiendo un precio de $15-25 dependiendo del tiempo. ¿Cuánto tiempo necesitas que dure el paseo?",
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
                text: "¡Genial! Un deseo de compras. El precio dependerá de los productos, pero sugiero $15-30. ¿Podrías ser más específico sobre qué necesitas comprar?",
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
                text: "¡Perfecto! Un servicio de entrega. Para entregas locales, sugiero $10-20 dependiendo de la distancia. ¿A dónde necesitas que se entregue?",
                wishData: {
                    title: "Servicio de entrega",
                    description: userMessage,
                    price: 15,
                    category: "servicios"
                }
            };
        }
        
        // Respuesta genérica
        return {
            text: "Interesante deseo. Para ayudarte mejor, ¿podrías ser más específico sobre qué necesitas? También me gustaría saber si tienes alguna preferencia de precio o si hay algo especial que deba considerar.",
            wishData: null
        };
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

        const newWish = {
            id: `wish${Date.now()}`,
            title: this.currentWishData.title,
            description: this.currentWishData.description,
            price: this.currentWishData.price,
            category: this.currentWishData.category,
            location: { x: Math.random() * 80 + 10, y: Math.random() * 80 + 10 },
            author: this.currentUser,
            status: 'active',
            createdAt: new Date()
        };

        this.wishes.push(newWish);
        this.renderWishesOnMap();
        this.closeModal('createWishModal');
        this.showNotification('¡Tu deseo ha sido publicado exitosamente!', 'success');
    }

    // ===== DETALLES DEL DESEO =====
    showWishDetails(wish) {
        document.getElementById('wishDetailsTitle').textContent = wish.title;
        document.getElementById('wishDetailsDescription').textContent = wish.description;
        document.getElementById('wishDetailsPrice').textContent = `$${wish.price}`;
        document.getElementById('wishDetailsCategory').textContent = this.getCategoryName(wish.category);
        document.getElementById('wishDetailsLocation').textContent = 'Ubicación aproximada';
        
        this.currentWish = wish;
        this.openModal('wishDetailsModal');
    }

    acceptWish() {
        if (!this.currentWish) return;

        this.currentWish.status = 'in_progress';
        this.currentWish.acceptedBy = this.currentUser;
        this.activeChat = {
            wishId: this.currentWish.id,
            otherUser: this.currentWish.author,
            messages: [
                {
                    sender: 'system',
                    message: `Has aceptado el deseo "${this.currentWish.title}" de ${this.currentWish.author.name}. ¡Coordina los detalles aquí!`,
                    timestamp: new Date()
                }
            ]
        };

        this.closeModal('wishDetailsModal');
        this.openPrivateChat();
        this.renderWishesOnMap();
        this.showNotification('¡Deseo aceptado! Puedes coordinar los detalles en el chat.', 'success');
    }

    // ===== CHAT PRIVADO =====
    openPrivateChat() {
        if (!this.activeChat) return;

        document.getElementById('chatUserName').textContent = this.activeChat.otherUser.name;
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
        });

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
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

    // ===== FILTROS =====
    openFilterModal() {
        document.getElementById('priceFilter').value = this.filters.maxPrice;
        document.getElementById('priceValue').textContent = `$${this.filters.maxPrice}`;
        document.getElementById('categoryFilter').value = this.filters.category;
        document.getElementById('distanceFilter').value = this.filters.distance;
        this.openModal('filterModal');
    }

    applyFilters() {
        this.filters.maxPrice = parseInt(document.getElementById('priceFilter').value);
        this.filters.category = document.getElementById('categoryFilter').value;
        this.filters.distance = parseInt(document.getElementById('distanceFilter').value);

        this.renderWishesOnMap();
        this.closeModal('filterModal');
        this.showNotification('Filtros aplicados correctamente.', 'success');
    }

    passesFilters(wish) {
        if (wish.price > this.filters.maxPrice) return false;
        if (this.filters.category && wish.category !== this.filters.category) return false;
        return true;
    }

    // ===== UTILIDADES =====
    getCategoryName(category) {
        const categories = {
            comida: 'Comida',
            transporte: 'Transporte',
            entretenimiento: 'Entretenimiento',
            servicios: 'Servicios',
            compras: 'Compras'
        };
        return categories[category] || 'Otros';
    }

    formatTime(date) {
        return date.toLocaleTimeString('es-ES', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
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
}

// ===== INICIALIZACIÓN DE LA APLICACIÓN =====
document.addEventListener('DOMContentLoaded', () => {
    window.deseoApp = new DeseoApp();
});

// ===== FUNCIONES GLOBALES ADICIONALES =====

/**
 * Función para simular geolocalización del usuario
 */
function getUserLocation() {
    return new Promise((resolve) => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    });
                },
                () => {
                    // Ubicación por defecto (Madrid, España)
                    resolve({ lat: 40.4168, lng: -3.7038 });
                }
            );
        } else {
            resolve({ lat: 40.4168, lng: -3.7038 });
        }
    });
}

/**
 * Función para generar ubicaciones aleatorias en el mapa
 */
function generateRandomLocation() {
    return {
        x: Math.random() * 80 + 10, // Entre 10% y 90%
        y: Math.random() * 80 + 10
    };
}

/**
 * Función para validar formularios
 */
function validateForm(formData) {
    const errors = [];
    
    if (!formData.title || formData.title.length < 3) {
        errors.push('El título debe tener al menos 3 caracteres');
    }
    
    if (!formData.description || formData.description.length < 10) {
        errors.push('La descripción debe tener al menos 10 caracteres');
    }
    
    if (!formData.price || formData.price < 1) {
        errors.push('El precio debe ser mayor a $0');
    }
    
    return errors;
}

/**
 * Función para formatear precios
 */
function formatPrice(price) {
    return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'USD'
    }).format(price);
}

/**
 * Función para calcular distancia entre dos puntos
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * Función para animar elementos
 */
function animateElement(element, animation) {
    element.style.animation = animation;
    element.addEventListener('animationend', () => {
        element.style.animation = '';
    });
}

/**
 * Función para hacer scroll suave
 */
function smoothScrollTo(element) {
    element.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
}

/**
 * Función para copiar texto al portapapeles
 */
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        window.deseoApp.showNotification('Texto copiado al portapapeles', 'success');
    }).catch(() => {
        window.deseoApp.showNotification('Error al copiar texto', 'error');
    });
}

/**
 * Función para generar ID único
 */
function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Función para debounce (retrasar ejecución)
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Función para throttle (limitar frecuencia)
 */
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ===== MANEJO DE ERRORES GLOBALES =====
window.addEventListener('error', (event) => {
    console.error('Error global:', event.error);
    if (window.deseoApp) {
        window.deseoApp.showNotification('Ha ocurrido un error inesperado', 'error');
    }
});

// ===== MANEJO DE CONECTIVIDAD =====
window.addEventListener('online', () => {
    if (window.deseoApp) {
        window.deseoApp.showNotification('Conexión restaurada', 'success');
    }
});

window.addEventListener('offline', () => {
    if (window.deseoApp) {
        window.deseoApp.showNotification('Sin conexión a internet', 'warning');
    }
});

// ===== OPTIMIZACIONES DE RENDIMIENTO =====

/**
 * Lazy loading para imágenes (si se añaden en el futuro)
 */
function lazyLoadImages() {
    const images = document.querySelectorAll('img[data-src]');
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                imageObserver.unobserve(img);
            }
        });
    });

    images.forEach(img => imageObserver.observe(img));
}

/**
 * Preload de recursos críticos
 */
function preloadCriticalResources() {
    const criticalResources = [
        'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
    ];

    criticalResources.forEach(resource => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'style';
        link.href = resource;
        document.head.appendChild(link);
    });
}

// ===== INICIALIZACIÓN DE OPTIMIZACIONES =====
document.addEventListener('DOMContentLoaded', () => {
    preloadCriticalResources();
    lazyLoadImages();
});

console.log('🎉 Deseo App cargada exitosamente!');
console.log('📱 Plataforma de micro-deseos lista para usar');
console.log('🤖 IA simulada activa');
console.log('🗺️ Mapa interactivo funcionando');
console.log('💬 Sistema de chat implementado');
console.log('⭐ Sistema de calificaciones activo');