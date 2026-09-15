/**
 * Módulo de Manejo de Deseos
 * Gestiona la creación, edición y visualización de deseos
 */

class DeseoWishes {
    constructor() {
        this.wishes = [];
        this.currentLocation = null;
    }

    async loadWishes() {
        try {
            // Intentar cargar desde Firebase primero
            if (CONFIG.FIREBASE.enabled && window.firebaseDB) {
                await this.loadWishesFromFirebase();
            } else {
                // Cargar desde localStorage
                this.loadLocalWishes();
            }
        } catch (error) {
            console.error('Error loading wishes:', error);
            // Fallback a deseos de ejemplo
            this.generateSampleWishes();
        }
    }

    async loadWishesFromFirebase() {
        try {
            const querySnapshot = await window.firebaseFunctions.getDocs(
                window.firebaseFunctions.collection(window.firebaseDB, window.firebaseCollections.wishes)
            );
            
            this.wishes = [];
            querySnapshot.forEach((doc) => {
                const wishData = doc.data();
                wishData.id = doc.id;
                this.wishes.push(wishData);
            });
            
            console.log(`Loaded ${this.wishes.length} wishes from Firebase`);
        } catch (error) {
            console.error('Error loading wishes from Firebase:', error);
            throw error;
        }
    }

    loadLocalWishes() {
        try {
            const saved = localStorage.getItem('deseo_wishes');
            if (saved) {
                this.wishes = JSON.parse(saved);
                console.log(`Loaded ${this.wishes.length} wishes from localStorage`);
            } else {
                this.generateSampleWishes();
            }
        } catch (error) {
            console.error('Error loading local wishes:', error);
            this.generateSampleWishes();
        }
    }

    generateSampleWishes() {
        this.wishes = [
            {
                id: 'wish_1',
                title: 'Aprender a tocar guitarra',
                description: 'Quiero aprender a tocar guitarra clásica y poder interpretar mis canciones favoritas.',
                category: 'música',
                price: 30,
                location: { lat: 4.6097, lng: -74.0817 },
                address: 'Bogotá, Colombia',
                author: 'Usuario Ejemplo',
                createdAt: new Date().toISOString(),
                status: 'active'
            },
            {
                id: 'wish_2',
                title: 'Visitar el Museo del Oro',
                description: 'Me gustaría conocer la colección de arte precolombino más importante del país.',
                category: 'cultura',
                price: 15,
                location: { lat: 4.6019, lng: -74.0719 },
                address: 'Museo del Oro, Bogotá',
                author: 'Usuario Ejemplo',
                createdAt: new Date().toISOString(),
                status: 'active'
            },
            {
                id: 'wish_3',
                title: 'Comer arepas de choclo',
                description: 'Quiero probar las mejores arepas de choclo de la ciudad.',
                category: 'comida',
                price: 8,
                location: { lat: 4.6119, lng: -74.0767 },
                address: 'Plaza de Bolívar, Bogotá',
                author: 'Usuario Ejemplo',
                createdAt: new Date().toISOString(),
                status: 'active'
            }
        ];
        
        this.saveLocalWishes();
        console.log('Generated sample wishes');
    }

    saveLocalWishes() {
        try {
            localStorage.setItem('deseo_wishes', JSON.stringify(this.wishes));
        } catch (error) {
            console.error('Error saving local wishes:', error);
        }
    }

    async saveWishToFirebase(wishData) {
        try {
            if (!CONFIG.FIREBASE.enabled || !window.firebaseDB) {
                throw new Error('Firebase not available');
            }

            const docRef = await window.firebaseFunctions.addDoc(
                window.firebaseFunctions.collection(window.firebaseDB, window.firebaseCollections.wishes),
                wishData
            );
            
            console.log('Wish saved to Firebase with ID:', docRef.id);
            return docRef.id;
        } catch (error) {
            console.error('Error saving wish to Firebase:', error);
            throw error;
        }
    }

    async publishWish(wishData) {
        try {
            // Agregar metadatos
            const completeWishData = {
                ...wishData,
                id: 'wish_' + Date.now(),
                author: this.getCurrentUser()?.displayName || 'Usuario Anónimo',
                createdAt: new Date().toISOString(),
                status: 'active'
            };

            // Intentar guardar en Firebase
            if (CONFIG.FIREBASE.enabled && window.firebaseDB) {
                try {
                    const firebaseId = await this.saveWishToFirebase(completeWishData);
                    completeWishData.firebaseId = firebaseId;
                } catch (firebaseError) {
                    console.warn('Firebase save failed, using local storage:', firebaseError);
                }
            }

            // Guardar localmente como respaldo
            this.wishes.push(completeWishData);
            this.saveLocalWishes();

            // Agregar al mapa
            this.addWishToMap(completeWishData);

            return completeWishData;
        } catch (error) {
            console.error('Error publishing wish:', error);
            throw error;
        }
    }

    addWishToMap(wish) {
        if (window.deseoApp && window.deseoApp.map) {
            const marker = new window.mapboxgl.Marker({
                color: this.getCategoryColor(wish.category)
            })
            .setLngLat([wish.location.lng, wish.location.lat])
            .setPopup(
                new window.mapboxgl.Popup({ offset: 25 })
                .setHTML(`
                    <div class="wish-popup">
                        <h3>${wish.title}</h3>
                        <p>${wish.description}</p>
                        <div class="wish-details">
                            <span class="category">${wish.category}</span>
                            <span class="price">$${wish.price}</span>
                        </div>
                        <div class="wish-address">${wish.address}</div>
                    </div>
                `)
            )
            .addTo(window.deseoApp.map);

            // Guardar referencia del marcador
            wish.marker = marker;
        }
    }

