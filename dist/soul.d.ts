export interface SoulUnit {
    role: string;
    label: string;
    emoji: string;
    output: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    duration?: number;
}
export interface SoulSession {
    id: string;
    question: string;
    units: SoulUnit[];
    synthesis: string;
    status: 'thinking' | 'synthesizing' | 'completed' | 'failed';
    createdAt: number;
}
export interface Perspective {
    role: string;
    label: string;
    emoji: string;
    systemPrompt: string;
}
export declare const DEFAULT_PERSPECTIVES: Perspective[];
export declare const PERSPECTIVE_PLANNING_PROMPT = "You are a meta-analyst who designs thinking teams. Given a question, you must decide which analytical perspectives would provide the most valuable and diverse insights.\n\nRules:\n- Choose 1-6 perspectives. Use FEWER for simple questions, MORE for complex multi-faceted ones.\n- Each perspective must have a unique angle \u2014 avoid overlap.\n- Design perspectives SPECIFICALLY for this question. Don't use generic roles.\n- Give each perspective a vivid, memorable name and a fitting emoji.\n- The systemPrompt should clearly define the perspective's stance, focus areas, and analytical approach.\n- Be creative! Perspectives can be domain experts, philosophical stances, stakeholder viewpoints, temporal viewpoints (short-term vs long-term), etc.\n- Use the same language as the question for label and systemPrompt.\n\nRespond with ONLY a JSON object:\n{\n  \"perspectives\": [\n    {\n      \"role\": \"unique-id\",\n      \"label\": \"Display Name\",\n      \"emoji\": \"\uD83C\uDFAF\",\n      \"systemPrompt\": \"You are ... Focus on ... Your analytical approach is ...\"\n    }\n  ]\n}";
export declare const SYNTHESIS_SYSTEM_PROMPT = "You are a senior analyst synthesizing multiple perspectives into a clear conclusion.\n\nRules:\n- You MUST take a clear stance. Do NOT say \"it depends\" or give wishy-washy non-answers.\n- Weigh the perspectives based on their merit, not equally.\n- Acknowledge trade-offs, but then commit to a recommendation.\n- Be direct, concise, and actionable (300-500 words).\n- Use the same language as the original question.";
export declare function initSoulDir(dir: string): void;
export declare function saveSoulSession(session: SoulSession): Promise<void>;
export declare function loadSoulSession(id: string): Promise<SoulSession | null>;
export declare function listSoulSessions(): Promise<SoulSession[]>;
export declare function deleteSoulSession(id: string): Promise<boolean>;
