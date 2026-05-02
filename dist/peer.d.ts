import WebSocket from 'ws';
export interface PeerInfo {
    id: string;
    url: string;
    name: string;
    status: 'connecting' | 'online' | 'offline';
    sessionId: string | null;
    ws: WebSocket | null;
    lastPong: number;
    isOutbound: boolean;
}
export type PeerEventHandler = (peerId: string, event: any) => void;
/** Task state for async peer_send / peer_recv */
export interface PeerTask {
    id: string;
    peerName: string;
    message: string;
    text: string;
    tools: string[];
    status: 'running' | 'done' | 'error';
    error?: string;
    sentAt: number;
    finishedAt?: number;
}
/**
 * PeerManager — manages WebSocket client connections to remote PiWeb instances.
 *
 * Design (v2 — pure async, no blocking):
 * - All peer interaction is non-blocking: peer_send dispatches, peer_recv polls
 * - One active task per peer (enforced by guard in sendBackground)
 * - No stored callbacks — handlePeerMessage() mutates PeerTask data directly
 * - Session created lazily by remote chat handler on first message
 * - Uses local IP (not hostname) as peer identity to avoid collisions
 */
export declare class PeerManager {
    private peers;
    private localName;
    private onEvent;
    private heartbeatTimer;
    private peerTasks;
    private sessionWaiters;
    private fileWaiters;
    private localPort;
    private peerSecret;
    private dataDir;
    private discoverySocket;
    private discoveryTimer;
    private discoveryEnabled;
    private connectingPeers;
    private trustedPeers;
    constructor(localName?: string, onEvent?: PeerEventHandler, localPort?: number, dataDir?: string);
    private _localIP;
    private _localPort;
    private _scanTimer;
    /** Get this node's detected LAN IP */
    getLocalIP(): string;
    /** Get this node's port */
    getLocalPort(): number;
    /**
     * Start peer connection — WHITELIST ONLY, no broadcast, no subnet scan.
     * Reads trustedPeers from piweb.config.json. Only connects to listed IPs.
     */
    startDiscovery(port?: number): void;
    /** Stop UDP discovery and subnet scanning */
    stopDiscovery(): void;
    /**
     * Unified message handler — routes all incoming peer messages.
     * Mutates PeerTask data directly (no stored callbacks, no race conditions).
     * Also handles session_created events for sessionWaiters.
     *
     * Security: All messages are logged for audit.
     */
    private handlePeerMessage;
    /**
     * Mark the running task for a peer as error (used on disconnect/timeout).
     * Safe to call even if no task is running.
     */
    private failRunningTask;
    /** Connect to a remote PiWeb instance (no session created — session is lazy on first chat) */
    connect(name: string, url: string): Promise<PeerInfo>;
    /** Disconnect from a peer */
    disconnect(name: string): boolean;
    /**
     * Fire-and-forget: send message to peer and collect response in background.
     * Returns immediately. Use getTask() to check progress.
     *
     * Guards:
     * - Rejects if peer not connected
     * - Rejects if no session (should not happen — connect() creates session eagerly)
     * - Rejects if a task is already running on this peer
     */
    sendBackground(name: string, content: string): Promise<string>;
    /** Stop the active task on a peer — sends stop signal and marks task as cancelled */
    stop(name: string): boolean;
    /** Create a new session on the peer */
    newSession(name: string): Promise<string>;
    /**
     * Send a file to a remote peer. Reads file locally, base64 encodes, sends over WS.
     * Remote saves to workplace/uploads/ and returns the remote path.
     * Max 20MB, blocks briefly until remote acknowledges.
     */
    sendFile(name: string, filePath: string): Promise<{
        remotePath: string;
        name: string;
        size: number;
    }>;
    /** List sessions on a remote peer via REST API */
    listRemoteSessions(name: string): Promise<any[]>;
    /** Get a peer by name */
    get(name: string): PeerInfo | undefined;
    /** List all remote peers */
    list(): PeerInfo[];
    /** List all peers including self (for display/API) */
    listWithSelf(): (PeerInfo & {
        self?: boolean;
    })[];
    /** Get task for a peer (non-destructive) */
    getTask(name: string): PeerTask | null;
    /** List all tasks */
    listTasks(): PeerTask[];
    /** Heartbeat — ping all connected peers */
    private heartbeat;
    /** Reconnect a disconnected peer */
    reconnect(name: string): Promise<PeerInfo>;
    /**
     * Register an incoming peer connection (called when a remote peer connects to us).
     * Unlike connect(), this does NOT create a session — the remote side initiated and has its own session.
     * Message routing is handled by web.ts calling routeIncomingMessage().
     *
     * Duplicate detection: if both sides connect simultaneously, use lexicographic
     * name tiebreaker — lower name keeps its outbound connection, higher adopts incoming.
     */
    registerIncoming(name: string, ws: WebSocket, url: string): boolean;
    /**
     * Route an incoming message from a peer WS to task + onEvent.
     * Called by web.ts when it receives a streaming event on a peer WebSocket.
     */
    routeIncomingMessage(name: string, msg: any): void;
    /** Shutdown all connections */
    shutdown(): void;
    static formatEvent(event: any): string | null;
}
