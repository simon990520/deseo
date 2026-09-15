// server/api/auth/verify.js
// Verificación de sesión Clerk (server-side). La CLERK_SECRET_KEY nunca sale del backend.
// Uso: POST { token } -> { valid, userId, isAdmin }
const ALLOWED_ORIGINS = [
    'https://simon990520.github.io',
    'http://localhost:3000',
    'http://localhost:5173'
];

function resolveOrigin(origin) {
    if (origin && ALLOWED_ORIGINS.includes(origin)) return origin;
    return ALLOWED_ORIGINS[0];
}

// Cache de JWKS de Clerk (por instancia).
let jwksCache = { keys: null, at: 0 };

async function getJwks() {
    const now = Date.now();
    if (jwksCache.keys && now - jwksCache.at < 3600 * 1000) return jwksCache.keys;
    const issuer = process.env.CLERK_ISSUER;
    if (!issuer) throw new Error('CLERK_ISSUER not configured');
    const res = await fetch(`${issuer}/.well-known/jwks.json`);
    if (!res.ok) throw new Error('Failed to fetch Clerk JWKS');
    const data = await res.json();
    jwksCache = { keys: data.keys, at: now };
    return data.keys;
}

// Verificación de JWT RS256 con WebCrypto (sin dependencias externas).
function base64urlToUint8(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = Buffer.from(b64 + pad, 'base64');
    return new Uint8Array(bin);
}

async function verifyJwt(token) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const [headerB64, payloadB64, sigB64] = parts;

    const header = JSON.parse(Buffer.from(headerB64, 'base64').toString('utf8'));
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));

    // Comprobar expiración
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) throw new Error('Token expired');

    const keys = await getJwks();
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) throw new Error('Signing key not found');

    const key = await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
    );

    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = base64urlToUint8(sigB64);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
    if (!valid) throw new Error('Invalid signature');

    return payload;
}

module.exports = async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', resolveOrigin(origin));
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const body = req.body || {};
        const token = body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!token) return res.status(400).json({ valid: false, error: 'Missing token' });

        const payload = await verifyJwt(token);
        const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
        const isAdmin = adminIds.includes(payload.sub) ||
            (payload.public_metadata && payload.public_metadata.role === 'admin');

        return res.status(200).json({
            valid: true,
            userId: payload.sub,
            isAdmin: isAdmin
        });
    } catch (err) {
        console.error('[auth] verify error:', err.message);
        return res.status(401).json({ valid: false, error: 'Invalid token' });
    }
};
