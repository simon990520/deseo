/**
 * Módulo de Autenticación
 * Maneja login, registro y autenticación con Firebase
 */

class DeseoAuth {
    constructor() {
        this.currentUser = null;
        this.isAuthenticated = false;
        this.init();
    }

    async init() {
        try {
            if (window.firebaseAuth && CONFIG.FIREBASE.enabled) {
                // Escuchar cambios de autenticación
                window.firebaseFunctions.onAuthStateChanged(window.firebaseAuth, (user) => {
                    if (user) {
                        this.handleUserLogin(user);
                    } else {
                        this.handleUserLogout();
                    }
                });
            } else {
                // Cargar usuario local si existe
                this.loadLocalUser();
            }
        } catch (error) {
            console.error('Error initializing auth:', error);
        }
    }

    handleUserLogin(user) {
        this.currentUser = user;
        this.isAuthenticated = true;
        
        // Cargar perfil del usuario
        this.loadUserProfile(user.uid);
        
        // Actualizar UI
        this.updateUIForAuthenticatedUser();
        
        // Ocultar botón de auth
        const authButton = document.getElementById('authButton');
        if (authButton) {
            authButton.style.display = 'none';
        }
        
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
        
        // Limpiar datos locales
        localStorage.removeItem('deseo_user');
        
        // Actualizar UI
        this.updateUIForUnauthenticatedUser();
        
        // Mostrar botón de auth
        const authButton = document.getElementById('authButton');
        if (authButton) {
            authButton.style.display = 'block';
        }
    }

    loadLocalUser() {
        try {
            const userData = localStorage.getItem('deseo_user');
            if (userData) {
                const user = JSON.parse(userData);
                this.currentUser = user;
                this.isAuthenticated = true;
                this.updateUIForAuthenticatedUser();
                
                const authButton = document.getElementById('authButton');
                if (authButton) {
                    authButton.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('Error loading local user:', error);
        }
    }

    async saveUserProfile(profileData) {
        try {
            if (window.firebaseDB && CONFIG.FIREBASE.enabled) {
                await window.firebaseFunctions.addDoc(
                    window.firebaseFunctions.collection(window.firebaseDB, window.firebaseCollections.users),
                    profileData
                );
            } else {
                // Guardar localmente
                localStorage.setItem('deseo_user', JSON.stringify({
                    uid: profileData.uid,
                    email: profileData.email,
                    displayName: profileData.fullName,
                    profile: profileData
                }));
            }
        } catch (error) {
            console.error('Error saving user profile:', error);
        }
    }

    async loadUserProfile(uid) {
        try {
            if (window.firebaseDB && CONFIG.FIREBASE.enabled) {
                const querySnapshot = await window.firebaseFunctions.getDocs(
                    window.firebaseFunctions.collection(window.firebaseDB, window.firebaseCollections.users)
                );
                
                const userProfile = querySnapshot.docs.find(doc => doc.data().uid === uid);
                if (userProfile) {
                    return userProfile.data();
                }
            }
            return null;
        } catch (error) {
            console.error('Error loading user profile:', error);
            return null;
        }
    }

    updateUIForAuthenticatedUser() {
        const userInfo = document.getElementById('userInfo');
        const userAvatar = document.getElementById('userAvatar');
        
        if (userInfo && this.currentUser) {
            const displayName = this.currentUser.displayName || this.currentUser.email || 'Usuario';
            const email = this.currentUser.email || '';
            
            userInfo.innerHTML = `
                <div class="user-avatar">
                    <img src="${safeUrl(this.currentUser.photoURL) || 'https://via.placeholder.com/40'}" alt="Avatar">
                </div>
                <div class="user-details">
                    <h3>${displayName}</h3>
                    <p>${email}</p>
                </div>
            `;
        }
    }

    updateUIForUnauthenticatedUser() {
        const userInfo = document.getElementById('userInfo');
        if (userInfo) {
            userInfo.innerHTML = '';
        }
    }

    showAuthModal() {
        const modal = document.getElementById('authModal');
        if (modal) {
            modal.style.display = 'flex';
        }
    }

    toggleAuthTab(tabId) {
        // Ocultar todos los contenidos
        document.querySelectorAll('.auth-content').forEach(content => {
            content.style.display = 'none';
        });
        
        // Remover clase active de todos los tabs
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        
        // Mostrar contenido seleccionado
        const selectedContent = document.getElementById(tabId);
        if (selectedContent) {
            selectedContent.style.display = 'block';
        }
        
        // Activar tab seleccionado
        const selectedTab = document.querySelector(`[onclick="app.toggleAuthTab('${tabId}')"]`);
        if (selectedTab) {
            selectedTab.classList.add('active');
        }
    }

    async signInWithEmail(email, password) {
        try {
            if (window.firebaseAuth && CONFIG.FIREBASE.enabled) {
                const userCredential = await window.firebaseFunctions.signInWithEmailAndPassword(
                    window.firebaseAuth, email, password
                );
                return userCredential.user;
            } else {
                return this.signInWithEmailLocal(email, password);
            }
        } catch (error) {
            console.error('Error signing in with email:', error);
            throw error;
        }
    }

    async signInWithEmailLocal(email, password) {
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
                // Migrar contraseña legada a hash
                if (typeof isHashed === 'function' && !isHashed(u.password) && typeof hashPassword === 'function') {
                    u.password = await hashPassword(password);
                    localStorage.setItem('deseo_users', JSON.stringify(users));
                }
                break;
            }
        }
        
        if (user) {
            const userObj = {
                uid: user.uid,
                email: user.email,
                displayName: user.fullName,
                photoURL: user.photoURL
            };
            
            localStorage.setItem('deseo_user', JSON.stringify(userObj));
            return userObj;
        } else {
            throw new Error('Credenciales inválidas');
        }
    }

