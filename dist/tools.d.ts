import type Anthropic from '@anthropic-ai/sdk';
export declare function setLspEnabled(enabled: boolean): void;
export declare function getLspStatus(): {
    enabled: boolean;
    clients: {
        id: string;
        name: string;
        root: string;
        status: string;
    }[];
};
export type ToolDefinition = Anthropic.Tool;
export declare const toolDefinitions: ToolDefinition[];
type ToolInput = Record<string, unknown>;
export declare function isNativeTool(name: string): boolean;
export declare function executeTool(name: string, args: ToolInput): Promise<string>;
export {};
