import { Agent } from './agent.js';
import { MemoryStore } from './memory.js';
import { MCPManager } from './mcp.js';
import { type Skill } from './skills.js';
import { type TimerManager } from './timers.js';
export declare function startWeb(agent: Agent, memory: MemoryStore, allSkills: Skill[], port?: number, rootDir?: string, mcpManager?: MCPManager, timerManager?: TimerManager): Promise<{
    shutdown: () => Promise<void>;
}>;
