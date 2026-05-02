/**
 * auth.ts — Token-based authentication with SHA-256 hashing
 *
 * Design:
 * - First run: auto-generate a cryptographically secure token, print it ONCE, store SHA-256 hash
 * - Subsequent runs: verify incoming tokens against stored hash
 * - Token never stored in plaintext — only the hash lives in piweb.config.json
 * - All API endpoints (except static assets) require valid token
 * - WebSocket requires token in URL query parameter
 */
export interface AuthConfig {
    authTokenHash: string;
    authEnabled: boolean;
}
/** SHA-256 hash a string, return hex */
export declare function hashToken(token: string): string;
/** Generate a cryptographically secure random token (48 bytes → 64-char base64url) */
export declare function generateToken(): string;
/**
 * Verify a provided token against the stored hash.
 * Uses constant-time comparison on the hash to prevent timing attacks.
 */
export declare function verifyToken(providedToken: string, storedHash: string): boolean;
/**
 * Initialize auth: read or generate token.
 * Returns the auth config (hash + enabled flag).
 * On first run, generates a new token, prints it, and saves the hash.
 */
export declare function initAuth(configPath: string): {
    config: AuthConfig;
    newToken?: string;
};
/**
 * CLI: reset token from command line (no auth needed — you're on the machine).
 * Usage: node -e "import('./dist/auth.js').then(m => m.resetTokenCLI())"
 * Or:    npx ts-node --esm -e "import('./src/auth.js').then(m => m.resetTokenCLI())"
 */
export declare function resetTokenCLI(configPath?: string): void;
/**
 * Extract token from HTTP request.
 * Checks (in order):
 *   1. Authorization: Bearer <token>
 *   2. URL query parameter ?token=<token>
 *   3. Cookie: piweb_token=<token>
 */
export declare function extractToken(req: {
    headers: Record<string, string | string[] | undefined>;
    url?: string;
}, parsedUrl?: URL): string | null;
/**
 * Extract token from WebSocket upgrade request URL.
 */
export declare function extractWsToken(reqUrl: string, host: string): string | null;
