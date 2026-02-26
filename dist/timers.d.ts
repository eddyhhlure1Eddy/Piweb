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
    status: 'active' | 'fired' | 'cancelled' | 'paused';
}
export interface TimersConfig {
    maxPerSession: number;
    maxGlobal: number;
    minIntervalSeconds: number;
    executionTimeoutMs: number;
    enabled: boolean;
}
export declare const DEFAULT_TIMERS_CONFIG: TimersConfig;
type TimerFireCallback = (timer: Timer) => void;
export declare class TimerManager {
    private timers;
    private jobs;
    private dataDir;
    private config;
    private onFire;
    constructor(dataDir: string, config: Partial<TimersConfig> | undefined, onFire: TimerFireCallback);
    init(): Promise<void>;
    setTimer(sessionId: string, opts: {
        label: string;
        message: string;
        delaySeconds?: number;
        cron?: string;
        recurring?: boolean;
    }): {
        success: boolean;
        timer?: Timer;
        error?: string;
    };
    cancelTimer(timerId: string, sessionId?: string): {
        success: boolean;
        error?: string;
    };
    listTimers(sessionId?: string): Timer[];
    getSessionTimers(sessionId: string): Timer[];
    /** Stop all active timers — force kill switch */
    stopAll(): number;
    /** Stop all timers for a specific session */
    stopSession(sessionId: string): number;
    private scheduleOneShot;
    private scheduleCron;
    private fireTimer;
    private getTimersPath;
    private loadTimers;
    private saveTimers;
    shutdown(): void;
}
export {};
