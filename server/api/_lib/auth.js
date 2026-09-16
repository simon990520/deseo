// server/api/_lib/auth.js
// Helper compartido para autenticar peticiones con token Clerk (Bearer).
// Reutiliza la verificación de JWT de ../auth/verify.js sin exponer la lógica.
const verifyHandler = require('../auth/verify.js');

/**
 * Extrae el token Bearer del header Authorization.
 * @param {object} req
 * @returns {string|null}
 */
function extractBearer(req) {
    const header = req.headers && (req.headers.authorization || req.headers.Authorization);
    if (!header || typeof header !== 'string') return null;
    const m = header.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : null;
}

/**
 * Verifica el token llamando al handler de verify con un res falso.
 * Devuelve { valid, userId, isAdmin } o lanza error.
 * @param {string} token
 * @returns {Promise<{valid:boolean,userId?:string,isAdmin?:boolean}>}
 */
function verifyToken(token) {
    return new Promise((resolve, reject) => {
        const fakeRes = {
            statusCode: 200,
            _json: null,
            status(code) { this.statusCode = code; return this; },
            json(obj) { this._json = obj; resolve({ statusCode: this.statusCode, body: obj }); return this; },
            setHeader() { return this; },
            end() { resolve({ statusCode: this.statusCode, body: null }); return this; }
        };
        const fakeReq = {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` },
            body: { token }
        };
        Promise.resolve(verifyHandler(fakeReq, fakeRes)).catch(reject);
    });
}

/**
 * Middleware helper: autentica la petición. Si falla, responde 401 y devuelve null.
 * Si tiene éxito, devuelve { userId, isAdmin }.
 * @param {object} req
 * @param {object} res
 * @returns {Promise<{userId:string,isAdmin:boolean}|null>}
 */
async function requireAuth(req, res) {
    const token = extractBearer(req);
    if (!token) {
        res.status(401).json({ error: 'Unauthorized: missing token' });
        return null;
    }
    try {
        const result = await verifyToken(token);
        if (!result || result.statusCode !== 200 || !result.body || !result.body.valid) {
            res.status(401).json({ error: 'Unauthorized: invalid token' });
            return null;
        }
        return { userId: result.body.userId, isAdmin: !!result.body.isAdmin };
    } catch (err) {
        console.error('[auth] requireAuth error:', err.message);
        res.status(401).json({ error: 'Unauthorized: invalid token' });
        return null;
    }
}

module.exports = { extractBearer, verifyToken, requireAuth };
