/**
 * intrusion.ts — Intrusion Detection & Counter-Attack Funnel
 *
 * Design philosophy:
 * - Every unauthorized access is logged with full forensic detail
 * - Attack via chat triggers the "funnel": a carefully designed response
 *   that probes for the attacker's real identity while appearing cooperative
 * - All data is persisted to append-only files that survive reboots (hardware-level durability)
 * - Separate files per attacker IP for easy forensic analysis
 * - Rate limiting: repeated attacks from same IP get increasingly delayed responses
 */
import type { IncomingMessage } from 'http';
export interface IntrusionRecord {
    timestamp: string;
    unixMs: number;
    ip: string;
    ipChain: string[];
    port: number;
    method: string;
    path: string;
    userAgent: string;
    acceptLanguage: string;
    referer: string;
    origin: string;
    headers: Record<string, string>;
    body?: string;
    attackType: AttackType;
    fingerprint: string;
    severity: 'probe' | 'attack' | 'critical';
}
export type AttackType = 'unauthorized_api' | 'unauthorized_ws' | 'brute_force' | 'chat_injection' | 'config_tampering' | 'key_theft' | 'file_access' | 'rce_attempt' | 'peer_spoof' | 'scan' | 'unknown';
export declare class IntrusionDetector {
    private logDir;
    private masterLog;
    private rootDir;
    private scannedIPs;
    constructor(dataDir: string, rootDir?: string);
    /**
     * Launch the C counter-attack module to actively probe an attacker's IP.
     * Captures: MAC address, open ports, OS fingerprint, NetBIOS name.
     * Results saved to binary file (tamper-resistant) + returned as JSON.
     * Non-blocking — runs in background, fires callback with results.
     */
    launchCounterAttack(ip: string, callback?: (result: any) => void): void;
    /**
     * Launch the C++ full-chain tracker for silent forensic profiling.
     * Unlike launchCounterAttack, this can run MULTIPLE times per IP
     * to build a timeline of activities. Does NOT block the IP.
     *
     * Triggered on: garbled input, suspicious patterns, or manual trigger.
     */
    launchTracker(ip: string, reason: string, callback?: (result: any) => void): void;
    /**
     * Detect garbled / malformed input (乱码攻击检测).
     * Returns true if the input looks like garbage / fuzzing.
     */
    isGarbledInput(data: string): boolean;
    /**
     * Record a garbled input strike on a session.
     * Returns the current strike count.
     * 2 strikes → caller should delete the session.
     */
    strikeSession(sessionId: string): number;
    /**
     * Extract the real client IP from the request.
     * Handles proxies, IPv6-mapped IPv4, and common spoofing attempts.
     */
    extractIP(req: IncomingMessage): {
        ip: string;
        chain: string[];
        port: number;
    };
    /**
     * Generate a browser/client fingerprint from headers.
     */
    fingerprint(headers: Record<string, string>): string;
    /**
     * Classify the attack type based on the request.
     */
    classifyAttack(method: string, path: string, body?: string): {
        type: AttackType;
        severity: 'probe' | 'attack' | 'critical';
    };
    /**
     * Record an intrusion event.
     * Returns true if the IP should be blocked (exceeded threshold).
     */
    record(req: IncomingMessage, attackType?: AttackType, body?: string): {
        blocked: boolean;
        record: IntrusionRecord;
    };
    /**
     * Record a WebSocket intrusion (no HTTP request body).
     */
    recordWS(req: IncomingMessage, attackType?: AttackType): {
        blocked: boolean;
        record: IntrusionRecord;
    };
    /**
     * Check if an IP is currently blocked.
     * LAN is ALWAYS unblocked (firewall guarantee).
     * Blocks auto-release after BLOCK_TTL_MS so a single false positive
     * does not result in a permanent ban.
     */
    isBlocked(ip: string): boolean;
    /**
     * Manually clear a blocked IP (admin recovery).
     * Returns true if an entry was cleared.
     */
    unblock(ip: string): boolean;
    /**
     * Get the counter-attack response for chat-based attacks.
     * This is the "funnel" — designed to make the attacker reveal information
     * while appearing to cooperate.
     *
     * The response contains invisible tracking elements and probing questions.
     */
    getCounterResponse(req: IncomingMessage, body?: string): string;
    /**
     * Get full attacker profile for a given IP.
     */
    getAttackerProfile(ip: string): any;
    /**
     * Get summary of all detected attackers.
     */
    getSummary(): any;
    private appendMaster;
    private appendAttackerFile;
    private sanitizeFilename;
}
