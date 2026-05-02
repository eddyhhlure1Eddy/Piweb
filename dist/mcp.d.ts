import type Anthropic from '@anthropic-ai/sdk';
export interface MCPServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    enabled?: boolean;
}
export declare class MCPManager {
    private servers;
    private _reconnecting;
    init(config: Record<string, MCPServerConfig>): Promise<void>;
    getToolDefinitions(): Anthropic.Tool[];
    private _cachedTools;
    private _cacheTs;
    refreshToolDefinitions(): Promise<Anthropic.Tool[]>;
    getCachedToolNames(): string[];
    hasTool(name: string): boolean;
    callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
    private _executeToolCall;
    private _reconnectServer;
    private compressBase64Image;
    startServer(name: string, serverConfig: MCPServerConfig): Promise<boolean>;
    stopServer(name: string): Promise<void>;
    getStatus(): {
        name: string;
        connected: boolean;
        toolCount: number;
    }[];
    /** Get detailed status with actual tool names per server */
    getDetailedStatus(): Promise<{
        name: string;
        connected: boolean;
        tools: {
            name: string;
            description: string;
        }[];
    }[]>;
    isServerConnected(name: string): boolean;
    reload(config: Record<string, MCPServerConfig>): Promise<string[]>;
    /** Clear tool cache so newly added MCP servers' tools appear immediately */
    invalidateCache(): void;
    /** Add a server entry to piweb.config.json and optionally hot-start it */
    addToConfig(name: string, serverConfig: MCPServerConfig, configPath: string): Promise<{
        ok: boolean;
        tools: number;
        error?: string;
    }>;
    /** Remove a server from piweb.config.json and stop it */
    removeFromConfig(name: string, configPath: string): Promise<{
        ok: boolean;
        error?: string;
    }>;
    listResources(serverName?: string): Promise<{
        name: string;
        uri: string;
        description: string;
        mimeType: string;
        server: string;
    }[]>;
    readResource(uri: string): Promise<string>;
    shutdown(): Promise<void>;
}
