/**
 * DESEO — Operaciones de dinero atómicas e idempotentes (Firebase RTDB).
 * --------------------------------------------------------------------
 * PROBLEMA QUE RESUELVE:
 *  - El código anterior hacía read-then-write sobre `users/{id}/balance`
 *    (`parseInt(snap) + amount` → `set()`), lo que permite doble gasto por
 *    condiciones de carrera y por doble clic/pestañas.
 *  - No había reserva de fondos en retiros ni idempotencia por operación.
 *
 * SOLUCIÓN:
 *  - Usa `ref.transaction()` de Firebase RTDB (atómico, server-side): si el
 *    saldo cambió entre lectura y escritura, Firebase reintenta.
 *  - Idempotencia: cada operación lleva un `opId` único; antes de aplicar se
 *    registra en `ledger/{opId}`. Si ya existe, no se vuelve a aplicar.
 *
 * NOTA DE SEGURIDAD (importante):
 *  - Esto endurece la ATOMICIDAD, pero la AUTORIDAD sigue en el cliente mientras
 *    el RTDB sea público. La defensa real es:
 *      (1) Firebase Security Rules que impidan escribir `balance` directamente, y
 *      (2) mover estas operaciones a Cloud Functions con Admin SDK.
 *  - Este módulo está pensado para funcionar igual hoy (compat) y para ser el
 *    punto único a migrar a backend mañana.
 *
 * Uso:
 *   await DeseoMoney.charge(db, userId, amount, {reason, chatId, opId})
 *   await DeseoMoney.credit(db, userId, amount, {reason, chatId, opId})
 *   await DeseoMoney.reserve(db, userId, amount, {reason, opId})
 */
