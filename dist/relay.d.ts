#!/usr/bin/env node
/**
 * WiFi Relay — Independent background agent for WiFi management
 *
 * CRITICAL DESIGN: This runs as a DETACHED process, independent of PiWeb.
 * When PiWeb spawns this for a WiFi switch, this process outlives PiWeb
 * across network changes. It writes results to a state file that PiWeb
 * reads when it comes back online.
 *
 * Modes:
 *   switch <ssid> [password] [--prev <ssid>]   One-shot WiFi switch
 *   daemon                                      Background monitor + watchdog
 *   state                                       Print current state and exit
 *
 * State file: <dataDir>/wifi-relay.json
 * Written atomically (tmp+rename) so readers never see partial data.
 *
 * IPC: File-based only. No HTTP dependency — works when PiWeb is down.
 *
 * Security:
 *   - SSID and password are validated to prevent command injection
 *   - Shell metacharacters are blocked
 *   - nmcli arguments are properly escaped
 */
export interface RelayState {
    ssid: string | null;
    ip: string | null;
    subnet: string | null;
    gateway: string | null;
    hostname: string | null;
    hotspot: boolean;
    connected: boolean;
    timestamp: number;
    switchResult: SwitchResult | null;
}
export interface SwitchResult {
    targetSSID: string;
    status: 'pending' | 'switching' | 'connected' | 'failed' | 'rolled_back';
    ip: string | null;
    error: string | null;
    timestamp: number;
}
export declare class RelayStateFile {
    private filePath;
    constructor(filePath: string);
    read(): RelayState | null;
    write(state: RelayState): void;
    /** Update only switchResult, preserving other fields */
    updateSwitch(result: SwitchResult): void;
}
/**
 * Spawn the relay as a detached child process for a WiFi switch.
 * The child outlives this process — survives PiWeb shutdown/restart.
 */
export declare function spawnRelaySwitch(dataDir: string, ssid: string, password: string, prevSSID: string | null): void;
/**
 * Spawn the relay daemon as a detached background process.
 * Monitors network state and runs watchdog independently of PiWeb.
 */
export declare function spawnRelayDaemon(dataDir: string): void;
/**
 * Read the relay state file (for PiWeb to consume).
 */
export declare function readRelayState(dataDir: string): RelayState | null;
/**
 * Read just the switch result (for /api/wifi/switch-result).
 */
export declare function readSwitchResult(dataDir: string): SwitchResult | null;
export interface RelayConfig {
    enabled: boolean;
    targetSSID: string;
    targetPassword?: string;
    piwebUrl: string;
    reportInterval: number;
}
export declare function loadRelayConfig(rootDir: string): RelayConfig;
export declare function saveRelayConfig(rootDir: string, config: RelayConfig): void;
export declare class WiFiRelayService {
    private config;
    private running;
    private dataDir;
    constructor(config: RelayConfig, dataDir?: string);
    start(): Promise<void>;
    stop(): void;
    switchToTargetWiFi(): Promise<boolean>;
    updateConfig(config: Partial<RelayConfig>): void;
    getStatus(): {
        running: boolean;
        config: RelayConfig;
        lastReport: RelayState | null;
    };
    isServiceRunning(): boolean;
}