    async signUpWithEmail(email, password, userData) {
        try {
            if (window.firebaseAuth && CONFIG.FIREBASE.enabled) {
                const userCredential = await window.firebaseFunctions.createUserWithEmailAndPassword(
                    window.firebaseAuth, email, password
                );
                
                // Guardar datos adicionales del usuario
                const profileData = {
                    uid: userCredential.user.uid,
                    email: userCredential.user.email,
                    fullName: userData.fullName,
                    address: userData.address,
                    gender: userData.gender,
                    provider: 'email',
                    createdAt: new Date().toISOString()
                };
                
                if (userData.photoFile) {
                    profileData.photoURL = await this.uploadUserPhoto(userCredential.user.uid, userData.photoFile);
                }
                
                await this.saveUserProfile(profileData);
                return userCredential.user;
            } else {
                return this.signUpWithEmailLocal(email, password, userData);
            }
        } catch (error) {
            console.error('Error signing up with email:', error);
            throw error;
        }
    }

    async signUpWithEmailLocal(email, password, userData) {
        const users = JSON.parse(localStorage.getItem('deseo_users') || '[]');
        
        // Verificar si el usuario ya existe
        if (users.find(u => u.email === email)) {
            throw new Error('El usuario ya existe');
        }
        
        const newUser = {
            uid: 'local_' + Date.now(),
            email: email,
            password: (typeof hashPassword === 'function') ? await hashPassword(password) : password,
            fullName: userData.fullName,
            address: userData.address,
            gender: userData.gender,
            provider: 'email',
            createdAt: new Date().toISOString()
        };
        
        if (userData.photoFile) {
            newUser.photoURL = this.processLocalPhoto(userData.photoFile);
        }
        
        users.push(newUser);
        localStorage.setItem('deseo_users', JSON.stringify(users));
        
        const userObj = {
            uid: newUser.uid,
            email: newUser.email,
            displayName: newUser.fullName,
            photoURL: newUser.photoURL
        };
        
        localStorage.setItem('deseo_user', JSON.stringify(userObj));
        return userObj;
    }