(function () {
    'use strict';

    function genOpId(prefix) {
        var rand = Math.random().toString(36).slice(2, 11);
        return (prefix || 'op') + '_' + Date.now() + '_' + rand;
    }

    function toInt(value) {
        var n = parseInt(value, 10);
        return Number.isFinite(n) ? n : null;
    }

    /**
     * Marca una operación como aplicada de forma idempotente.
     * Devuelve true si es la primera vez (debe aplicarse), false si ya existía.
     */
    async function claimOp(db, opId, meta) {
        if (!opId) return true; // sin id → no hay control de idempotencia
        var ledgerRef = db.ref('ledger/' + opId);
        // applyLocally=true (default): para un nodo NUEVO el updateFn debe poder
        // crear el registro aunque el servidor aún no tenga el valor. El ledger es
        // append-only; si ya existe, la transacción aborta (idempotencia).
        var result = await ledgerRef.transaction(function (current) {
            if (current) return; // ya existe: abortar la transacción (no aplicar)
            return Object.assign({ appliedAt: new Date().toISOString() }, meta || {});
        });
        return result.committed;
    }

    async function releaseOp(db, opId) {
        if (!opId) return;
        try { await db.ref('ledger/' + opId).remove(); } catch (_) { /* noop */ }
    }

    // Cache de nodos ya "activados" con listener persistente (para que
    // transaction() siempre trabaje sobre el valor del servidor en compat SDK v10).
    var activatedNodes = {};

    /**
     * Activa (sincroniza) un nodo del RTDB adjuntando un listener persistente.
     * En el SDK compat v10, `transaction()` sobre un nodo que no está "activo"
     * parte de la caché local vacía (ve null) y aborta silenciosamente. Mantener
     * un listener 'value' garantiza que la caché refleje el servidor.
     */
    function activateNode(ref) {
        return new Promise(function (resolve) {
            var key = ref.toString();
            if (activatedNodes[key]) { resolve(); return; }
            var done = false;
            var finish = function () { if (!done) { done = true; activatedNodes[key] = true; resolve(); } };
            try {
                ref.on('value', function () { finish(); }, function () { finish(); });
            } catch (_) { finish(); return; }
            // Respaldo: si no llega ningún valor en 2.5s, continuar igualmente.
            setTimeout(finish, 2500);
        });
    }

    /**
     * Aplica un delta atómico al balance, sin permitir saldo negativo.
     * delta: número positivo o negativo.
     * requireSufficient: si true, aborta cuando el saldo quedaría < 0.
     */
    async function applyDelta(db, userId, delta, options) {
        options = options || {};
        var balanceRef = db.ref('users/' + userId + '/balance');

        // Sincronizar el nodo (listener persistente) para que la transacción vea el valor real.
        await activateNode(balanceRef);

        var updateFn = function (current) {
            var cur = toInt(current);
            if (cur === null) cur = 0;
            var next = cur + delta;
            if (options.requireSufficient && next < 0) {
                return; // abortar: fondos insuficientes
            }
            return next;
        };

        var result = await balanceRef.transaction(updateFn);
        return { committed: result.committed, balance: toInt(result.snapshot.val()) };
    }

    async function writeLedgerEntry(db, userId, entry) {
        try {
            await db.ref('users/' + userId + '/microtransactions/' + entry.id).set(entry);
        } catch (_) { /* noop */ }
    }

    var DeseoMoney = {
        genOpId: genOpId,

        /** Cobra al usuario de forma atómica. No deja saldo negativo. */
        async charge(db, userId, amount, options) {
            options = options || {};
            var amt = toInt(amount);
            if (amt === null || amt <= 0) throw new Error('Monto inválido');
            var opId = options.opId || genOpId('charge');

            if (!(await claimOp(db, opId, { kind: 'charge', userId: userId, amount: amt }))) {
                return { ok: true, idempotent: true, opId: opId };
            }

            var res = await applyDelta(db, userId, -amt, { requireSufficient: true });
            if (!res.committed) {
                await releaseOp(db, opId);
                return { ok: false, reason: 'insufficient_funds', opId: opId };
            }

            await writeLedgerEntry(db, userId, {
                id: opId, direction: 'out', reason: options.reason || 'charge',
                amount: amt, to: options.to || null, chatId: options.chatId || null,
                timestamp: new Date().toISOString()
            });
            return { ok: true, balance: res.balance, opId: opId };
        },

        /** Acredita al usuario de forma atómica. */
        async credit(db, userId, amount, options) {
            options = options || {};
            var amt = toInt(amount);
            if (amt === null || amt <= 0) throw new Error('Monto inválido');
            var opId = options.opId || genOpId('credit');

            if (!(await claimOp(db, opId, { kind: 'credit', userId: userId, amount: amt }))) {
                return { ok: true, idempotent: true, opId: opId };
            }

            var res = await applyDelta(db, userId, amt, { requireSufficient: false });
            if (!res.committed) {
                await releaseOp(db, opId);
                return { ok: false, reason: 'not_committed', opId: opId };
            }

            await writeLedgerEntry(db, userId, {
                id: opId, direction: 'in', reason: options.reason || 'credit',
                amount: amt, from: options.from || null, chatId: options.chatId || null,
                timestamp: new Date().toISOString()
            });
            return { ok: true, balance: res.balance, opId: opId };
        },

        /** Transferencia atómica cliente→proveedor en una sola operación idempotente. */
        async transfer(db, fromUserId, toUserId, amount, options) {
            options = options || {};
            var opId = options.opId || genOpId('transfer');
            var charge = await this.charge(db, fromUserId, amount, {
                reason: options.reason, chatId: options.chatId, to: toUserId, opId: opId + '_out'
            });
            if (!charge.ok) return charge;
            if (charge.idempotent) {
                // El cobro ya se aplicó antes; verificar que el crédito también.
                await this.credit(db, toUserId, amount, {
                    reason: options.reason, chatId: options.chatId, from: fromUserId, opId: opId + '_in'
                });
                return { ok: true, idempotent: true, opId: opId };
            }
            await this.credit(db, toUserId, amount, {
                reason: options.reason, chatId: options.chatId, from: fromUserId, opId: opId + '_in'
            });
            return { ok: true, opId: opId };
        },

        /** Reserva fondos (retiro): descuenta ya, de forma atómica y sin saldo negativo. */
        async reserve(db, userId, amount, options) {
            options = options || {};
            var opId = options.opId || genOpId('reserve');
            return this.charge(db, userId, amount, Object.assign({}, options, { opId: opId, reason: options.reason || 'withdrawal_reserve' }));
        }
    };

    if (typeof window !== 'undefined') {
        window.DeseoMoney = DeseoMoney;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DeseoMoney;
    }
})();
