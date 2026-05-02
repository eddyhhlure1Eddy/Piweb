export interface MessageFile {
    path: string;
    name: string;
    mime: string;
    size: number;
}
export interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    thinking?: string;
    tools?: {
        name: string;
        result: string;
    }[];
    images?: {
        mime: string;
        data: string;
        name: string;
    }[];
    files?: MessageFile[];
    grids?: any[];
    souls?: any[];
}
export interface MemoryEntry {
    id: string;
    content: string;
    category?: string;
    timestamp: number;
}
interface LongTermMemory {
    entries: MemoryEntry[];
}
export interface Session {
    id: string;
    title: string;
    messages: Message[];
    createdAt: number;
    updatedAt: number;
    summary?: string;
    archived?: boolean;
    preview?: string;
    originalMessageCount?: number;
    compressedArchive?: {
        archivedAt: number;
        messageCount: number;
        messages: Message[];
    }[];
}
export declare class MemoryStore {
    private dataDir;
    private _memoryLock;
    private _sessionLocks;
    constructor(dataDir?: string);
    /** Acquire a per-session mutex. Returns a release function. */
    _acquireSessionLock(sessionId: string): Promise<() => void>;
    init(): Promise<void>;
    private getSessionPath;
    createSession(title?: string): Promise<Session>;
    createSessionWithId(id: string, title?: string): Promise<Session>;
    saveSession(session: Session): Promise<void>;
    getSession(sessionId: string): Promise<Session | null>;
    /** Try to recover a session from any leftover .tmp.* files */
    private _recoverFromTmp;
    /** Attempt to recover a truncated JSON session file */
    private repairTruncatedJSON;
    addMessage(sessionId: string, message: Message): Promise<Session>;
    listSessions(): Promise<Session[]>;
    /** Return lightweight summaries for sidebar — no message content, no images */
    listSessionSummaries(limit?: number): Promise<{
        id: string;
        title: string;
        messageCount: number;
        updatedAt: number;
        archived?: boolean;
        preview?: string;
    }[]>;
    /**
     * Archive old sessions: strip messages, keep only metadata + preview.
     * Sessions beyond `keepRecent` are archived in-place.
     * Returns number of newly archived sessions.
     */
    archiveOldSessions(keepRecent?: number): Promise<number>;
    deleteSession(sessionId: string): Promise<void>;
    findSessionByShortId(shortId: string): Promise<Session | null>;
    replaceMessages(sessionId: string, messages: Message[]): Promise<void>;
    updateSessionTitle(sessionId: string, title: string): Promise<void>;
    saveSessionSummary(sessionId: string, summary: string): Promise<void>;
    archiveMessages(sessionId: string, messages: Message[]): Promise<void>;
    cleanupInvalidSummaries(): Promise<void>;
    private getMemoryPath;
    loadMemory(): Promise<LongTermMemory>;
    private saveMemory;
    saveMemoryEntry(content: string, category?: string): Promise<MemoryEntry>;
    deleteMemoryEntry(id: string): Promise<void>;
    getMemoryEntries(): Promise<MemoryEntry[]>;
    getMemoryText(): Promise<string>;
}
export {};
