/**
 * DESEO — Operaciones de dinero AUTORITATIVAS EN SERVIDOR (Supabase).
 * --------------------------------------------------------------------
 * MIGRACIÓN (anti-hack):
 *  - ANTES: read-then-write / transaction() sobre Firebase RTDB desde el CLIENTE.
 *    Eso endurecía la atomicidad pero la AUTORIDAD seguía en el navegador: un
 *    atacante con la consola podía escribir `users/{id}/balance` directamente.
 *  - AHORA: el dinero vive en Supabase (Postgres). El cliente NO puede escribir
 *    saldos ni ledger (RLS sin policies de escritura). Solo puede INVOCAR RPC
 *    `SECURITY DEFINER` que validan identidad (Clerk JWT → auth.uid()) y mueven
 *    el saldo de forma atómica e idempotente (UNIQUE(op_id) a nivel de motor).
 *
 * SEGURIDAD:
 *  - Toda operación se ejecuta como el usuario autenticado (auth.uid()).
 *  - `credit()` a OTRO usuario se resuelve con rpc_transfer (el pagador debe ser
 *    el autenticado). Un usuario NO puede regalar saldo ni darse saldo a sí mismo.
 *  - Idempotencia garantizada por el motor (no por la app).
 *
 * COMPATIBILIDAD:
 *  - Se mantiene la MISMA API pública: DeseoMoney.charge/credit/transfer/reserve.
 *    El primer argumento `db` (Firebase) se ignora; se conserva por compatibilidad.
 *
 * Uso:
 *   await DeseoMoney.charge(db, userId, amount, {reason, chatId, opId})
 *   await DeseoMoney.credit(db, otherUserId, amount, {reason, chatId, opId})
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

    // ---------------------------------------------------------------------
    // Cliente Supabase (esperado global desde clerk-supabase.js)
    // ---------------------------------------------------------------------
    async function getClient() {
        if (window.DeseoAuth && window.DeseoAuth.waitForSupabase) {
            try { const c = await window.DeseoAuth.waitForSupabase; if (c) return c; } catch (_) {}
        }
        if (window.DeseoSupabase) return window.DeseoSupabase;
        if (window.DeseoAuth && window.DeseoAuth.getSupabase) return window.DeseoAuth.getSupabase();
        return null;
    }

    async function callRpc(name, params) {
        var sb = await getClient();
        if (!sb) throw new Error('Supabase no disponible');
        var res = await sb.rpc(name, params);
        if (res.error) {
            // Errores de negocio esperados → devolver como resultado controlado.
            var msg = (res.error.message || '').toLowerCase();
            if (msg.indexOf('insufficient_funds') !== -1 || msg.indexOf('balances_non_negative') !== -1 || msg.indexOf('check constraint') !== -1) return { ok: false, reason: 'insufficient_funds', error: res.error };
            if (msg.indexOf('not_authenticated') !== -1) return { ok: false, reason: 'not_authenticated', error: res.error };
            if (msg.indexOf('forbidden') !== -1) return { ok: false, reason: 'forbidden', error: res.error };
            throw new Error(res.error.message || 'rpc_error');
        }
        return res.data; // jsonb {ok, balance, ...}
    }

    // Devuelve el id del usuario autenticado (sub del JWT de Clerk/Supabase).
    async function resolveAuthUserId() {
        // 1) Sesión de Clerk (producción).
        try {
            if (window.DeseoAuth && window.DeseoAuth.getUserId) {
                var id = await window.DeseoAuth.getUserId();
                if (id) return String(id);
            }
        } catch (_) { /* noop */ }
        // 2) Decodificar el JWT del cliente Supabase (sub).
        try {
            var sb = await getClient();
            if (sb && sb.auth && sb.auth.getSession) {
                var s = await sb.auth.getSession();
                var tok = s && s.data && s.data.session && s.data.session.access_token;
                if (tok) {
                    var p = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                    if (p && p.sub) return String(p.sub);
                }
            }
        } catch (_) { /* noop */ }
        return null;
    }

    var DeseoMoney = {
        genOpId: genOpId,

        /**
         * Cobra al usuario autenticado de forma atómica e idempotente.
         * El `userId` debe ser el propio (el servidor usa auth.uid()).
         */
        async charge(db, userId, amount, options) {
            options = options || {};
            var amt = toInt(amount);
            if (amt === null || amt <= 0) throw new Error('Monto inválido');
            var opId = options.opId || genOpId('charge');

            var r = await callRpc('rpc_charge', {
                p_amount: amt,
                p_reason: options.reason || 'charge',
                p_chat_id: options.chatId || null,
                p_op_id: opId
            });
            if (r && r.ok === false) return r; // insufficient_funds, etc.
            return { ok: true, idempotent: !!(r && r.idempotent), balance: r && r.balance, opId: opId };
        },

        /**
         * Acredita a un usuario. Si es OTRO usuario, se hace como transferencia
         * del autenticado → destino (rpc_transfer). Si es uno mismo, rpc_credit.
         */
        async credit(db, userId, amount, options) {
            options = options || {};
            var amt = toInt(amount);
            if (amt === null || amt <= 0) throw new Error('Monto inválido');
            var opId = options.opId || genOpId('credit');

            // Identidad del pagador autenticado: del cliente Supabase (auth.uid()),
            // no de estructuras locales que el cliente pudiera falsear.
            var me = await resolveAuthUserId();
            if (!me && options.from) me = options.from;

            if (userId && me && userId !== me) {
                // Acreditar a otro = transferir del autenticado al destino.
                // Se normaliza el opId quitando el sufijo _in que añade el chat.
                var baseOp = String(opId).replace(/_in$/, '');
                return this.transfer(db, me, userId, amt, {
                    reason: options.reason, chatId: options.chatId, opId: baseOp
                });
            }
            // Acreditar a uno mismo (p.ej. devolución/reembolso). rpc_credit exige
            // service_role; si no está disponible, no acreditamos (evita auto-hack).
            var r = await callRpc('rpc_credit', {
                p_amount: amt,
                p_reason: options.reason || 'credit',
                p_chat_id: options.chatId || null,
                p_op_id: opId
            }).catch(function (e) {
                console.warn('[DeseoMoney] credit a sí mismo no permitido:', e && e.message);
                return { ok: false, reason: 'credit_forbidden' };
            });
            if (r && r.ok === false) return r;
            return { ok: true, idempotent: !!(r && r.idempotent), balance: r && r.balance, opId: opId };
        },

        /** Transferencia atómica (autenticado → toUserId) en el servidor. */
        async transfer(db, fromUserId, toUserId, amount, options) {
            options = options || {};
            var amt = toInt(amount);
            if (amt === null || amt <= 0) throw new Error('Monto inválido');
            if (!toUserId) throw new Error('Destino inválido');
            var opId = options.opId || genOpId('transfer');

            var r = await callRpc('rpc_transfer', {
                p_to_user: toUserId,
                p_amount: amt,
                p_reason: options.reason || 'transfer',
                p_chat_id: options.chatId || null,
                p_op_id: opId
            });
            if (r && r.ok === false) return r;
            return { ok: true, idempotent: !!(r && r.idempotent), balance: r && r.balance, opId: opId };
        },

        /**
         * ADMIN: acredita saldo a un usuario objetivo (aprobación de depósito).
         * El servidor valida que el llamador sea admin (tabla public.admins).
         * Idempotente por op_id. Si no es admin → {ok:false, reason:'forbidden'}.
         */
        async adminCredit(db, userId, amount, options) {
            options = options || {};
            var amt = toInt(amount);
            if (amt === null || amt <= 0) throw new Error('Monto inválido');
            if (!userId) throw new Error('Destino inválido');
            var opId = options.opId || genOpId('admin_credit');
            var r = await callRpc('rpc_admin_credit', {
                p_user: userId, p_amount: amt,
                p_reason: options.reason || 'admin_deposit', p_op_id: opId
            });
            if (r && r.ok === false) return r;
            return { ok: true, idempotent: !!(r && r.idempotent), balance: r && r.balance, opId: opId };
        },

        /**
         * ADMIN: debita saldo a un usuario objetivo (aprobación de retiro).
         * Valida admin en el servidor. Idempotente por op_id.
         */
        async adminCharge(db, userId, amount, options) {
            options = options || {};
            var amt = toInt(amount);
            if (amt === null || amt <= 0) throw new Error('Monto inválido');
            if (!userId) throw new Error('Destino inválido');
            var opId = options.opId || genOpId('admin_charge');
            var r = await callRpc('rpc_admin_charge', {
                p_user: userId, p_amount: amt,
                p_reason: options.reason || 'admin_withdrawal', p_op_id: opId
            });
            if (r && r.ok === false) return r;
            return { ok: true, idempotent: !!(r && r.idempotent), balance: r && r.balance, opId: opId };
        },

        /** Reserva fondos (retiro): cobra de forma atómica, sin saldo negativo. */
        async reserve(db, userId, amount, options) {
            options = options || {};
            var opId = options.opId || genOpId('reserve');
            return this.charge(db, userId, amount, Object.assign({}, options, {
                opId: opId, reason: options.reason || 'withdrawal_reserve'
            }));
        },

        /** Escrow (custodia): retiene el monto del pagador hasta liberarlo. */
        async escrowHold(db, orderId, amount, options) {
            options = options || {};
            var amt = toInt(amount);
            if (amt === null || amt <= 0) throw new Error('Monto inválido');
            if (!orderId) throw new Error('orderId requerido');
            var r = await callRpc('rpc_escrow_hold', {
                p_order_id: orderId, p_amount: amt,
                p_op_id: options.opId || ('escrow_hold_' + orderId)
            });
            if (r && r.ok === false) return r;
            return { ok: true, idempotent: !!(r && r.idempotent), balance: r && r.balance, escrow: r && r.escrow };
        },

        /** Libera el escrow al proveedor (idempotente). */
        async escrowRelease(db, orderId, toUser, options) {
            options = options || {};
            if (!orderId || !toUser) throw new Error('orderId/toUser requeridos');
            var r = await callRpc('rpc_escrow_release', {
                p_order_id: orderId, p_to_user: toUser,
                p_op_id: options.opId || ('release_' + orderId)
            });
            if (r && r.ok === false) return r;
            return { ok: true, idempotent: !!(r && r.idempotent), released: r && r.released };
        },

        /** Devuelve el escrow al cliente original (disputa/cancelación). */
        async escrowRefund(db, orderId, options) {
            options = options || {};
            if (!orderId) throw new Error('orderId requerido');
            var r = await callRpc('rpc_escrow_refund', {
                p_order_id: orderId, p_op_id: options.opId || ('refund_' + orderId)
            });
            if (r && r.ok === false) return r;
            return { ok: true, idempotent: !!(r && r.idempotent), refunded: r && r.refunded };
        },

        /**
         * Lectura del saldo propio (RLS: solo el propio). Devuelve número o null.
         */
        async getBalance(db, userId) {
            try {
                var sb = await getClient();
                if (!sb) return null;
                var res = await sb.from('balances').select('balance').eq('user_id', userId).maybeSingle();
                if (res.error) return null;
                return res.data ? toInt(res.data.balance) : 0;
            } catch (_) { return null; }
        }
    };

    if (typeof window !== 'undefined') {
        window.DeseoMoney = DeseoMoney;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DeseoMoney;
    }
})();
