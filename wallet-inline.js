// ===== WALLET FUNCTIONALITY - INLINE IMPLEMENTATION =====
console.log('🚀 Inicializando billetera inline...');

// ===== WALLET MANAGER INLINE =====
class InlineWalletManager {
    constructor() {
        this.balance = 0;
        this.transactions = [];
        this.currentAmount = 0;
        this.currentProofFile = null;
        this.firebase = null;
        this.database = null;
        this.init();
    }

    async init() {
        console.log('🟣 InlineWalletManager: Inicializando...');
        
        // Inicializar Firebase primero
        await this.initializeFirebase();
        
        await this.loadBalance();
        await this.loadTransactions();
        await this.loadMicrotransactions();
        this.initializeTheme();
        this.renderBalance();
        this.renderTransactions();
        this.renderMicrotransactions();
        this.setupEventListeners();
        
        // Configurar limpieza al cerrar la página
        this.setupCleanup();
        
        console.log('✅ InlineWalletManager: Inicializado correctamente');
    }

    setupCleanup() {
        // Limpiar listeners cuando se cierre la página
        window.addEventListener('beforeunload', () => {
            if (this.database && this.transactionListener) {
                this.database.ref(`transactions/${this.getCurrentUserId()}`).off('value', this.transactionListener);
            }
            if (this.balanceListenerRef && this.balanceListener) {
                try { this.balanceListenerRef.off('value', this.balanceListener); } catch (_) {}
            }
        });
    }

    getCurrentUserId() {
        // SEGURIDAD: preferir la identidad verificada por Clerk sobre localStorage
        // (que es manipulable). Fallback a la caché por compatibilidad.
        if (window.DeseoSession) {
            const verified = window.DeseoSession.getVerifiedUserId();
            if (verified) return verified;
        }
        const user = JSON.parse(localStorage.getItem('deseo_user') || '{}');
        return user.id || user.uid;
    }
    
    async initializeFirebase() {
        console.log('🔍 [DEBUG] Iniciando Firebase en wallet...');
        console.log('🔍 [DEBUG] CONFIG disponible:', typeof CONFIG);
        console.log('🔍 [DEBUG] CONFIG.FIREBASE disponible:', typeof CONFIG.FIREBASE);
        console.log('🔍 [DEBUG] CONFIG.FIREBASE.enabled:', CONFIG.FIREBASE.enabled);
        
        if (!CONFIG.FIREBASE.enabled) {
            console.log('❌ Firebase está deshabilitado en la configuración');
            return;
        }

        // Verificar si Firebase está disponible
        console.log('🔍 [DEBUG] typeof firebase:', typeof firebase);
        if (typeof firebase === 'undefined') {
            console.warn('⚠️ Firebase SDK no está cargado, reintentando en 2 segundos...');
            setTimeout(() => this.initializeFirebase(), 2000);
            return;
        }

        try {
            // Verificar si ya está inicializado
            if (this.firebase) {
                console.log('✅ Firebase ya está inicializado en wallet');
                return;
            }

            // Verificar que firebase.database esté disponible
            console.log('🔍 [DEBUG] typeof firebase.database:', typeof firebase.database);
            if (typeof firebase.database === 'undefined') {
                console.warn('⚠️ Firebase Database no está cargado, reintentando en 2 segundos...');
                setTimeout(() => this.initializeFirebase(), 2000);
                return;
            }

            // Verificar configuración
            console.log('🔍 [DEBUG] Configuración Firebase:', CONFIG.FIREBASE.config);
            console.log('🔍 [DEBUG] databaseURL:', CONFIG.FIREBASE.config.databaseURL);
            
            // Verificar si la configuración es válida
            if (!CONFIG.FIREBASE.config.databaseURL) {
                console.warn('⚠️ databaseURL no está definido en la configuración');
                console.log('🔍 [DEBUG] Firebase deshabilitado por databaseURL faltante, usando modo local');
                this.showNotification('Configuración de Firebase incompleta. Usando modo local.', 'warning');
                return;
            }
            
            // Verificar si es una configuración válida
            if (CONFIG.FIREBASE.config.databaseURL.includes('parcero-6b971')) {
                console.log('🔍 [DEBUG] Usando configuración de Firebase real del proyecto parcero');
            } else if (CONFIG.FIREBASE.config.databaseURL.includes('samplep-d6b68')) {
                console.log('🔍 [DEBUG] Usando configuración de Firebase de prueba válida');
            } else if (CONFIG.FIREBASE.config.databaseURL.includes('firebaseio.com')) {
                console.warn('⚠️ Configuración de Firebase parece ser placeholder/falsa');
                console.log('🔍 [DEBUG] Firebase deshabilitado por configuración placeholder, usando modo local');
                this.showNotification('Configuración de Firebase no válida. Usando modo local.', 'warning');
                return;
            }

            // Inicializar Firebase
            console.log('🔍 [DEBUG] Intentando inicializar Firebase en wallet...');
            this.firebase = firebase.initializeApp(CONFIG.FIREBASE.config);
            this.database = firebase.database();
            
            console.log('✅ Firebase Realtime Database inicializado en wallet');
            console.log('📊 Database URL:', CONFIG.FIREBASE.config.databaseURL);
            
        } catch (error) {
            console.error('❌ Error inicializando Firebase en wallet:', error);
            console.error('🔍 [DEBUG] Error details:', error.message);
            console.error('🔍 [DEBUG] Error code:', error.code);
            this.showNotification(`Error Firebase: ${error.message} (${error.code || 'Sin código'})`, 'error');
        }
    }

    initializeTheme() {
        // Esperar a que ThemeManager esté disponible
        if (window.themeManager) {
            this.setupThemeIntegration();
        } else {
            // Si ThemeManager no está listo, esperar un poco
            setTimeout(() => this.initializeTheme(), 100);
        }
    }
    
