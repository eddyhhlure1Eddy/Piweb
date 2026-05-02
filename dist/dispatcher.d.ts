/**
 * Context Dispatcher — 上下文调度器
 *
 * 坐在路由层和 Agent 之间，每次请求前智能裁剪上下文：
 * 1. 记忆按需加载 — 只注入 preference + 关键词命中的 fact，跳过 conversation_summary
 * 2. 工具按需加载 — 根据意图只挂载相关工具，避免 40+ 工具淹没模型
 * 3. 系统提示词精简 — 不在文本里重复描述工具，让 function schema 说话
 * 4. 工具结果截断 — 防止单次工具返回撑爆上下文
 */
import { type MemoryEntry } from './memory.js';
import { type Skill } from './skills.js';
import { type TimerManager } from './timers.js';
import { type MCPManager } from './mcp.js';
import type Anthropic from '@anthropic-ai/sdk';
export interface ContextOverrides {
    systemPrompt: string;
    tools: Anthropic.Tool[];
    toolResultMaxChars: number;
    toolChoice?: 'auto' | 'required' | 'none';
}
export declare class ContextDispatcher {
    private mcpManager;
    private timerManager?;
    private _sessionBrowserUsed;
    constructor(mcpManager: MCPManager, timerManager?: TimerManager);
    setTimerManager(tm: TimerManager): void;
    /** Called by agent after tool execution to track browser usage per session */
    markBrowserUsed(sessionId: string): void;
    /**
     * Main entry — call before every agent.chatStream()
     * Returns a clean ContextOverrides that replaces the agent's internal context building
     */
    dispatch(message: string, sessionId: string, activeSkills: Skill[], isWake: boolean, memoryEntries: MemoryEntry[], customSystemPrompt?: string, allSkills?: Skill[]): Promise<ContextOverrides>;
    private classifyIntent;
    private filterMemories;
    private buildTimerSection;
    private selectTools;
    static truncateResult(result: string, maxChars: number): string;
}
