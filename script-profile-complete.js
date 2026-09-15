// ===== SISTEMA DE COMPLETAR PERFIL =====
class ProfileCompleteManager {
    constructor() {
        this.photos = [];
        this.selectedPoses = [];
        this.profileData = {};
        this.firebase = null;
        this.database = null;
        
        // Lista de poses sexuales reales
        this.sexualPoses = [
            {
                id: 'missionary',
                name: 'Misionero',
                description: 'Posición clásica cara a cara'
            },
            {
                id: 'cowgirl',
                name: 'Vaquera',
                description: 'La mujer arriba, controlando el ritmo'
            },
            {
                id: 'doggy',
                name: 'Perrito',
                description: 'Penetración desde atrás'
            },
            {
                id: 'spooning',
                name: 'Cucharita',
                description: 'Ambos de lado, penetración suave'
            },
            {
                id: 'reverse_cowgirl',
                name: 'Vaquera Inversa',
                description: 'Mujer arriba, de espaldas'
            },
            {
                id: 'standing',
                name: 'De Pie',
                description: 'Penetración de pie, más intensa'
            },
            {
                id: 'lotus',
                name: 'Loto',
                description: 'Sentados cara a cara, muy íntima'
            },
            {
                id: 'scissors',
                name: 'Tijeras',
                description: 'Piernas entrelazadas, penetración lateral'
            },
            {
                id: 'butterfly',
                name: 'Mariposa',
                description: 'Mujer con piernas elevadas'
            },
            {
                id: 'reverse_spooning',
                name: 'Cucharita Inversa',
                description: 'Hombre detrás, ambos de lado'
            },
            {
                id: 'crab',
                name: 'Cangrejo',
                description: 'Mujer en posición de puente'
            },
            {
                id: 'wheelbarrow',
                name: 'Carretilla',
                description: 'Mujer en posición de plancha'
            },
            {
                id: 'pretzel',
                name: 'Pretzel',
                description: 'Piernas entrelazadas en posición lateral'
            },
            {
                id: 'yab_yum',
                name: 'Yab Yum',
                description: 'Sentados en posición de meditación'
            },
            {
                id: 'bridge',
                name: 'Puente',
                description: 'Mujer en posición de puente, penetración desde abajo'
            },
            {
                id: 'spread_eagle',
                name: 'Águila Extendida',
                description: 'Mujer boca arriba con piernas abiertas'
            },
            {
                id: 'reverse_spread',
                name: 'Águila Inversa',
                description: 'Mujer boca abajo con piernas abiertas'
            },
            {
                id: 'side_by_side',
                name: 'Lado a Lado',
                description: 'Ambos de lado, penetración lateral'
            },
            {
                id: 'kneeling',
                name: 'Arrodillados',
                description: 'Ambos arrodillados, penetración desde atrás'
            },
            {
                id: 'lotus_standing',
                name: 'Loto de Pie',
                description: 'Abrazo de pie con penetración'
            }
        ];
        
        this.init();
    }
    
    async init() {
        console.log('🔥 Inicializando ProfileCompleteManager...');
        
        // Inicializar Firebase
        await this.initializeFirebase();
        
        // Cargar poses sexuales
        this.loadSexualPoses();
        
        // Configurar eventos
        this.setupEventListeners();
        
        // Cargar borrador si existe
        this.loadDraft();
        
        // Actualizar progreso
        this.updateProgress();
        
        console.log('✅ ProfileCompleteManager inicializado');
    }
    
    async initializeFirebase() {
        try {
            if (typeof firebase === 'undefined' || typeof window.CONFIG === 'undefined' || !window.CONFIG.FIREBASE) {
                console.warn('⚠️ Firebase SDK o config no disponible');
                return;
            }
            
            this.firebase = firebase.initializeApp(window.CONFIG.FIREBASE.config);
            this.database = firebase.database();
            console.log('✅ Firebase inicializado para completar perfil');
        } catch (error) {
            console.error('❌ Error inicializando Firebase:', error);
        }
    }
    
    loadSexualPoses() {
        const posesGrid = document.getElementById('posesGrid');
        if (!posesGrid) return;
        
        posesGrid.innerHTML = '';
        
        this.sexualPoses.forEach(pose => {
            const poseItem = document.createElement('div');
            poseItem.className = 'pose-item';
            poseItem.innerHTML = `
                <input type="checkbox" id="pose_${pose.id}" value="${pose.id}" class="pose-checkbox">
                <div class="pose-name">${escapeHtml(pose.name)}</div>
                <div class="pose-description">${escapeHtml(pose.description)}</div>
            `;
            
            posesGrid.appendChild(poseItem);
        });
    }
    
