/**
 * security.ts — Centralized security policies and audit logging
 *
 * All dangerous operations must go through this module for validation.
 */
declare const SECURITY_CONFIG: {
    bash: {
        enabled: boolean;
        mode: "blacklist" | "whitelist";
        maxCommandLength: number;
        timeout: number;
        rateLimit: {
            maxCommandsPerMinute: number;
            maxCommandsPerHour: number;
        };
        blockedPatterns: RegExp[];
        whitelistedCommands: string[];
        auditOnlyPatterns: RegExp[];
    };
    env: {
        blockedVariables: string[];
        exfilPatterns: RegExp[];
    };
};
interface AuditEntry {
    timestamp: string;
    unixMs: number;
    sessionId?: string;
    category: 'bash' | 'peer' | 'config' | 'daemon' | 'wifi' | 'auth' | 'security';
    action: string;
    input: string;
    result: 'allowed' | 'blocked' | 'audit';
    reason?: string;
    metadata?: Record<string, any>;
}
declare class AuditLogger {
    private logPath;
    private buffer;
    private flushInterval;
    constructor(dataDir: string);
    log(entry: Omit<AuditEntry, 'timestamp' | 'unixMs'>): void;
    private flush;
    shutdown(): void;
}
export declare function initSecurity(dataDir: string): void;
export declare function getAuditLogger(): AuditLogger;
export interface BashValidationResult {
    allowed: boolean;
    sanitizedCommand?: string;
    reason?: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
}
export declare function validateBashCommand(command: string, sessionId?: string): BashValidationResult;
export interface PeerValidationResult {
    allowed: boolean;
    reason?: string;
}
export declare function validatePeerUrl(url: string): PeerValidationResult;
export interface WiFiValidationResult {
    allowed: boolean;
    sanitizedSSID?: string;
    reason?: string;
}
export declare function validateWiFiCredentials(ssid: string, password?: string): WiFiValidationResult;
export declare function validateDaemonPrompt(prompt: string): {
    allowed: boolean;
    reason?: string;
};
export declare function computeConfigHash(configPath: string): string;
export declare function setConfigHash(hash: string): void;
export declare function verifyConfigIntegrity(configPath: string): boolean;
export { SECURITY_CONFIG };
