export interface SwarmTask {
    id: string;
    name: string;
    description: string;
    expectedOutput: string;
    dependencies: string[];
    output: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    duration?: number;
}
export interface SwarmPlan {
    id: string;
    goal: string;
    constraints?: string;
    tasks: SwarmTask[];
    summary: string;
    status: 'planning' | 'planned' | 'executing' | 'completed' | 'failed';
    maxWorkers: number;
    createdAt: number;
}
/**
 * Group tasks into execution levels based on dependencies.
 * Level 0: tasks with no dependencies (run first, in parallel)
 * Level 1: tasks depending only on level-0 tasks (run next, in parallel)
 * etc.
 * Circular dependencies are forced into one final level.
 */
export declare function resolveExecutionLevels(tasks: SwarmTask[]): SwarmTask[][];
export declare function initSwarmDir(dir: string): void;
export declare function saveSwarmPlan(plan: SwarmPlan): Promise<void>;
export declare function loadSwarmPlan(id: string): Promise<SwarmPlan | null>;
export declare function listSwarmPlans(): Promise<SwarmPlan[]>;
export declare function deleteSwarmPlan(id: string): Promise<boolean>;