    processLocalPhoto(photoFile) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                resolve(e.target.result);
            };
            reader.readAsDataURL(photoFile);
        });
    }

    async signInWithGoogle() {
        try {
            if (!window.firebaseAuth || !CONFIG.FIREBASE.enabled) {
                return this.signInWithGoogleLocal();
            }

            // Crear el proveedor de Google
            const provider = new window.firebaseFunctions.GoogleAuthProvider();
            
            // Configurar parámetros adicionales
            provider.addScope('email');
            provider.addScope('profile');
            provider.setCustomParameters({
                prompt: 'select_account'
            });

            console.log('Iniciando Google Sign-In con Firebase...');
            this.showNotification('Abriendo selector de cuentas de Google...', 'info');

            const result = await window.firebaseFunctions.signInWithPopup(window.firebaseAuth, provider);

            console.log('Google Sign-In exitoso:', result.user);

            // Verificar si es un usuario nuevo
            if (result.additionalUserInfo.isNewUser) {
                console.log('Usuario nuevo detectado, guardando perfil...');
                
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
            
            let errorMessage = 'Error al iniciar sesión con Google';
            
            switch (error.code) {
                case 'auth/popup-blocked':
                    errorMessage = 'Popup bloqueado. Por favor, permite popups para este sitio.';
                    break;
                case 'auth/popup-closed-by-user':
                    errorMessage = 'Inicio de sesión cancelado';
                    break;
                case 'auth/account-exists-with-different-credential':
                    errorMessage = 'Ya existe una cuenta con este email usando otro método';
                    break;
                case 'auth/operation-not-allowed':
                    errorMessage = 'Google Sign-In no está habilitado en Firebase';
                    break;
                case 'auth/unauthorized-domain':
                    errorMessage = 'Dominio no autorizado para Google Sign-In';
                    break;
                case 'auth/network-request-failed':
                    errorMessage = 'Error de conexión. Verifica tu internet.';
                    break;
                case 'auth/too-many-requests':
                    errorMessage = 'Demasiados intentos. Intenta más tarde.';
                    break;
                default:
                    errorMessage = `Error: ${error.message}`;
            }
            
            this.showNotification(errorMessage, 'error');
            throw error;
        }
    }

    async signInWithGoogleLocal() {
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

        const selectedAccount = await this.showGoogleAccountSelector(googleAccounts);
        
        if (!selectedAccount) {
            return null;
        }

        const googleUser = {
            uid: 'google_' + Date.now(),
            email: selectedAccount.email,
            displayName: selectedAccount.displayName,
            photoURL: selectedAccount.photoURL,
            provider: 'google'
        };

        const users = JSON.parse(localStorage.getItem('deseo_users') || '[]');
        let existingUser = users.find(u => u.email === googleUser.email);

        if (!existingUser) {
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

        localStorage.setItem('deseo_user', JSON.stringify(googleUser));
        this.showNotification('¡Bienvenido con Google!', 'success');
        return googleUser;
    }

    async showGoogleAccountSelector(accounts) {
        return new Promise((resolve) => {
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

            window.selectAccount = (index) => {
                modal.remove();
                resolve(accounts[index]);
            };
        });
    }

    async logout() {
        try {
            if (window.firebaseAuth && CONFIG.FIREBASE.enabled) {
                await window.firebaseFunctions.signOut(window.firebaseAuth);
            } else {
                localStorage.removeItem('deseo_user');
                this.handleUserLogout();
            }
        } catch (error) {
            console.error('Error logging out:', error);
        }
    }

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

    toggleNavMenu() {
        const navMenu = document.getElementById('navMenu');
        if (navMenu) {
            navMenu.style.display = navMenu.style.display === 'none' ? 'block' : 'none';
        }
    }

    closeNavMenu() {
        const navMenu = document.getElementById('navMenu');
        if (navMenu) {
            navMenu.style.display = 'none';
        }
    }

    showNotification(message, type = 'info') {
        if (window.deseoApp && window.deseoApp.showNotification) {
            window.deseoApp.showNotification(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
}

// Exportar para uso global
window.DeseoAuth = DeseoAuth;