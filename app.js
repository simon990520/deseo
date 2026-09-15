/**
 * Aplicación Principal de Deseo
 * Coordina todos los módulos: mapa, autenticación, IA y deseos
 */

class DeseoApp {
    constructor() {
        this.map = null;
        this.currentUser = null;
        this.userLocation = null;
        this.userLocationMarker = null;
        this.filters = {
            maxPrice: 1000,
            category: '',
            distance: 10
        };
        
        // Inicializar módulos
        this.auth = new DeseoAuth();
        this.ai = new DeseoAI();
        this.wishes = new DeseoWishes();
        
        this.initializeApp();
    }

    async initializeApp() {
        try {
            console.log('Inicializando aplicación Deseo...');
            
            // Cargar tema guardado
            this.loadSavedTheme();
            
            // Inicializar mapa
            await this.initializeMapbox();
            
            // Configurar event listeners
            this.setupEventListeners();
            
            // Cargar deseos
            await this.wishes.loadWishes();
            
            // Obtener ubicación del usuario
            await this.getUserLocation();
            
            // Cargar deseos en el mapa
            this.loadWishesOnMap();
            
            console.log('Aplicación inicializada correctamente');
        } catch (error) {
            console.error('Error inicializando aplicación:', error);
            this.showNotification('Error al inicializar la aplicación', 'error');
        }
    }

    async initializeMapbox() {
        try {
            if (!CONFIG.MAPBOX_TOKEN) {
                throw new Error('Mapbox token no configurado');
            }

            // Configurar estilo del mapa basado en el tema
            const theme = document.documentElement.getAttribute('data-theme') || 'dark';
            const mapStyle = theme === 'light' ? 'light' : 'dark';

            this.map = new mapboxgl.Map({
                container: 'map',
                style: `mapbox://styles/mapbox/${mapStyle}-v11`,
                center: [CONFIG.MAP.defaultCenter.lng, CONFIG.MAP.defaultCenter.lat],
                zoom: CONFIG.MAP.defaultZoom,
                accessToken: CONFIG.MAPBOX_TOKEN
            });

            // Agregar controles
            this.map.addControl(new mapboxgl.NavigationControl());
            this.map.addControl(new mapboxgl.FullscreenControl());

            // Esperar a que el mapa esté listo
            this.map.on('load', () => {
                console.log('Mapa cargado correctamente');
            });

        } catch (error) {
            console.error('Error inicializando Mapbox:', error);
            throw error;
        }
    }

    updateMapTheme(theme) {
        if (this.map) {
            const mapStyle = theme === 'light' ? 'light' : 'dark';
            this.map.setStyle(`mapbox://styles/mapbox/${mapStyle}-v11`);
        }
    }

    async getUserLocation() {
        try {
            const location = await this.wishes.getUserLocation();
            this.userLocation = location;
            
            // Agregar marcador de ubicación del usuario
            if (this.map) {
                this.userLocationMarker = new mapboxgl.Marker({
                    color: '#1d9bf0',
                    scale: 1.2
                })
                .setLngLat([location.lng, location.lat])
                .setPopup(
                    new mapboxgl.Popup({ offset: 25 })
                    .setHTML('<div class="user-location-popup">Tu ubicación</div>')
                )
                .addTo(this.map);

                // Centrar mapa en la ubicación del usuario
                this.map.flyTo({
                    center: [location.lng, location.lat],
                    zoom: 13,
                    duration: 2000
                });
            }
        } catch (error) {
            console.error('Error obteniendo ubicación:', error);
        }
    }

    loadWishesOnMap() {
        this.wishes.wishes.forEach(wish => {
            this.wishes.addWishToMap(wish);
        });
    }

    setupEventListeners() {
        // Botón de crear deseo
        const createWishBtn = document.getElementById('createWishBtn');
        if (createWishBtn) {
            createWishBtn.addEventListener('click', () => this.showCreateWishModal());
        }

        // Botón de filtros
        const filterBtn = document.getElementById('filterBtn');
        if (filterBtn) {
            filterBtn.addEventListener('click', () => this.showFiltersModal());
        }

        // Toggle de tema
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        }

