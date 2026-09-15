class AdminDisputes {
    constructor() {
        this.database = null;
        this.currentDispute = null;
        this.disputes = [];
        this.currentTheme = localStorage.getItem('admin-theme') || 'dark';
        
        this.init();
    }

    async init() {
        console.log('🔍 AdminDisputes: Inicializando...');
        
        // Inicializar Firebase
        await this.initializeFirebase();
        
        // Aplicar tema
        this.applyTheme();
        
        // Configurar event listeners
        this.setupEventListeners();
        
        // Cargar disputas
        await this.loadDisputes();
        
        console.log('✅ AdminDisputes: Inicializado correctamente');
    }

    async initializeFirebase() {
        try {
            console.log('🔍 Iniciando Firebase en admin disputes...');
            
            if (typeof CONFIG === 'undefined' || !CONFIG.FIREBASE) {
                throw new Error('CONFIG.FIREBASE no está definido');
            }

            const firebaseConfig = CONFIG.FIREBASE.config;
            
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }
            
            this.database = firebase.database();
            console.log('✅ Firebase inicializado correctamente en admin disputes');
        } catch (error) {
            console.error('❌ Error inicializando Firebase en admin disputes:', error);
            throw error;
        }
    }

    applyTheme() {
        document.body.setAttribute('data-theme', this.currentTheme);
        const themeIcon = document.getElementById('themeToggle');
        if (themeIcon) {
            themeIcon.innerHTML = this.currentTheme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        }
    }

    setupEventListeners() {
        // Theme toggle
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
                localStorage.setItem('admin-theme', this.currentTheme);
                this.applyTheme();
            });
        }

        // Logout button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                if (confirm('¿Estás seguro de que quieres cerrar sesión?')) {
                    localStorage.removeItem('currentUser');
                    sessionStorage.removeItem('currentUser');
                    window.location.href = 'index.html';
                }
            });
        }

        // Tab navigation
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // Request evidence button
        const requestEvidenceBtn = document.getElementById('requestEvidenceBtn');
        if (requestEvidenceBtn) {
            requestEvidenceBtn.addEventListener('click', () => {
                this.requestEvidence();
            });
        }

        // Resolve dispute button
        const resolveDisputeBtn = document.getElementById('resolveDisputeBtn');
        if (resolveDisputeBtn) {
            resolveDisputeBtn.addEventListener('click', () => {
                this.showResolutionModal();
            });
        }

        // Admin message input
        const adminMessageInput = document.getElementById('adminMessageInput');
        const sendAdminMessageBtn = document.getElementById('sendAdminMessageBtn');
        
        if (adminMessageInput && sendAdminMessageBtn) {
            const sendMessage = () => {
                const message = adminMessageInput.value.trim();
                if (message) {
                    this.sendAdminMessage(message);
                    adminMessageInput.value = '';
                }
            };

            sendAdminMessageBtn.addEventListener('click', sendMessage);
            adminMessageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    sendMessage();
                }
            });
        }

        // Resolution modal
        const confirmResolutionBtn = document.getElementById('confirmResolutionBtn');
        if (confirmResolutionBtn) {
            confirmResolutionBtn.addEventListener('click', () => {
                this.confirmResolution();
            });
        }
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update tab panes
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        document.getElementById(`${tabName}Tab`).classList.add('active');

        // Load tab-specific content
        if (tabName === 'evidence') {
            this.loadEvidence();
        } else if (tabName === 'details') {
            this.loadDisputeDetails();
        }
    }

    async loadDisputes() {
        try {
            console.log('🔍 Cargando disputas...');
            const disputesRef = this.database.ref('disputes');
            const snapshot = await disputesRef.once('value');
            const disputesData = snapshot.val() || {};
            
            this.disputes = Object.entries(disputesData).map(([id, dispute]) => ({
                id,
                ...dispute
            }));

            this.renderDisputesList();
            this.updateStats();
            console.log(`✅ Cargadas ${this.disputes.length} disputas`);
        } catch (error) {
            console.error('❌ Error cargando disputas:', error);
            this.showError('Error cargando disputas');
        }
    }

    renderDisputesList() {
        const disputesList = document.getElementById('disputesList');
        const emptyState = document.getElementById('emptyState');
        
        if (this.disputes.length === 0) {
            emptyState.style.display = 'block';
            disputesList.innerHTML = '';
            return;
        }

        emptyState.style.display = 'none';
        
        disputesList.innerHTML = this.disputes.map(dispute => `
            <div class="dispute-item" data-dispute-id="${escapeAttr(dispute.id)}">
                <div class="dispute-item-header">
                    <span class="dispute-item-id">Disputa #${dispute.id.slice(-6)}</span>
                    <span class="dispute-item-status ${dispute.status}">${this.getStatusText(dispute.status)}</span>
                </div>
                <div class="dispute-item-amount">$${escapeInt(dispute.amount, 0)}</div>
                <div class="dispute-item-meta">
                    ${new Date(dispute.createdAt).toLocaleDateString()} • 
                    ${escapeHtml(dispute.clientName || 'Cliente')} vs ${escapeHtml(dispute.providerName || 'Proveedor')}
                </div>
            </div>
        `).join('');

        // Add click listeners
        document.querySelectorAll('.dispute-item').forEach(item => {
            item.addEventListener('click', () => {
                const disputeId = item.dataset.disputeId;
                this.selectDispute(disputeId);
            });
        });
    }

    updateStats() {
        const pendingCount = this.disputes.filter(d => d.status === 'pending').length;
        const resolvedCount = this.disputes.filter(d => d.status === 'resolved').length;
        
        document.getElementById('pendingCount').textContent = pendingCount;
        document.getElementById('resolvedCount').textContent = resolvedCount;
    }

    getStatusText(status) {
        const statusMap = {
            'pending': 'Pendiente',
            'resolved': 'Resuelta',
            'in_review': 'En Revisión'
        };
        return statusMap[status] || status;
    }

    selectDispute(disputeId) {
        // Limpiar listener anterior
        if (this.chatListener && this.currentDispute) {
            const messagesRef = this.database.ref(`chats/${this.currentDispute.chatId}/messages`);
            messagesRef.off('child_added', this.chatListener);
            this.chatListener = null;
        }
        
        // Update UI
        document.querySelectorAll('.dispute-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-dispute-id="${disputeId}"]`).classList.add('active');

        // Show dispute content
        document.getElementById('noDisputeSelected').style.display = 'none';
        document.getElementById('disputeContent').style.display = 'flex';

        // Load dispute data
        this.currentDispute = this.disputes.find(d => d.id === disputeId);
        this.loadDisputeData();
    }

    loadDisputeData() {
        if (!this.currentDispute) return;

        // Update header
        document.getElementById('disputeId').textContent = this.currentDispute.id.slice(-6);
        document.getElementById('disputeStatus').textContent = this.getStatusText(this.currentDispute.status);
        document.getElementById('disputeStatus').className = `dispute-status ${this.currentDispute.status}`;
        document.getElementById('disputeAmount').textContent = `$${this.currentDispute.amount || 0}`;
        document.getElementById('disputeDate').textContent = new Date(this.currentDispute.createdAt).toLocaleDateString();

        // Update participants
        document.getElementById('clientName').textContent = this.currentDispute.clientName || 'Cliente';
        document.getElementById('providerName').textContent = this.currentDispute.providerName || 'Proveedor';

        // Load chat messages
        this.loadChatMessages();

        // Load evidence if on evidence tab
        if (document.getElementById('evidenceTab').classList.contains('active')) {
            this.loadEvidence();
        }

        // Load details if on details tab
        if (document.getElementById('detailsTab').classList.contains('active')) {
            this.loadDisputeDetails();
        }
    }

    async loadChatMessages() {
        if (!this.currentDispute) return;

        try {
            const messagesRef = this.database.ref(`chats/${this.currentDispute.chatId}/messages`);
            
            // Cargar mensajes existentes
            const snapshot = await messagesRef.once('value');
            const messagesData = snapshot.val() || {};
            
            this.messages = Object.values(messagesData)
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            this.renderChatMessages(this.messages);
            
            // Configurar listener en tiempo real para nuevos mensajes
            this.setupRealtimeChatListener(messagesRef);
            
        } catch (error) {
            console.error('❌ Error cargando mensajes:', error);
        }
    }
    
    setupRealtimeChatListener(messagesRef) {
        // Remover listener anterior si existe
        if (this.chatListener) {
            messagesRef.off('child_added', this.chatListener);
        }
        
        // Crear nuevo listener
        this.chatListener = (snapshot) => {
            const newMessage = snapshot.val();
            
            // Verificar si el mensaje ya existe
            const messageExists = this.messages.some(msg => 
                msg.timestamp === newMessage.timestamp && 
                msg.senderId === newMessage.senderId &&
                msg.message === newMessage.message
            );
            
            if (!messageExists) {
                this.messages.push(newMessage);
                this.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                this.renderChatMessages(this.messages);
                
                // Scroll to bottom
                const chatMessages = document.getElementById('chatMessages');
                if (chatMessages) {
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
                
                console.log('🔄 [DEBUG] Nuevo mensaje recibido en tiempo real:', newMessage);
            }
        };
        
        // Activar listener
        messagesRef.on('child_added', this.chatListener);
        console.log('✅ [DEBUG] Listener en tiempo real activado para admin chat');
    }

    renderChatMessages(messages) {
        const chatMessages = document.getElementById('chatMessages');
        
        chatMessages.innerHTML = messages.map(message => {
            const isAdmin = message.senderId === 'admin';
            const isClient = message.senderId === this.currentDispute.clientId;
            const isProvider = message.senderId === this.currentDispute.providerId;
            
            let messageClass = 'chat-message';
            if (isAdmin) messageClass += ' admin';
            else if (isClient) messageClass += ' client';
            else if (isProvider) messageClass += ' provider';

            return `
                <div class="${messageClass}">
                    ${escapeHtml(message.message)}
                    <div class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</div>
                </div>
            `;
        }).join('');

        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async sendAdminMessage(message) {
        if (!this.currentDispute) return;

        try {
            const messageData = {
                senderId: 'admin',
                message: message,
                timestamp: Date.now(),
                type: 'admin_message'
            };

            // Enviar a Firebase
            await this.database.ref(`chats/${this.currentDispute.chatId}/messages`).push(messageData);
            
            console.log('✅ Mensaje de admin enviado a Firebase');
            
            // NO agregar localmente - dejar que el listener en tiempo real lo maneje
            // Esto evita duplicados
            
        } catch (error) {
            console.error('❌ Error enviando mensaje de admin:', error);
            this.showError('Error enviando mensaje');
        }
    }

    async requestEvidence() {
        if (!this.currentDispute) {
            this.showError('Selecciona una disputa primero');
            return;
        }
        
        try {
            const message = {
                senderId: 'admin',
                message: 'El administrador solicita evidencias para resolver esta disputa. Por favor, sube imágenes que respalden tu caso usando el botón de evidencias en el chat.',
                timestamp: Date.now(),
                type: 'admin_request_evidence'
            };
            
            // Send to chat
            await this.database.ref(`chats/${this.currentDispute.chatId}/messages`).push(message);
            
            // NO agregar localmente - dejar que el listener en tiempo real lo maneje
            // Esto evita duplicados
            
            this.showSuccess('Solicitud de evidencias enviada a ambas partes');
        } catch (error) {
            console.error('Error enviando solicitud de evidencias:', error);
            this.showError('Error enviando solicitud de evidencias');
        }
    }

    async loadEvidence() {
        if (!this.currentDispute) return;

        try {
            const evidenceRef = this.database.ref(`disputes/${this.currentDispute.id}/evidence`);
            const snapshot = await evidenceRef.once('value');
            const evidenceData = snapshot.val() || {};

            this.renderEvidence(evidenceData);
        } catch (error) {
            console.error('❌ Error cargando evidencias:', error);
        }
    }

    renderEvidence(evidenceData) {
        const clientEvidence = document.getElementById('clientEvidence');
        const providerEvidence = document.getElementById('providerEvidence');

        // Client evidence
        if (evidenceData.client && evidenceData.client.length > 0) {
            clientEvidence.innerHTML = evidenceData.client.map(evidence => `
                <div class="evidence-item" data-evidence-url="${escapeAttr(safeUrl(evidence.data))}">
                    <img src="${escapeAttr(safeUrl(evidence.data))}" alt="Evidence">
                    <div class="evidence-item-info">
                        <div>Subido por: ${escapeHtml(evidence.uploadedByName)}</div>
                        <div>${new Date(evidence.uploadedAt).toLocaleString()}</div>
                    </div>
                </div>
            `).join('');
        } else {
            clientEvidence.innerHTML = `
                <div class="no-evidence">
                    <i class="fas fa-image"></i>
                    <p>No hay evidencias del cliente</p>
                </div>
            `;
        }

        // Provider evidence
        if (evidenceData.provider && evidenceData.provider.length > 0) {
            providerEvidence.innerHTML = evidenceData.provider.map(evidence => `
                <div class="evidence-item" data-evidence-url="${escapeAttr(safeUrl(evidence.data))}">
                    <img src="${escapeAttr(safeUrl(evidence.data))}" alt="Evidence">
                    <div class="evidence-item-info">
                        <div>Subido por: ${escapeHtml(evidence.uploadedByName)}</div>
                        <div>${new Date(evidence.uploadedAt).toLocaleString()}</div>
                    </div>
                </div>
            `).join('');
        } else {
            providerEvidence.innerHTML = `
                <div class="no-evidence">
                    <i class="fas fa-image"></i>
                    <p>No hay evidencias del proveedor</p>
                </div>
            `;
        }

        // Abrir la evidencia en pestaña nueva (delegado, sin onclick inline)
        document.querySelectorAll('.evidence-item[data-evidence-url]').forEach(el => {
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                const url = el.getAttribute('data-evidence-url');
                if (url && /^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
            });
        });
    }

    loadDisputeDetails() {
        if (!this.currentDispute) return;

        // Update detail fields
        document.getElementById('detailDisputeId').textContent = this.currentDispute.id;
        document.getElementById('detailChatId').textContent = this.currentDispute.chatId;
        document.getElementById('detailClient').textContent = this.currentDispute.clientName || 'Cliente';
        document.getElementById('detailProvider').textContent = this.currentDispute.providerName || 'Proveedor';
        document.getElementById('detailAmount').textContent = `$${this.currentDispute.amount || 0}`;
        document.getElementById('detailCreatedAt').textContent = new Date(this.currentDispute.createdAt).toLocaleString();
        document.getElementById('detailUpdatedAt').textContent = new Date(this.currentDispute.updatedAt || this.currentDispute.createdAt).toLocaleString();

        // Load history
        this.loadDisputeHistory();
    }

    loadDisputeHistory() {
        const historyContainer = document.getElementById('disputeHistory');
        
        const historyItems = [
            {
                title: 'Disputa creada',
                date: new Date(this.currentDispute.createdAt).toLocaleString(),
                description: 'La disputa fue iniciada por el cliente'
            }
        ];

        if (this.currentDispute.resolvedAt) {
            historyItems.push({
                title: 'Disputa resuelta',
                date: new Date(this.currentDispute.resolvedAt).toLocaleString(),
                description: `Resuelta a favor del ${this.currentDispute.resolution === 'client' ? 'cliente' : 'proveedor'}`
            });
        }

        historyContainer.innerHTML = historyItems.map(item => `
            <div class="history-item">
                <div class="history-item-header">
                    <span class="history-item-title">${escapeHtml(item.title)}</span>
                    <span class="history-item-date">${escapeHtml(item.date)}</span>
                </div>
                <div class="history-item-description">${escapeHtml(item.description)}</div>
            </div>
        `).join('');
    }

    showResolutionModal() {
        if (!this.currentDispute) {
            this.showError('Selecciona una disputa primero');
            return;
        }

        // Verificar si la disputa ya está resuelta
        if (this.currentDispute.status === 'resolved') {
            this.showError('Esta disputa ya ha sido resuelta y no puede ser resuelta nuevamente');
            return;
        }

        document.getElementById('resolutionModal').style.display = 'flex';
    }

    async confirmResolution() {
        const selectedResolution = document.querySelector('input[name="resolution"]:checked');
        const comment = document.getElementById('resolutionComment').value.trim();

        if (!selectedResolution) {
            this.showError('Selecciona una resolución');
            return;
        }

        if (!comment) {
            this.showError('Agrega un comentario explicando la decisión');
            return;
        }

        // Verificar si la disputa ya está resuelta
        if (this.currentDispute.status === 'resolved') {
            this.showError('Esta disputa ya ha sido resuelta');
            return;
        }

        try {
            const resolution = selectedResolution.value;
            const resolutionData = {
                status: 'resolved',
                resolution: resolution,
                resolutionComment: comment,
                resolvedAt: Date.now(),
                resolvedBy: 'admin'
            };

            // Update dispute
            await this.database.ref(`disputes/${this.currentDispute.id}`).update(resolutionData);

            // Actualizar disputa local para tiempo real
            this.currentDispute = { ...this.currentDispute, ...resolutionData };
            this.disputes = this.disputes.map(d => 
                d.id === this.currentDispute.id ? this.currentDispute : d
            );

            // Send resolution message to chat
            const resolutionMessage = {
                senderId: 'admin',
                message: this.getResolutionMessage(resolution, comment),
                timestamp: Date.now(),
                type: 'dispute_resolved'
            };

            await this.database.ref(`chats/${this.currentDispute.chatId}/messages`).push(resolutionMessage);

            // Handle payment based on resolution
            await this.handlePaymentResolution(resolution);

            this.showSuccess('Disputa resuelta correctamente');
            this.closeModal('resolutionModal');
            
            // Actualizar UI en tiempo real sin recargar
            this.updateDisputeList();
            this.updateDisputeDetails();
            
        } catch (error) {
            console.error('❌ Error resolviendo disputa:', error);
            this.showError('Error resolviendo disputa');
        }
    }

    getResolutionMessage(resolution, comment) {
        switch (resolution) {
            case 'client':
                return `✅ Disputa resuelta a favor del CLIENTE. El dinero ha sido devuelto al cliente. Comentario: ${comment}`;
            case 'provider':
                return `✅ Disputa resuelta a favor del PROVEEDOR. El dinero ha sido transferido al proveedor. Comentario: ${comment}`;
            case 'split':
                return `✅ Disputa resuelta con DIVISIÓN 50/50. El dinero se ha dividido entre cliente y proveedor. Comentario: ${comment}`;
            default:
                return `✅ Disputa resuelta. Comentario: ${comment}`;
        }
    }

    async handlePaymentResolution(resolution) {
        if (!this.currentDispute) return;

        try {
            const amount = this.currentDispute.amount || 0;
            const disputeId = this.currentDispute.id;
            const timestamp = Date.now();
            
            console.log(`💰 Procesando pago de disputa ${disputeId}: ${resolution} - $${amount}`);
            
            if (resolution === 'client') {
                // Return money to client - usar 'balance' en lugar de 'wallet'
                const balanceRef = this.database.ref(`users/${this.currentDispute.clientId}/balance`);
                const snap = await balanceRef.once('value');
                const current = parseInt(snap.val() || '0', 10);
                await balanceRef.set(current + amount);
                
                // Registrar micro transacción
                await this.recordMicroTransaction(
                    this.currentDispute.clientId, 
                    amount, 
                    'in',
                    'dispute_resolution_client',
                    `Disputa ${disputeId} resuelta a favor del cliente`
                );
                
                console.log(`✅ $${amount} devuelto al cliente ${this.currentDispute.clientId}`);
                
            } else if (resolution === 'provider') {
                // Give money to provider - usar 'balance' en lugar de 'wallet'
                const balanceRef = this.database.ref(`users/${this.currentDispute.providerId}/balance`);
                const snap = await balanceRef.once('value');
                const current = parseInt(snap.val() || '0', 10);
                await balanceRef.set(current + amount);
                
                // Registrar micro transacción
                await this.recordMicroTransaction(
                    this.currentDispute.providerId, 
                    amount, 
                    'in',
                    'dispute_resolution_provider',
                    `Disputa ${disputeId} resuelta a favor del proveedor`
                );
                
                console.log(`✅ $${amount} transferido al proveedor ${this.currentDispute.providerId}`);
                
            } else if (resolution === 'split') {
                // Split money 50/50
                const halfAmount = amount / 2;
                
                // Cliente recibe la mitad
                const clientBalanceRef = this.database.ref(`users/${this.currentDispute.clientId}/balance`);
                const clientSnap = await clientBalanceRef.once('value');
                const clientCurrent = parseInt(clientSnap.val() || '0', 10);
                await clientBalanceRef.set(clientCurrent + halfAmount);
                
                // Proveedor recibe la mitad
                const providerBalanceRef = this.database.ref(`users/${this.currentDispute.providerId}/balance`);
                const providerSnap = await providerBalanceRef.once('value');
                const providerCurrent = parseInt(providerSnap.val() || '0', 10);
                await providerBalanceRef.set(providerCurrent + halfAmount);
                
                // Registrar micro transacciones
                await this.recordMicroTransaction(
                    this.currentDispute.clientId, 
                    halfAmount, 
                    'in',
                    'dispute_resolution_split_client',
                    `Disputa ${disputeId} resuelta con división 50/50 - parte cliente`
                );
                
                await this.recordMicroTransaction(
                    this.currentDispute.providerId, 
                    halfAmount, 
                    'in',
                    'dispute_resolution_split_provider',
                    `Disputa ${disputeId} resuelta con división 50/50 - parte proveedor`
                );
                
                console.log(`✅ $${halfAmount} transferido a cliente y $${halfAmount} a proveedor`);
            }

            console.log('✅ Pago procesado correctamente');
        } catch (error) {
            console.error('❌ Error procesando pago:', error);
            throw error;
        }
    }

    async recordMicroTransaction(userId, amount, direction, reason, description) {
        try {
            const microId = `micro_${Date.now()}`;
            const microTransaction = {
                id: microId,
                direction: direction, // 'in' o 'out'
                reason: reason,
                amount: amount,
                description: description,
                timestamp: new Date().toISOString(),
                disputeId: this.currentDispute.id
            };
            
            await this.database.ref(`users/${userId}/microtransactions/${microId}`).set(microTransaction);
            console.log(`📝 Micro transacción registrada para usuario ${userId}: ${reason} - $${amount} (${direction})`);
        } catch (error) {
            console.error('❌ Error registrando micro transacción:', error);
        }
    }

    updateDisputeList() {
        // Actualizar la lista de disputas en tiempo real
        const disputeList = document.getElementById('disputeList');
        if (!disputeList) return;

        disputeList.innerHTML = this.disputes.map(dispute => `
            <div class="dispute-item ${dispute.id === this.currentDispute?.id ? 'active' : ''}" 
                 data-dispute-id="${escapeAttr(dispute.id)}">
                <div class="dispute-header">
                    <span class="dispute-id">#${escapeHtml(dispute.id)}</span>
                    <span class="dispute-status ${dispute.status}">${this.getStatusText(dispute.status)}</span>
                </div>
                <div class="dispute-amount">$${dispute.amount || 0}</div>
                <div class="dispute-parties">
                    ${escapeHtml(dispute.clientName || 'Cliente')} vs ${escapeHtml(dispute.providerName || 'Proveedor')}
                </div>
            </div>
        `).join('');

        // Re-agregar event listeners
        document.querySelectorAll('.dispute-item').forEach(item => {
            item.addEventListener('click', () => {
                const disputeId = item.dataset.disputeId;
                this.selectDispute(disputeId);
            });
        });

        // Actualizar estadísticas
        this.updateStats();
    }

    updateDisputeDetails() {
        if (!this.currentDispute) return;

        // Actualizar header
        const header = document.querySelector('.dispute-header h2');
        if (header) {
            header.textContent = `Disputa #${this.currentDispute.id}`;
        }

        // Actualizar estado
        const statusElement = document.querySelector('.dispute-status');
        if (statusElement) {
            statusElement.textContent = this.getStatusText(this.currentDispute.status);
            statusElement.className = `dispute-status ${this.currentDispute.status}`;
        }

        // Actualizar historial
        this.loadDisputeDetails();
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    }

    showSuccess(message) {
        // Simple success notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--success-color);
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            z-index: 10000;
            font-weight: 500;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    showError(message) {
        // Simple error notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--danger-color);
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            z-index: 10000;
            font-weight: 500;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Global functions
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.adminDisputes = new AdminDisputes();
});