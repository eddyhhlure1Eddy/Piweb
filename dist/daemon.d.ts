export interface DaemonTask {
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
    prompt: string;
    session?: string;
}
export interface DaemonConfig {
    enabled: boolean;
    tasks: DaemonTask[];
    settings: {
        autoCreateSession: boolean;
        saveToMemory: boolean;
        notifyOnComplete: boolean;
    };
}
export declare function loadDaemonConfig(rootDir: string): DaemonConfig;
export declare function saveDaemonConfig(rootDir: string, config: DaemonConfig): void;
export declare class DaemonScheduler {
    private jobs;
    private agent;
    private memory;
    private rootDir;
    private config;
    constructor(agent: any, memory: any, rootDir: string, config: DaemonConfig);
    start(): Promise<void>;
    private scheduleTask;
    private executeTask;
    private getOrCreateSession;
    private interpolatePrompt;
    stop(): void;
}