    setupEventListeners() {
        // Formulario principal
        const profileForm = document.getElementById('profileForm');
        if (profileForm) {
            profileForm.addEventListener('submit', (e) => this.handleSubmit(e));
        }
        
        // Botón guardar borrador
        const saveDraftBtn = document.getElementById('saveDraftBtn');
        if (saveDraftBtn) {
            saveDraftBtn.addEventListener('click', () => this.saveDraft());
        }
        
        // Inputs del formulario
        const inputs = document.querySelectorAll('#profileForm input, #profileForm textarea');
        inputs.forEach(input => {
            input.addEventListener('input', () => this.updateProgress());
        });
        
        // Fotos
        this.setupPhotoUpload();
        
        // Poses
        this.setupPosesSelection();
    }
    
    setupPhotoUpload() {
        const photoGrid = document.getElementById('photoGrid');
        if (!photoGrid) return;
        
        // Agregar más slots de fotos dinámicamente
        for (let i = 1; i < 6; i++) {
            const photoItem = document.createElement('div');
            photoItem.className = 'photo-upload-item';
            photoItem.setAttribute('data-index', i);
            photoItem.innerHTML = `
                <input type="file" class="photo-input" accept="image/*" data-index="${i}">
                <div class="photo-placeholder">
                    <i class="fas fa-plus"></i>
                    <span>Agregar foto</span>
                </div>
                <div class="photo-preview" style="display: none;">
                    <img src="" alt="Preview">
                    <button type="button" class="remove-photo">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
            photoGrid.appendChild(photoItem);
        }
        
        // Event listeners para fotos
        photoGrid.addEventListener('change', (e) => {
            if (e.target.classList.contains('photo-input')) {
                this.handlePhotoUpload(e.target);
            }
        });
        
        photoGrid.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-photo') || e.target.closest('.remove-photo')) {
                this.removePhoto(e.target.closest('.photo-upload-item'));
            }
        });
    }
    
    setupPosesSelection() {
        const posesGrid = document.getElementById('posesGrid');
        if (!posesGrid) return;
        
        posesGrid.addEventListener('change', (e) => {
            if (e.target.classList.contains('pose-checkbox')) {
                this.updatePosesSelection();
                this.updateProgress();
            }
        });
        
        // Hacer clickeable toda la tarjeta
        posesGrid.addEventListener('click', (e) => {
            const poseItem = e.target.closest('.pose-item');
            if (poseItem && !e.target.classList.contains('pose-checkbox')) {
                const checkbox = poseItem.querySelector('.pose-checkbox');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    this.updatePosesSelection();
                    this.updateProgress();
                }
            }
        });
    }
    
    async handlePhotoUpload(input) {
        const file = input.files[0];
        if (!file) return;
        
        // Validar tipo de archivo
        if (!file.type.startsWith('image/')) {
            this.showNotification('Solo se permiten archivos de imagen', 'error');
            return;
        }
        
        // Validar tamaño (máximo 5MB)
        if (file.size > 5 * 1024 * 1024) {
            this.showNotification('La imagen debe ser menor a 5MB', 'error');
            return;
        }
        
        try {
            // Convertir a base64
            const base64 = await this.fileToBase64(file);
            
            // Guardar en el array de fotos
            const index = parseInt(input.dataset.index);
            this.photos[index] = {
                file: file,
                base64: base64,
                name: file.name,
                size: file.size,
                type: file.type
            };
            
            // Mostrar preview
            this.showPhotoPreview(input, base64);
            
            this.showNotification('Foto agregada correctamente', 'success');
            this.updateProgress();
            
        } catch (error) {
            console.error('Error procesando foto:', error);
            this.showNotification('Error al procesar la foto', 'error');
        }
    }
    
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
    
    showPhotoPreview(input, base64) {
        const photoItem = input.closest('.photo-upload-item');
        const placeholder = photoItem.querySelector('.photo-placeholder');
        const preview = photoItem.querySelector('.photo-preview');
        const img = preview.querySelector('img');
        
        img.src = base64;
        placeholder.style.display = 'none';
        preview.style.display = 'block';
    }
    
    removePhoto(photoItem) {
        const index = parseInt(photoItem.dataset.index);
        const placeholder = photoItem.querySelector('.photo-placeholder');
        const preview = photoItem.querySelector('.photo-preview');
        const input = photoItem.querySelector('.photo-input');
        
        // Limpiar datos
        delete this.photos[index];
        input.value = '';
        
        // Mostrar placeholder
        placeholder.style.display = 'flex';
        preview.style.display = 'none';
        
        this.updateProgress();
    }
    
    updatePosesSelection() {
        const checkboxes = document.querySelectorAll('.pose-checkbox');
        this.selectedPoses = [];
        
        checkboxes.forEach(checkbox => {
            const poseItem = checkbox.closest('.pose-item');
            if (checkbox.checked) {
                this.selectedPoses.push(checkbox.value);
                poseItem.classList.add('selected');
            } else {
                poseItem.classList.remove('selected');
            }
        });
    }
    
    updateProgress() {
        let completed = 0;
        let total = 0;
        
        // Información básica
        const nickname = document.getElementById('nickname').value.trim();
        const description = document.getElementById('description').value.trim();
        const age = document.getElementById('age').value.trim();
        
        total += 3;
        if (nickname) completed++;
        if (description) completed++;
        if (age) completed++;
        
        // Fotos (mínimo 3)
        const photoCount = Object.keys(this.photos).length;
        total += 1;
        if (photoCount >= 3) completed++;
        
        // Poses (mínimo 1)
        total += 1;
        if (this.selectedPoses.length >= 1) completed++;
        
        const percentage = Math.round((completed / total) * 100);
        
        // Actualizar UI
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const completeBtn = document.getElementById('completeProfileBtn');
        
        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }
        
        if (progressText) {
            progressText.textContent = `${percentage}% completado`;
        }
        
        if (completeBtn) {
            completeBtn.disabled = percentage < 100;
        }
    }
    
    async handleSubmit(e) {
        e.preventDefault();
        
        if (!this.validateForm()) {
            return;
        }
        
        this.showLoading(true);
        
        try {
            // Recopilar datos del formulario
            const formData = new FormData(e.target);
            const profileData = {
                nickname: formData.get('nickname'),
                description: formData.get('description'),
                age: parseInt(formData.get('age')),
                photos: this.photos,
                sexualPoses: this.selectedPoses,
                completedAt: new Date().toISOString(),
                isComplete: true
            };
            
            // Guardar en Firebase
            await this.saveProfileToFirebase(profileData);
            
            // Limpiar borrador
            this.clearDraft();
            
            this.showNotification('¡Perfil completado exitosamente!', 'success');
            
            // Redirigir después de 2 segundos
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 2000);
            
        } catch (error) {
            console.error('Error completando perfil:', error);
            this.showNotification('Error al completar el perfil', 'error');
        } finally {
            this.showLoading(false);
        }
    }
    
    validateForm() {
        const nickname = document.getElementById('nickname').value.trim();
        const description = document.getElementById('description').value.trim();
        const age = document.getElementById('age').value.trim();
        
        if (!nickname) {
            this.showNotification('El apodo es requerido', 'error');
            return false;
        }
        
        if (!description) {
            this.showNotification('La descripción es requerida', 'error');
            return false;
        }
        
        if (!age || age < 18) {
            this.showNotification('La edad debe ser mayor a 18 años', 'error');
            return false;
        }
        
        if (Object.keys(this.photos).length < 3) {
            this.showNotification('Debes subir al menos 3 fotos', 'error');
            return false;
        }
        
        if (this.selectedPoses.length < 1) {
            this.showNotification('Debes seleccionar al menos una pose sexual', 'error');
            return false;
        }
        
        return true;
    }
    
    async saveProfileToFirebase(profileData) {
        try {
            if (!this.database) {
                throw new Error('Firebase no disponible');
            }
            
            // Obtener usuario actual - múltiples métodos de detección
            let currentUser = null;
            
            console.log('🔍 Debug - Verificando autenticación en profile-complete.html...');
            
            // Método 1: Intentar obtener de window.deseoApp (si viene del index)
            if (window.deseoApp && window.deseoApp.currentUser) {
                currentUser = window.deseoApp.currentUser;
                console.log('✅ Usuario obtenido del sistema principal:', currentUser);
            }
            // Método 2: Intentar obtener de Clerk directamente
            else if (window.Clerk && window.Clerk.user) {
                const clerkUser = window.Clerk.user;
                currentUser = {
                    id: clerkUser.id,
                    name: clerkUser.fullName || clerkUser.firstName || 'Usuario',
                    email: clerkUser.primaryEmailAddress?.emailAddress || '',
                    profileImageUrl: clerkUser.imageUrl || 'https://www.gravatar.com/avatar/?d=mp&f=y'
                };
                console.log('✅ Usuario obtenido de Clerk:', currentUser);
            }
            // Método 3: Intentar obtener de localStorage
            else {
                console.log('⚠️ Intentando localStorage...');
                const user = JSON.parse(localStorage.getItem('deseo_user') || '{}');
                console.log('🔍 Debug - Usuario de localStorage:', user);
                
                if (user.uid || user.id) {
                    currentUser = user;
                    console.log('✅ Usuario obtenido de localStorage:', currentUser);
                } else {
                    console.log('⚠️ No se encontró usuario en localStorage');
                }
            }
            
            // Método 4: Verificar si hay datos de autenticación en sessionStorage
            if (!currentUser) {
                const sessionUser = JSON.parse(sessionStorage.getItem('deseo_user') || '{}');
                if (sessionUser.uid || sessionUser.id) {
                    currentUser = sessionUser;
                    console.log('✅ Usuario obtenido de sessionStorage:', currentUser);
                }
            }
            
            // No crear usuarios temporales - requerir autenticación real
            
            if (!currentUser || (!currentUser.id && !currentUser.uid)) {
                throw new Error('Usuario no autenticado. Por favor, inicia sesión primero.');
            }
            
            // Usar el ID del usuario para guardar en Firebase
            const userId = currentUser.id || currentUser.uid;
            
            // Guardar perfil completo
            const userRef = this.database.ref(`users/${userId}`);
            await userRef.update({
                profile: profileData,
                profileComplete: true,
                lastUpdated: new Date().toISOString(),
                userInfo: {
                    name: currentUser.name,
                    email: currentUser.email,
                    profileImageUrl: currentUser.profileImageUrl
                }
            });
            
            console.log('✅ Perfil guardado en Firebase Realtime Database para usuario:', userId);
            
        } catch (error) {
            console.error('❌ Error guardando perfil:', error);
            throw error;
        }
    }
    
    saveDraft() {
        const formData = {
            nickname: document.getElementById('nickname').value,
            description: document.getElementById('description').value,
            age: document.getElementById('age').value,
            photos: this.photos,
            sexualPoses: this.selectedPoses,
            savedAt: new Date().toISOString()
        };
        
        localStorage.setItem('profile_draft', JSON.stringify(formData));
        this.showNotification('Borrador guardado', 'success');
    }
    
    loadDraft() {
        try {
            const draft = localStorage.getItem('profile_draft');
            if (draft) {
                const data = JSON.parse(draft);
                
                // Cargar datos del formulario
                if (data.nickname) document.getElementById('nickname').value = data.nickname;
                if (data.description) document.getElementById('description').value = data.description;
                if (data.age) document.getElementById('age').value = data.age;
                
                // Cargar fotos
                if (data.photos) {
                    this.photos = data.photos;
                    this.loadPhotoPreviews();
                }
                
                // Cargar poses
                if (data.sexualPoses) {
                    this.selectedPoses = data.sexualPoses;
                    this.updatePosesSelection();
                }
                
                this.showNotification('Borrador cargado', 'success');
            }
        } catch (error) {
            console.error('Error cargando borrador:', error);
        }
    }
    
    loadPhotoPreviews() {
        Object.keys(this.photos).forEach(index => {
            const photo = this.photos[index];
            const photoItem = document.querySelector(`[data-index="${index}"]`);
            if (photoItem) {
                const input = photoItem.querySelector('.photo-input');
                this.showPhotoPreview(input, photo.base64);
            }
        });
    }
    
    clearDraft() {
        localStorage.removeItem('profile_draft');
    }
    
    showLoading(show) {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.style.display = show ? 'flex' : 'none';
        }
    }
    
    showNotification(message, type = 'info') {
        const container = document.getElementById('notificationContainer');
        if (!container) return;
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icon = type === 'success' ? 'check-circle' : 
                    type === 'error' ? 'exclamation-circle' : 
                    type === 'warning' ? 'exclamation-triangle' : 'info-circle';
        
        notification.innerHTML = `
            <i class="fas fa-${icon}"></i>
            <span>${escapeHtml(message)}</span>
        `;
        
        container.appendChild(notification);
        
        // Remover después de 5 segundos
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    console.log('🔥 Iniciando ProfileCompleteManager...');
    window.profileCompleteManager = new ProfileCompleteManager();
});