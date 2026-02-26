import { MemoryStore } from './memory.js';
import { MCPManager } from './mcp.js';
import { type Skill } from './skills.js';
import { type GridPlanStep, type SkillGap } from './grids.js';
import { type SwarmTask } from './swarm.js';
import { type TimerManager } from './timers.js';
export type StreamEvent = {
    type: 'thinking';
    text: string;
} | {
    type: 'token';
    text: string;
} | {
    type: 'tool_start';
    name: string;
} | {
    type: 'tool_end';
    name: string;
    result: string;
    file?: {
        mime: string;
        data: string;
        name: string;
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
    type: 'swarm_planning';
    planId: string;
    goal: string;
} | {
    type: 'swarm_plan_ready';
    planId: string;
    goal: string;
    tasks: SwarmTask[];
} | {
    type: 'swarm_task_start';
    planId: string;
    taskName: string;
    taskId: string;
    index: number;
    total: number;
} | {
    type: 'swarm_task_end';
    planId: string;
    taskName: string;
    taskId: string;
    index: number;
    output: string;
    status: string;
} | {
    type: 'swarm_complete';
    planId: string;
    goal: string;
    summary: string;
} | {
    type: 'swarm_error';
    planId: string;
    message: string;
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
export interface SwarmMessageTask {
    id: string;
    name: string;
    description: string;
    dependencies: string[];
    status: string;
    output?: string;
}
export interface SwarmMessageData {
    planId: string;
    goal: string;
    tasks: SwarmMessageTask[];
    summary: string;
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
export declare class Agent {
    private anthropicClient?;
    private openaiConfig?;
    private apiKey;
    private memory;
    private mcpManager;
    private config;
    private gridsDir;
    private allSkills;
    private compressionConfig;
    private maxToolIterations;
    private timerManager?;
    constructor(apiKey: string, memory: MemoryStore, mcpManager: MCPManager, config: AgentConfig, gridsDir?: string, allSkills?: Skill[], compression?: Partial<CompressionConfig>, maxToolIterations?: number);
    private applyConfig;
    setTimerManager(tm: TimerManager): void;
    updateConfig(config: AgentConfig, apiKey?: string): void;
    getConfig(): AgentConfig & {
        apiKey: string;
    };
    chatStream(message: string, sessionId: string, emit: (event: StreamEvent) => void, activeSkills?: Skill[], signal?: AbortSignal, images?: string[], isWake?: boolean): Promise<void>;
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
    private streamLoopAnthropic;
    private streamLoopOpenAI;
    private currentSessionId?;
    private runTool;
    private planGrid;
    private executeGridPlan;
    private runCompletionAnthropic;
    private runCompletionLoopAnthropic;
    private runCompletionOpenAI;
    private runCompletionLoopOpenAI;
    private planPerspectives;
    private soulThink;
    private planSwarm;
    private executeSwarmPlan;
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
        grids?: GridMessageData[];
        souls?: SoulMessageData[];
        swarms?: SwarmMessageData[];
    }): Promise<void>;
    listSessions(): Promise<import("./memory.js").Session[]>;
    getMemory(): MemoryStore;
}