    getCategoryColor(category) {
        const colors = {
            'música': '#1d9bf0',
            'cultura': '#00ba7c',
            'comida': '#f91880',
            'deportes': '#ffd400',
            'tecnología': '#6366f1',
            'viajes': '#f59e0b',
            'arte': '#8b5cf6',
            'educación': '#06b6d4',
            'salud': '#ef4444',
            'entretenimiento': '#ec4899'
        };
        return colors[category] || '#6b7280';
    }

    getCurrentUser() {
        if (window.deseoAuth && window.deseoAuth.currentUser) {
            return window.deseoAuth.currentUser;
        }
        return null;
    }

    showWishPreview(wishData) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2><i class="fas fa-star"></i> Vista Previa del Deseo</h2>
                    <button class="close-btn" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="wish-preview">
                        <h3>${escapeHtml(wishData.title)}</h3>
                        <p class="wish-description">${escapeHtml(wishData.description)}</p>
                        <div class="wish-details">
                            <div class="detail-item">
                                <i class="fas fa-tag"></i>
                                <span>Categoría: ${escapeHtml(wishData.category)}</span>
                            </div>
                            <div class="detail-item">
                                <i class="fas fa-dollar-sign"></i>
                                <span>Precio: $${escapeInt(wishData.price, '')}</span>
                            </div>
                            <div class="detail-item">
                                <i class="fas fa-map-marker-alt"></i>
                                <span>${escapeHtml(wishData.address)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn-secondary" onclick="this.closest('.modal').remove()">
                            Cancelar
                        </button>
                        <button class="btn-primary" onclick="deseoWishes.createWishFromPreview(this.closest('.modal'))">
                            <i class="fas fa-plus"></i>
                            Crear Deseo
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    }

    async createWishFromPreview(modal) {
        try {
            const title = modal.querySelector('h3').textContent;
            const description = modal.querySelector('.wish-description').textContent;
            const category = modal.querySelector('.detail-item:nth-child(1) span').textContent.replace('Categoría: ', '');
            const price = parseInt(modal.querySelector('.detail-item:nth-child(2) span').textContent.replace('Precio: $', ''));
            const address = modal.querySelector('.detail-item:nth-child(3) span').textContent;

            const wishData = {
                title,
                description,
                category,
                price,
                address,
                location: this.currentLocation || { lat: 4.6097, lng: -74.0817 }
            };

            await this.publishWish(wishData);
            
            modal.remove();
            
            if (window.deseoApp && window.deseoApp.showNotification) {
                window.deseoApp.showNotification('¡Deseo creado exitosamente!', 'success');
            }
        } catch (error) {
            console.error('Error creating wish from preview:', error);
            if (window.deseoApp && window.deseoApp.showNotification) {
                window.deseoApp.showNotification('Error al crear el deseo', 'error');
            }
        }
    }

    async getUserLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const location = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    this.currentLocation = location;
                    resolve(location);
                },
                (error) => {
                    console.error('Error getting location:', error);
                    // Usar ubicación por defecto (Bogotá)
                    const defaultLocation = { lat: 4.6097, lng: -74.0817 };
                    this.currentLocation = defaultLocation;
                    resolve(defaultLocation);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 300000
                }
            );
        });
    }

    filterWishesByCategory(category) {
        if (!category || category === 'all') {
            return this.wishes;
        }
        return this.wishes.filter(wish => wish.category === category);
    }

    filterWishesByPriceRange(minPrice, maxPrice) {
        return this.wishes.filter(wish => 
            wish.price >= minPrice && wish.price <= maxPrice
        );
    }

    searchWishes(query) {
        if (!query) return this.wishes;
        
        const lowercaseQuery = query.toLowerCase();
        return this.wishes.filter(wish => 
            wish.title.toLowerCase().includes(lowercaseQuery) ||
            wish.description.toLowerCase().includes(lowercaseQuery) ||
            wish.category.toLowerCase().includes(lowercaseQuery)
        );
    }

    getWishById(id) {
        return this.wishes.find(wish => wish.id === id);
    }

    updateWish(id, updates) {
        const index = this.wishes.findIndex(wish => wish.id === id);
        if (index !== -1) {
            this.wishes[index] = { ...this.wishes[index], ...updates };
            this.saveLocalWishes();
            return this.wishes[index];
        }
        return null;
    }

    deleteWish(id) {
        const index = this.wishes.findIndex(wish => wish.id === id);
        if (index !== -1) {
            const wish = this.wishes[index];
            
            // Remover marcador del mapa
            if (wish.marker) {
                wish.marker.remove();
            }
            
            // Remover de la lista
            this.wishes.splice(index, 1);
            this.saveLocalWishes();
            
            return true;
        }
        return false;
    }

    getCategories() {
        const categories = [...new Set(this.wishes.map(wish => wish.category))];
        return categories.sort();
    }

    getStats() {
        return {
            total: this.wishes.length,
            categories: this.getCategories().length,
            averagePrice: this.wishes.length > 0 ? 
                Math.round(this.wishes.reduce((sum, wish) => sum + wish.price, 0) / this.wishes.length) : 0,
            mostPopularCategory: this.getMostPopularCategory()
        };
    }

    getMostPopularCategory() {
        const categoryCount = {};
        this.wishes.forEach(wish => {
            categoryCount[wish.category] = (categoryCount[wish.category] || 0) + 1;
        });
        
        return Object.keys(categoryCount).reduce((a, b) => 
            categoryCount[a] > categoryCount[b] ? a : b, 'N/A'
        );
    }
}

// Exportar para uso global
window.DeseoWishes = DeseoWishes;