import Anthropic from '@anthropic-ai/sdk';
import type { PeerManager } from './peer.js';
import { MemoryStore } from './memory.js';
import { MCPManager } from './mcp.js';
import { type Skill } from './skills.js';
import { type GridPlanStep, type SkillGap } from './grids.js';
import { type TimerManager } from './timers.js';
import { type SchedulerConfig } from './scheduler.js';
export type StreamEvent = {
    type: 'thinking';
    text: string;
} | {
    type: 'token';
    text: string;
} | {
    type: 'tool_start';
    name: string;
    args?: any;
} | {
    type: 'tool_partial';
    name: string;
    args: any;
    argsText: string;
} | {
    type: 'tool_end';
    name: string;
    result: string;
    file?: {
        mime: string;
        data: string;
        name: string;
        path?: string;
    };
} | {
    type: 'done';
    fullText: string;
} | {
    type: 'error';
    message: string;
} | {
    type: 'grid_planning';
    planId: string;
    goal: string;
} | {
    type: 'grid_plan_ready';
    planId: string;
    goal: string;
    steps: GridPlanStep[];
    skillGaps: SkillGap[];
} | {
    type: 'grid_step_start';
    planId: string;
    step: string;
    index: number;
    total: number;
    skills: string[];
} | {
    type: 'grid_step_end';
    planId: string;
    step: string;
    index: number;
    output: string;
    status: string;
} | {
    type: 'grid_complete';
    planId: string;
    goal: string;
    summary: string;
} | {
    type: 'grid_error';
    planId: string;
    message: string;
} | {
    type: 'soul_start';
    soulId: string;
    question: string;
    unitCount: number;
} | {
    type: 'soul_unit_start';
    soulId: string;
    role: string;
    label: string;
    emoji: string;
    index: number;
} | {
    type: 'soul_unit_done';
    soulId: string;
    role: string;
    label: string;
    index: number;
    output: string;
    status: string;
} | {
    type: 'soul_synthesizing';
    soulId: string;
} | {
    type: 'soul_complete';
    soulId: string;
    question: string;
    synthesis: string;
} | {
    type: 'soul_error';
    soulId: string;
    message: string;
} | {
    type: 'reflection';
    step: number;
    tools: string[];
} | {
    type: 'reflection_output';
    step: number;
    tools: string[];
    content: string;
} | {
    type: 'timer_fired';
    timerId: string;
    label: string;
    sessionId: string;
};
export interface GridMessageStep {
    name: string;
    description: string;
    skills: string[];
    expectedOutput: string;
    status: string;
    output?: string;
}
export interface GridMessageData {
    planId: string;
    goal: string;
    steps: GridMessageStep[];
    skillGaps: SkillGap[];
    status: string;
    error?: string;
}
export interface SoulMessageUnit {
    role: string;
    label: string;
    emoji: string;
    output: string;
    status: string;
}
export interface SoulMessageData {
    soulId: string;
    question: string;
    units: SoulMessageUnit[];
    synthesis: string;
    status: string;
    error?: string;
}
export interface AgentConfig {
    provider: 'anthropic' | 'openai';
    baseURL?: string;
    model: string;
    maxTokens: number;
    systemPrompt?: string;
}
export interface VisionEndpointConfig {
    enabled: boolean;
    mode?: 'auto' | 'manual';
    provider: string;
    baseURL: string;
    apiKey: string;
    model: string;
}
export interface CompressionConfig {
    tokenThreshold: number;
    messageThreshold: number;
    minMessages: number;
    keepRecent: number;
    keepMid: number;
    summaryMaxTokens: number;
    contentTruncateChars: number;
    systemPromptOverhead: number;
    retryAttempts: number;
    retryDelayMs: number;
    backupBeforeCompress: boolean;
    includeMetadataInSummary: boolean;
}
/** Overrides from ContextDispatcher — replaces internally-built context */
export interface ContextOverrides {
    systemPrompt: string;
    tools: Anthropic.Tool[];
    toolResultMaxChars: number;
    toolChoice?: 'auto' | 'required' | 'none';
}
export declare class Agent {
    private anthropicClient?;
    private openaiConfig?;
    private apiKey;
    private memory;
    private mcpManager;
    private config;
    private gridsDir;
    private allSkills;
    private skillsDir;
    private compressionConfig;
    private maxToolIterations;
    private timerManager?;
    private peerManager?;
    private _toolResultMaxChars;
    private _toolChoice?;
    private scheduler?;
    private visionEndpoint?;
    private _freeVLCache;
    private _freeVLCacheExpiry;
    private initDoneSessions;
    private agenticLoop;
    private _guideIntensity;
    constructor(apiKey: string, memory: MemoryStore, mcpManager: MCPManager, config: AgentConfig, gridsDir?: string, allSkills?: Skill[], compression?: Partial<CompressionConfig>, maxToolIterations?: number, skillsDir?: string);
    private applyConfig;
    setTimerManager(tm: TimerManager): void;
    setPeerManager(pm: PeerManager): void;
    /** Initialize or update the model scheduler */
    setScheduler(config?: SchedulerConfig): void;
    /** Initialize or update the vision endpoint */
    setVisionEndpoint(config?: VisionEndpointConfig): void;
    setAgenticLoop(enabled: boolean): void;
    getAgenticLoop(): boolean;
    setCompression(partial?: Partial<CompressionConfig>): void;
    getCompressionConfig(): CompressionConfig;
    /** Fetch and cache free vision-language models from OpenRouter */
    private fetchFreeVLModels;
    /**
     * Send images to the vision model and get text descriptions.
     * Returns the description text, or null on failure (caller falls back to raw images).
     */
    private processImagesViaVision;
    /** Get current scheduler info for API/frontend */
    getSchedulerInfo(): {
        mode: string;
        models: Record<string, string>;
        reflectEndpoint?: any;
    } | null;
    /** Resolve model for a given execution phase (scheduler-aware) */
    private resolveModel;
    /** Resolve work-or-init phase: init only on the very first message of a session */
    private resolveWorkPhase;
    /** Reload skills from disk into the shared allSkills array */
    reloadSkills(): Promise<void>;
    updateConfig(config: AgentConfig, apiKey?: string): void;
    getConfig(): AgentConfig & {
        apiKey: string;
    };
    chatStream(message: string, sessionId: string, emit: (event: StreamEvent) => void, activeSkills?: Skill[], signal?: AbortSignal, images?: string[], isWake?: boolean, overrides?: ContextOverrides, files?: {
        path: string;
        name: string;
        mime: string;
        size: number;
    }[]): Promise<void>;
    /**
     * Build a rich digest from messages for summarization.
     * tier: 'mid' = detailed, 'far' = coarse
     */
    private buildMessageDigest;
    /**
     * Call the LLM for summarization with timeout and think-tag stripping.
     */
    private callSummaryLLM;
    /**
     * Generate a tiered summary with retry and validation.
     * tier: 'mid' = detailed (≤400 words), 'far' = coarse (≤200 words)
     */
    private generateTieredSummary;
    /**
     * Pure extractive fallback when LLM is unavailable.
     * Extracts topics from user messages and tool names — no LLM call.
     */
    private extractiveFallbackSummary;
    /**
     * Three-tier context compression:
     * [FAR - coarse summary] [MID - detailed summary] [NEAR - kept as-is]
     */
    private maybeCompressContext;
    /**
     * Extract a readable execution trace from recent messages for the reflection model.
     * Handles both Anthropic and OpenAI message formats.
     */
    private extractExecutionTrace;
    private generateReflection;
    /**
     * Generate a brief strategy guide from the reflect model BEFORE the worker model processes.
     * Reuses the same reflect endpoint config. Returns null on failure or when not applicable.
     */
    private generateDraftGuide;
    /**
     * Called BEFORE each recursive streamLoop call (every tool iteration).
     * Sends the current progress (tool names + results) to the reflect model,
     * gets a strategic analysis, and returns it for injection into messages.
     * Only active when reflectEndpoint.draftGuide is true.
     * Returns null if disabled, timed out, or failed.
     */
    private generateStepGuide;
    private streamLoopAnthropic;
    private streamLoopOpenAI;
    /**
     * Reconstruct a human-readable summary of tool calls from a stored message.
     * This is injected into assistant messages when loading session history,
     * so the model knows what tools it used in previous turns.
     */
    private _buildToolDigest;
    private _injectStepGuide;
    private _shouldRunStepGuide;
    private _classifyTaskType;
    private _hasBrowserMCP;
    private _buildWebToolPriority;
    private _getAvailableToolNames;
    private _countSources;
    private _buildDraftSystemPrompt;
    private _buildStepSystemPrompt;
    private _callReflectForPlanning;
    /**
     * Build a compact history of what the worker did in previous steps.
     * Extracts tool_call names + first line of each result from messages.
     * Budget: ~1500 chars max to avoid bloating the reflect prompt.
     */
    private _buildStepHistory;
    private _truncResult;
    /**
     * Trim in-flight messages array when accumulated tokens exceed budget.
     * Keeps: system message (index 0) + last N messages.
     * Removes oldest non-system messages and replaces with a summary note.
     */
    private _trimInFlightMessages;
    private runTool;
    private planGrid;
    private executeGridPlan;
    private runCompletionAnthropic;
    private runCompletionLoopAnthropic;
    private runCompletionOpenAI;
    private runCompletionLoopOpenAI;
    private planPerspectives;
    private soulThink;
    saveAssistantMessage(sessionId: string, content: string, extra?: {
        images?: {
            mime: string;
            data: string;
            name: string;
        }[];
        thinking?: string;
        tools?: {
            name: string;
            result: string;
        }[];
        steps?: Array<{
            type: string;
            text?: string;
            name?: string;
            result?: string;
        }>;
        grids?: GridMessageData[];
        souls?: SoulMessageData[];
    }): Promise<void>;
    /** Replace the last assistant message in a session (idempotent intermediate save) */
    replaceLastAssistantMessage(sessionId: string, content: string, extra?: {
        images?: {
            mime: string;
            data: string;
            name: string;
        }[];
        thinking?: string;
        tools?: {
            name: string;
            result: string;
        }[];
        steps?: Array<{
            type: string;
            text?: string;
            name?: string;
            result?: string;
        }>;
        grids?: GridMessageData[];
        souls?: SoulMessageData[];
    }): Promise<void>;
    listSessions(): Promise<import("./memory.js").Session[]>;
    getMemory(): MemoryStore;
}
