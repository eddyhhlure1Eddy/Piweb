export interface Timer {
    id: string;
    sessionId: string;
    label: string;
    message: string;
    fireAt?: number;
    cron?: string;
    recurring: boolean;
    createdAt: number;
    firedCount: number;
    lastFiredAt?: number;
    maxFireCount?: number;
    chainIntervalSeconds?: number;
    status: 'active' | 'fired' | 'cancelled';
}
export interface TimersConfig {
    maxPerSession: number;
    maxGlobal: number;
    minIntervalSeconds: number;
    executionTimeoutMs: number;
    enabled: boolean;
}
export declare const DEFAULT_TIMERS_CONFIG: TimersConfig;
type TimerFireCallback = (timer: Timer) => void | Promise<void>;
export declare class TimerManager {
    private timers;
    private jobs;
    private dataDir;
    private config;
    private onFire;
    private saveLock;
    constructor(dataDir: string, config: Partial<TimersConfig> | undefined, onFire: TimerFireCallback);
    init(): Promise<void>;
    setTimer(sessionId: string, opts: {
        label: string;
        message: string;
        delaySeconds?: number;
        cron?: string;
        recurring?: boolean;
        maxFireCount?: number;
        chainIntervalSeconds?: number;
    }): Promise<{
        success: boolean;
        timer?: Timer;
        error?: string;
    }>;
    cancelTimer(timerId: string, sessionId?: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    listTimers(sessionId?: string): Timer[];
    getSessionTimers(sessionId: string): Timer[];
    /** Schedule the next fire for a chain timer (called after agent run completes) */
    scheduleChainNext(timerId: string): Promise<boolean>;
    /** Stop all active timers — force kill switch */
    stopAll(): Promise<number>;
    /** Stop all timers for a specific session */
    stopSession(sessionId: string): Promise<number>;
    private scheduleOneShot;
    private scheduleCron;
    private fireTimer;
    private getTimersPath;
    private loadTimers;
    private saveTimers;
    shutdown(): void;
}
export {};
