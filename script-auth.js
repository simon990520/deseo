// ===== SISTEMA DE AUTENTICACIÓN =====
class AuthManager {
    constructor() {
        this.currentUser = null;
        this.isAuthenticated = false;
        this.init();
    }

    async init() {
        // Verificar si Firebase está disponible
        if (window.firebaseAuth && CONFIG.FIREBASE.enabled) {
            try {
                // Escuchar cambios en el estado de autenticación
                window.firebaseFunctions.onAuthStateChanged(window.firebaseAuth, (user) => {
                    if (user) {
                        this.handleUserLogin(user);
                    } else {
                        this.handleUserLogout();
                    }
                });
            } catch (error) {
                console.warn('Firebase Auth error, falling back to local auth:', error);
                this.loadLocalUser();
            }
        } else {
            console.log('Using local authentication system');
            this.loadLocalUser();
        }
    }

    async handleUserLogin(user) {
        this.currentUser = user;
        this.isAuthenticated = true;
        
        // Cargar datos adicionales del usuario desde Firestore
        await this.loadUserProfile(user.uid);
        
        // Actualizar UI
        this.updateUIForAuthenticatedUser();
        
        // Ocultar botón de login
        const authButton = document.getElementById('authButton');
        if (authButton) {
            authButton.style.display = 'none';
        }
        
        console.log('User logged in:', user.email);
        
        // Forzar actualización del estado de autenticación
        this.forceAuthStateUpdate();
    }

    forceAuthStateUpdate() {
        console.log('🔄 Forzando actualización del estado de autenticación...');
        
        // Disparar evento personalizado para notificar a otros componentes
        const authEvent = new CustomEvent('authStateChanged', {
            detail: { user: this.currentUser, isAuthenticated: this.isAuthenticated }
        });
        window.dispatchEvent(authEvent);
        
        // Actualizar elementos que dependen de la autenticación
        this.updateAuthDependentElements();
    }

    updateAuthDependentElements() {
        // Actualizar elementos que cambian según el estado de autenticación
        const elements = document.querySelectorAll('[data-auth-required]');
        elements.forEach(el => {
            if (this.isAuthenticated) {
                el.style.display = el.dataset.authRequired === 'true' ? 'block' : 'none';
            } else {
                el.style.display = el.dataset.authRequired === 'true' ? 'none' : 'block';
            }
        });
        
        // Actualizar botones de acción que requieren autenticación
        const actionButtons = document.querySelectorAll('[data-requires-auth]');
        actionButtons.forEach(btn => {
            if (this.isAuthenticated) {
                btn.disabled = false;
                btn.style.opacity = '1';
            } else {
                btn.disabled = true;
                btn.style.opacity = '0.5';
            }
        });
    }

    handleUserLogout() {
        this.currentUser = null;
        this.isAuthenticated = false;
        
        // Actualizar UI
        this.updateUIForUnauthenticatedUser();
        
        // Mostrar botón de login
        const authButton = document.getElementById('authButton');
        if (authButton) {
            authButton.style.display = 'block';
        }
        
        console.log('User logged out');
    }

    async loadUserProfile(uid) {
        try {
            if (!window.firebaseDB || !CONFIG.FIREBASE.enabled) {
                return;
            }

            const userDoc = await window.firebaseFunctions.getDocs(
                window.firebaseFunctions.collection(window.firebaseDB, window.firebaseCollections.users)
            );
            
            const userData = userDoc.docs.find(doc => doc.data().uid === uid);
            if (userData) {
                this.currentUser.profile = userData.data();
            }
        } catch (error) {
            console.error('Error loading user profile:', error);
        }
    }

    loadLocalUser() {
        const localUser = localStorage.getItem('deseo_user');
        if (localUser) {
            this.currentUser = JSON.parse(localUser);
            this.isAuthenticated = true;
            this.updateUIForAuthenticatedUser();
            
            const authButton = document.getElementById('authButton');
            if (authButton) {
                authButton.style.display = 'none';
            }
        }
    }

