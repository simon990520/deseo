module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "script"
  },
  globals: {
    // Librerías externas (CDN)
    firebase: "readonly",
    mapboxgl: "readonly",
    Chart: "readonly",
    Clerk: "readonly",
    // Config global propia
    CONFIG: "readonly",
    // Utilidades propias expuestas en window
    getCategoryConfig: "readonly",
    getCategoryName: "readonly",
    getCategoryColor: "readonly",
    getCategoryPriceRange: "readonly",
    isMapboxTokenConfigured: "readonly",
    getRandomAIResponse: "readonly",
    debugLog: "readonly",
    // Utilidades de seguridad (security-utils.js)
    escapeHtml: "readonly",
    escapeAttr: "readonly",
    escapeInt: "readonly",
    safeUrl: "readonly",
    setText: "readonly",
    hashPassword: "readonly",
    verifyPassword: "readonly",
    isHashed: "readonly",
    DeseoSecurity: "readonly",
    // Clases definidas en otros archivos (auth.js, wishes.js, ai-chat.js)
    DeseoAuth: "readonly",
    DeseoAI: "readonly",
    DeseoWishes: "readonly"
  },
  rules: {
    "no-unused-vars": ["warn", { "args": "none", "caughtErrors": "none" }],
    "no-undef": "error",
    "no-redeclare": "warn",
    "no-dupe-keys": "error",
    "no-dupe-args": "error",
    "no-dupe-class-members": "error",
    "no-constant-condition": "warn",
    "no-empty": "warn",
    "no-prototype-builtins": "off",
    "eqeqeq": ["warn", "smart"],
    "no-var": "off",
    "prefer-const": "off"
  },
  ignorePatterns: [
    "node_modules/",
    "_backup_audit/",
    "data.json",
    "*.min.js",
    "config.local.js"
  ]
};