    setupThemeIntegration() {
        console.log('🎨 Configurando integración con ThemeManager en wallet...');
        
        // Aplicar tema actual
        const currentTheme = window.themeManager.getCurrentTheme();
        this.applyWalletTheme(currentTheme === 'dark');
        
        // Escuchar cambios de tema desde ThemeManager
        window.addEventListener('themeChanged', (event) => {
            const theme = event.detail.theme;
            this.applyWalletTheme(theme === 'dark');
        });
    }
    
    observeThemeChanges() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
                    const newTheme = document.documentElement.getAttribute('data-theme');
                    const isDark = newTheme === 'dark';
                    this.applyWalletTheme(isDark);
                }
            });
        });
        
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    }
    
    applyWalletTheme(isDark) {
        const root = document.documentElement;
        if (isDark) {
            root.style.setProperty('--bg-primary', '#0f0f0f');
            root.style.setProperty('--bg-secondary', '#1a1a1a');
            root.style.setProperty('--text-primary', '#ffffff');
            root.style.setProperty('--text-secondary', '#cccccc');
            root.style.setProperty('--border-color', '#333333');
        } else {
            root.style.setProperty('--bg-primary', '#ffffff');
            root.style.setProperty('--bg-secondary', '#f5f5f5');
            root.style.setProperty('--text-primary', '#333333');
            root.style.setProperty('--text-secondary', '#666666');
            root.style.setProperty('--border-color', '#e0e0e0');
        }
        document.body.classList.toggle('dark-mode', isDark);
    }

    async loadBalance() {
        try {
            const user = JSON.parse(localStorage.getItem('deseo_user') || '{}');
            const userId = user.id || user.uid;
            
            if (!userId) {
                console.log('⚠️ Usuario no autenticado, balance inicial: 0');
                this.balance = 0;
                return;
            }
            
            if (!this.database) {
                console.log('⚠️ Firebase no inicializado, balance en 0');
                this.balance = 0;
                return;
            }
            
            const userRef = this.database.ref(`users/${userId}`);
            const snapshot = await userRef.once('value');
            const userData = snapshot.val();

            // FUENTE AUTORITATIVA del saldo: Supabase (balances). Firebase queda
            // como fallback mientras se migra. El saldo real vive en Supabase.
            let sbBalance = null;
            try {
                if (window.DeseoMoney && window.DeseoMoney.getBalance) {
                    sbBalance = await window.DeseoMoney.getBalance(this.database, userId);
                }
            } catch (_) { /* noop */ }

            if (typeof sbBalance === 'number' && Number.isFinite(sbBalance)) {
                this.balance = sbBalance;
                console.log('✅ Balance cargado desde Supabase:', this.balance);
            } else if (userData && userData.balance !== undefined) {
                this.balance = parseFloat(userData.balance);
                console.log('✅ Balance cargado desde Firebase (fallback):', this.balance);
            } else {
                this.balance = 0;
                console.log('ℹ️ Usuario nuevo, balance inicial: 0');
            }

            // Listener en TIEMPO REAL sobre el saldo: cuando el admin aprueba una
            // recarga/retiro o llega una nueva transacción que modifica el balance,
            // el valor mostrado se actualiza automáticamente sin recargar la página.
            this.setupBalanceListener(userId);
            // Refrescar desde Supabase (fuente de verdad) periódicamente.
            this.setupSupabaseBalancePoll(userId);
        } catch (error) {
            console.error('❌ Error loading balance from Firebase:', error);
            this.balance = 0;
        }
    }

    // Sondeo periódico del saldo REAL (Supabase). El RTDB de Firebase ya no es
    // la fuente de verdad; este poll mantiene la UI sincronizada.
    setupSupabaseBalancePoll(userId) {
        if (this._sbPollTimer) { clearInterval(this._sbPollTimer); this._sbPollTimer = null; }
        const tick = async () => {
            try {
                if (!window.DeseoMoney || !window.DeseoMoney.getBalance) return;
                const b = await window.DeseoMoney.getBalance(this.database, userId);
                if (typeof b === 'number' && Number.isFinite(b) && b !== this.balance) {
                    this.balance = b;
                    this.renderBalance();
                }
            } catch (_) { /* noop */ }
        };
        this._sbPollTimer = setInterval(tick, 15000);
        tick();
    }

    setupBalanceListener(userId) {
        if (!this.database) return;

        // Evitar duplicar listeners si loadBalance() se llama varias veces.
        if (this.balanceListener && this.balanceListenerRef) {
            try { this.balanceListenerRef.off('value', this.balanceListener); } catch (_) {}
        }

        const balanceRef = this.database.ref(`users/${userId}/balance`);
        this.balanceListenerRef = balanceRef;

        this.balanceListener = (snapshot) => {
            const raw = snapshot.val();
            const newBalance = (raw === null || raw === undefined) ? 0 : parseFloat(raw);
            const safeBalance = Number.isFinite(newBalance) ? newBalance : 0;

            if (safeBalance !== this.balance) {
                const previous = this.balance;
                this.balance = safeBalance;
                console.log(`🔄 Balance actualizado en tiempo real: ${previous} → ${this.balance}`);
                this.renderBalance();

                // Feedback visual cuando el saldo aumenta (recarga aprobada, etc.)
                if (this.balance > previous) {
                    this.flashBalance();
                }
            }
        };

        balanceRef.on('value', this.balanceListener);
        console.log('👂 Listener de balance en tiempo real activado');
    }

    flashBalance() {
        const balanceElement = document.getElementById('totalBalance');
        if (!balanceElement) return;
        balanceElement.classList.add('balance-updated');
        setTimeout(() => balanceElement.classList.remove('balance-updated'), 1200);
    }

    async loadTransactions() {
        try {
            const user = JSON.parse(localStorage.getItem('deseo_user') || '{}');
            const userId = user.id || user.uid;
            
            if (!userId) {
                console.log('⚠️ Usuario no autenticado, transacciones vacías');
                this.transactions = [];
                return;
            }
            
            if (!this.database) {
                console.log('⚠️ Firebase no inicializado, transacciones vacías');
                this.transactions = [];
                return;
            }
            
            const transactionsRef = this.database.ref(`transactions/${userId}`);
            const snapshot = await transactionsRef.once('value');
            const transactionsData = snapshot.val();
            
            if (transactionsData) {
                this.transactions = Object.values(transactionsData)
                    .sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));
                console.log('✅ Transacciones cargadas desde Firebase:', this.transactions.length);
            } else {
                this.transactions = [];
                console.log('ℹ️ No hay transacciones para este usuario');
            }

            // Configurar listener en tiempo real para cambios en transacciones
            this.setupTransactionListener(userId);
        } catch (error) {
            console.error('❌ Error loading transactions from Firebase:', error);
            this.transactions = [];
        }
    }

    setupTransactionListener(userId) {
        if (!this.database) return;

        const transactionsRef = this.database.ref(`transactions/${userId}`);
        
        // Guardar referencia del listener para poder limpiarlo después
        this.transactionListener = (snapshot) => {
            const transactionsData = snapshot.val();
            
            if (transactionsData) {
                const newTransactions = Object.values(transactionsData)
                    .sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));
                
                // Verificar si hay cambios
                const hasChanges = JSON.stringify(newTransactions) !== JSON.stringify(this.transactions);
                
                if (hasChanges) {
                    this.transactions = newTransactions;
                    console.log('🔄 Transacciones actualizadas en tiempo real');
                    
                    // Re-renderizar transacciones
                    this.renderTransactions();
                    
                    // Mostrar notificación si hay un nuevo mensaje del admin
                    this.checkForNewAdminMessages(newTransactions);
                }
            } else {
                this.transactions = [];
                this.renderTransactions();
            }
        };
        
        // Escuchar cambios en tiempo real
        transactionsRef.on('value', this.transactionListener);
    }

    checkForNewAdminMessages(newTransactions) {
        // Buscar transacciones con mensajes del admin que no estaban antes
        const oldTransactionIds = this.transactions.map(t => t.id || t.timestamp);
        
        newTransactions.forEach(transaction => {
            const transactionId = transaction.id || transaction.timestamp;
            const hasAdminMessage = transaction.adminMessage && transaction.adminMessage.trim() !== '';
            const isNewMessage = !oldTransactionIds.includes(transactionId) && hasAdminMessage;
            
            if (isNewMessage || (hasAdminMessage && transaction.adminActionDate)) {
                // Mostrar notificación de nuevo mensaje
                this.showAdminMessageNotification(transaction);
            }
        });
    }

    showAdminMessageNotification(transaction) {
        const messageType = transaction.status === 'rejected' ? 'rechazada' : 
                           transaction.status === 'completed' ? 'aprobada' : 'actualizada';
        
        const notification = document.createElement('div');
        notification.className = 'admin-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${transaction.status === 'rejected' ? '#f44336' : '#4CAF50'};
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
                <i class="fas ${transaction.status === 'rejected' ? 'fa-times' : 'fa-check'}" style="font-size: 18px;"></i>
                <div>
                    <strong>Transacción ${messageType}</strong>
                    <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">
                        ${transaction.adminMessage ? escapeHtml(transaction.adminMessage.substring(0, 50) + '...') : 'Tu transacción ha sido procesada.'}
                    </p>
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

    renderBalance() {
        const balanceElement = document.getElementById('totalBalance');
        if (balanceElement) {
            balanceElement.textContent = this.balance.toFixed(2);
        }
    }

    renderTransactions(filter = 'all') {
        const transactionsList = document.getElementById('transactionsList');
        if (!transactionsList) return;

        let filteredTransactions = this.transactions;
        if (filter !== 'all') {
            filteredTransactions = this.transactions.filter(t => t.type === filter);
        }
        filteredTransactions.sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));

        transactionsList.innerHTML = '';

        if (filteredTransactions.length === 0) {
            transactionsList.innerHTML = `
                <div class="no-transactions">
                    <i class="fas fa-receipt"></i>
                    <p>No hay transacciones para mostrar</p>
                </div>
            `;
            return;
        }

        filteredTransactions.forEach(transaction => {
            const transactionElement = this.createTransactionElement(transaction);
            transactionsList.appendChild(transactionElement);
        });
    }

    createTransactionElement(transaction) {
        const div = document.createElement('div');
        div.className = 'transaction-item';

        const iconClass = transaction.type === 'income' ? 'fas fa-arrow-down' : 'fas fa-arrow-up';
        const amountClass = transaction.type === 'income' ? 'income' : 'expense';
        const amountPrefix = transaction.type === 'income' ? '+' : '-';

        let statusBadge = '';
        let statusClass = '';
        if (transaction.status === 'pending_verification') {
            statusBadge = '<span class="transaction-status-badge pending"><i class="fas fa-clock"></i> Pendiente</span>';
            statusClass = 'pending';
        } else if (transaction.status === 'completed') {
            statusBadge = '<span class="transaction-status-badge approved"><i class="fas fa-check"></i> Aprobado</span>';
            statusClass = 'approved';
        } else if (transaction.status === 'rejected') {
            statusBadge = '<span class="transaction-status-badge rejected"><i class="fas fa-times"></i> Rechazado</span>';
            statusClass = 'rejected';
        }

        // Crear mensaje del admin si existe
        let adminMessageHtml = '';
        if (transaction.adminMessage) {
            const messageClass = transaction.status === 'rejected' ? 'rejected' : 
                                transaction.status === 'completed' ? 'approved' : 'info';
            const messageIcon = transaction.status === 'rejected' ? 'fas fa-times' : 
                               transaction.status === 'completed' ? 'fas fa-check' : 'fas fa-info-circle';
            const messageTitle = transaction.status === 'rejected' ? 'Transacción Rechazada' : 
                                transaction.status === 'completed' ? 'Transacción Aprobada' : 'Mensaje del Administrador';
            
            adminMessageHtml = `
                <div class="admin-message ${messageClass}">
                    <div class="admin-message-header">
                        <div class="admin-message-icon ${messageClass}">
                            <i class="${messageIcon}"></i>
                        </div>
                        <h4 class="admin-message-title">${messageTitle}</h4>
                    </div>
                    <p class="admin-message-content">${escapeHtml(transaction.adminMessage)}</p>
                    ${transaction.adminActionDate ? `
                        <div class="admin-message-date">
                            <i class="fas fa-calendar"></i>
                            ${this.formatDate(transaction.adminActionDate)}
                        </div>
                    ` : ''}
                </div>
            `;
        }

        // Información adicional para retiros bancarios
        let bankInfoHtml = '';
        if (transaction.type === 'outcome' && transaction.accountNumber && transaction.accountHolder) {
            const bankName = this.getBankDisplayName(transaction.method);
            bankInfoHtml = `
                <div class="bank-info">
                    <p><strong>Banco:</strong> ${bankName}</p>
                    <p><strong>Cuenta:</strong> ${escapeHtml(transaction.accountNumber)}</p>
                    <p><strong>Titular:</strong> ${escapeHtml(transaction.accountHolder)}</p>
                </div>
            `;
        }

        div.innerHTML = `
            <div class="transaction-info">
                <div class="transaction-icon ${transaction.type}">
                    <i class="${iconClass}"></i>
                </div>
                <div class="transaction-details">
                    <h4>${escapeHtml(transaction.description || 'Transacción')}${statusBadge}</h4>
                    <p>${transaction.method || 'Método'} • ${this.formatDate(transaction.timestamp || transaction.date || new Date().toISOString())}</p>
                    ${transaction.nequiNumber ? `<p style=\"font-size: 12px; color: #666;\">Nequi: ${escapeHtml(transaction.nequiNumber)}</p>` : ''}
                    ${bankInfoHtml}
                    ${adminMessageHtml}
                </div>
            </div>
            <div class="transaction-amount ${amountClass}">
                ${amountPrefix}$${Number(transaction.amount || 0).toFixed(2)}
            </div>
        `;

        return div;
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    setupEventListeners() {
        const filterTabs = document.querySelectorAll('.filter-tab');
        filterTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                filterTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const filter = tab.getAttribute('data-filter');
                this.applyFilter(filter);
            });
        });

        const addMoneyForm = document.getElementById('addMoneyForm');
        if (addMoneyForm) {
            addMoneyForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleAddMoney();
            });
        }

        const addAmountInput = document.getElementById('addAmount');
        if (addAmountInput) {
            addAmountInput.addEventListener('input', (e) => {
                const amount = parseFloat(e.target.value);
                if (amount && amount >= 1000) {
                    this.showNequiInstructions(amount);
                } else {
                    this.resetNequiInstructions();
                }
            });
        }

        const withdrawForm = document.getElementById('withdrawForm');
        if (withdrawForm) {
            withdrawForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleWithdraw();
            });
        }
    }

    applyFilter(filter) {
        const txList = document.getElementById('transactionsList');
        const microList = document.getElementById('microtransactionsList');
        if (!txList || !microList) return;
        if (filter === 'micro') {
            txList.style.display = 'none';
            microList.style.display = 'block';
            this.renderMicrotransactions();
        } else {
            microList.style.display = 'none';
            txList.style.display = 'block';
            this.renderTransactions(filter);
        }
    }

    async loadMicrotransactions() {
        try {
            const userId = this.getCurrentUserId();
            if (!userId || !this.database) { this.microtransactions = []; return; }
            const ref = this.database.ref(`users/${userId}/microtransactions`);
            const snap = await ref.once('value');
            const data = snap.val();
            this.microtransactions = data ? Object.values(data).sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp)) : [];
            // Listener en tiempo real
            ref.on('value', (s) => {
                const d = s.val();
                this.microtransactions = d ? Object.values(d).sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp)) : [];
                this.renderMicrotransactions();
            });
        } catch (e) {
            console.error('❌ Error cargando microtransacciones:', e);
            this.microtransactions = [];
        }
    }

    renderMicrotransactions() {
        const container = document.getElementById('microtransactionsList');
        if (!container) return;
        container.innerHTML = '';
        if (!this.microtransactions || this.microtransactions.length === 0) {
            container.innerHTML = '<p style="padding: 12px; color: #888;">No hay microtransacciones</p>';
            return;
        }
        this.microtransactions.forEach((m) => {
            const item = document.createElement('div');
            item.className = 'transaction-item';
            const sign = m.direction === 'in' ? '+' : '-';
            const color = m.direction === 'in' ? '#4CAF50' : '#f44336';
            item.innerHTML = `
                <div class="transaction-info">
                    <div class="transaction-title">Mensaje (${escapeHtml(m.reason)})</div>
                    <div class="transaction-date">${this.formatDate(m.timestamp)}</div>
                </div>
                <div class="transaction-amount" style="color:${color};">${sign}${escapeInt(m.amount, m.amount)}</div>
            `;
            container.appendChild(item);
        });
    }

    async handleAddMoney() {
        const amount = parseFloat(document.getElementById('addAmount').value);
        if (!amount || amount < 1000) {
            this.showNotification('Por favor ingresa una cantidad válida (mínimo $1,000 COP)', 'error');
            return;
        }
        try {
            this.showNequiInstructions(amount);
        } catch (error) {
            console.error('Error showing Nequi instructions:', error);
            this.showNotification('Error al mostrar las instrucciones', 'error');
        }
    }
    
    resetNequiInstructions() {
        const container = document.querySelector('.nequi-payment-container');
        if (container) {
            container.innerHTML = `
                <div id="nequiInstructionsPlaceholder">
                    <p style="text-align: center; color: #666; padding: 20px;">
                        <i class="fas fa-mobile-alt" style="font-size: 48px; color: #E91E63; margin-bottom: 15px;"></i><br>
                        Ingresa una cantidad para ver las instrucciones de transferencia
                    </p>
                </div>
            `;
        }
        
        // Limpiar estado
        this.currentProofFile = null;
        this.currentAmount = 0;
    }

    showNequiInstructions(amount) {
        const container = document.querySelector('.nequi-payment-container');
        if (!container) return;

        // Guardar el monto actual
        this.currentAmount = amount;

        const currentTheme = document.documentElement.getAttribute('data-theme') ||
                           localStorage.getItem('deseo_theme') ||
                           localStorage.getItem('deseo-theme') || 'dark';
        const isDarkMode = currentTheme === 'dark';
        
        // Colores de la app (basados en styles.css)
        const appColors = {
            primary: '#60c48e',      // Verde principal de la app
            primaryHover: '#4fb87a', // Verde hover
            secondary: '#26282a',    // Gris secundario
            accent: '#e88dff',        // Rosa-púrpura accent
            success: '#00ba7c',       // Verde éxito
            warning: '#ffd400',      // Amarillo advertencia
            error: '#f4212e',        // Rojo error
            dark: {
                bg: '#18191a',
                card: '#26282a',
                text: '#ffffff',
                textSecondary: '#a8a8a8',
                border: '#383a3c'
            },
            light: {
                bg: '#ffffff',
                card: '#f0f2f5',
                text: '#0f1419',
                textSecondary: '#536471',
                border: '#cfd9de'
            }
        };
        
        const theme = isDarkMode ? appColors.dark : appColors.light;
        
        container.innerHTML = `
            <div class="nequi-instructions-container" style="
                text-align: center; 
                padding: 25px; 
                border: 2px solid ${appColors.primary}; 
                border-radius: 15px; 
                background: linear-gradient(135deg, ${theme.card} 0%, ${theme.bg} 100%);
                color: ${theme.text};
                transition: all 0.3s ease;
                box-shadow: 0 8px 32px rgba(96, 196, 142, 0.15);
            ">
                <div style="margin-bottom: 25px;">
                    <div style="
                        width: 80px; 
                        height: 80px; 
                        background: linear-gradient(135deg, ${appColors.primary}, ${appColors.primaryHover});
                        border-radius: 50%; 
                        display: inline-flex; 
                        align-items: center; 
                        justify-content: center; 
                        margin-bottom: 20px;
                        box-shadow: 0 4px 20px rgba(96, 196, 142, 0.3);
                    ">
                        <i class="fas fa-mobile-alt" style="font-size: 36px; color: white;"></i>
                    </div>
                    <h3 style="color: ${theme.text}; margin-bottom: 10px; font-size: 24px; font-weight: 600;">Transferencia a Nequi</h3>
                    <p style="color: ${theme.textSecondary}; font-size: 18px; margin-bottom: 20px;">
                        <strong style="color: ${appColors.primary};">Monto a transferir:</strong> $${amount.toLocaleString('es-CO')} COP
                    </p>
                </div>
                
                <div style="
                    background: ${theme.card}; 
                    border: 1px solid ${appColors.primary}; 
                    border-radius: 12px; 
                    padding: 25px; 
                    margin-bottom: 25px; 
                    text-align: left;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.1);
                ">
                    <h4 style="color: ${theme.text}; margin-bottom: 20px; text-align: center; font-size: 18px; font-weight: 600;">📋 Pasos para transferir:</h4>
                    
                    <div style="margin-bottom: 15px; padding: 15px; background: ${isDarkMode ? '#2a2a2a' : '#f8f9fa'}; border-radius: 8px; border-left: 4px solid ${appColors.primary};">
                        <strong style="color: ${appColors.primary}; font-size: 16px;">1.</strong> 
                        <span style="color: ${theme.text}; font-size: 14px;">Abre tu app de Nequi</span>
                    </div>
                    
                    <div style="margin-bottom: 15px; padding: 15px; background: ${isDarkMode ? '#2a2a2a' : '#f8f9fa'}; border-radius: 8px; border-left: 4px solid ${appColors.primary};">
                        <strong style="color: ${appColors.primary}; font-size: 16px;">2.</strong> 
                        <span style="color: ${theme.text}; font-size: 14px;">Ve a "Enviar dinero" o "Transferir"</span>
                    </div>
                    
                    <div style="margin-bottom: 15px; padding: 15px; background: ${isDarkMode ? '#2a2a2a' : '#f8f9fa'}; border-radius: 8px; border-left: 4px solid ${appColors.primary};">
                        <strong style="color: ${appColors.primary}; font-size: 16px;">3.</strong> 
                        <span style="color: ${theme.text}; font-size: 14px;">Ingresa el número: </span>
                        <strong style="color: ${appColors.primary}; font-size: 18px; background: ${theme.bg}; padding: 4px 8px; border-radius: 4px; cursor: pointer;" onclick="navigator.clipboard.writeText('3146959639'); window.inlineWalletManager.showNotification('Número copiado al portapapeles', 'success');">3146959639</strong>
                        <button onclick="navigator.clipboard.writeText('3146959639'); window.inlineWalletManager.showNotification('Número copiado al portapapeles', 'success');" style="background: ${appColors.primary}; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-left: 8px; cursor: pointer;">
                            <i class="fas fa-copy"></i> Copiar
                        </button>
                    </div>
                    
                    <div style="margin-bottom: 15px; padding: 15px; background: ${isDarkMode ? '#2a2a2a' : '#f8f9fa'}; border-radius: 8px; border-left: 4px solid ${appColors.primary};">
                        <strong style="color: ${appColors.primary}; font-size: 16px;">4.</strong> 
                        <span style="color: ${theme.text}; font-size: 14px;">Ingresa el monto: </span>
                        <strong style="color: ${appColors.primary}; font-size: 16px;">$${amount.toLocaleString('es-CO')} COP</strong>
                    </div>
                    
                    <div style="margin-bottom: 15px; padding: 15px; background: ${isDarkMode ? '#2a2a2a' : '#f8f9fa'}; border-radius: 8px; border-left: 4px solid ${appColors.primary};">
                        <strong style="color: ${appColors.primary}; font-size: 16px;">5.</strong> 
                        <span style="color: ${theme.text}; font-size: 14px;">Completa la transferencia</span>
                    </div>
                </div>
                
                <div style="margin-bottom: 25px;">
                    <p style="color: ${theme.textSecondary}; font-size: 14px; margin-bottom: 20px;">
                        Una vez realizada la transferencia, toma una captura de pantalla del comprobante:
                    </p>
                    
                    <input type="file" id="paymentProof" accept="image/*" style="display: none;">
                    
                    <!-- Previsualización de imagen -->
                    <div id="imagePreview" style="
                        margin-bottom: 20px; 
                        display: none;
                        text-align: center;
                    ">
                        <p style="color: ${theme.textSecondary}; font-size: 12px; margin-bottom: 10px;">
                            <i class="fas fa-image" style="margin-right: 5px;"></i>Vista previa del comprobante:
                        </p>
                        <img id="previewImage" style="
                            max-width: 200px; 
                            max-height: 150px; 
                            border-radius: 8px; 
                            border: 2px solid ${appColors.primary};
                            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                        " />
                        <button onclick="document.getElementById('paymentProof').click()" style="
                            background: ${appColors.secondary}; 
                            color: ${theme.text}; 
                            padding: 8px 15px; 
                            border: none; 
                            border-radius: 6px; 
                            font-size: 12px; 
                            cursor: pointer; 
                            margin-top: 10px;
                            transition: all 0.3s ease;
                        " onmouseover="this.style.background='${appColors.primary}'" onmouseout="this.style.background='${appColors.secondary}'">
                            <i class="fas fa-edit" style="margin-right: 5px;"></i> Cambiar imagen
                        </button>
                    </div>
                    
                    <div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap;">
                        <button onclick="document.getElementById('paymentProof').click()" style="
                            background: linear-gradient(135deg, ${appColors.primary}, ${appColors.primaryHover}); 
                            color: white; 
                            padding: 15px 30px; 
                            border: none; 
                            border-radius: 25px; 
                            font-size: 14px; 
                            font-weight: 600; 
                            cursor: pointer; 
                            transition: all 0.3s ease;
                            box-shadow: 0 4px 16px rgba(96, 196, 142, 0.3);
                        " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(96, 196, 142, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 16px rgba(96, 196, 142, 0.3)'">
                            <i class="fas fa-camera" style="margin-right: 8px;"></i> Subir Captura
                        </button>
                        
                        <button onclick="window.inlineWalletManager.handleNequiPayment(${amount})" style="
                            background: linear-gradient(135deg, ${appColors.success}, #00a86b); 
                            color: white; 
                            padding: 15px 30px; 
                            border: none; 
                            border-radius: 25px; 
                            font-size: 14px; 
                            font-weight: 600; 
                            cursor: pointer; 
                            transition: all 0.3s ease;
                            box-shadow: 0 4px 16px rgba(0, 186, 124, 0.3);
                        " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(0, 186, 124, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 16px rgba(0, 186, 124, 0.3)'">
                            <i class="fas fa-check" style="margin-right: 8px;"></i> Ya envié el dinero
                        </button>
                    </div>
                </div>
                
                <div style="
                    background: linear-gradient(135deg, #fff8e1, #ffecb3); 
                    border: 1px solid ${appColors.warning}; 
                    border-radius: 12px; 
                    padding: 20px; 
                    margin-top: 20px;
                ">
                    <p style="color: #e65100; font-size: 13px; margin: 0; line-height: 1.4;">
                        <i class="fas fa-info-circle" style="margin-right: 8px; color: ${appColors.warning};"></i> 
                        <strong>Importante:</strong> Tu transferencia será verificada por un administrador. El dinero se acreditará en tu billetera una vez aprobada.
                    </p>
                </div>
            </div>
        `;
        
        const fileInput = document.getElementById('paymentProof');
        if (fileInput) {
            // Restaurar archivo si existe
            if (this.currentProofFile) {
                // Crear un nuevo FileList con el archivo guardado
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(this.currentProofFile);
                fileInput.files = dataTransfer.files;
                
                // Mostrar previsualización
                const preview = document.getElementById('imagePreview');
                const previewImage = document.getElementById('previewImage');
                if (preview && previewImage) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        previewImage.src = e.target.result;
                        preview.style.display = 'block';
                    };
                    reader.readAsDataURL(this.currentProofFile);
                }
            }

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    // Guardar el archivo
                    this.currentProofFile = file;
                    
                    // Mostrar previsualización de la imagen
                    const preview = document.getElementById('imagePreview');
                    const previewImage = document.getElementById('previewImage');
                    
                    if (preview && previewImage) {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            previewImage.src = e.target.result;
                            preview.style.display = 'block';
                        };
                        reader.readAsDataURL(file);
                    }
                    
                    this.showNotification('Captura seleccionada. Ahora confirma que ya enviaste el dinero.', 'info');
                }
            });
        }
    }
    
    async handleNequiPayment(amount) {
        try {
            // Verificar autenticación primero (más rápido)
            const user = JSON.parse(localStorage.getItem('deseo_user') || '{}');
            if (!user.id && !user.uid) {
                this.showNotification('Debes iniciar sesión para realizar transacciones', 'error');
                return;
            }

            // Usar el archivo guardado o el del input
            let proofFile = this.currentProofFile;
            
            if (!proofFile) {
                const fileInput = document.getElementById('paymentProof');
                if (fileInput && fileInput.files && fileInput.files.length > 0) {
                    proofFile = fileInput.files[0];
                }
            }
            
            if (!proofFile) {
                this.showNotification('Por favor sube la captura del comprobante antes de continuar', 'warning');
                return;
            }

            // Validar tamaño de archivo (máximo 5MB)
            if (proofFile.size > 5 * 1024 * 1024) {
                this.showNotification('La imagen es muy grande. Máximo 5MB permitido.', 'error');
                return;
            }

            const confirmed = confirm(`¿Confirmas que ya enviaste $${amount.toLocaleString('es-CO')} COP por Nequi al número 3146959639?\n\nIMPORTANTE: Este pago será verificado por un administrador.`);
            if (!confirmed) return;

            // Mostrar indicador de carga inmediatamente
            this.showNotification('Procesando pago por Nequi...', 'info');

            // Procesar archivo de forma asíncrona para no bloquear la UI
            const proofBase64 = await this.fileToBase64(proofFile);
            
            const transaction = {
                id: `nequi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'income',
                amount: amount,
                description: 'Recarga de billetera via Nequi (Pendiente de verificación)',
                method: 'Nequi',
                nequiNumber: '3146959639',
                proofImage: proofBase64,
                proofFileName: proofFile.name,
                proofFileSize: proofFile.size,
                timestamp: new Date().toISOString(),
                status: 'pending_verification',
                needsAdminApproval: true,
                adminNotified: false,
                userId: user.id || user.uid
            };

            // Agregar a transacciones locales inmediatamente para feedback rápido
            this.transactions.unshift(transaction);
            this.renderTransactions();
            
            // Procesar en background
            setTimeout(async () => {
                try {
                    // Verificar conexión Firebase antes de procesar
                    const isConnected = await this.checkFirebaseConnection();
                    if (!isConnected) {
                        throw new Error('Sin conexión a la base de datos. Verifica tu conexión a internet.');
                    }
                    
                    // Guardar en Firebase
                    await this.saveToFirebase(this.balance, transaction);
                    
                    // Notificar al admin
                    await this.notifyAdmin(transaction);
                    
                    this.closeModal('addMoneyModal');
                    document.getElementById('addMoneyForm').reset();
                    this.resetNequiInstructions();
                    
                    // Limpiar estado
                    this.currentProofFile = null;
                    this.currentAmount = 0;
                    
                    this.showNotification('¡Pago por Nequi registrado! Se verificará en las próximas 24 horas.', 'success');
                    
                } catch (error) {
                    console.error('❌ Error procesando pago por Nequi:', error);
                    this.showNotification(`Error: ${error.message}`, 'error');
                    
                    // Remover transacción local si falló
                    const index = this.transactions.findIndex(t => t.id === transaction.id);
                    if (index !== -1) {
                        this.transactions.splice(index, 1);
                        this.renderTransactions();
                    }
                }
            }, 50); // Reducido el delay para mejor rendimiento
            
        } catch (error) {
            console.error('❌ Error procesando pago por Nequi:', error);
            this.showNotification('Error al procesar el pago por Nequi', 'error');
        }
    }
    
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            // Validar que el archivo existe
            if (!file) {
                reject(new Error('No se proporcionó archivo'));
                return;
            }
            
            const reader = new FileReader();
            
            // Configurar eventos
            reader.onload = () => resolve(reader.result);
            reader.onerror = (error) => reject(error);
            
            // Leer archivo con optimización para imágenes
            reader.readAsDataURL(file);
        });
    }
    
    async saveToFirebase(balance, transaction) {
        try {
            if (!this.database) {
                throw new Error('Firebase no inicializado. No se puede procesar la transacción sin conexión a la base de datos.');
            }
            
            const user = JSON.parse(localStorage.getItem('deseo_user') || '{}');
            const userId = user.id || user.uid;
            if (!userId) {
                throw new Error('Usuario no autenticado');
            }
            
            // Guardar transacción
            const transactionRef = this.database.ref(`transactions/${userId}/${transaction.id}`);
            await transactionRef.set({
                ...transaction,
                userId: userId,
                createdAt: new Date().toISOString()
            });
            
            // Guardar balance del usuario
            // SEGURIDAD: NO escribir `balance` desde memoria del cliente. Antes se
            // hacía `update({ balance: this.balance })`, lo que sobrescribía el saldo
            // real (last-writer-wins) y permitía manipularlo. El saldo SOLO se
            // modifica mediante operaciones atómicas (DeseoMoney.charge/credit) o
            // desde el backend al aprobar una transacción.
            const userRef = this.database.ref(`users/${userId}`);
            await userRef.update({
                lastUpdated: new Date().toISOString()
            });
            
            console.log('✅ Datos guardados en Firebase correctamente');
            
        } catch (error) {
            console.error('❌ Error guardando en Firebase:', error);
            throw error;
        }
    }
    
    async checkFirebaseConnection() {
        try {
            if (!this.database) {
                return false;
            }
            
            // Hacer una consulta simple para verificar conexión
            const testRef = this.database.ref('.info/connected');
            const snapshot = await testRef.once('value');
            return snapshot.val() === true;
        } catch (error) {
            console.error('❌ Error verificando conexión Firebase:', error);
            return false;
        }
    }

    async notifyAdmin(transaction) {
        try {
            console.log('📧 Notificando al administrador sobre nueva transacción:', transaction.id);
            
            // Verificar Firebase primero
            if (!this.database) {
                console.log('⚠️ Firebase no inicializado, notificación simulada');
                return;
            }
            
            // En producción, aquí se enviaría una notificación real al admin
            const adminNotification = {
                type: 'payment_verification_required',
                transactionId: transaction.id,
                userId: transaction.userId,
                amount: transaction.amount,
                method: transaction.method,
                nequiNumber: transaction.nequiNumber,
                proofImage: transaction.proofImage,
                timestamp: new Date().toISOString(),
                status: 'pending'
            };
            
            // Guardar notificación para el admin en Firebase
            const adminRef = this.database.ref('admin_notifications').push();
            await adminRef.set(adminNotification);
            console.log('✅ Notificación enviada al admin');
            
        } catch (error) {
            console.error('❌ Error notificando al admin:', error);
            // No lanzar error para no interrumpir el flujo principal
        }
    }
    
    async handleWithdraw() {
        const amount = parseFloat(document.getElementById('withdrawAmount').value);
        const bank = document.getElementById('withdrawBank').value;
        const accountNumber = document.getElementById('accountNumber').value;
        const accountHolder = document.getElementById('accountHolder').value;
        
        // Validaciones
        if (!amount || amount < 1000) {
            this.showNotification('El monto mínimo es $1,000 COP', 'error');
            return;
        }
        if (amount > this.balance) {
            this.showNotification('Fondos insuficientes', 'error');
            return;
        }
        if (!bank) {
            this.showNotification('Por favor selecciona un banco', 'error');
            return;
        }
        if (!accountNumber || accountNumber.trim() === '') {
            this.showNotification('Por favor ingresa el número de cuenta', 'error');
            return;
        }
        if (!accountHolder || accountHolder.trim() === '') {
            this.showNotification('Por favor ingresa el nombre del titular', 'error');
            return;
        }
        
        try {
            this.showNotification('Solicitando retiro...', 'info');
            
            // Crear transacción de retiro pendiente de aprobación
            const transaction = {
                id: `wd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                type: 'outcome',
                amount: amount,
                description: `Retiro a ${this.getBankDisplayName(bank)}`,
                method: bank,
                accountNumber: accountNumber,
                accountHolder: accountHolder,
                timestamp: new Date().toISOString(),
                status: 'pending_verification',
                adminMessage: null
            };
            
            const selectedBank = bank;
            // Guardar en Firebase y RESERVAR los fondos de forma atómica.
            await this.saveWithdrawalRequest(transaction, selectedBank);
            
            // Refrescar saldo mostrado tras la reserva.
            await this.loadBalance();
            
            this.closeModal('withdrawModal');
            document.getElementById('withdrawForm').reset();
            this.showNotification('Solicitud de retiro enviada. Será procesada en 24-48 horas.', 'success');
            
        } catch (error) {
            console.error('Error processing withdrawal:', error);
            this.showNotification(error.message || 'Error al procesar la solicitud de retiro', 'error');
        }
    }
    
    getBankDisplayName(bankCode) {
        const banks = {
            'nequi': 'Nequi',
            'daviplata': 'Daviplata',
            'bancolombia': 'Bancolombia',
            'davivienda': 'Davivienda',
            'dale': 'Dale'
        };
        return banks[bankCode] || bankCode;
    }
    
    async saveWithdrawalRequest(transaction, selectedBank) {
        if (!this.database) {
            throw new Error('Firebase no disponible');
        }
        
        const userId = this.getCurrentUserId();
        if (!userId) {
            throw new Error('Usuario no autenticado');
        }
        
        // SEGURIDAD (anti double-spend): reservar los fondos ANTES de registrar la
        // solicitud, de forma atómica. Antes solo se descontaba al aprobar el admin,
        // permitiendo solicitar varios retiros con el mismo saldo.
        if (!window.DeseoMoney) {
            throw new Error('Servicio de pagos no disponible. Recarga la página.');
        }
        const reserve = await window.DeseoMoney.reserve(
            this.database,
            userId,
            parseInt(transaction.amount, 10),
            { reason: 'withdrawal_reserve', opId: transaction.id }
        );
        if (!reserve.ok) {
            if (reserve.reason === 'insufficient_funds') {
                throw new Error('Fondos insuficientes');
            }
            throw new Error('No se pudo reservar el saldo. Intenta de nuevo.');
        }
        
        // Guardar la transacción en Firebase para que el admin la vea.
        // `fundsReserved: true` indica que el saldo ya fue descontado.
        const tx = Object.assign({}, transaction, {
            fundsReserved: true,
            reservedAt: new Date().toISOString(),
            bank: selectedBank || transaction.method
        });
        const transactionRef = this.database.ref(`transactions/${userId}/${transaction.id}`);
        await transactionRef.set(tx);
        
        console.log('✅ Solicitud de retiro guardada y fondos reservados');
    }

    showAddMoneyModal() {
        const modal = document.getElementById('addMoneyModal');
        if (modal) modal.style.display = 'flex';
    }

    showWithdrawModal() {
        const modal = document.getElementById('withdrawModal');
        if (modal) modal.style.display = 'flex';
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
    }

    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => { notification.remove(); }, 4000);
    }
}

// ===== INICIALIZACIÓN INLINE =====
let inlineWalletManager;

function initializeInlineWallet() {
    console.log('🚀 Inicializando billetera inline...');
    try {
        inlineWalletManager = new InlineWalletManager();
        window.inlineWalletManager = inlineWalletManager;
        console.log('✅ Billetera inline inicializada correctamente');
    } catch (error) {
        console.error('❌ Error inicializando billetera inline:', error);
    }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initializeInlineWallet);

// También inicializar si el DOM ya está listo
if (document.readyState !== 'loading') {
    initializeInlineWallet();
}

// ===== FUNCIONES GLOBALES ACTUALIZADAS =====
window.app = window.app || {};
window.app.showAddMoneyModal = () => { 
    if (inlineWalletManager) {
        inlineWalletManager.showAddMoneyModal();
    } else {
        console.log('⏳ Esperando walletManager...');
        setTimeout(() => window.app.showAddMoneyModal(), 100);
    }
};
window.app.showWithdrawModal = () => { 
    if (inlineWalletManager) {
        inlineWalletManager.showWithdrawModal();
    } else {
        console.log('⏳ Esperando walletManager...');
        setTimeout(() => window.app.showWithdrawModal(), 100);
    }
};
window.app.closeModal = (modalId) => { 
    if (inlineWalletManager) {
        inlineWalletManager.closeModal(modalId);
    } else {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
    }
};
window.app.openNavMenu = () => {
    const navMenu = document.getElementById('navMenu');
    if (navMenu) navMenu.style.display = 'block';
};
window.app.closeNavMenu = () => {
    const navMenu = document.getElementById('navMenu');
    if (navMenu) navMenu.style.display = 'none';
};
window.app.logout = () => {
    console.log('Logout simulado');
    localStorage.removeItem('deseo_user_profile');
    localStorage.removeItem('deseo_balance');
    localStorage.removeItem('deseo_transactions');
    alert('Sesión cerrada');
    window.location.href = 'index.html';
};

console.log('✅ Funcionalidad de billetera inline cargada');