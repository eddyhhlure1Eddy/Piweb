import type Anthropic from '@anthropic-ai/sdk';
export interface MCPServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    enabled?: boolean;
}
export declare class MCPManager {
    private servers;
    init(config: Record<string, MCPServerConfig>): Promise<void>;
    getToolDefinitions(): Anthropic.Tool[];
    refreshToolDefinitions(): Promise<Anthropic.Tool[]>;
    hasTool(name: string): boolean;
    callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
    private compressBase64Image;
    startServer(name: string, serverConfig: MCPServerConfig): Promise<boolean>;
    stopServer(name: string): Promise<void>;
    getStatus(): {
        name: string;
        connected: boolean;
        toolCount: number;
    }[];
    isServerConnected(name: string): boolean;
    reload(config: Record<string, MCPServerConfig>): Promise<string[]>;
    shutdown(): Promise<void>;
}
