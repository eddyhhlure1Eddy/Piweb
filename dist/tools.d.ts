import type Anthropic from '@anthropic-ai/sdk';
export type ToolDefinition = Anthropic.Tool;
export declare const toolDefinitions: ToolDefinition[];
type ToolInput = Record<string, unknown>;
export declare function isNativeTool(name: string): boolean;
export declare function executeTool(name: string, args: ToolInput): Promise<string>;
export {};
