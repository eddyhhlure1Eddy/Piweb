import { Agent } from './agent.js';
import { MemoryStore } from './memory.js';
import { type Skill } from './skills.js';
export declare function startCLI(agent: Agent, memory: MemoryStore, allSkills: Skill[], onExit?: () => void | Promise<void>): Promise<void>;
