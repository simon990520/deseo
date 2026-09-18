// ===== ADMIN DASHBOARD FUNCTIONALITY =====
console.log('🚀 Inicializando Admin Dashboard...');

class AdminDashboard {
    constructor() {
        this.firebase = null;
        this.database = null;
        this.transactionsChart = null;
        this.currentFilter = 'pending';
        this.currentSection = 'dashboard';
        this.allTransactions = [];
        this.allUsers = [];
        this.analyticsData = {};
        this.stats = {
            totalIncome: 0,
            totalOutcome: 0,
            pendingTransactions: 0,
            totalUsers: 0
        };
        this.pendingMessage = null;
        this.pendingAction = null;
        this.firebaseListeners = []; // Array para rastrear listeners activos
        this.transactionsLoaded = false; // Flag para controlar carga inicial
        this.transactionsListener = null; // Listener de transacciones
        this.init();
    }

    async init() {
        console.log('🔍 AdminDashboard: Inicializando...');
        
        // Inicializar Firebase primero
        await this.initializeFirebase();
        
        // Inicializar componentes
        this.initializeTheme();
        this.initializeChart();
        this.setupEventListeners();
        this.loadDashboardData();
        
        console.log('✅ AdminDashboard: Inicializado correctamente');
    }

    async initializeFirebase() {
        console.log('🔍 [DEBUG] Iniciando Firebase en Admin Dashboard...');
        console.log('🔍 [DEBUG] CONFIG disponible:', typeof CONFIG);
        console.log('🔍 [DEBUG] CONFIG.FIREBASE disponible:', typeof CONFIG.FIREBASE);
        console.log('🔍 [DEBUG] CONFIG.FIREBASE.enabled:', CONFIG.FIREBASE.enabled);
        
        if (!CONFIG.FIREBASE.enabled) {
            console.log('❌ Firebase está deshabilitado en la configuración');
            this.showError('Firebase está deshabilitado en la configuración');
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
                console.log('✅ Firebase ya está inicializado en Admin Dashboard');
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
                console.log('🔍 [DEBUG] Firebase deshabilitado por databaseURL faltante');
                this.showError('Configuración de Firebase incompleta');
                return;
            }
            
            // Verificar si es una configuración válida
            if (CONFIG.FIREBASE.config.databaseURL.includes('parcero-6b971')) {
                console.log('🔍 [DEBUG] Usando configuración de Firebase real del proyecto parcero');
            } else if (CONFIG.FIREBASE.config.databaseURL.includes('samplep-d6b68')) {
                console.log('🔍 [DEBUG] Usando configuración de Firebase de prueba válida');
            } else if (CONFIG.FIREBASE.config.databaseURL.includes('firebaseio.com')) {
                console.warn('⚠️ Configuración de Firebase parece ser placeholder/falsa');
                console.log('🔍 [DEBUG] Firebase deshabilitado por configuración placeholder');
                this.showError('Configuración de Firebase no válida');
                return;
            }

            // Inicializar Firebase
            console.log('🔍 [DEBUG] Intentando inicializar Firebase en Admin Dashboard...');
            this.firebase = firebase.initializeApp(CONFIG.FIREBASE.config);
            this.database = firebase.database();
            
            console.log('✅ Firebase Realtime Database inicializado en Admin Dashboard');
            console.log('📊 Database URL:', CONFIG.FIREBASE.config.databaseURL);
            
        } catch (error) {
            console.error('❌ Error inicializando Firebase en Admin Dashboard:', error);
            console.error('🔍 [DEBUG] Error details:', error.message);
            console.error('🔍 [DEBUG] Error code:', error.code);
            this.showError(`Error Firebase: ${error.message} (${error.code || 'Sin código'})`);
        }
    }

    showError(message) {
        const transactionsList = document.getElementById('transactionsList');
        if (transactionsList) {
            transactionsList.innerHTML = `
                <div class="no-transactions">
                    <i class="fas fa-exclamation-triangle" style="color: #f44336;"></i>
                    <p style="color: #f44336;">${escapeHtml(message)}</p>
                </div>
            `;
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
        console.log('🎨 Configurando integración con ThemeManager...');
        
        // Escuchar cambios de tema desde ThemeManager
        window.addEventListener('themeChanged', (event) => {
            const theme = event.detail.theme;
            this.updateChartsForTheme(theme);
        });
        
        // Aplicar tema actual a los gráficos
        const currentTheme = window.themeManager.getCurrentTheme();
        this.updateChartsForTheme(currentTheme);
    }

    updateChartsForTheme(theme) {
        // Actualizar gráfico principal si existe
        if (this.transactionsChart) {
            this.transactionsChart.options.plugins.legend.labels.color = 
                theme === 'dark' ? '#e0e0e0' : '#333';
            this.transactionsChart.update();
        }
        
        // Actualizar otros gráficos si existen
        const charts = [
            this.revenueChart,
            this.transactionDistributionChart,
            this.userActivityChart,
            this.approvalTrendsChart
        ];
        
        charts.forEach(chart => {
            if (chart) {
                chart.options.plugins.legend.labels.color = 
                    theme === 'dark' ? '#e0e0e0' : '#333';
                chart.update();
            }
        });
    }

    initializeChart() {
        const ctx = document.getElementById('transactionsChart');
        if (!ctx) return;

        this.transactionsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Ingresos',
                    data: [],
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    tension: 0.4,
                    fill: true
                }, {
                    label: 'Retiros',
                    data: [],
                    borderColor: '#f44336',
                    backgroundColor: 'rgba(244, 67, 54, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toLocaleString('es-CO');
                            }
                        }
                    }
                }
            }
        });
    }

    setupEventListeners() {
        // Filtros de transacciones
        const filterTabs = document.querySelectorAll('.filter-tab');
        filterTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                filterTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.currentFilter = tab.getAttribute('data-filter');
                this.renderTransactions();
            });
        });

        // Navegación del sidebar
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = link.getAttribute('data-section');
                this.navigateToSection(section);
            });
        });

        // Toggle del sidebar
        const sidebarToggle = document.getElementById('sidebarToggle');
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', () => {
                const sidebar = document.getElementById('adminSidebar');
                if (sidebar) {
                    sidebar.classList.toggle('collapsed');
                }
            });
        }

        // Mobile menu toggle
        const mobileMenuToggle = document.getElementById('mobileMenuToggle');
        const mobileOverlay = document.getElementById('mobileOverlay');
        const adminSidebar = document.getElementById('adminSidebar');

        if (mobileMenuToggle && mobileOverlay && adminSidebar) {
            mobileMenuToggle.addEventListener('click', () => {
                adminSidebar.classList.toggle('open');
                mobileOverlay.classList.toggle('active');
            });

            mobileOverlay.addEventListener('click', () => {
                adminSidebar.classList.remove('open');
                mobileOverlay.classList.remove('active');
            });

            // Close mobile menu when clicking on nav links
            const navLinks = document.querySelectorAll('.nav-link');
            navLinks.forEach(link => {
                link.addEventListener('click', () => {
                    if (window.innerWidth <= 768) {
                        adminSidebar.classList.remove('open');
                        mobileOverlay.classList.remove('active');
                    }
                });
            });
        }

        // Botón de guardar mensaje
        const saveMessageBtn = document.getElementById('saveMessageBtn');
        if (saveMessageBtn) {
            saveMessageBtn.addEventListener('click', () => {
                this.saveAdminMessage();
            });
        }

        // Handle window resize
        window.addEventListener('resize', () => {
            this.handleWindowResize();
        });

        // Initial responsive setup
        this.handleWindowResize();
    }

    navigateToSection(section) {
        // Limpiar listeners anteriores para evitar bucles infinitos
        this.cleanupFirebaseListeners();
        
        // Actualizar navegación activa
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('data-section') === section) {
                link.classList.add('active');
            }
        });

        // Ocultar todas las secciones
        const sections = document.querySelectorAll('.dashboard-section');
        sections.forEach(sec => {
            sec.style.display = 'none';
        });

        // Mostrar sección seleccionada
        const targetSection = document.getElementById(section + 'Section');
        if (targetSection) {
            targetSection.style.display = 'block';
            this.currentSection = section;
        }

        // Cargar datos específicos de la sección si es necesario
        if (section === 'transactions') {
            this.loadTransactionManagement();
        } else if (section === 'users') {
            this.loadUserManagement();
        } else if (section === 'analytics') {
            this.loadAnalytics();
        } else if (section === 'settings') {
            this.loadSettings();
        } else if (section === 'escrow') {
            this.loadEscrow();
        } else if (section === 'reconciliation') {
            this.loadReconciliation();
        } else if (section === 'ledger') {
            this.loadLedger();
        } else if (section === 'dashboard') {
            // Recargar datos del dashboard sin listeners persistentes
            this.loadDashboardData();
        }
    }

    async loadDashboardData() {
        if (!this.database) {
            console.log('⚠️ Firebase no inicializado, no se pueden cargar datos');
            return;
        }

        try {
            // Cargar todas las transacciones (solo si no están cargadas)
            if (!this.transactionsLoaded) {
                await this.loadTransactions();
            }
            
            // Cargar estadísticas de usuarios
            await this.loadUserStats();
            
            // Actualizar estadísticas
            this.updateStats();
            
            // Actualizar gráfico
            this.updateChart();
            
            // Renderizar transacciones
            this.renderTransactions();
            
        } catch (error) {
            console.error('❌ Error cargando datos del dashboard:', error);
        }
    }

    async loadTransactions() {
        return new Promise((resolve, reject) => {
            // Usar listener en tiempo real para transacciones
            const transactionsRef = this.database.ref('transactions');
            
            // Configurar listener en tiempo real
            this.transactionsListener = transactionsRef.on('value', (snapshot) => {
                try {
                    const data = snapshot.val() || {};
                    this.allTransactions = [];
                    
                    // Recopilar todas las transacciones de todos los usuarios
                    Object.keys(data).forEach(userId => {
                        const userTransactions = data[userId];
                        Object.keys(userTransactions).forEach(transactionId => {
                            const transaction = userTransactions[transactionId];
                            this.allTransactions.push({
                                id: transactionId,
                                userId: userId,
                                transaction: transaction
                            });
                        });
                    });
                    
                    // Ordenar por fecha (más recientes primero)
                    this.allTransactions.sort((a, b) => 
                        new Date(b.transaction.timestamp) - new Date(a.transaction.timestamp)
                    );
                    
                    console.log(`✅ ${this.allTransactions.length} transacciones cargadas (tiempo real)`);
                    
                    // Actualizar UI en tiempo real
                    this.updateStats();
                    this.updateChart();
                    this.renderTransactions();
                    
                    // Resolver la promesa solo la primera vez
                    if (!this.transactionsLoaded) {
                        this.transactionsLoaded = true;
                        resolve();
                    }
                    
                } catch (error) {
                    console.error('❌ Error procesando transacciones:', error);
                    if (!this.transactionsLoaded) {
                        reject(error);
                    }
                }
            }, (error) => {
                console.error('❌ Error cargando transacciones:', error);
                if (!this.transactionsLoaded) {
                    reject(error);
                }
            });
        });
    }

    async loadUserStats() {
        return new Promise((resolve, reject) => {
            // Usar once() en lugar de on() para evitar bucles infinitos
            this.database.ref('users').once('value', (snapshot) => {
                try {
                    const users = snapshot.val() || {};
                    this.stats.totalUsers = Object.keys(users).length;
                    console.log(`✅ ${this.stats.totalUsers} usuarios cargados`);
                    resolve();
                } catch (error) {
                    console.error('❌ Error cargando usuarios:', error);
                    reject(error);
                }
            }, (error) => {
                console.error('❌ Error cargando usuarios:', error);
                reject(error);
            });
        });
    }

    updateStats() {
        // Calcular estadísticas
        this.stats.totalIncome = 0;
        this.stats.totalOutcome = 0;
        this.stats.pendingTransactions = 0;

        this.allTransactions.forEach(({transaction}) => {
            if (transaction.type === 'income') {
                this.stats.totalIncome += transaction.amount || 0;
            } else if (transaction.type === 'outcome') {
                this.stats.totalOutcome += transaction.amount || 0;
            }
            
            if (transaction.status === 'pending_verification') {
                this.stats.pendingTransactions++;
            }
        });

        // Actualizar UI
        document.getElementById('totalIncome').textContent = 
            '$' + this.stats.totalIncome.toLocaleString('es-CO');
        document.getElementById('totalOutcome').textContent = 
            '$' + this.stats.totalOutcome.toLocaleString('es-CO');
        document.getElementById('pendingTransactions').textContent = 
            this.stats.pendingTransactions;
        document.getElementById('totalUsers').textContent = 
            this.stats.totalUsers;
    }

    updateChart() {
        if (!this.transactionsChart) return;

        // Agrupar transacciones por día
        const dailyData = {};
        
        this.allTransactions.forEach(({transaction}) => {
            const date = new Date(transaction.timestamp).toISOString().split('T')[0];
            if (!dailyData[date]) {
                dailyData[date] = { income: 0, outcome: 0 };
            }
            
            if (transaction.type === 'income') {
                dailyData[date].income += transaction.amount || 0;
            } else if (transaction.type === 'outcome') {
                dailyData[date].outcome += transaction.amount || 0;
            }
        });

        // Ordenar fechas y preparar datos para el gráfico
        const sortedDates = Object.keys(dailyData).sort();
        const last7Days = sortedDates.slice(-7); // Últimos 7 días
        
        const incomeData = last7Days.map(date => dailyData[date].income);
        const outcomeData = last7Days.map(date => dailyData[date].outcome);

        // Actualizar gráfico
        this.transactionsChart.data.labels = last7Days.map(date => 
            new Date(date).toLocaleDateString('es-ES', { 
                month: 'short', 
                day: 'numeric' 
            })
        );
        this.transactionsChart.data.datasets[0].data = incomeData;
        this.transactionsChart.data.datasets[1].data = outcomeData;
        this.transactionsChart.update();
    }

    renderTransactions() {
        const list = document.getElementById('transactionsList');
        if (!list) return;

        // Filtrar transacciones según el filtro seleccionado
        let filteredTransactions = this.allTransactions;
        
        if (this.currentFilter === 'pending') {
            filteredTransactions = this.allTransactions.filter(t => 
                t.transaction.status === 'pending_verification'
            );
        } else if (this.currentFilter === 'approved') {
            filteredTransactions = this.allTransactions.filter(t => 
                t.transaction.status === 'completed'
            );
        } else if (this.currentFilter === 'rejected') {
            filteredTransactions = this.allTransactions.filter(t => 
                t.transaction.status === 'rejected'
            );
        }

        if (filteredTransactions.length === 0) {
            list.innerHTML = `
                <div class="no-transactions">
                    <i class="fas fa-receipt"></i>
                    <p>No hay transacciones para mostrar</p>
                </div>
            `;
            return;
        }

        // Renderizar transacciones (máximo 10)
        const recentTransactions = filteredTransactions.slice(0, 10);
        list.innerHTML = recentTransactions.map(({id, userId, transaction}) => 
            this.renderTransactionItem(id, userId, transaction)
        ).join('');
    }

    renderTransactionItem(transactionId, userId, transaction) {
        // Helpers de escape (evitan XSS con datos controlados por el usuario).
        const esc = (typeof escapeHtml === 'function') ? escapeHtml : (v) => String(v == null ? '' : v);
        const escAttr = (typeof escapeAttr === 'function') ? escapeAttr : esc;
        const safe = (typeof safeUrl === 'function') ? safeUrl : (u) => u;

        // Determinar el estado
        let statusBadge = '';
        let statusColor = '';
        let statusIcon = '';
        
        if (transaction.status === 'pending_verification') {
            statusBadge = 'Pendiente';
            statusColor = '#ff9800';
            statusIcon = 'fas fa-clock';
        } else if (transaction.status === 'completed') {
            statusBadge = 'Aprobado';
            statusColor = '#4CAF50';
            statusIcon = 'fas fa-check';
        } else if (transaction.status === 'rejected') {
            statusBadge = 'Rechazado';
            statusColor = '#f44336';
            statusIcon = 'fas fa-times';
        }

        const transactionIcon = transaction.type === 'income' ? 'fas fa-arrow-up' : 'fas fa-arrow-down';
        const transactionColor = transaction.type === 'income' ? 'var(--primary-color)' : '#f44336';

        // Monto seguro (entero) y fecha segura.
        const amountInt = (typeof escapeInt === 'function') ? escapeInt(transaction.amount, 0) : (parseInt(transaction.amount, 10) || 0);
        const safeDate = (() => {
            const d = new Date(transaction.timestamp);
            return isNaN(d.getTime()) ? 'N/A' : d.toLocaleString('es-ES');
        })();

        // IDs usados en atributos onclick: se escapan para evitar romper el HTML.
        const txIdAttr = escAttr(transactionId);
        const userIdAttr = escAttr(userId);

        return `
            <div class="transaction-item">
                <div class="transaction-info">
                    <div class="transaction-icon" style="background: ${transactionColor};">
                        <i class="${transactionIcon}"></i>
                    </div>
                    <div class="transaction-details">
                        <h4>
                            ${transaction.type === 'income' ? 'Depósito' : 'Retiro'} 
                            ${statusBadge ? `<span style="background: ${statusColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px; margin-left: 8px;">
                                <i class="${statusIcon}"></i> ${statusBadge}
                            </span>` : ''}
                        </h4>
                        <p><strong>Usuario:</strong> ${esc(userId)}</p>
                        <p><strong>Monto:</strong> $${amountInt.toLocaleString('es-CO')} COP</p>
                        <p><strong>Método:</strong> ${esc(transaction.method || 'N/A')}</p>
                        <p><strong>Fecha:</strong> ${esc(safeDate)}</p>
                        ${transaction.proofFileName ? `<p><strong>Comprobante:</strong> ${esc(transaction.proofFileName)}</p>` : ''}
                        ${transaction.adminMessage ? `
                            <div class="admin-message">
                                <h4><i class="fas fa-comment"></i> Mensaje del Administrador:</h4>
                                <p>${esc(transaction.adminMessage)}</p>
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="transaction-actions">
                    ${transaction.proofImage ? `
                        <button class="btn-admin btn-view" onclick="adminApp.showProof('${txIdAttr}', '${userIdAttr}')">
                            <i class="fas fa-eye"></i> Ver Comprobante
                        </button>
                    ` : ''}
                    ${transaction.status === 'pending_verification' ? `
                        <button class="btn-admin btn-approve" onclick="adminApp.showMessageModal('${txIdAttr}', '${userIdAttr}', ${amountInt}, 'approve')">
                            <i class="fas fa-check"></i> Aprobar
                        </button>
                        <button class="btn-admin btn-reject" onclick="adminApp.showMessageModal('${txIdAttr}', '${userIdAttr}', ${amountInt}, 'reject')">
                            <i class="fas fa-times"></i> Rechazar
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    showProof(transactionId, userId) {
        const modal = document.getElementById('proofModal');
        const container = document.getElementById('proofImageContainer');

        // Buscar la transacción real en memoria (no confiar en el HTML).
        const entry = this.allTransactions.find(t => t.id === transactionId && t.userId === userId);
        const rawProof = entry && entry.transaction ? entry.transaction.proofImage : null;

        // Validar esquema de la URL (bloquea javascript:, data:text/html, etc.).
        const safeProof = (typeof safeUrl === 'function') ? safeUrl(rawProof) : rawProof;

        if (modal && container) {
            if (!safeProof) {
                container.innerHTML = '<p style="color:#f44336;">Comprobante no disponible o inválido.</p>';
            } else {
                const img = document.createElement('img');
                img.src = safeProof;
                img.style.cssText = 'max-width: 100%; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.3);';
                container.innerHTML = '';
                container.appendChild(img);
            }
            modal.style.display = 'flex';
        }
    }

    showMessageModal(transactionId, userId, amount, action) {
        this.pendingAction = {
            transactionId,
            userId,
            amount,
            action
        };
        
        const modal = document.getElementById('messageModal');
        const messageInput = document.getElementById('adminMessage');
        
        if (modal && messageInput) {
            // Limpiar mensaje anterior
            messageInput.value = '';
            
            // Cambiar placeholder según la acción
            if (action === 'approve') {
                messageInput.placeholder = 'Escribe un mensaje explicando por qué se aprueba la transacción...';
            } else if (action === 'reject') {
                messageInput.placeholder = 'Escribe un mensaje explicando por qué se rechaza la transacción...';
            } else {
                messageInput.placeholder = 'Escribe un mensaje para el usuario...';
            }
            
            modal.style.display = 'flex';
        }
    }

    async saveAdminMessage() {
        const messageInput = document.getElementById('adminMessage');
        const message = messageInput ? messageInput.value.trim() : '';
        
        if (!this.pendingAction) {
            console.error('❌ No hay acción pendiente');
            return;
        }

        const { transactionId, userId, amount, action } = this.pendingAction;

        try {
            if (action === 'approve') {
                await this.approveTransactionWithMessage(transactionId, userId, amount, message);
            } else if (action === 'reject') {
                await this.rejectTransactionWithMessage(transactionId, userId, message);
            } else if (action === 'message') {
                await this.addMessageToTransaction(transactionId, userId, message);
            }

            this.closeModal('messageModal');
            this.loadDashboardData(); // Recargar datos
            
        } catch (error) {
            console.error('❌ Error procesando acción:', error);
            alert('❌ Error al procesar la acción');
        }
    }

    async approveTransactionWithMessage(transactionId, userId, amount, message) {
        if (!this.database) {
            alert('❌ Firebase no disponible');
            return;
        }

        try {
            console.log('🔍 Debug: Aprobando transacción con mensaje:', transactionId);

            const transactionRef = this.database.ref(`transactions/${userId}/${transactionId}`);
            const txSnap = await transactionRef.once('value');
            const transactionData = txSnap.val();

            if (!transactionData) {
                alert('❌ Transacción no encontrada.');
                return;
            }

            // IDEMPOTENCIA: evitar doble aprobación (doble crédito/débito).
            if (transactionData.status === 'completed') {
                alert('ℹ️ Esta transacción ya fue aprobada.');
                return;
            }
            if (transactionData.status === 'rejected') {
                alert('❌ Esta transacción fue rechazada y no puede aprobarse.');
                return;
            }

            const transactionType = transactionData.type || 'income';
            // SEGURIDAD: usar SIEMPRE el monto almacenado en Firebase, no el que
            // llega desde el DOM (evita manipulación del HTML/atributos onclick).
            const amt = parseInt(transactionData.amount, 10);
            if (!Number.isFinite(amt) || amt <= 0) {
                alert('❌ Monto inválido.');
                return;
            }
            // Advertir si el monto del DOM no coincide con el real (posible manipulación).
            if (parseInt(amount, 10) !== amt) {
                console.warn('⚠️ El monto del DOM no coincide con el de Firebase; se usa el de Firebase.');
            }

            // CORRECCIÓN: mover el dinero PRIMERO y solo marcar 'completed' si tuvo
            // éxito. Antes se marcaba 'completed' antes de mover dinero; si el
            // crédito/débito fallaba, la transacción quedaba completada SIN mover
            // fondos y el reintento se bloqueaba por "ya fue aprobada" (dinero
            // perdido). El opId (approve_<id>) hace la operación idempotente.
            //  - Si es un retiro (outcome) que YA reservó fondos al solicitarse
            //    (fundsReserved === true), NO descontar de nuevo.
            if (transactionType === 'outcome' && transactionData.fundsReserved === true) {
                console.log('ℹ️ Retiro con fondos ya reservados: no se descuenta de nuevo.');
            } else if (window.DeseoMoney) {
                if (transactionType === 'outcome') {
                    // Retiro aprobado: debitar al usuario objetivo (server-authoritative).
                    var rCh = await window.DeseoMoney.adminCharge(this.database, userId, amt, {
                        reason: 'withdrawal_approved', opId: `approve_${transactionId}`
                    });
                    if (rCh && rCh.ok === false) {
                        console.error('❌ No se pudo debitar (admin):', rCh.reason);
                        alert('❌ No se pudo descontar el saldo: ' + (rCh.reason || 'error'));
                        return;
                    }
                } else {
                    // Depósito aprobado: acreditar al usuario objetivo (server-authoritative).
                    var rCr = await window.DeseoMoney.adminCredit(this.database, userId, amt, {
                        reason: 'deposit_approved', opId: `approve_${transactionId}`
                    });
                    if (rCr && rCr.ok === false) {
                        console.error('❌ No se pudo acreditar (admin):', rCr.reason);
                        alert('❌ No se pudo acreditar el saldo: ' + (rCr.reason || 'error') +
                            (rCr.reason === 'forbidden' ? ' (tu cuenta no tiene permisos de admin en el servidor)' : ''));
                        return;
                    }
                }
            } else {
                console.error('❌ DeseoMoney no disponible; no se ajustó el balance por seguridad.');
                alert('❌ Motor de dinero no disponible. No se aprobó la transacción.');
                return;
            }

            // Dinero movido con éxito: ahora sí marcar la transacción como completada.
            await transactionRef.update({
                status: 'completed',
                adminMessage: message || null,
                adminActionDate: new Date().toISOString()
            });

            console.log('✅ Transacción aprobada con mensaje exitosamente');
            const actionMessage = transactionType === 'outcome' 
                ? 'Retiro aprobado. El dinero será transferido a la cuenta bancaria del usuario.'
                : 'Depósito aprobado. El dinero se ha acreditado a la billetera del usuario.';
            alert(`✅ Transacción aprobada. ${actionMessage}`);
            
        } catch (error) {
            console.error('❌ Error aprobando transacción:', error);
            throw error;
        }
    }

    async rejectTransactionWithMessage(transactionId, userId, message) {
        if (!this.database) {
            alert('❌ Firebase no disponible');
            return;
        }

        try {
            console.log('🔍 Debug: Rechazando transacción con mensaje:', transactionId);

            const transactionRef = this.database.ref(`transactions/${userId}/${transactionId}`);
            const txSnap = await transactionRef.once('value');
            const transactionData = txSnap.val();

            if (!transactionData) {
                alert('❌ Transacción no encontrada.');
                return;
            }
            if (transactionData.status === 'rejected') {
                alert('ℹ️ Esta transacción ya fue rechazada.');
                return;
            }
            if (transactionData.status === 'completed') {
                alert('❌ Esta transacción ya fue aprobada y no puede rechazarse.');
                return;
            }

            // REEMBOLSO primero: si era un retiro (outcome) cuyos fondos ya se habían
            // reservado al solicitar, devolver el saldo al usuario ANTES de marcar
            // 'rejected'. Así, si el reembolso falla, la transacción sigue en su estado
            // previo y puede reintentarse (no se pierde el dinero). opId fijo => idempotente.
            if (transactionData.type === 'outcome' && transactionData.fundsReserved === true && window.DeseoMoney) {
                const amt = parseInt(transactionData.amount, 10);
                if (Number.isFinite(amt) && amt > 0) {
                    const rr = await window.DeseoMoney.adminCredit(this.database, userId, amt, {
                        reason: 'withdrawal_rejected_refund', opId: `refund_${transactionId}`
                    });
                    if (rr && rr.ok === false) {
                        console.error('❌ No se pudo reembolsar (admin):', rr.reason);
                        alert('❌ No se pudo reembolsar el saldo: ' + (rr.reason || 'error') + '. La transacción NO se rechazó para evitar perder el dinero.');
                        return;
                    }
                    await transactionRef.update({ fundsReserved: false, refundedAt: new Date().toISOString() });
                }
            }

            // Reembolso OK (o no aplicaba): marcar la transacción como rechazada.
            await transactionRef.update({
                status: 'rejected',
                adminMessage: message || null,
                adminActionDate: new Date().toISOString()
            });

            console.log('✅ Transacción rechazada con mensaje');
            alert('✅ Transacción rechazada.');
            
        } catch (error) {
            console.error('❌ Error rechazando transacción:', error);
            throw error;
        }
    }

    async addMessageToTransaction(transactionId, userId, message) {
        if (!this.database) {
            alert('❌ Firebase no disponible');
            return;
        }

        try {
            console.log('🔍 Debug: Agregando mensaje a transacción:', transactionId);
            
            // Solo agregar mensaje sin cambiar estado
            const transactionRef = this.database.ref(`transactions/${userId}/${transactionId}`);
            await transactionRef.update({
                adminMessage: message || null,
                adminActionDate: new Date().toISOString()
            });
            
            console.log('✅ Mensaje agregado a transacción');
            alert('✅ Mensaje agregado correctamente.');
            
        } catch (error) {
            console.error('❌ Error agregando mensaje:', error);
            throw error;
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // ===== GESTIÓN DE TRANSACCIONES AVANZADA =====
    async loadTransactionManagement() {
        console.log('📊 Cargando gestión de transacciones...');
        await this.loadAdvancedTransactions();
        this.updateTransactionStats();
    }

    async loadAdvancedTransactions() {
        if (!this.database) {
            console.log('⚠️ Firebase no disponible');
            return;
        }

        try {
            const transactionsRef = this.database.ref('transactions');
            const snapshot = await transactionsRef.once('value');
            const transactionsData = snapshot.val();
            
            this.allTransactions = [];
            if (transactionsData) {
                Object.keys(transactionsData).forEach(userId => {
                    const userTransactions = transactionsData[userId];
                    Object.keys(userTransactions).forEach(transactionId => {
                        this.allTransactions.push({
                            id: transactionId,
                            userId: userId,
                            transaction: userTransactions[transactionId]
                        });
                    });
                });
            }

            this.renderAdvancedTransactions();
        } catch (error) {
            console.error('❌ Error cargando transacciones:', error);
        }
    }

    renderAdvancedTransactions() {
        const list = document.getElementById('advancedTransactionsList');
        if (!list) return;

        if (this.allTransactions.length === 0) {
            list.innerHTML = `
                <div class="no-transactions">
                    <i class="fas fa-inbox"></i>
                    <p>No hay transacciones disponibles</p>
                </div>
            `;
            return;
        }

        list.innerHTML = this.allTransactions.map(({id, userId, transaction}) => 
            this.renderTransactionItem(id, userId, transaction)
        ).join('');
    }

    updateTransactionStats() {
        const deposits = this.allTransactions
            .filter(t => t.transaction.type === 'income' && t.transaction.status === 'completed')
            .reduce((sum, t) => sum + (t.transaction.amount || 0), 0);
        
        const withdrawals = this.allTransactions
            .filter(t => t.transaction.type === 'outcome' && t.transaction.status === 'completed')
            .reduce((sum, t) => sum + (t.transaction.amount || 0), 0);
        
        const pending = this.allTransactions
            .filter(t => t.transaction.status === 'pending_verification').length;
        
        const activeUsers = new Set(this.allTransactions.map(t => t.userId)).size;

        document.getElementById('totalDeposits').textContent = `$${deposits.toLocaleString('es-CO')}`;
        document.getElementById('totalWithdrawals').textContent = `$${withdrawals.toLocaleString('es-CO')}`;
        document.getElementById('pendingCount').textContent = pending;
        document.getElementById('activeUsers').textContent = activeUsers;
    }

    applyAdvancedFilters() {
        const statusFilter = document.getElementById('statusFilter')?.value || 'all';
        const typeFilter = document.getElementById('typeFilter')?.value || 'all';
        const dateFrom = document.getElementById('dateFrom')?.value;
        const dateTo = document.getElementById('dateTo')?.value;
        const userSearch = document.getElementById('userSearch')?.value?.toLowerCase();

        let filtered = this.allTransactions;

        if (statusFilter !== 'all') {
            filtered = filtered.filter(t => t.transaction.status === statusFilter);
        }

        if (typeFilter !== 'all') {
            filtered = filtered.filter(t => t.transaction.type === typeFilter);
        }

        if (dateFrom) {
            const fromDate = new Date(dateFrom);
            filtered = filtered.filter(t => new Date(t.transaction.timestamp) >= fromDate);
        }

        if (dateTo) {
            const toDate = new Date(dateTo);
            toDate.setHours(23, 59, 59, 999);
            filtered = filtered.filter(t => new Date(t.transaction.timestamp) <= toDate);
        }

        if (userSearch) {
            filtered = filtered.filter(t => 
                t.userId.toLowerCase().includes(userSearch) ||
                (t.transaction.userEmail && t.transaction.userEmail.toLowerCase().includes(userSearch))
            );
        }

        const list = document.getElementById('advancedTransactionsList');
        if (list) {
            list.innerHTML = filtered.map(({id, userId, transaction}) => 
                this.renderTransactionItem(id, userId, transaction)
            ).join('');
        }
    }

    clearFilters() {
        document.getElementById('statusFilter').value = 'all';
        document.getElementById('typeFilter').value = 'all';
        document.getElementById('dateFrom').value = '';
        document.getElementById('dateTo').value = '';
        document.getElementById('userSearch').value = '';
        this.renderAdvancedTransactions();
    }

    exportTransactions(format) {
        const data = this.allTransactions.map(({id, userId, transaction}) => ({
            ID: id,
            Usuario: userId,
            Tipo: transaction.type === 'income' ? 'Depósito' : 'Retiro',
            Monto: transaction.amount,
            Estado: transaction.status,
            Fecha: new Date(transaction.timestamp).toLocaleString('es-ES'),
            Método: transaction.method || 'N/A',
            Comprobante: transaction.proofFileName || 'N/A'
        }));

        if (format === 'csv') {
            this.downloadCSV(data, 'transacciones.csv');
        } else if (format === 'excel') {
            this.downloadExcel(data, 'transacciones.xlsx');
        }
    }

    downloadCSV(data, filename) {
        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(','),
            ...data.map(row => headers.map(header => `"${row[header]}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
    }

    downloadExcel(data, filename) {
        // Si SheetJS está disponible, generar un .xlsx real; si no, CSV de respaldo.
        if (typeof XLSX !== 'undefined') {
            try {
                const ws = XLSX.utils.json_to_sheet(data);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Datos');
                XLSX.writeFile(wb, filename);
                return;
            } catch (e) {
                console.warn('⚠️ Error generando Excel, se usa CSV:', e && e.message);
            }
        }
        this.downloadCSV(data, filename.replace('.xlsx', '.csv'));
    }

    // ===== GESTIÓN DE USUARIOS =====
    async loadUserManagement() {
        console.log('👥 Cargando gestión de usuarios...');
        await this.loadUsers();
        this.updateUserStats();
    }

    async loadUsers() {
        if (!this.database) {
            console.log('⚠️ Firebase no disponible');
            return;
        }

        try {
            const usersRef = this.database.ref('users');
            const snapshot = await usersRef.once('value');
            const usersData = snapshot.val();
            
            this.allUsers = [];
            if (usersData) {
                Object.keys(usersData).forEach(userId => {
                    this.allUsers.push({
                        id: userId,
                        ...usersData[userId]
                    });
                });
            }

            // Enriquecer el balance con la FUENTE AUTORITATIVA (Supabase).
            // Firebase queda como valor de respaldo si Supabase no responde.
            try {
                if (window.DeseoMoney && window.DeseoMoney.getBalance) {
                    await Promise.all(this.allUsers.map(async (u) => {
                        try {
                            const b = await window.DeseoMoney.getBalance(this.database, u.id);
                            if (typeof b === 'number' && Number.isFinite(b)) u.balance = b;
                        } catch (_) { /* noop */ }
                    }));
                }
            } catch (_) { /* noop */ }

            this.renderUsers();
        } catch (error) {
            console.error('❌ Error cargando usuarios:', error);
        }
    }

    renderUsers() {
        const list = document.getElementById('usersList');
        if (!list) return;

        if (this.allUsers.length === 0) {
            list.innerHTML = `
                <div class="no-transactions">
                    <i class="fas fa-users"></i>
                    <p>No hay usuarios registrados</p>
                </div>
            `;
            return;
        }

        list.innerHTML = this.allUsers.map(user => this.renderUserItem(user)).join('');
    }

    renderUserItem(user) {
        // Helpers de escape (evitan XSS con datos controlados por el usuario).
        const esc = (typeof escapeHtml === 'function') ? escapeHtml : (v) => String(v == null ? '' : v);
        const escAttr = (typeof escapeAttr === 'function') ? escapeAttr : esc;

        const statusBadge = user.status === 'active' ? 
            '<span style="background: #4CAF50; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px;">Activo</span>' :
            '<span style="background: #f44336; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px;">Inactivo</span>';

        const balanceInt = (typeof escapeInt === 'function') ? escapeInt(user.balance, 0) : (parseInt(user.balance, 10) || 0);
        const safeDate = user.lastUpdated ? new Date(user.lastUpdated).toLocaleString('es-ES') : 'N/A';
        const userIdAttr = escAttr(user.id);

        return `
            <div class="user-item">
                <div class="user-info">
                    <div class="user-avatar">
                        <i class="fas fa-user"></i>
                    </div>
                    <div class="user-details">
                        <h4>${esc(user.email || user.id)} ${statusBadge}</h4>
                        <p><strong>ID:</strong> ${esc(user.id)}</p>
                        <p><strong>Balance:</strong> $${balanceInt.toLocaleString('es-CO')} COP</p>
                        <p><strong>Última actividad:</strong> ${esc(safeDate)}</p>
                    </div>
                </div>
                <div class="user-actions">
                    <button class="btn-admin btn-view" onclick="adminApp.viewUserDetails('${userIdAttr}')">
                        <i class="fas fa-eye"></i> Ver
                    </button>
                    <button class="btn-admin btn-message" onclick="adminApp.messageUser('${userIdAttr}')">
                        <i class="fas fa-comment"></i> Mensaje
                    </button>
                    <button class="btn-admin btn-warning" onclick="adminApp.openAdjustBalanceModal('${userIdAttr}')">
                        <i class="fas fa-wallet"></i> Ajustar Saldo
                    </button>
                    ${user.status === 'active' ? 
                        `<button class="btn-admin btn-reject" onclick="adminApp.banUser('${userIdAttr}')">
                            <i class="fas fa-ban"></i> Suspender
                        </button>` :
                        `<button class="btn-admin btn-approve" onclick="adminApp.unbanUser('${userIdAttr}')">
                            <i class="fas fa-check"></i> Activar
                        </button>`
                    }
                </div>
            </div>
        `;
    }

    updateUserStats() {
        const total = this.allUsers.length;
        const active = this.allUsers.filter(u => u.status === 'active').length;
        const newUsers = this.allUsers.filter(u => {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            return new Date(u.lastUpdated || 0) > weekAgo;
        }).length;
        const banned = this.allUsers.filter(u => u.status === 'banned').length;

        document.getElementById('totalUsersCount').textContent = total;
        document.getElementById('activeUsersCount').textContent = active;
        document.getElementById('newUsersCount').textContent = newUsers;
        document.getElementById('bannedUsersCount').textContent = banned;
    }

    searchUsers() {
        const searchTerm = document.getElementById('userSearchInput')?.value?.toLowerCase();
        const statusFilter = document.getElementById('userStatusFilter')?.value;

        let filtered = this.allUsers;

        if (searchTerm) {
            filtered = filtered.filter(user => 
                user.id.toLowerCase().includes(searchTerm) ||
                (user.email && user.email.toLowerCase().includes(searchTerm))
            );
        }

        if (statusFilter !== 'all') {
            filtered = filtered.filter(user => user.status === statusFilter);
        }

        const list = document.getElementById('usersList');
        if (list) {
            list.innerHTML = filtered.map(user => this.renderUserItem(user)).join('');
        }
    }

    viewUserDetails(userId) {
        const user = this.allUsers.find(u => u.id === userId);
        if (user) {
            alert(`Detalles del usuario:\n\nID: ${user.id}\nEmail: ${user.email || 'N/A'}\nBalance: $${(user.balance || 0).toLocaleString('es-CO')}\nEstado: ${user.status}\nÚltima actividad: ${user.lastUpdated ? new Date(user.lastUpdated).toLocaleString('es-ES') : 'N/A'}`);
        }
    }

    messageUser(userId) {
        const message = prompt('Escribe un mensaje para el usuario:');
        if (message) {
            // Aquí se implementaría el envío de mensaje al usuario
            alert('Mensaje enviado al usuario');
        }
    }

    async banUser(userId) {
        if (confirm('¿Estás seguro de suspender este usuario?')) {
            try {
                await this.database.ref(`users/${userId}/status`).set('banned');
                alert('Usuario suspendido');
                this.loadUserManagement();
            } catch (error) {
                console.error('❌ Error suspendiendo usuario:', error);
                alert('Error al suspender usuario');
            }
        }
    }

    async unbanUser(userId) {
        try {
            await this.database.ref(`users/${userId}/status`).set('active');
            alert('Usuario activado');
            this.loadUserManagement();
        } catch (error) {
            console.error('❌ Error activando usuario:', error);
            alert('Error al activar usuario');
        }
    }

    showCreateUserModal() {
        alert('Funcionalidad de crear usuario en desarrollo');
    }

    // ===== ANALYTICS AVANZADOS =====
    async loadAnalytics() {
        console.log('📈 Cargando analytics avanzados...');
        await this.loadAnalyticsData();
        this.initializeAnalyticsCharts();
    }

    async loadAnalyticsData() {
        // Cargar datos para analytics
        this.analyticsData = {
            revenue: this.calculateRevenueData(),
            userGrowth: this.calculateUserGrowth(),
            transactionVolume: this.calculateTransactionVolume(),
            approvalRate: this.calculateApprovalRate()
        };
    }

    calculateRevenueData() {
        const last30Days = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dayTransactions = this.allTransactions.filter(t => {
                const transactionDate = new Date(t.transaction.timestamp);
                return transactionDate.toDateString() === date.toDateString() && 
                       t.transaction.type === 'income' && 
                       t.transaction.status === 'completed';
            });
            const revenue = dayTransactions.reduce((sum, t) => sum + (t.transaction.amount || 0), 0);
            last30Days.push({ date: date.toISOString().split('T')[0], revenue });
        }
        return last30Days;
    }

    calculateUserGrowth() {
        const last30Days = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dayUsers = this.allUsers.filter(u => {
                const userDate = new Date(u.lastUpdated || 0);
                return userDate.toDateString() === date.toDateString();
            });
            last30Days.push({ date: date.toISOString().split('T')[0], users: dayUsers.length });
        }
        return last30Days;
    }

    calculateTransactionVolume() {
        return this.allTransactions.length;
    }

    calculateApprovalRate() {
        const completed = this.allTransactions.filter(t => t.transaction.status === 'completed').length;
        const total = this.allTransactions.filter(t => t.transaction.status !== 'pending_verification').length;
        return total > 0 ? Math.round((completed / total) * 100) : 0;
    }

    initializeAnalyticsCharts() {
        this.initializeRevenueChart();
        this.initializeTransactionDistributionChart();
        this.initializeUserActivityChart();
        this.initializeApprovalTrendsChart();
        this.updateAnalyticsMetrics();
    }

    initializeRevenueChart() {
        const ctx = document.getElementById('revenueChart');
        if (!ctx) return;

        const data = this.analyticsData.revenue;
        
        this.revenueChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => new Date(d.date).toLocaleDateString('es-ES')),
                datasets: [{
                    label: 'Ingresos (COP)',
                    data: data.map(d => d.revenue),
                    borderColor: 'var(--primary-color)',
                    backgroundColor: 'rgba(96, 196, 142, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        labels: {
                            color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#e0e0e0' : '#333'
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#e0e0e0' : '#333'
                        }
                    },
                    x: {
                        ticks: {
                            color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#e0e0e0' : '#333'
                        }
                    }
                }
            }
        });
    }

    initializeTransactionDistributionChart() {
        const ctx = document.getElementById('transactionDistributionChart');
        if (!ctx) return;

        const income = this.allTransactions.filter(t => t.transaction.type === 'income').length;
        const outcome = this.allTransactions.filter(t => t.transaction.type === 'outcome').length;

        this.transactionDistributionChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Depósitos', 'Retiros'],
                datasets: [{
                    data: [income, outcome],
                    backgroundColor: ['var(--primary-color)', '#f44336'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        labels: {
                            color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#e0e0e0' : '#333'
                        }
                    }
                }
            }
        });
    }

    initializeUserActivityChart() {
        const ctx = document.getElementById('userActivityChart');
        if (!ctx) return;

        const data = this.analyticsData.userGrowth;
        
        this.userActivityChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => new Date(d.date).toLocaleDateString('es-ES')),
                datasets: [{
                    label: 'Usuarios Activos',
                    data: data.map(d => d.users),
                    backgroundColor: 'var(--primary-color)',
                    borderColor: 'var(--primary-dark)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        labels: {
                            color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#e0e0e0' : '#333'
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#e0e0e0' : '#333'
                        }
                    },
                    x: {
                        ticks: {
                            color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#e0e0e0' : '#333'
                        }
                    }
                }
            }
        });
    }

    initializeApprovalTrendsChart() {
        const ctx = document.getElementById('approvalTrendsChart');
        if (!ctx) return;

        // Datos simulados para tendencias de aprobación
        const data = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dayTransactions = this.allTransactions.filter(t => {
                const transactionDate = new Date(t.transaction.timestamp);
                return transactionDate.toDateString() === date.toDateString();
            });
            const approved = dayTransactions.filter(t => t.transaction.status === 'completed').length;
            const total = dayTransactions.filter(t => t.transaction.status !== 'pending_verification').length;
            const rate = total > 0 ? (approved / total) * 100 : 0;
            data.push({ date: date.toISOString().split('T')[0], rate });
        }

        this.approvalTrendsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => new Date(d.date).toLocaleDateString('es-ES')),
                datasets: [{
                    label: 'Tasa de Aprobación (%)',
                    data: data.map(d => d.rate),
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        labels: {
                            color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#e0e0e0' : '#333'
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#e0e0e0' : '#333'
                        }
                    },
                    x: {
                        ticks: {
                            color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#e0e0e0' : '#333'
                        }
                    }
                }
            }
        });
    }

    updateAnalyticsMetrics() {
        const revenueGrowth = this.calculateGrowthRate(this.analyticsData.revenue.map(d => d.revenue));
        const userGrowth = this.calculateGrowthRate(this.analyticsData.userGrowth.map(d => d.users));

        document.getElementById('revenueGrowth').textContent = `+${revenueGrowth}%`;
        document.getElementById('userGrowth').textContent = `+${userGrowth}%`;
        document.getElementById('transactionVolume').textContent = this.analyticsData.transactionVolume;
        document.getElementById('approvalRate').textContent = `${this.analyticsData.approvalRate}%`;
    }

    calculateGrowthRate(values) {
        if (values.length < 2) return 0;
        const firstHalf = values.slice(0, Math.floor(values.length / 2));
        const secondHalf = values.slice(Math.floor(values.length / 2));
        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        return firstAvg > 0 ? Math.round(((secondAvg - firstAvg) / firstAvg) * 100) : 0;
    }

    updateAnalytics() {
        this.loadAnalytics();
    }

    generateReport(type) {
        console.log(`📄 Generando reporte: ${type}`);
        let data = [];
        let filename = 'reporte.csv';

        if (type === 'financial') {
            const income = this.allTransactions
                .filter(t => t.transaction.type === 'income' && t.transaction.status === 'completed')
                .reduce((s, t) => s + (t.transaction.amount || 0), 0);
            const outcome = this.allTransactions
                .filter(t => t.transaction.type === 'outcome' && t.transaction.status === 'completed')
                .reduce((s, t) => s + (t.transaction.amount || 0), 0);
            data = [
                { Concepto: 'Ingresos Totales (aprobados)', Valor: income },
                { Concepto: 'Retiros Totales (aprobados)', Valor: outcome },
                { Concepto: 'Balance Neto', Valor: income - outcome },
                { Concepto: 'Transacciones Pendientes', Valor: this.stats.pendingTransactions },
                { Concepto: 'Total Usuarios', Valor: this.stats.totalUsers },
                { Concepto: 'Fecha de generación', Valor: new Date().toLocaleString('es-ES') }
            ];
            filename = 'reporte_financiero.csv';
        } else if (type === 'users') {
            data = this.allUsers.map(u => ({
                ID: u.id,
                Email: u.email || 'N/A',
                Balance: u.balance || 0,
                Estado: u.status || 'N/A',
                'Última actividad': u.lastUpdated ? new Date(u.lastUpdated).toLocaleString('es-ES') : 'N/A'
            }));
            filename = 'reporte_usuarios.csv';
        } else if (type === 'transactions') {
            data = this.allTransactions.map(({ id, userId, transaction }) => ({
                ID: id,
                Usuario: userId,
                Tipo: transaction.type === 'income' ? 'Depósito' : 'Retiro',
                Monto: transaction.amount,
                Estado: transaction.status,
                Fecha: new Date(transaction.timestamp).toLocaleString('es-ES'),
                Método: transaction.method || 'N/A'
            }));
            filename = 'reporte_transacciones.csv';
        }

        if (data.length === 0) { alert('No hay datos para generar el reporte.'); return; }
        this.downloadCSV(data, filename);
        alert('✅ Reporte generado y descargado.');
    }

    // ===== CONFIGURACIÓN DEL SISTEMA =====
    async loadSettings() {
        console.log('⚙️ Cargando configuración...');
        await this.loadSystemSettings();
    }

    async loadSystemSettings() {
        if (!this.database) {
            console.log('⚠️ Firebase no disponible');
            return;
        }

        try {
            const settingsRef = this.database.ref('admin/settings');
            const snapshot = await settingsRef.once('value');
            const settings = snapshot.val() || this.getDefaultSettings();

            this.populateSettingsForm(settings);
        } catch (error) {
            console.error('❌ Error cargando configuraciones:', error);
            this.populateSettingsForm(this.getDefaultSettings());
        }
    }

    getDefaultSettings() {
        return {
            platformName: 'Deseo',
            contactEmail: 'admin@deseo.com',
            dailyDepositLimit: 1000000,
            dailyWithdrawalLimit: 500000,
            autoApproveSmall: true,
            requireProof: true,
            approvalTimeout: 24,
            transactionFee: 2.5,
            twoFactorAuth: true,
            sessionTimeout: true,
            maxLoginAttempts: 5,
            lockoutDuration: 30,
            emailNotifications: true,
            pushNotifications: true,
            transactionAlerts: true,
            reportFrequency: 7
        };
    }

    populateSettingsForm(settings) {
        Object.keys(settings).forEach(key => {
            const element = document.getElementById(key);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = settings[key];
                } else {
                    element.value = settings[key];
                }
            }
        });
    }

    async saveSettings() {
        if (!this.database) {
            alert('❌ Firebase no disponible');
            return;
        }

        try {
            const settings = {
                platformName: document.getElementById('platformName')?.value || 'Deseo',
                contactEmail: document.getElementById('contactEmail')?.value || 'admin@deseo.com',
                dailyDepositLimit: parseInt(document.getElementById('dailyDepositLimit')?.value) || 1000000,
                dailyWithdrawalLimit: parseInt(document.getElementById('dailyWithdrawalLimit')?.value) || 500000,
                autoApproveSmall: document.getElementById('autoApproveSmall')?.checked || false,
                requireProof: document.getElementById('requireProof')?.checked || false,
                approvalTimeout: parseInt(document.getElementById('approvalTimeout')?.value) || 24,
                transactionFee: parseFloat(document.getElementById('transactionFee')?.value) || 2.5,
                twoFactorAuth: document.getElementById('twoFactorAuth')?.checked || false,
                sessionTimeout: document.getElementById('sessionTimeout')?.checked || false,
                maxLoginAttempts: parseInt(document.getElementById('maxLoginAttempts')?.value) || 5,
                lockoutDuration: parseInt(document.getElementById('lockoutDuration')?.value) || 30,
                emailNotifications: document.getElementById('emailNotifications')?.checked || false,
                pushNotifications: document.getElementById('pushNotifications')?.checked || false,
                transactionAlerts: document.getElementById('transactionAlerts')?.checked || false,
                reportFrequency: parseInt(document.getElementById('reportFrequency')?.value) || 7,
                lastUpdated: new Date().toISOString()
            };

            await this.database.ref('admin/settings').set(settings);
            alert('✅ Configuraciones guardadas correctamente');
        } catch (error) {
            console.error('❌ Error guardando configuraciones:', error);
            alert('❌ Error al guardar configuraciones');
        }
    }

    resetSettings() {
        if (confirm('¿Estás seguro de restaurar los valores por defecto?')) {
            this.populateSettingsForm(this.getDefaultSettings());
            alert('✅ Configuraciones restauradas a valores por defecto');
        }
    }

    clearCache() {
        if (confirm('¿Estás seguro de limpiar el caché?')) {
            localStorage.clear();
            sessionStorage.clear();
            alert('✅ Caché limpiado correctamente');
        }
    }

    async backupData() {
        if (!this.database) { alert('❌ Firebase no disponible'); return; }
        if (!confirm('¿Generar un respaldo completo de los datos (usuarios, transacciones, ledger, escrow)?')) return;

        try {
            // El dinero vive en Supabase (server-authoritative). Ledger y escrow
            // deben leerse de Supabase vía RPCs admin; antes se leían de Firebase
            // y salían VACÍOS tras la migración (respaldo incompleto).
            const [usersSnap, txSnap, settingsSnap] = await Promise.all([
                this.database.ref('users').once('value'),
                this.database.ref('transactions').once('value'),
                this.database.ref('admin/settings').once('value')
            ]);

            // Ledger + escrow desde Supabase (tolerante a fallos: si la RPC no
            // está disponible, se registra y se continúa con lo demás).
            let ledger = {}, escrow = {}, balances = {};
            const sb = (window.DeseoSupabase) || (window.DeseoAuth && window.DeseoAuth.getSupabase && window.DeseoAuth.getSupabase());
            if (sb && typeof sb.rpc === 'function') {
                try {
                    const led = await sb.rpc('rpc_admin_list_ledger', { p_limit: 100000 });
                    if (led && !led.error && Array.isArray(led.data)) {
                        led.data.forEach(function (row) { ledger[row.op_id || (row.user_id + '_' + row.created_at)] = row; });
                    } else if (led && led.error) {
                        console.warn('⚠️ Respaldo: no se pudo leer ledger de Supabase:', led.error.message);
                    }
                } catch (e) { console.warn('⚠️ Respaldo: error leyendo ledger:', e && e.message); }
                try {
                    const esc = await sb.rpc('rpc_admin_list_escrow');
                    if (esc && !esc.error && Array.isArray(esc.data)) {
                        esc.data.forEach(function (row) { escrow[row.order_id || (row.id + '')] = row; });
                    } else if (esc && esc.error) {
                        console.warn('⚠️ Respaldo: no se pudo leer escrow de Supabase:', esc.error.message);
                    }
                } catch (e) { console.warn('⚠️ Respaldo: error leyendo escrow:', e && e.message); }
            } else {
                console.warn('⚠️ Respaldo: Supabase no disponible; ledger/escrow irán vacíos.');
            }

            const backup = {
                generatedAt: new Date().toISOString(),
                users: usersSnap.val() || {},
                transactions: txSnap.val() || {},
                ledger: ledger,
                escrow: escrow,
                settings: settingsSnap.val() || {}
            };

            const json = JSON.stringify(backup, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `respaldo_deseo_${new Date().toISOString().split('T')[0]}.json`;
            link.click();

            await this.logAdminAction('backup_data', { size: json.length });
            alert('✅ Respaldo generado y descargado.');
        } catch (error) {
            console.error('❌ Error generando respaldo:', error);
            alert('❌ Error al generar el respaldo: ' + error.message);
        }
    }

    // ===== AJUSTE MANUAL DE SALDO (adminCredit / adminCharge) =====
    openAdjustBalanceModal(userId) {
        const modal = document.getElementById('adjustBalanceModal');
        const userField = document.getElementById('adjustUserId');
        const amountField = document.getElementById('adjustAmount');
        const reasonField = document.getElementById('adjustReason');
        const typeField = document.getElementById('adjustType');
        if (!modal) return;

        if (userField) userField.value = userId || '';
        if (amountField) amountField.value = '';
        if (reasonField) reasonField.value = '';
        if (typeField) typeField.value = 'credit';

        modal.style.display = 'flex';

        const confirmBtn = document.getElementById('confirmAdjustBtn');
        if (confirmBtn) {
            // Evitar listeners duplicados reemplazando el nodo.
            const clone = confirmBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(clone, confirmBtn);
            clone.addEventListener('click', () => this.confirmAdjustBalance());
        }
    }

    async confirmAdjustBalance() {
        const userId = document.getElementById('adjustUserId')?.value?.trim();
        const type = document.getElementById('adjustType')?.value || 'credit';
        const amount = parseInt(document.getElementById('adjustAmount')?.value, 10);
        const reason = document.getElementById('adjustReason')?.value?.trim();

        if (!userId) { alert('❌ Usuario inválido.'); return; }
        if (!Number.isFinite(amount) || amount <= 0) { alert('❌ Monto inválido.'); return; }
        if (!reason) { alert('❌ El motivo es obligatorio (queda en auditoría).'); return; }
        if (!window.DeseoMoney) { alert('❌ Motor de dinero no disponible.'); return; }

        const verb = type === 'credit' ? 'acreditar' : 'debitar';
        if (!confirm(`¿Confirmas ${verb} $${amount.toLocaleString('es-CO')} al usuario ${userId}?`)) return;

        try {
            const opId = `admin_adjust_${type}_${userId}_${Date.now()}`;
            let res;
            if (type === 'credit') {
                res = await window.DeseoMoney.adminCredit(this.database, userId, amount, { reason, opId });
            } else {
                res = await window.DeseoMoney.adminCharge(this.database, userId, amount, { reason, opId });
            }

            if (res && res.ok === false) {
                alert('❌ No se pudo aplicar el ajuste: ' + (res.reason || 'error') +
                    (res.reason === 'forbidden' ? ' (tu cuenta no tiene permisos de admin en el servidor)' : '') +
                    (res.reason === 'insufficient_funds' ? ' (saldo insuficiente)' : ''));
                return;
            }

            // Registrar en auditoría (Firebase) para trazabilidad.
            await this.logAdminAction('adjust_balance', {
                userId, type, amount, reason, opId,
                newBalance: res && res.balance
            });

            alert('✅ Ajuste aplicado correctamente. Nuevo saldo: $' +
                ((res && res.balance != null ? res.balance : 0).toLocaleString('es-CO')));
            this.closeModal('adjustBalanceModal');
            if (this.currentSection === 'users') this.loadUserManagement();
        } catch (error) {
            console.error('❌ Error en ajuste de saldo:', error);
            alert('❌ Error al aplicar el ajuste: ' + error.message);
        }
    }

    // ===== AUDITORÍA DE ACCIONES DEL ADMIN =====
    async logAdminAction(action, details) {
        if (!this.database) return;
        try {
            const adminId = (window.DeseoAuth && window.DeseoAuth.getUserId)
                ? await window.DeseoAuth.getUserId() : 'unknown';
            const ref = this.database.ref('admin/audit_log').push();
            await ref.set({
                action,
                details: details || {},
                adminId: adminId || 'unknown',
                timestamp: new Date().toISOString()
            });
        } catch (e) {
            console.warn('⚠️ No se pudo registrar auditoría:', e && e.message);
        }
    }

    // ===== CUSTODIA (ESCROW) =====
    async loadEscrow() {
        console.log('🔒 Cargando custodia (escrow)...');
        const list = document.getElementById('escrowList');
        if (!list) return;

        // El dinero vive en Supabase (server-authoritative). El escrow se deriva
        // del ledger vía la RPC admin rpc_admin_list_escrow (solo admin).
        const sb = (window.DeseoSupabase) || (window.DeseoAuth && window.DeseoAuth.getSupabase && window.DeseoAuth.getSupabase());
        if (!sb) {
            list.innerHTML = '<div class="no-transactions"><i class="fas fa-exclamation-triangle"></i><p>Motor de dinero no disponible</p></div>';
            return;
        }

        try {
            const { data, error } = await sb.rpc('rpc_admin_list_escrow');
            if (error) throw error;
            const orders = (data || []).map(o => ({
                orderId: o.order_id, clientId: o.client_id, amount: o.amount, status: o.status, createdAt: o.created_at
            }));

            let totalHeld = 0, active = 0, released = 0, refunded = 0;
            orders.forEach(o => {
                const amt = parseInt(o.amount, 10) || 0;
                if (o.status === 'held' || !o.status) { totalHeld += amt; active++; }
                else if (o.status === 'released') released++;
                else if (o.status === 'refunded') refunded++;
            });

            document.getElementById('escrowTotalHeld').textContent = '$' + totalHeld.toLocaleString('es-CO');
            document.getElementById('escrowActiveCount').textContent = active;
            document.getElementById('escrowReleasedCount').textContent = released;
            document.getElementById('escrowRefundedCount').textContent = refunded;

            if (orders.length === 0) {
                list.innerHTML = '<div class="no-transactions"><i class="fas fa-lock-open"></i><p>No hay órdenes en custodia</p></div>';
                return;
            }

            const esc = (typeof escapeHtml === 'function') ? escapeHtml : (v) => String(v == null ? '' : v);
            const escAttr = (typeof escapeAttr === 'function') ? escapeAttr : esc;

            list.innerHTML = orders.map(o => {
                const amt = parseInt(o.amount, 10) || 0;
                const status = o.status || 'held';
                const badge = status === 'held'
                    ? '<span style="background:#f59e0b;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;">En custodia</span>'
                    : status === 'released'
                        ? '<span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;">Liberada</span>'
                        : '<span style="background:#ef4444;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;">Reembolsada</span>';
                const actions = status === 'held'
                    ? `<button class="btn-admin btn-approve" onclick="adminApp.openEscrowAction('${escAttr(o.orderId)}', ${amt}, 'release')"><i class="fas fa-check"></i> Liberar</button>
                       <button class="btn-admin btn-reject" onclick="adminApp.openEscrowAction('${escAttr(o.orderId)}', ${amt}, 'refund')"><i class="fas fa-rotate-left"></i> Reembolsar</button>`
                    : '';
                return `
                    <div class="transaction-item">
                        <div class="transaction-info">
                            <div class="transaction-icon" style="background: var(--primary-color);"><i class="fas fa-lock"></i></div>
                            <div class="transaction-details">
                                <h4>Orden ${esc(o.orderId)} ${badge}</h4>
                                <p><strong>Monto:</strong> $${amt.toLocaleString('es-CO')} COP</p>
                                <p><strong>Cliente:</strong> ${esc(o.clientId || o.buyerId || 'N/A')}</p>
                                <p><strong>Proveedor:</strong> ${esc(o.providerId || o.sellerId || 'N/A')}</p>
                            </div>
                        </div>
                        <div class="transaction-actions">${actions}</div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('❌ Error cargando escrow:', error);
            list.innerHTML = '<div class="no-transactions"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar custodia</p></div>';
        }
    }

    openEscrowAction(orderId, amount, action) {
        const modal = document.getElementById('escrowActionModal');
        if (!modal) return;
        document.getElementById('escrowOrderId').value = orderId;
        document.getElementById('escrowOrderAmount').value = '$' + (amount || 0).toLocaleString('es-CO');
        document.getElementById('escrowActionType').value = action || 'release';
        document.getElementById('escrowToUser').value = '';
        modal.style.display = 'flex';

        const confirmBtn = document.getElementById('confirmEscrowBtn');
        if (confirmBtn) {
            const clone = confirmBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(clone, confirmBtn);
            clone.addEventListener('click', () => this.confirmEscrowAction());
        }
    }

    async confirmEscrowAction() {
        const orderId = document.getElementById('escrowOrderId')?.value;
        const action = document.getElementById('escrowActionType')?.value || 'release';
        const toUser = document.getElementById('escrowToUser')?.value?.trim();

        if (!orderId) { alert('❌ Orden inválida.'); return; }
        if (!window.DeseoMoney) { alert('❌ Motor de dinero no disponible.'); return; }

        try {
            let res;
            if (action === 'release') {
                if (!toUser) { alert('❌ Debes indicar el ID del proveedor para liberar.'); return; }
                if (!confirm(`¿Liberar la custodia de la orden ${orderId} al proveedor ${toUser}?`)) return;
                res = await window.DeseoMoney.escrowRelease(this.database, orderId, toUser, {});
            } else {
                if (!confirm(`¿Reembolsar la custodia de la orden ${orderId} al cliente?`)) return;
                res = await window.DeseoMoney.escrowRefund(this.database, orderId, {});
            }

            if (res && res.ok === false) {
                alert('❌ No se pudo completar la acción: ' + (res.reason || 'error'));
                return;
            }

            await this.logAdminAction('escrow_' + action, { orderId, toUser: toUser || null });
            alert('✅ Acción de custodia completada.');
            this.closeModal('escrowActionModal');
            this.loadEscrow();
        } catch (error) {
            console.error('❌ Error en acción de escrow:', error);
            alert('❌ Error: ' + error.message);
        }
    }

    // ===== CONCILIACIÓN DE PAGOS =====
    async loadReconciliation() {
        console.log('⚖️ Cargando conciliación...');
        const list = document.getElementById('reconciliationList');
        if (!list) return;

        // La conciliación compara los pagos reportados por la pasarela (Bold) contra
        // las transacciones income registradas. Si la pasarela aún no está cableada a
        // Supabase, se informa que no hay pagos (comportamiento esperado del plan).
        const sb = (window.DeseoSupabase) || (window.DeseoAuth && window.DeseoAuth.getSupabase && window.DeseoAuth.getSupabase());
        if (!sb) {
            list.innerHTML = '<div class="no-transactions"><i class="fas fa-exclamation-triangle"></i><p>Motor de dinero no disponible</p></div>';
            return;
        }

        try {
            // Pagos registrados en la pasarela. Se intenta leer de una tabla/general si
            // existiera; en este modelo los pagos conciliables son transacciones income
            // completadas del nodo Firebase. Si no hay tabla de pagos, mostramos vacío.
            let payments = [];
            try {
                const pr = await sb.from('payments').select('*').limit(500);
                if (!pr.error && Array.isArray(pr.data)) payments = pr.data;
            } catch (_) { /* tabla no existe aún: pagos = [] */ }

            // Transacciones registradas (income completadas) para cruzar.
            const ledgerIncome = this.allTransactions.filter(t =>
                t.transaction.type === 'income' && t.transaction.status === 'completed'
            );

            let gatewayTotal = 0, ledgerTotal = 0, diffs = 0, unmatched = 0;
            payments.forEach(p => {
                const amt = parseInt(p.amount, 10) || 0;
                gatewayTotal += amt;
                const match = ledgerIncome.find(t =>
                    (p.reference && t.transaction.reference === p.reference) ||
                    (p.transactionId && t.id === p.transactionId)
                );
                if (!match) { unmatched++; }
                else {
                    ledgerTotal += parseInt(match.transaction.amount, 10) || 0;
                    if ((parseInt(match.transaction.amount, 10) || 0) !== amt) diffs++;
                }
            });

            document.getElementById('reconGatewayTotal').textContent = '$' + gatewayTotal.toLocaleString('es-CO');
            document.getElementById('reconLedgerTotal').textContent = '$' + ledgerTotal.toLocaleString('es-CO');
            document.getElementById('reconDiffCount').textContent = diffs;
            document.getElementById('reconUnmatchedCount').textContent = unmatched;

            if (payments.length === 0) {
                list.innerHTML = '<div class="no-transactions"><i class="fas fa-balance-scale"></i><p>No hay pagos de pasarela registrados</p></div>';
                return;
            }

            const esc = (typeof escapeHtml === 'function') ? escapeHtml : (v) => String(v == null ? '' : v);
            list.innerHTML = payments.map(p => {
                const amt = parseInt(p.amount, 10) || 0;
                const match = ledgerIncome.find(t =>
                    (p.reference && t.transaction.reference === p.reference) ||
                    (p.transactionId && t.id === p.transactionId)
                );
                const badge = match
                    ? '<span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;">Conciliado</span>'
                    : '<span style="background:#f59e0b;color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;">Sin conciliar</span>';
                return `
                    <div class="transaction-item">
                        <div class="transaction-info">
                            <div class="transaction-icon" style="background: var(--primary-color);"><i class="fas fa-money-check-dollar"></i></div>
                            <div class="transaction-details">
                                <h4>Pago ${esc(p.id)} ${badge}</h4>
                                <p><strong>Monto:</strong> $${amt.toLocaleString('es-CO')} COP</p>
                                <p><strong>Referencia:</strong> ${esc(p.reference || 'N/A')}</p>
                                <p><strong>Estado pasarela:</strong> ${esc(p.status || 'N/A')}</p>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('❌ Error cargando conciliación:', error);
            list.innerHTML = '<div class="no-transactions"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar conciliación</p></div>';
        }
    }

    exportReconciliation() {
        const rows = [];
        document.querySelectorAll('#reconciliationList .transaction-item').forEach(item => {
            rows.push({ Detalle: item.innerText.replace(/\s+/g, ' ').trim() });
        });
        if (rows.length === 0) { alert('No hay datos para exportar.'); return; }
        this.downloadCSV(rows, 'conciliacion.csv');
    }

    // ===== LIBRO MAYOR (LEDGER) =====
    async loadLedger() {
        console.log('📖 Cargando libro mayor...');
        const list = document.getElementById('ledgerList');
        if (!list) return;

        // El ledger real vive en Supabase (server-authoritative). Se lee vía la RPC
        // admin rpc_admin_list_ledger (solo admin).
        const sb = (window.DeseoSupabase) || (window.DeseoAuth && window.DeseoAuth.getSupabase && window.DeseoAuth.getSupabase());
        if (!sb) {
            list.innerHTML = '<div class="no-transactions"><i class="fas fa-exclamation-triangle"></i><p>Motor de dinero no disponible</p></div>';
            return;
        }

        try {
            const { data, error } = await sb.rpc('rpc_admin_list_ledger', { p_limit: 500 });
            if (error) throw error;
            // Mapeo de campos Supabase -> formato que usa el render/export existente.
            this.ledgerEntries = (data || []).map(r => ({
                opId: r.op_id,
                userId: r.user_id,
                type: r.direction,          // 'in' | 'out' | 'transfer'
                direction: r.direction,
                amount: r.amount,
                reason: r.reason,
                counterpart: r.counterpart,
                timestamp: r.created_at
            }));
            this.renderLedger(this.ledgerEntries);
        } catch (error) {
            console.error('❌ Error cargando ledger:', error);
            list.innerHTML = '<div class="no-transactions"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar libro mayor</p></div>';
        }
    }

    renderLedger(entries) {
        const list = document.getElementById('ledgerList');
        if (!list) return;

        if (!entries || entries.length === 0) {
            list.innerHTML = '<div class="no-transactions"><i class="fas fa-book"></i><p>No hay movimientos contables</p></div>';
            return;
        }

        const esc = (typeof escapeHtml === 'function') ? escapeHtml : (v) => String(v == null ? '' : v);
        list.innerHTML = entries.map(e => {
            const amt = parseInt(e.amount, 10) || 0;
            const dir = (e.direction || e.type || '').toLowerCase();
            const isCredit = dir === 'in' || dir.indexOf('credit') !== -1 || dir.indexOf('deposit') !== -1;
            const color = isCredit ? 'var(--primary-color)' : '#ef4444';
            const icon = isCredit ? 'fas fa-arrow-up' : 'fas fa-arrow-down';
            const date = e.timestamp ? new Date(e.timestamp).toLocaleString('es-ES') : 'N/A';
            const label = dir === 'in' ? 'Crédito' : dir === 'out' ? 'Débito' : (e.type || 'movimiento');
            return `
                <div class="transaction-item">
                    <div class="transaction-info">
                        <div class="transaction-icon" style="background: ${color};"><i class="${icon}"></i></div>
                        <div class="transaction-details">
                            <h4>${esc(label)}</h4>
                            <p><strong>Usuario:</strong> ${esc(e.userId || e.user_id || 'N/A')}</p>
                            <p><strong>Monto:</strong> $${amt.toLocaleString('es-CO')} COP</p>
                            <p><strong>Motivo:</strong> ${esc(e.reason || 'N/A')}</p>
                            <p><strong>opId:</strong> ${esc(e.opId || e.op_id || 'N/A')}</p>
                            <p><strong>Fecha:</strong> ${esc(date)}</p>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    applyLedgerFilters() {
        if (!this.ledgerEntries) return;
        const user = document.getElementById('ledgerUserSearch')?.value?.toLowerCase();
        const type = document.getElementById('ledgerTypeFilter')?.value || 'all';
        const from = document.getElementById('ledgerDateFrom')?.value;
        const to = document.getElementById('ledgerDateTo')?.value;

        let filtered = this.ledgerEntries;
        if (user) filtered = filtered.filter(e => String(e.userId || e.user_id || '').toLowerCase().includes(user));
        if (type !== 'all') { const t = type.toLowerCase(); filtered = filtered.filter(e => String(e.direction || e.type || '').toLowerCase().includes(t) || String(e.reason || '').toLowerCase().includes(t)); }
        if (from) { const f = new Date(from); filtered = filtered.filter(e => new Date(e.timestamp) >= f); }
        if (to) { const t = new Date(to); t.setHours(23,59,59,999); filtered = filtered.filter(e => new Date(e.timestamp) <= t); }
        this.renderLedger(filtered);
    }

    clearLedgerFilters() {
        const ids = ['ledgerUserSearch', 'ledgerTypeFilter', 'ledgerDateFrom', 'ledgerDateTo'];
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = id === 'ledgerTypeFilter' ? 'all' : ''; });
        this.renderLedger(this.ledgerEntries || []);
    }

    exportLedger() {
        const entries = this.ledgerEntries || [];
        if (entries.length === 0) { alert('No hay datos para exportar.'); return; }
        const data = entries.map(e => ({
            opId: e.opId || e.op_id || '',
            Usuario: e.userId || e.user_id || '',
            Tipo: e.direction || e.type || '',
            Monto: e.amount || 0,
            Motivo: e.reason || '',
            Fecha: e.timestamp ? new Date(e.timestamp).toLocaleString('es-ES') : ''
        }));
        this.downloadCSV(data, 'libro_mayor.csv');
    }

    // ===== RESPONSIVE HANDLING =====
    handleWindowResize() {
        const width = window.innerWidth;
        const adminSidebar = document.getElementById('adminSidebar');
        const mobileOverlay = document.getElementById('mobileOverlay');

        if (width > 768) {
            // Desktop view
            if (adminSidebar) {
                adminSidebar.classList.remove('open');
            }
            if (mobileOverlay) {
                mobileOverlay.classList.remove('active');
            }
        } else {
            // Mobile view - ensure sidebar is closed by default
            if (adminSidebar && !adminSidebar.classList.contains('open')) {
                adminSidebar.classList.remove('open');
            }
            if (mobileOverlay) {
                mobileOverlay.classList.remove('active');
            }
        }

        // Update charts if they exist
        this.updateChartsResponsiveness();
    }

    updateChartsResponsiveness() {
        // Update chart sizes for responsive behavior
        const charts = [
            this.transactionsChart,
            this.revenueChart,
            this.transactionDistributionChart,
            this.userActivityChart,
            this.approvalTrendsChart
        ];

        charts.forEach(chart => {
            if (chart) {
                chart.resize();
            }
        });
    }

    // Función para limpiar listeners de Firebase y evitar bucles infinitos
    cleanupFirebaseListeners() {
        // Limpiar listeners del array
        this.firebaseListeners.forEach(listener => {
            if (listener && typeof listener.off === 'function') {
                listener.off();
            }
        });
        this.firebaseListeners = [];
        
        // Limpiar listener de transacciones específico
        if (this.transactionsListener && this.database) {
            this.database.ref('transactions').off('value', this.transactionsListener);
            this.transactionsListener = null;
        }
        
        console.log('🧹 Listeners de Firebase limpiados');
    }

    // Función para agregar listener con rastreo
    addFirebaseListener(ref, eventType, callback) {
        const listener = ref.on(eventType, callback);
        this.firebaseListeners.push(listener);
        return listener;
    }
}

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    console.log('🏁 DOM cargado. Inicializando Admin Dashboard...');

    // SEGURIDAD: no arrancar el panel si el gate de acceso lo denegó.
    const start = () => {
        if (window.__DESEO_ADMIN_DENIED__) {
            console.warn('⛔ Panel admin bloqueado por el gate de acceso.');
            return;
        }
        // Esperar un momento para asegurar que todos los scripts estén cargados
        setTimeout(() => {
            if (window.__DESEO_ADMIN_DENIED__) return;
            if (!window.adminApp) {
                window.adminApp = new AdminDashboard();
                console.log('✨ AdminDashboard instance created.');
            } else {
                console.log('AdminDashboard ya estaba inicializada.');
            }
        }, 100);
    };

    if (window.deseoAdminGate && window.deseoAdminGate.ready) {
        window.deseoAdminGate.ready.then((granted) => { if (granted) start(); });
    } else if (window.__DESEO_ADMIN_GRANTED__) {
        start();
    } else {
        console.warn('⚠️ Gate de admin no detectado; no se inicia el panel por seguridad.');
    }
});