    updateUIForAuthenticatedUser() {
        // Actualizar información del usuario en la navegación
        const userName = document.getElementById('userName');
        const userEmail = document.getElementById('userEmail');
        const userAvatar = document.getElementById('userAvatar');
        
        if (userName && userEmail && userAvatar) {
            const displayName = this.currentUser.displayName || 
                               this.currentUser.profile?.fullName || 
                               this.currentUser.email?.split('@')[0];
            
            userName.textContent = displayName;
            userEmail.textContent = this.currentUser.email;
            
            // Actualizar avatar si hay foto
            if (this.currentUser.profile?.photoURL) {
                userAvatar.innerHTML = `<img src="${safeUrl(this.currentUser.profile.photoURL)}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
            }
        }
    }

    updateUIForUnauthenticatedUser() {
        const userName = document.getElementById('userName');
        const userEmail = document.getElementById('userEmail');
        const userAvatar = document.getElementById('userAvatar');
        
        if (userName && userEmail && userAvatar) {
            userName.textContent = 'Usuario';
            userEmail.textContent = 'usuario@email.com';
            userAvatar.innerHTML = '<i class="fas fa-user"></i>';
        }
    }

    // ===== MÉTODOS DE AUTENTICACIÓN =====
    async signInWithEmail(email, password) {
        try {
            if (!window.firebaseAuth || !CONFIG.FIREBASE.enabled) {
                // Autenticación local
                return this.signInWithEmailLocal(email, password);
            }

            const userCredential = await window.firebaseFunctions.signInWithEmailAndPassword(
                window.firebaseAuth, email, password
            );
            
            return userCredential.user;
        } catch (error) {
            console.error('Error signing in:', error);
            throw error;
        }
    }

    async signInWithEmailLocal(email, password) {
        // Simular autenticación local
        const users = JSON.parse(localStorage.getItem('deseo_users') || '[]');
        // Verificar con hash (soporta migración de contraseñas en texto plano)
        let user = null;
        for (const u of users) {
            if (u.email !== email) continue;
            const ok = (typeof verifyPassword === 'function')
                ? await verifyPassword(password, u.password)
                : (u.password === password);
            if (ok) {
                user = u;
                if (typeof isHashed === 'function' && !isHashed(u.password) && typeof hashPassword === 'function') {
                    u.password = await hashPassword(password);
                    localStorage.setItem('deseo_users', JSON.stringify(users));
                }
                break;
            }
        }
        
        if (!user) {
            throw new Error('Credenciales incorrectas');
        }
        
        // Crear objeto de usuario compatible con Firebase
        const firebaseUser = {
            uid: user.uid,
            email: user.email,
            displayName: user.fullName,
            profile: user
        };
        
        // Guardar sesión actual
        localStorage.setItem('deseo_user', JSON.stringify(firebaseUser));
        
        return firebaseUser;
    }

    async signUpWithEmail(email, password, userData) {
        try {
            if (!window.firebaseAuth || !CONFIG.FIREBASE.enabled) {
                // Registro local
                return this.signUpWithEmailLocal(email, password, userData);
            }

            // Crear usuario
            const userCredential = await window.firebaseFunctions.createUserWithEmailAndPassword(
                window.firebaseAuth, email, password
            );

            // Subir foto si existe
            let photoURL = null;
            if (userData.photo) {
                photoURL = await this.uploadUserPhoto(userCredential.user.uid, userData.photo);
            }

            // Guardar datos adicionales del usuario
            const userProfile = {
                uid: userCredential.user.uid,
                email: userCredential.user.email,
                fullName: userData.fullName,
                address: userData.address,
                gender: userData.gender,
                photoURL: photoURL,
                createdAt: new Date().toISOString()
            };

            await this.saveUserProfile(userProfile);
            
            return userCredential.user;
        } catch (error) {
            console.error('Error signing up:', error);
            throw error;
        }
    }

    async signUpWithEmailLocal(email, password, userData) {
        // Verificar si el usuario ya existe
        const users = JSON.parse(localStorage.getItem('deseo_users') || '[]');
        const existingUser = users.find(u => u.email === email);
        
        if (existingUser) {
            throw new Error('El usuario ya existe');
        }
        
        // Procesar foto si existe
        let photoURL = null;
        if (userData.photo) {
            photoURL = await this.processLocalPhoto(userData.photo);
        }
        
        // Crear nuevo usuario
        const newUser = {
            uid: Date.now().toString(),
            email: email,
            password: (typeof hashPassword === 'function') ? await hashPassword(password) : password,
            fullName: userData.fullName,
            address: userData.address,
            gender: userData.gender,
            photoURL: photoURL,
            createdAt: new Date().toISOString()
        };
        
        // Guardar usuario
        users.push(newUser);
        localStorage.setItem('deseo_users', JSON.stringify(users));
        
        // Crear objeto de usuario compatible con Firebase
        const firebaseUser = {
            uid: newUser.uid,
            email: newUser.email,
            displayName: newUser.fullName,
            profile: newUser
        };
        
        // Guardar sesión actual
        localStorage.setItem('deseo_user', JSON.stringify(firebaseUser));
        
        return firebaseUser;
    }

    async processLocalPhoto(photoFile) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                resolve(e.target.result);
            };
            reader.readAsDataURL(photoFile);
        });
    }

    async signInWithGoogleLocal() {
        // Simular Google Sign-In con datos predefinidos para facilitar testing
        const googleAccounts = [
            {
                email: 'usuario1@gmail.com',
                displayName: 'Usuario Google 1',
                photoURL: 'https://via.placeholder.com/150/1d9bf0/ffffff?text=U1'
            },
            {
                email: 'usuario2@gmail.com', 
                displayName: 'Usuario Google 2',
                photoURL: 'https://via.placeholder.com/150/00ba7c/ffffff?text=U2'
            },
            {
                email: 'usuario3@gmail.com',
                displayName: 'Usuario Google 3', 
                photoURL: 'https://via.placeholder.com/150/f91880/ffffff?text=U3'
            }
        ];

        // Mostrar selector de cuentas simuladas
        const selectedAccount = await this.showGoogleAccountSelector(googleAccounts);
        
        if (!selectedAccount) {
            return null; // Usuario canceló
        }

        const googleUser = {
            uid: 'google_' + Date.now(),
            email: selectedAccount.email,
            displayName: selectedAccount.displayName,
            photoURL: selectedAccount.photoURL,
            provider: 'google'
        };

        // Verificar si ya existe un usuario con este email
        const users = JSON.parse(localStorage.getItem('deseo_users') || '[]');
        let existingUser = users.find(u => u.email === googleUser.email);

        if (!existingUser) {
            // Crear nuevo usuario Google
            const newUser = {
                uid: googleUser.uid,
                email: googleUser.email,
                fullName: googleUser.displayName,
                photoURL: googleUser.photoURL,
                provider: 'google',
                createdAt: new Date().toISOString()
            };

            users.push(newUser);
            localStorage.setItem('deseo_users', JSON.stringify(users));
            googleUser.profile = newUser;
        } else {
            googleUser.profile = existingUser;
        }

        // Guardar sesión actual
        localStorage.setItem('deseo_user', JSON.stringify(googleUser));

        this.showNotification('¡Bienvenido con Google!', 'success');
        return googleUser;
    }

    async showGoogleAccountSelector(accounts) {
        return new Promise((resolve) => {
            // Crear modal de selector de cuentas
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h2><i class="fab fa-google"></i> Seleccionar Cuenta de Google</h2>
                        <button class="close-btn" onclick="this.closest('.modal').remove(); resolve(null);">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <p>Selecciona una cuenta para continuar:</p>
                        <div class="google-accounts">
                            ${accounts.map((account, index) => `
                                <div class="google-account" onclick="selectAccount(${index})">
                                    <img src="${account.photoURL}" alt="Avatar" class="account-avatar">
                                    <div class="account-info">
                                        <h4>${account.displayName}</h4>
                                        <p>${account.email}</p>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        <button class="btn-secondary" onclick="this.closest('.modal').remove(); resolve(null);">
                            Cancelar
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Función para seleccionar cuenta
            window.selectAccount = (index) => {
                modal.remove();
                resolve(accounts[index]);
            };
        });
    }

