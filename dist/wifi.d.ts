/**
 * WiFi management module for PiWeb (Linux/NetworkManager only)
 *
 * Architecture: WiFi SWITCHING is delegated to a detached relay process
 * (relay.ts) that survives PiWeb restarts and network changes.
 * This module handles: scanning, status, hotspot, and the API glue.
 *
 * The relay process:
 * - Runs independently as a detached child
 * - Performs nmcli operations for WiFi switches
 * - Writes results to data/wifi-relay.json
 * - Includes its own watchdog (daemon mode)
 */
import { type SwitchResult } from './relay.js';
export declare function initWiFi(dataDir: string): void;
export interface WiFiNetwork {
    ssid: string;
    signal: number;
    security: string;
    connected: boolean;
}
export interface NetworkStatus {
    connected: boolean;
    ip: string | null;
    ssid: string | null;
    url: string | null;
    hostname: string | null;
    hotspot: boolean;
}
export interface ConnectResult {
    success: boolean;
    ip?: string | null;
    error?: string;
}
export declare function scanNetworks(): Promise<WiFiNetwork[]>;
/**
 * Schedule a WiFi switch via the relay.
 * The relay runs as a DETACHED process — survives PiWeb shutdown.
 * Frontend polls /api/wifi/switch-result which reads relay's state file.
 */
export declare function scheduleWiFiConnect(ssid: string, password: string, _delaySec?: number): Promise<void>;
/**
 * Get switch result — reads from relay's state file.
 * Returns the SwitchResult written by the detached relay process.
 */
export declare function getSwitchResult(): SwitchResult | null;
export declare function getNetworkStatus(): Promise<NetworkStatus>;
export declare function startHotspot(): Promise<{
    success: boolean;
    error?: string;
}>;
export declare function startWatchdog(): void;
export declare function stopWatchdog(): void;
