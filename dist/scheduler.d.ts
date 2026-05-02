/**
 * Model Scheduler — route different execution phases to different models.
 * All models go through the same OpenAI-compatible proxy endpoint;
 * only the `model` field in the request body changes.
 */
export type SchedulerPhase = 'init' | 'work' | 'reflect' | 'compress';
export type SchedulerMode = 'none' | 'performance' | 'custom';
export interface SchedulerModelMap {
    init: string;
    work: string;
    reflect: string;
    compress: string;
}
/**
 * Independent endpoint config for the reflect model.
 * When set, generateReflection() uses this endpoint instead of the main one.
 * Supports both OpenAI-compatible and Anthropic API formats.
 */
export interface ReflectEndpointConfig {
    enabled: boolean;
    provider: 'openai' | 'anthropic';
    baseURL: string;
    apiKey: string;
    model: string;
    reflection?: boolean;
    draftGuide?: boolean;
    minSources?: number;
    minScore?: number;
    maxPlanSteps?: number;
    guideMaxTokens?: number;
}
export interface SchedulerConfig {
    mode: SchedulerMode;
    models?: Partial<SchedulerModelMap>;
    reflectEndpoint?: ReflectEndpointConfig;
}
export declare const PRESET_PERFORMANCE: SchedulerModelMap;
export declare class ModelScheduler {
    private mode;
    private models;
    private _reflectEndpoint?;
    constructor(config?: SchedulerConfig, fallbackModel?: string);
    private resolveModels;
    /** Whether the scheduler is active (mode !== 'none') */
    isActive(): boolean;
    /** Resolve model name for a given execution phase */
    resolve(phase: SchedulerPhase): string;
    /** Hot-update scheduler config at runtime */
    update(config: SchedulerConfig, fallbackModel?: string): void;
    getMode(): SchedulerMode;
    getModels(): SchedulerModelMap;
    /** Get the independent reflect endpoint config (if enabled) */
    getReflectEndpoint(): ReflectEndpointConfig | undefined;
    /** Serialize current state for API responses */
    toJSON(): {
        mode: SchedulerMode;
        models: SchedulerModelMap;
        reflectEndpoint?: ReflectEndpointConfig;
    };
}