    async showGoogleSignInModal() {
        return new Promise((resolve) => {
            // Crear modal temporal para Google Sign-In
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h2><i class="fab fa-google"></i> Continuar con Google</h2>
                        <button class="close-btn" onclick="this.closest('.modal').remove(); resolve(null);">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <p>Ingresa tu información de Google:</p>
                        <form id="googleSignInForm">
                            <div class="form-group">
                                <label for="googleEmail">Correo de Google:</label>
                                <input type="email" id="googleEmail" placeholder="tu@gmail.com" required>
                            </div>
                            <div class="form-group">
                                <label for="googleName">Nombre completo:</label>
                                <input type="text" id="googleName" placeholder="Tu Nombre" required>
                            </div>
                            <div class="form-group">
                                <label for="googlePhoto">URL de foto (opcional):</label>
                                <input type="url" id="googlePhoto" placeholder="https://...">
                            </div>
                            <button type="submit" class="btn-primary">
                                <i class="fab fa-google"></i> Continuar con Google
                            </button>
                        </form>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Configurar formulario
            const form = document.getElementById('googleSignInForm');
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                
                const email = document.getElementById('googleEmail').value;
                const fullName = document.getElementById('googleName').value;
                const photoURL = document.getElementById('googlePhoto').value;

                modal.remove();
                resolve({ email, fullName, photoURL });
            });
        });
    }

    async signInWithGoogle() {
        try {
            if (!window.firebaseAuth || !CONFIG.FIREBASE.enabled) {
                // Usar Google Sign-In simulado local
                return this.signInWithGoogleLocal();
            }

            // Configurar el proveedor de Google
            const provider = new window.firebaseFunctions.GoogleAuthProvider();
            
            // Configurar parámetros adicionales
            provider.addScope('email');
            provider.addScope('profile');
            
            // Mostrar el selector de cuentas
            provider.setCustomParameters({
                prompt: 'select_account'
            });

            console.log('Iniciando Google Sign-In con Firebase...');
            
            // Mostrar indicador de carga
            this.showNotification('Abriendo selector de cuentas de Google...', 'info');

            const result = await window.firebaseFunctions.signInWithPopup(window.firebaseAuth, provider);

            console.log('Google Sign-In exitoso:', result.user);

            // Verificar si es un usuario nuevo
            if (result.additionalUserInfo.isNewUser) {
                console.log('Usuario nuevo detectado, guardando perfil...');
                
                // Guardar datos básicos del usuario
                const userProfile = {
                    uid: result.user.uid,
                    email: result.user.email,
                    fullName: result.user.displayName,
                    photoURL: result.user.photoURL,
                    provider: 'google',
                    createdAt: new Date().toISOString()
                };

                await this.saveUserProfile(userProfile);
                this.showNotification('¡Cuenta creada exitosamente!', 'success');
            } else {
                this.showNotification('¡Bienvenido de vuelta!', 'success');
            }

            return result.user;
        } catch (error) {
            console.error('Error signing in with Google:', error);
            
            // Manejar errores específicos
            if (error.code === 'auth/popup-closed-by-user') {
                this.showNotification('Inicio de sesión cancelado', 'info');
            } else if (error.code === 'auth/popup-blocked') {
                this.showNotification('Popup bloqueado. Por favor permite popups para este sitio.', 'error');
            } else if (error.code === 'auth/network-request-failed') {
                this.showNotification('Error de conexión. Verifica tu internet.', 'error');
            } else {
                this.showNotification('Error al iniciar sesión con Google: ' + error.message, 'error');
            }
            
            throw error;
        }
    }

    async logout() {
        try {
            if (window.firebaseAuth && CONFIG.FIREBASE.enabled) {
                await window.firebaseFunctions.signOut(window.firebaseAuth);
            } else {
                // Logout local
                localStorage.removeItem('deseo_user');
                this.handleUserLogout();
            }
        } catch (error) {
            console.error('Error logging out:', error);
        }
    }

    // ===== MÉTODOS AUXILIARES =====
    async uploadUserPhoto(uid, photoFile) {
        try {
            if (!window.firebaseStorage || !CONFIG.FIREBASE.enabled) {
                return null;
            }

            const storageRef = window.firebaseFunctions.ref(
                window.firebaseStorage, 
                `users/${uid}/profile.jpg`
            );
            
            const snapshot = await window.firebaseFunctions.uploadBytes(storageRef, photoFile);
            const downloadURL = await window.firebaseFunctions.getDownloadURL(snapshot.ref);
            
            return downloadURL;
        } catch (error) {
            console.error('Error uploading photo:', error);
            return null;
        }
    }

    async saveUserProfile(userProfile) {
        try {
            if (!window.firebaseDB || !CONFIG.FIREBASE.enabled) {
                // Guardar localmente
                localStorage.setItem('deseo_user', JSON.stringify({
                    uid: userProfile.uid,
                    email: userProfile.email,
                    displayName: userProfile.fullName,
                    profile: userProfile
                }));
                return;
            }

            await window.firebaseFunctions.addDoc(
                window.firebaseFunctions.collection(window.firebaseDB, window.firebaseCollections.users),
                userProfile
            );
        } catch (error) {
            console.error('Error saving user profile:', error);
        }
    }

    // ===== NAVEGACIÓN =====
    toggleNavMenu() {
        const navMenu = document.getElementById('navMenu');
        if (navMenu) {
            navMenu.classList.toggle('open');
        }
    }

    closeNavMenu() {
        const navMenu = document.getElementById('navMenu');
        if (navMenu) {
            navMenu.classList.remove('open');
        }
    }

    showAuthModal() {
        const authModal = document.getElementById('authModal');
        if (authModal) {
            authModal.style.display = 'flex';
            this.setupAuthTabs();
        }
    }

    setupAuthTabs() {
        const tabs = document.querySelectorAll('.auth-tab');
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        const modalTitle = document.getElementById('authModalTitle');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Remover clase active de todos los tabs
                tabs.forEach(t => t.classList.remove('active'));
                // Agregar clase active al tab clickeado
                tab.classList.add('active');

                const tabType = tab.getAttribute('data-tab');
                
                if (tabType === 'login') {
                    loginForm.style.display = 'block';
                    registerForm.style.display = 'none';
                    modalTitle.textContent = 'Iniciar Sesión';
                } else {
                    loginForm.style.display = 'none';
                    registerForm.style.display = 'block';
                    modalTitle.textContent = 'Registrarse';
                }
            });
        });

        // Configurar formularios
        this.setupLoginForm();
        this.setupRegisterForm();
    }

    setupLoginForm() {
        const loginForm = document.getElementById('loginFormElement');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const email = document.getElementById('loginEmail').value;
                const password = document.getElementById('loginPassword').value;
                
                try {
                    await this.signInWithEmail(email, password);
                    this.closeModal('authModal');
                    this.showNotification('¡Bienvenido!', 'success');
                } catch (error) {
                    this.showNotification('Error al iniciar sesión: ' + error.message, 'error');
                }
            });
        }
    }

    setupRegisterForm() {
        const registerForm = document.getElementById('registerFormElement');
        if (registerForm) {
            registerForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const formData = new FormData(registerForm);
                const userData = {
                    fullName: document.getElementById('registerFullName').value,
                    email: document.getElementById('registerEmail').value,
                    password: document.getElementById('registerPassword').value,
                    address: document.getElementById('registerAddress').value,
                    gender: document.getElementById('registerGender').value,
                    photo: document.getElementById('registerPhoto').files[0]
                };
                
                try {
                    await this.signUpWithEmail(userData.email, userData.password, userData);
                    this.closeModal('authModal');
                    this.showNotification('¡Cuenta creada exitosamente!', 'success');
                } catch (error) {
                    this.showNotification('Error al registrarse: ' + error.message, 'error');
                }
            });
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
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
}

// ===== INICIALIZACIÓN =====
let authManager;

document.addEventListener('DOMContentLoaded', () => {
    authManager = new AuthManager();
    
    // Hacer disponible globalmente
    window.authManager = authManager;
    
    // Configurar navegación
    setupNavigation();
});

function setupNavigation() {
    // Navegación entre páginas
    const navItems = document.querySelectorAll('.nav-item[data-page]');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.getAttribute('data-page');
            navigateToPage(page);
        });
    });
}

function navigateToPage(page) {
    switch (page) {
        case 'home':
            window.location.href = 'index.html';
            break;
        case 'wallet':
            window.location.href = 'wallet.html';
            break;
        case 'settings':
            window.location.href = 'settings.html';
            break;
    }
}

// ===== FUNCIONES GLOBALES =====
window.app = window.app || {};

window.app.showAuthModal = () => authManager.showAuthModal();
window.app.signInWithGoogle = () => authManager.signInWithGoogle();
window.app.logout = () => authManager.logout();
window.app.toggleNavMenu = () => authManager.toggleNavMenu();
window.app.closeNavMenu = () => authManager.closeNavMenu();
window.app.closeModal = (modalId) => authManager.closeModal(modalId);