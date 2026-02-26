export interface GridPlanStep {
    name: string;
    description: string;
    skills: string[];
    expectedOutput: string;
}
export interface SkillGap {
    name: string;
    reason: string;
    step: string;
}
export interface StepResult {
    stepName: string;
    output: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
}
export interface GridPlan {
    id: string;
    goal: string;
    constraints?: string;
    steps: GridPlanStep[];
    skillGaps: SkillGap[];
    results: StepResult[];
    status: 'planned' | 'executing' | 'completed' | 'failed';
    createdAt: number;
}
export declare function initGridsDir(dir: string): Promise<void>;
export declare function savePlan(plan: GridPlan): Promise<void>;
export declare function loadPlan(id: string): Promise<GridPlan | null>;
export declare function listPlans(): Promise<GridPlan[]>;
export declare function deletePlan(id: string): Promise<boolean>;
export declare function extractJSON<T = any>(text: string): T;