        // Chat con IA
        const aiChatInput = document.getElementById('aiChatInput');
        if (aiChatInput) {
            aiChatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendAIMessage();
                }
            });
        }

        const aiChatSendBtn = document.getElementById('aiChatSendBtn');
        if (aiChatSendBtn) {
            aiChatSendBtn.addEventListener('click', () => this.sendAIMessage());
        }

        // Botón flotante de chat
        const floatingBtn = document.getElementById('floatingBtn');
        if (floatingBtn) {
            floatingBtn.addEventListener('click', () => this.toggleAIChat());
        }
    }

    loadSavedTheme() {
        const savedTheme = localStorage.getItem('deseo_theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            const icon = themeToggle.querySelector('i');
            if (icon) {
                icon.className = savedTheme === 'light' ? 'fas fa-sun' : 'fas fa-moon';
            }
        }
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('deseo_theme', newTheme);
        
        // Actualizar ícono
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            const icon = themeToggle.querySelector('i');
            if (icon) {
                icon.className = newTheme === 'light' ? 'fas fa-sun' : 'fas fa-moon';
            }
        }
        
        // Actualizar mapa
        this.updateMapTheme(newTheme);
    }

    showCreateWishModal() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2><i class="fas fa-star"></i> Crear Nuevo Deseo</h2>
                    <button class="close-btn" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="createWishForm">
                        <div class="form-group">
                            <label for="wishTitle">Título del deseo:</label>
                            <input type="text" id="wishTitle" placeholder="¿Qué deseas hacer?" required>
                        </div>
                        <div class="form-group">
                            <label for="wishDescription">Descripción:</label>
                            <textarea id="wishDescription" placeholder="Describe tu deseo en detalle..." required></textarea>
                        </div>
                        <div class="form-group">
                            <label for="wishCategory">Categoría:</label>
                            <select id="wishCategory" required>
                                <option value="">Selecciona una categoría</option>
                                <option value="música">Música</option>
                                <option value="cultura">Cultura</option>
                                <option value="comida">Comida</option>
                                <option value="deportes">Deportes</option>
                                <option value="tecnología">Tecnología</option>
                                <option value="viajes">Viajes</option>
                                <option value="arte">Arte</option>
                                <option value="educación">Educación</option>
                                <option value="salud">Salud</option>
                                <option value="entretenimiento">Entretenimiento</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="wishPrice">Precio máximo (USD):</label>
                            <input type="number" id="wishPrice" min="1" max="1000" value="25" required>
                        </div>
                        <div class="form-group">
                            <label for="wishAddress">Dirección:</label>
                            <input type="text" id="wishAddress" placeholder="¿Dónde quieres hacerlo?" required>
                        </div>
                        <div class="modal-actions">
                            <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">
                                Cancelar
                            </button>
                            <button type="submit" class="btn-primary">
                                <i class="fas fa-plus"></i>
                                Crear Deseo
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Configurar formulario
        const form = document.getElementById('createWishForm');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.createWishFromForm(modal);
        });
    }

    async createWishFromForm(modal) {
        try {
            const title = document.getElementById('wishTitle').value;
            const description = document.getElementById('wishDescription').value;
            const category = document.getElementById('wishCategory').value;
            const price = parseInt(document.getElementById('wishPrice').value);
            const address = document.getElementById('wishAddress').value;

            const wishData = {
                title,
                description,
                category,
                price,
                address,
                location: this.userLocation || { lat: 4.6097, lng: -74.0817 }
            };

            await this.wishes.publishWish(wishData);
            
            modal.remove();
            this.showNotification('¡Deseo creado exitosamente!', 'success');
        } catch (error) {
            console.error('Error creating wish:', error);
            this.showNotification('Error al crear el deseo', 'error');
        }
    }

    showFiltersModal() {
        // Implementar modal de filtros
        this.showNotification('Filtros próximamente', 'info');
    }

    async sendAIMessage() {
        const input = document.getElementById('aiChatInput');
        if (!input || !input.value.trim()) return;

        const message = input.value.trim();
        input.value = '';

        // Agregar mensaje del usuario al chat
        this.ai.addMessageToChat(message, 'user');

        try {
            // Enviar mensaje a la IA
            const response = await this.ai.sendAIMessage(message);
            
            // La respuesta ya se agrega al chat en el método sendAIMessage
        } catch (error) {
            console.error('Error sending AI message:', error);
            this.ai.addMessageToChat('Lo siento, hubo un error procesando tu mensaje.', 'ai');
        }
    }

    toggleAIChat() {
        const chatContainer = document.getElementById('aiChatContainer');
        if (chatContainer) {
            const isVisible = chatContainer.style.display !== 'none';
            chatContainer.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                // Mostrar sugerencias si el estado emocional es positivo
                setTimeout(() => {
                    this.ai.maybeShowSuggestions();
                }, 500);
            }
        }
    }

    showWishPreview(wishData) {
        this.wishes.showWishPreview(wishData);
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${this.getNotificationIcon(type)}"></i>
                <span>${escapeHtml(message)}</span>
            </div>
        `;

        document.body.appendChild(notification);

        // Mostrar notificación
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);

        // Ocultar después de 3 segundos
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    }

    getNotificationIcon(type) {
        const icons = {
            'success': 'check-circle',
            'error': 'exclamation-circle',
            'warning': 'exclamation-triangle',
            'info': 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    // Métodos de compatibilidad para el módulo de autenticación
    showAuthModal() {
        if (this.auth) {
            this.auth.showAuthModal();
        }
    }

    toggleNavMenu() {
        if (this.auth) {
            this.auth.toggleNavMenu();
        }
    }
}

// Inicializar aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    window.deseoApp = new DeseoApp();
    window.app = window.deseoApp; // Alias para compatibilidad
});

// Exportar para uso global
window.DeseoApp = DeseoApp;