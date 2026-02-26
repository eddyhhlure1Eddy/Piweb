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
    grids?: any[];
    souls?: any[];
    swarms?: any[];
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
    compressedArchive?: {
        archivedAt: number;
        messageCount: number;
        messages: Message[];
    }[];
}
export declare class MemoryStore {
    private dataDir;
    constructor(dataDir?: string);
    init(): Promise<void>;
    private getSessionPath;
    createSession(title?: string): Promise<Session>;
    createSessionWithId(id: string, title?: string): Promise<Session>;
    saveSession(session: Session): Promise<void>;
    getSession(sessionId: string): Promise<Session | null>;
    addMessage(sessionId: string, message: Message): Promise<Session>;
    listSessions(): Promise<Session[]>;
    /** Return lightweight summaries for sidebar — no message content, no images */
    listSessionSummaries(): Promise<{
        id: string;
        title: string;
        messageCount: number;
        updatedAt: number;
    }[]>;
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
    getMemoryText(): Promise<string>;
}
export {};
