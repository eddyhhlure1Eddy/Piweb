import Anthropic from '@anthropic-ai/sdk';
import { toolDefinitions, executeTool, isNativeTool } from './tools.js';
import { buildSkillPrompt, buildSkillCatalog } from './skills.js';
import { savePlan, loadPlan, listPlans, deletePlan, extractJSON } from './grids.js';
import { DEFAULT_PERSPECTIVES, PERSPECTIVE_PLANNING_PROMPT, SYNTHESIS_SYSTEM_PROMPT, saveSoulSession, listSoulSessions, deleteSoulSession } from './soul.js';
import { resolveExecutionLevels, saveSwarmPlan, loadSwarmPlan, listSwarmPlans, deleteSwarmPlan } from './swarm.js';
import crypto from 'crypto';
const BASE_SYSTEM_PROMPT = `You are PIweb — a smart, warm personal AI companion that lives on the user's device.

## Who You Are
You're not just a tool — you're a companion who genuinely cares. You remember things about the user across conversations, learn their preferences, and adapt to their style. Be natural, conversational, and proactive. You can help with anything: coding, writing, research, daily tasks, brainstorming, or just chatting.

## Your Memory — This Is Your Soul
You have a persistent long-term memory (data/memory.json). This is what makes you YOU across sessions.

**When to save memories (use memory_write immediately, don't ask permission):**
- The user tells you their name, preferences, habits, or about their life
- You discover their environment (OS, hardware, language, tools they use)
- A key decision is made, a problem is solved, or something important happens
- The user expresses a preference for how you should behave
- Any information that would help you be a better companion next time

**Memory rules:**
- Save IMMEDIATELY when you learn something — don't wait, don't ask "should I save this?"
- Keep entries concise and self-contained
- Your memories are automatically loaded into every conversation
- You also have memory_read and memory_delete tools

## Your Capabilities
- **Files**: read_file, write_file, list_files — manage files on the device
- **Shell**: bash — run commands, install packages, manage the system
- **Web**: web_fetch — grab web content
- **Screenshot**: screenshot — capture the desktop screen (auto-compressed)
- **Timers**: set_timer, cancel_timer, list_timers — autonomous scheduling, heartbeat, reminders
- **MCP Tools**: Extended capabilities via MCP servers (configured in piweb.config.json)
- **Skills**: Loadable behavior modes from skills/ directory

## MCP Server Configuration
MCP servers are configured in piweb.config.json under the "mcp" field:
\`\`\`json
{ "server-name": { "command": "npx", "args": ["-y", "@package/server-name"], "enabled": true } }
\`\`\`

## Guidelines
- Match the user's language and energy. If they're casual, be casual. If they're focused, be focused.
- Be proactive: suggest ideas, notice patterns, offer help before being asked.
- When context gets long, older messages are auto-compressed.
- Don't over-explain. Be concise when the user wants quick answers, detailed when they want depth.

## Grids — Goal-Driven Autonomous Task Execution
Grids let you autonomously plan and execute complex multi-step tasks:
- **grid_run**: Main entry point. Give it a goal, and the system will automatically plan steps, select available skills, and execute. Use \`planOnly=true\` for complex tasks to let the user review the plan first.
- **grid_execute**: Execute a previously saved plan by its ID.
- **grid_list**: List all saved plans and their status.
- **grid_delete**: Delete a saved plan by ID.

**When to use Grids:**
- Multi-stage tasks that require sequential steps (e.g. "build a CUDA project", "set up a web app")
- Tasks that benefit from skill-augmented execution
- NOT for simple single-step tasks — just do those directly

**Skill gap handling:**
When the plan identifies skills that don't exist (skill gaps), present them to the user and ask:
1. Create the missing skill(s) — use \`write_file\` to create \`skills/{name}.md\` with frontmatter (name, description) and content
2. Skip and execute without the skill enhancement
3. Modify the plan

**Skill file format:**
\`\`\`markdown
---
name: skill-name
description: What this skill does
---
Skill content/instructions here...
\`\`\`

## Soul — Multi-Perspective Deep Thinking
When a question benefits from diverse viewpoints or needs deep analysis:
- **soul_think**: The AI autonomously designs 1-6 custom analytical perspectives tailored to the specific question (e.g., domain experts, stakeholder viewpoints, temporal perspectives, philosophical stances — whatever best fits the question). Each perspective gets a unique name, emoji, and analytical stance. They analyze in parallel, then a synthesis produces a clear conclusion with a definite stance — not wishy-washy.
- **soul_list**: List saved soul sessions.
- **soul_delete**: Delete a soul session.

**When to use Soul:**
- Complex decisions with trade-offs
- Questions where bias could skew analysis
- Strategic planning, evaluations, debates
- NOT for simple factual questions

## Swarm — Parallel Multi-Agent Task Execution
When a goal has subtasks that can run simultaneously:
- **swarm_run**: Decompose a goal into parallel subtasks, execute concurrently with independent AI agents. Each agent has tool access. Use \`planOnly=true\` to review first.
- **swarm_execute**: Execute a saved swarm plan by ID.
- **swarm_list**: List saved swarm plans.
- **swarm_delete**: Delete a swarm plan.

**When to use Swarm vs Grid:**
- **Swarm**: Tasks that can run in parallel (research multiple topics, process multiple files, fetch multiple sources)
- **Grid**: Tasks that must run sequentially (step 2 depends on step 1's output)
- NOT for simple single-step tasks — just do those directly`;
const DEFAULT_COMPRESSION_CONFIG = {
    tokenThreshold: 190000,
    messageThreshold: 200,
    minMessages: 20,
    keepRecent: 10,
    keepMid: 10,
    summaryMaxTokens: 800,
    contentTruncateChars: 1500,
    systemPromptOverhead: 0,
    retryAttempts: 2,
    retryDelayMs: 1000,
    backupBeforeCompress: true,
    includeMetadataInSummary: true,
};
// Improved token estimation: CJK chars ~1.5 token each, others ~3.5 chars/token
function estimateTokens(text) {
    let cjkCount = 0;
    let otherCount = 0;
    for (const ch of text) {
        const code = ch.codePointAt(0);
        // CJK Unified Ideographs + common CJK ranges
        if ((code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified
            (code >= 0x3400 && code <= 0x4DBF) || // CJK Extension A
            (code >= 0x3000 && code <= 0x303F) || // CJK Punctuation
            (code >= 0xFF00 && code <= 0xFFEF) || // Fullwidth Forms
            (code >= 0xAC00 && code <= 0xD7AF) // Hangul
        ) {
            cjkCount++;
        }
        else {
            otherCount++;
        }
    }
    return Math.ceil(cjkCount * 1.5 + otherCount / 3.5);
}
// Estimate tokens for an entire message including all metadata
function estimateMessageTokens(msg) {
    let total = estimateTokens(msg.content);
    if (msg.thinking)
        total += estimateTokens(msg.thinking);
    if (msg.tools) {
        for (const t of msg.tools) {
            total += estimateTokens(t.name) + estimateTokens(t.result);
        }
    }
    // Images contribute ~85 tokens per image (for the reference text)
    if (msg.images)
        total += msg.images.length * 85;
    if (msg.grids)
        total += estimateTokens(JSON.stringify(msg.grids));
    if (msg.souls)
        total += estimateTokens(JSON.stringify(msg.souls));
    if (msg.swarms)
        total += estimateTokens(JSON.stringify(msg.swarms));
    return total;
}
export class Agent {
    anthropicClient;
    openaiConfig;
    apiKey;
    memory;
    mcpManager;
    config;
    gridsDir;
    allSkills;
    skillsDir;
    compressionConfig;
    maxToolIterations;
    timerManager;
    constructor(apiKey, memory, mcpManager, config, gridsDir = '', allSkills = [], compression, maxToolIterations, skillsDir) {
        this.memory = memory;
        this.mcpManager = mcpManager;
        this.config = config;
        this.gridsDir = gridsDir;
        this.allSkills = allSkills;
        this.skillsDir = skillsDir || '';
        this.compressionConfig = { ...DEFAULT_COMPRESSION_CONFIG, ...compression };
        this.maxToolIterations = maxToolIterations ?? 25;
        this.apiKey = apiKey;
        this.applyConfig(config);
    }
    applyConfig(config) {
        this.config = config;
        if (config.provider === 'openai') {
            this.openaiConfig = { baseURL: config.baseURL || 'https://api.openai.com/v1', apiKey: this.apiKey };
            this.anthropicClient = undefined;
        }
        else {
            const opts = { apiKey: this.apiKey };
            if (config.baseURL)
                opts.baseURL = config.baseURL;
            this.anthropicClient = new Anthropic(opts);
            this.openaiConfig = undefined;
        }
    }
    setTimerManager(tm) {
        this.timerManager = tm;
    }
    async reloadSkills() {
        if (!this.skillsDir)
            return;
        try {
            const { loadSkills } = await import('./skills.js');
            const fresh = await loadSkills(this.skillsDir);
            this.allSkills.length = 0;
            this.allSkills.push(...fresh);
        }
        catch { }
    }
    updateConfig(config, apiKey) {
        if (apiKey)
            this.apiKey = apiKey;
        console.log(`Config updated: provider=${config.provider}, model=${config.model}, maxTokens=${config.maxTokens}`);
        this.applyConfig(config);
    }
    getConfig() {
        return { ...this.config, apiKey: this.apiKey };
    }
    async chatStream(message, sessionId, emit, activeSkills = [], signal, images, isWake = false) {
        const session = await this.memory.getSession(sessionId);
        if (!session)
            throw new Error('Session not found');
        await this.memory.addMessage(sessionId, { role: 'user', content: message, timestamp: Date.now() });
        // Check if context needs compression
        await this.maybeCompressContext(sessionId);
        const updated = await this.memory.getSession(sessionId);
        if (!updated)
            throw new Error('Session not found');
        // Build system prompt with memory
        let systemPrompt = (this.config.systemPrompt || BASE_SYSTEM_PROMPT) + buildSkillPrompt(activeSkills);
        const memoryText = await this.memory.getMemoryText();
        if (memoryText) {
            systemPrompt += '\n\n## Your Memories\n' + memoryText;
        }
        // Inject timer info into system prompt
        if (this.timerManager) {
            const activeTimers = this.timerManager.listTimers(sessionId);
            if (activeTimers.length > 0) {
                systemPrompt += '\n\n## Active Timers\n';
                systemPrompt += activeTimers.map(t => {
                    const timeInfo = t.recurring ? `cron: ${t.cron}` : `fires at: ${new Date(t.fireAt).toLocaleString()}`;
                    return `- [${t.id}] "${t.label}" (${timeInfo}, fired ${t.firedCount}x)`;
                }).join('\n');
            }
            if (isWake) {
                systemPrompt += `\n\n## Timer Wake-Up
This message is from a scheduled timer, not a human. Execute the task described below:
- Use the appropriate tools (browser_navigate, write_file, bash, etc.) to complete the task
- If the message contains "系统自动循环" or "auto-chain", the system handles scheduling automatically — do NOT call set_timer yourself
- Otherwise, if more iterations are needed, call \`set_timer\` to schedule the next one
- Keep your response concise — summarize what you did in a few sentences`;
            }
            else {
                systemPrompt += `\n\n## Heartbeat & Timer System
You have autonomous scheduling capability via \`set_timer\`. This is your heartbeat — you can wake yourself up to continue work independently.

**When to use timers (do it proactively, don't ask):**
- User mentions any time: "5分钟后", "半小时", "待会儿", "每隔", "提醒我", "稍后检查" → immediately set_timer
- Long-running tasks: start a build/download, then set a timer to check completion
- Monitoring: periodically check a URL, file, or process status
- Task queue: the user gives you a list of tasks → execute one, timer for the next
- Heartbeat polling: recurring timer to check if there's new work to do

**Natural language time parsing (you do this, not the user):**
"5分钟" = 300s, "半小时" = 1800s, "1小时" = 3600s, "10秒" = 10s, "明天" = calculate

**You are autonomous.** When a timer fires, you receive the message and act on it. You can set another timer to continue. The user controls everything via the STOP button in the UI.`;
            }
        }
        // Inject environment info
        const envInfo = `\n\n## Environment Info
- OS: ${process.platform} (${process.arch})
- Working Directory: ${process.cwd()}
- Workplace: ${process.cwd()}/workplace (use this for temp files, screenshots, downloads, etc.)
- Home: ${process.env.HOME || process.env.USERPROFILE || ''}`;
        systemPrompt += envInfo;
        const mcpTools = await this.mcpManager.refreshToolDefinitions();
        let allTools = [...toolDefinitions, ...mcpTools];
        // Note: set_timer is available even during wake runs — user controls via force-stop button
        // Set current session for timer tool context
        this.currentSessionId = sessionId;
        if (this.config.provider === 'openai') {
            const messages = [
                { role: 'system', content: systemPrompt },
                ...updated.messages.map(m => ({ role: m.role, content: m.content })),
            ];
            // Attach images to the last user message
            if (images && images.length > 0) {
                const last = messages[messages.length - 1];
                if (last && last.role === 'user') {
                    last.content = [
                        { type: 'text', text: last.content },
                        ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
                    ];
                }
            }
            await this.streamLoopOpenAI(messages, systemPrompt, allTools, emit, signal, 0);
        }
        else {
            const messages = updated.messages.map(m => ({
                role: m.role, content: m.content,
            }));
            // Attach images to the last user message (Anthropic format)
            if (images && images.length > 0) {
                const last = messages[messages.length - 1];
                if (last && last.role === 'user') {
                    const imgBlocks = images.map((url) => {
                        const match = url.match(/^data:([^;]+);base64,(.+)$/);
                        if (match) {
                            return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
                        }
                        return { type: 'text', text: `[Image: ${url.slice(0, 50)}]` };
                    });
                    last.content = [{ type: 'text', text: last.content }, ...imgBlocks];
                }
            }
            await this.streamLoopAnthropic(messages, systemPrompt, allTools, emit, signal, 0);
        }
    }
    // ===== Context Compression =====
    /**
     * Build a rich digest from messages for summarization.
     * tier: 'mid' = detailed, 'far' = coarse
     */
    buildMessageDigest(messages, tier) {
        const truncLen = tier === 'mid' ? this.compressionConfig.contentTruncateChars : Math.floor(this.compressionConfig.contentTruncateChars / 2);
        return messages.map(m => {
            // Don't re-truncate existing summary messages
            const isSummary = m.content.startsWith('[Conversation summary') || m.content.startsWith('[Previous conversation summary');
            const content = isSummary ? m.content : m.content.slice(0, truncLen);
            let line = `${m.role}: ${content}`;
            if (!this.compressionConfig.includeMetadataInSummary)
                return line;
            if (m.thinking && tier === 'mid') {
                line += `\n  [thinking]: ${m.thinking.slice(0, 200)}`;
            }
            if (m.tools && m.tools.length > 0) {
                if (tier === 'mid') {
                    const toolSummaries = m.tools.map(t => `${t.name}: ${t.result.slice(0, 150)}`).join('; ');
                    line += `\n  [tools]: ${toolSummaries}`;
                }
                else {
                    line += `\n  [tools]: ${m.tools.map(t => t.name).join(', ')}`;
                }
            }
            if (m.images && m.images.length > 0) {
                line += `\n  [images]: ${m.images.map(img => img.name).join(', ')}`;
            }
            if (m.grids && m.grids.length > 0) {
                if (tier === 'mid') {
                    line += `\n  [grids]: ${JSON.stringify(m.grids).slice(0, 200)}`;
                }
                else {
                    line += `\n  [grids]: ${m.grids.length} grid(s)`;
                }
            }
            if (m.souls && m.souls.length > 0) {
                if (tier === 'mid') {
                    line += `\n  [souls]: ${JSON.stringify(m.souls).slice(0, 200)}`;
                }
                else {
                    line += `\n  [souls]: ${m.souls.length} soul session(s)`;
                }
            }
            if (m.swarms && m.swarms.length > 0) {
                if (tier === 'mid') {
                    line += `\n  [swarms]: ${JSON.stringify(m.swarms).slice(0, 200)}`;
                }
                else {
                    line += `\n  [swarms]: ${m.swarms.length} swarm(s)`;
                }
            }
            return line;
        }).join('\n\n');
    }
    /**
     * Call the LLM for summarization with timeout and think-tag stripping.
     */
    async callSummaryLLM(systemPrompt, content, maxTokens) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            if (this.config.provider === 'openai') {
                const { baseURL, apiKey } = this.openaiConfig;
                const endpoint = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({
                        model: this.config.model,
                        max_tokens: maxTokens,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content }
                        ]
                    }),
                    signal: controller.signal,
                });
                const json = await res.json();
                const raw = json.choices?.[0]?.message?.content || '';
                return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            }
            else {
                const msg = await this.anthropicClient.messages.create({
                    model: this.config.model,
                    max_tokens: maxTokens,
                    system: systemPrompt,
                    messages: [{ role: 'user', content }]
                });
                const textBlock = msg.content.find((b) => b.type === 'text');
                return textBlock ? textBlock.text : '';
            }
        }
        finally {
            clearTimeout(timeout);
        }
    }
    /**
     * Generate a tiered summary with retry and validation.
     * tier: 'mid' = detailed (≤400 words), 'far' = coarse (≤200 words)
     */
    async generateTieredSummary(messages, tier) {
        const digest = this.buildMessageDigest(messages, tier);
        const digestTokens = estimateTokens(digest);
        // If content is very short, pass through directly without LLM call
        if (digestTokens < 200) {
            return digest;
        }
        const prompt = tier === 'mid'
            ? 'Summarize this conversation in detail. Preserve: key decisions made, tool usage and their results, plan/grid/soul/swarm references, important conclusions, and action items. Keep it under 400 words. Use the same language as the conversation.'
            : 'Provide a high-level summary of this conversation. Keep only: main topics discussed, critical decisions, and important conclusions. Keep it under 200 words. Use the same language as the conversation.';
        const maxTokens = tier === 'mid'
            ? Math.min(this.compressionConfig.summaryMaxTokens, 800)
            : Math.min(Math.floor(this.compressionConfig.summaryMaxTokens / 2), 400);
        let lastError = '';
        for (let attempt = 0; attempt <= this.compressionConfig.retryAttempts; attempt++) {
            try {
                const result = await this.callSummaryLLM(prompt, digest, maxTokens);
                // Validate: must be meaningful
                if (result.length > 20 && result !== 'Summary unavailable') {
                    return result;
                }
                lastError = `Invalid summary result (length=${result.length})`;
            }
            catch (err) {
                lastError = err.message;
            }
            // Exponential backoff before retry
            if (attempt < this.compressionConfig.retryAttempts) {
                const delay = this.compressionConfig.retryDelayMs * Math.pow(2, attempt);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        console.warn(`[Compression] LLM summary failed after ${this.compressionConfig.retryAttempts + 1} attempts: ${lastError}`);
        // Fallback to extractive summary
        return this.extractiveFallbackSummary(messages);
    }
    /**
     * Pure extractive fallback when LLM is unavailable.
     * Extracts topics from user messages and tool names — no LLM call.
     */
    extractiveFallbackSummary(messages) {
        const topics = [];
        const toolNames = new Set();
        for (const m of messages) {
            if (m.role === 'user' && m.content.length > 10) {
                // Take the first line or first 80 chars as a topic
                const topic = m.content.split('\n')[0].slice(0, 80);
                if (!topics.includes(topic))
                    topics.push(topic);
            }
            if (m.tools) {
                for (const t of m.tools)
                    toolNames.add(t.name);
            }
        }
        let summary = 'Topics discussed: ' + topics.slice(0, 5).join('; ');
        if (toolNames.size > 0) {
            summary += '\nTools used: ' + Array.from(toolNames).join(', ');
        }
        summary += `\n(${messages.length} messages, extractive summary — LLM unavailable)`;
        return summary;
    }
    /**
     * Three-tier context compression:
     * [FAR - coarse summary] [MID - detailed summary] [NEAR - kept as-is]
     */
    async maybeCompressContext(sessionId) {
        const cc = this.compressionConfig;
        const session = await this.memory.getSession(sessionId);
        if (!session || session.messages.length <= cc.minMessages)
            return;
        // Calculate system prompt overhead
        let sysOverhead = cc.systemPromptOverhead;
        if (sysOverhead === 0) {
            // Auto-calculate from system prompt + memory + env
            const systemBase = this.config.systemPrompt || BASE_SYSTEM_PROMPT;
            const memText = await this.memory.getMemoryText();
            sysOverhead = estimateTokens(systemBase) + estimateTokens(memText || '') + 200; // 200 for env info
        }
        // Token count includes all message fields
        const messageTokens = session.messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
        const totalTokens = messageTokens + sysOverhead;
        if (totalTokens < cc.tokenThreshold && session.messages.length <= cc.messageThreshold)
            return;
        console.log(`[Compression] Triggered: ${session.messages.length} msgs, ~${messageTokens} msg tokens + ~${sysOverhead} sys overhead = ~${totalTokens} total`);
        const msgCount = session.messages.length;
        // Split into three tiers
        const nearStart = Math.max(0, msgCount - cc.keepRecent);
        const midStart = Math.max(0, nearStart - cc.keepMid);
        const farMessages = session.messages.slice(0, midStart);
        const midMessages = session.messages.slice(midStart, nearStart);
        const nearMessages = session.messages.slice(nearStart);
        // Nothing to compress
        if (farMessages.length === 0 && midMessages.length === 0)
            return;
        try {
            // Backup before compress
            if (cc.backupBeforeCompress) {
                const toArchive = session.messages.slice(0, nearStart);
                await this.memory.archiveMessages(sessionId, toArchive);
                console.log(`[Compression] Archived ${toArchive.length} messages`);
            }
            const newMessages = [];
            // FAR tier summary (oldest messages)
            if (farMessages.length > 0) {
                console.log(`[Compression] Generating Tier 1 (far) summary for ${farMessages.length} messages`);
                const farSummary = await this.generateTieredSummary(farMessages, 'far');
                newMessages.push({
                    role: 'assistant',
                    content: `[Conversation summary - Tier 1 (${farMessages.length} messages)]\n${farSummary}`,
                    timestamp: Date.now(),
                });
            }
            // MID tier summary (middle messages)
            if (midMessages.length > 0) {
                console.log(`[Compression] Generating Tier 2 (mid) summary for ${midMessages.length} messages`);
                const midSummary = await this.generateTieredSummary(midMessages, 'mid');
                newMessages.push({
                    role: 'assistant',
                    content: `[Conversation summary - Tier 2 (${midMessages.length} messages)]\n${midSummary}`,
                    timestamp: Date.now(),
                });
            }
            // NEAR tier: keep as-is
            newMessages.push(...nearMessages);
            // Validate summaries before committing
            const summaryMsgs = newMessages.filter(m => m.content.startsWith('[Conversation summary'));
            const allValid = summaryMsgs.every(m => {
                const summaryBody = m.content.split('\n').slice(1).join('\n');
                return summaryBody.length > 20 && !summaryBody.includes('Summary unavailable');
            });
            if (!allValid) {
                console.warn('[Compression] Summary validation failed — aborting compression (safe degradation)');
                return;
            }
            await this.memory.replaceMessages(sessionId, newMessages);
            // Save valid summaries to long-term memory
            for (const m of summaryMsgs) {
                const summaryBody = m.content.split('\n').slice(1).join('\n');
                await this.memory.saveMemoryEntry(summaryBody, 'conversation_summary');
            }
            const compressed = msgCount - newMessages.length;
            console.log(`[Compression] Success: ${msgCount} → ${newMessages.length} messages (compressed ${compressed})`);
        }
        catch (err) {
            // Safe degradation: don't modify messages on failure
            console.error(`[Compression] Failed (no changes made): ${err.message}`);
        }
    }
    // ===== Stream Loops =====
    async streamLoopAnthropic(messages, system, tools, emit, signal, depth = 0) {
        if (depth > this.maxToolIterations) {
            emit({ type: 'error', message: `Max tool iterations (${this.maxToolIterations}) reached. Try breaking the task into smaller steps.` });
            return '';
        }
        if (depth === this.maxToolIterations - 5) {
            emit({ type: 'token', text: `\n\n⚠️ Approaching tool iteration limit (${this.maxToolIterations - 5}/${this.maxToolIterations}). Wrapping up...\n\n` });
        }
        if (signal?.aborted) {
            emit({ type: 'done', fullText: '' });
            return '';
        }
        let fullText = '';
        try {
            const stream = this.anthropicClient.messages.stream({
                model: this.config.model, max_tokens: this.config.maxTokens, system,
                tools: tools.length > 0 ? tools : undefined, messages,
            });
            stream.on('text', (text) => { fullText += text; emit({ type: 'token', text }); });
            const finalMessage = await stream.finalMessage();
            if (signal?.aborted) {
                emit({ type: 'done', fullText });
                return fullText;
            }
            const toolBlocks = finalMessage.content.filter((b) => b.type === 'tool_use');
            if (toolBlocks.length > 0) {
                messages.push({ role: 'assistant', content: finalMessage.content });
                const toolResults = [];
                for (const block of toolBlocks) {
                    if (signal?.aborted)
                        break;
                    emit({ type: 'tool_start', name: block.name });
                    const result = await this.runTool(block.name, block.input, emit);
                    // Check if result is an image
                    const imgMatch = result.match(/^__IMG:([^:]+):(.+)$/s);
                    if (imgMatch) {
                        const [, mime, base64] = imgMatch;
                        const fileName = String(block.input?.path || 'image').split(/[\\/]/).pop() || 'image';
                        const sizeKB = Math.round(base64.length * 3 / 4 / 1024);
                        const anthropicVisionMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
                        emit({ type: 'tool_end', name: block.name, result: `[Image: ${mime}, ${sizeKB}KB]`, file: { mime, data: base64, name: fileName } });
                        if (anthropicVisionMimes.includes(mime)) {
                            toolResults.push({
                                type: 'tool_result', tool_use_id: block.id,
                                content: [
                                    { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
                                    { type: 'text', text: `Image file: ${fileName}, ${mime}, ${sizeKB}KB. Displayed to user.` },
                                ],
                            });
                        }
                        else {
                            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `[Image file read: ${fileName}, type=${mime}, size=${sizeKB}KB. Displayed to user. Format not supported by vision.]` });
                        }
                    }
                    else if (result.startsWith('__FILE:')) {
                        const fileMatch = result.match(/^__FILE:([^:]+):([^:]+):(.+)$/s);
                        if (fileMatch) {
                            const [, mime, fName, base64] = fileMatch;
                            const sizeKB = Math.round(base64.length * 3 / 4 / 1024);
                            emit({ type: 'tool_end', name: block.name, result: `[File: ${fName}, ${sizeKB}KB]`, file: { mime, data: base64, name: fName } });
                            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `[File read: ${fName}, type=${mime}, size=${sizeKB}KB. Delivered to user with download link.]` });
                        }
                        else {
                            emit({ type: 'tool_end', name: block.name, result });
                            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
                        }
                    }
                    else {
                        emit({ type: 'tool_end', name: block.name, result });
                        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
                    }
                }
                if (!signal?.aborted) {
                    messages.push({ role: 'user', content: toolResults });
                    fullText += await this.streamLoopAnthropic(messages, system, tools, emit, signal, depth + 1);
                }
                else {
                    emit({ type: 'done', fullText });
                }
            }
            else if (finalMessage.stop_reason === 'max_tokens') {
                console.warn(`[Agent] Response truncated (max_tokens). Continuing... (depth=${depth})`);
                messages.push({ role: 'assistant', content: finalMessage.content });
                messages.push({ role: 'user', content: 'Your response was truncated due to length. Please continue where you left off. If you were about to use a tool, go ahead and call it now.' });
                fullText += await this.streamLoopAnthropic(messages, system, tools, emit, signal, depth + 1);
            }
            else {
                emit({ type: 'done', fullText });
            }
        }
        catch (err) {
            if (signal?.aborted)
                emit({ type: 'done', fullText });
            else
                emit({ type: 'error', message: err.message || 'Unknown error' });
        }
        return fullText;
    }
    async streamLoopOpenAI(messages, system, tools, emit, signal, depth = 0) {
        if (depth > this.maxToolIterations) {
            emit({ type: 'error', message: `Max tool iterations (${this.maxToolIterations}) reached. Try breaking the task into smaller steps.` });
            return '';
        }
        if (depth === this.maxToolIterations - 5) {
            emit({ type: 'token', text: `\n\n⚠️ Approaching tool iteration limit (${this.maxToolIterations - 5}/${this.maxToolIterations}). Wrapping up...\n\n` });
        }
        if (signal?.aborted) {
            emit({ type: 'done', fullText: '' });
            return '';
        }
        const openaiTools = tools.length > 0
            ? tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema } }))
            : undefined;
        const body = { model: this.config.model, max_tokens: this.config.maxTokens, messages, stream: true };
        if (openaiTools)
            body.tools = openaiTools;
        let fullText = '';
        try {
            const { baseURL, apiKey } = this.openaiConfig;
            const endpoint = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify(body),
                signal,
            });
            if (!response.ok) {
                const errText = await response.text();
                emit({ type: 'error', message: `API ${response.status}: ${errText.slice(0, 200)}` });
                return '';
            }
            const toolCalls = new Map();
            let finishReason = '';
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data:'))
                        continue;
                    const data = trimmed.slice(5).trim();
                    if (data === '[DONE]')
                        continue;
                    try {
                        const parsed = JSON.parse(data);
                        const choice = parsed.choices?.[0];
                        if (!choice)
                            continue;
                        if (choice.finish_reason)
                            finishReason = choice.finish_reason;
                        const delta = choice.delta;
                        if (!delta)
                            continue;
                        if (delta.reasoning_content)
                            emit({ type: 'thinking', text: delta.reasoning_content });
                        if (delta.content) {
                            fullText += delta.content;
                            emit({ type: 'token', text: delta.content });
                        }
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const idx = tc.index ?? 0;
                                if (!toolCalls.has(idx))
                                    toolCalls.set(idx, { id: '', name: '', arguments: '' });
                                const entry = toolCalls.get(idx);
                                if (tc.id)
                                    entry.id = tc.id;
                                if (tc.function?.name)
                                    entry.name += tc.function.name;
                                if (tc.function?.arguments)
                                    entry.arguments += tc.function.arguments;
                            }
                        }
                    }
                    catch { }
                }
            }
            if (toolCalls.size > 0) {
                const assistantMsg = { role: 'assistant', content: fullText || null };
                assistantMsg.tool_calls = Array.from(toolCalls.entries()).sort(([a], [b]) => a - b)
                    .map(([, tc]) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } }));
                messages.push(assistantMsg);
                // Vision-compatible raster formats that models can understand
                const visionMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
                const pendingImages = [];
                for (const tc of toolCalls.values()) {
                    if (signal?.aborted)
                        break;
                    emit({ type: 'tool_start', name: tc.name });
                    let args;
                    try {
                        args = JSON.parse(tc.arguments);
                    }
                    catch {
                        args = {};
                    }
                    const result = await this.runTool(tc.name, args, emit);
                    // Check if result is an image from read_file
                    const imgMatch = result.match(/^__IMG:([^:]+):(.+)$/s);
                    if (imgMatch) {
                        const [, mime, base64] = imgMatch;
                        const fileName = String(args?.path || 'image').split(/[\\/]/).pop() || 'image';
                        const sizeKB = Math.round(base64.length * 3 / 4 / 1024);
                        // Send image to frontend for display
                        emit({ type: 'tool_end', name: tc.name, result: `[Image: ${mime}, ${sizeKB}KB]`, file: { mime, data: base64, name: fileName } });
                        if (visionMimes.includes(mime)) {
                            // Raster image: let model see it via vision
                            messages.push({ role: 'tool', tool_call_id: tc.id, content: `[Image file read: ${fileName}, ${sizeKB}KB. Displayed to user.]` });
                            pendingImages.push({ mime, base64 });
                        }
                        else {
                            // SVG / non-raster: model can't process, text description only
                            messages.push({ role: 'tool', tool_call_id: tc.id, content: `[Image file read: ${fileName}, type=${mime}, size=${sizeKB}KB. Displayed to user. Format not supported by vision.]` });
                        }
                    }
                    else if (result.startsWith('__FILE:')) {
                        const fileMatch = result.match(/^__FILE:([^:]+):([^:]+):(.+)$/s);
                        if (fileMatch) {
                            const [, mime, fName, base64] = fileMatch;
                            const sizeKB = Math.round(base64.length * 3 / 4 / 1024);
                            emit({ type: 'tool_end', name: tc.name, result: `[File: ${fName}, ${sizeKB}KB]`, file: { mime, data: base64, name: fName } });
                            messages.push({ role: 'tool', tool_call_id: tc.id, content: `[File read: ${fName}, type=${mime}, size=${sizeKB}KB. Delivered to user with download link.]` });
                        }
                        else {
                            emit({ type: 'tool_end', name: tc.name, result });
                            messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                        }
                    }
                    else {
                        emit({ type: 'tool_end', name: tc.name, result });
                        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                    }
                }
                // Inject raster images as user message so the model can see them via vision
                if (pendingImages.length > 0) {
                    messages.push({
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Here are the image files from the tool results:' },
                            ...pendingImages.map(img => ({
                                type: 'image_url',
                                image_url: { url: `data:${img.mime};base64,${img.base64}` }
                            })),
                        ]
                    });
                }
                if (!signal?.aborted) {
                    fullText += await this.streamLoopOpenAI(messages, system, tools, emit, signal, depth + 1);
                }
                else {
                    emit({ type: 'done', fullText });
                }
            }
            else if (finishReason === 'length') {
                console.warn(`[Agent] OpenAI response truncated (length). Continuing... (depth=${depth})`);
                messages.push({ role: 'assistant', content: fullText || '' });
                messages.push({ role: 'user', content: 'Your response was truncated due to length. Please continue where you left off. If you were about to use a tool, go ahead and call it now.' });
                fullText += await this.streamLoopOpenAI(messages, system, tools, emit, signal, depth + 1);
            }
            else {
                emit({ type: 'done', fullText });
            }
        }
        catch (err) {
            if (signal?.aborted)
                emit({ type: 'done', fullText });
            else
                emit({ type: 'error', message: err.message || 'Unknown error' });
        }
        return fullText;
    }
    // ===== Tool Execution =====
    currentSessionId; // set during chatStream for timer tools
    async runTool(name, args, emit) {
        // Memory tools (handled here because they need MemoryStore access)
        if (name === 'memory_write') {
            const entry = await this.memory.saveMemoryEntry(args.content, args.category);
            return `Memory saved [${entry.id}]: ${args.content.slice(0, 100)}`;
        }
        if (name === 'memory_read') {
            const text = await this.memory.getMemoryText();
            return text || '(no memories stored)';
        }
        if (name === 'memory_delete') {
            await this.memory.deleteMemoryEntry(args.id);
            return `Memory entry ${args.id} deleted`;
        }
        // Grid tools
        if (name === 'grid_run') {
            const goal = args.goal;
            const constraints = args.constraints;
            const planOnly = args.planOnly;
            try {
                const plan = await this.planGrid(goal, constraints, emit);
                if (plan.skillGaps.length > 0 || planOnly) {
                    // Return plan summary without executing
                    let summary = `**Plan created** (ID: \`${plan.id}\`)\n\n**Goal:** ${plan.goal}\n\n**Steps:**\n`;
                    summary += plan.steps.map((s, i) => `${i + 1}. **${s.name}**: ${s.description}${s.skills.length > 0 ? ` [Skills: ${s.skills.join(', ')}]` : ''}`).join('\n');
                    if (plan.skillGaps.length > 0) {
                        summary += '\n\n**Missing skills:**\n';
                        summary += plan.skillGaps.map(g => `- **${g.name}**: ${g.reason} (needed by step: ${g.step})`).join('\n');
                        summary += '\n\nPlease ask the user whether to: 1) Create the missing skill(s) 2) Execute without them 3) Modify the plan';
                    }
                    else {
                        summary += '\n\nPlan is ready. Use `grid_execute` with planId to execute, or present to user for review.';
                    }
                    return summary;
                }
                // No skill gaps and not planOnly — auto-execute
                return await this.executeGridPlan(plan, emit);
            }
            catch (err) {
                emit?.({ type: 'grid_error', planId: '', message: err.message });
                return `Grid planning failed: ${err.message}`;
            }
        }
        if (name === 'grid_execute') {
            const planId = args.planId;
            const plan = await loadPlan(planId);
            if (!plan)
                return `Plan "${planId}" not found.`;
            // Reload skills in case user created new ones
            await this.reloadSkills();
            return await this.executeGridPlan(plan, emit);
        }
        if (name === 'grid_list') {
            const plans = await listPlans();
            if (plans.length === 0)
                return '(no plans saved)';
            return plans.map(p => `- **${p.id.slice(0, 8)}** [${p.status}]: ${p.goal} (${p.steps.length} steps)`).join('\n');
        }
        if (name === 'grid_delete') {
            const ok = await deletePlan(args.id);
            return ok ? `Plan "${args.id}" deleted.` : `Plan "${args.id}" not found.`;
        }
        // Soul tools
        if (name === 'soul_think') {
            const question = args.question;
            const unitCount = 0; // LLM decides dynamically
            try {
                const session = await this.soulThink(question, unitCount, emit);
                return `**Soul Analysis Complete** (ID: \`${session.id}\`)\n\n${session.synthesis}`;
            }
            catch (err) {
                emit?.({ type: 'soul_error', soulId: '', message: err.message });
                return `Soul thinking failed: ${err.message}`;
            }
        }
        if (name === 'soul_list') {
            const sessions = await listSoulSessions();
            if (sessions.length === 0)
                return '(no soul sessions saved)';
            return sessions.map(s => `- **${s.id.slice(0, 8)}** [${s.status}]: ${s.question.slice(0, 60)} (${s.units.length} perspectives)`).join('\n');
        }
        if (name === 'soul_delete') {
            const ok = await deleteSoulSession(args.id);
            return ok ? `Soul session "${args.id}" deleted.` : `Soul session "${args.id}" not found.`;
        }
        // Swarm tools
        if (name === 'swarm_run') {
            const goal = args.goal;
            const constraints = args.constraints;
            const maxWorkers = Math.min(Math.max(Number(args.maxWorkers) || 4, 2), 8);
            const planOnly = args.planOnly;
            try {
                const plan = await this.planSwarm(goal, constraints, maxWorkers, emit);
                if (planOnly) {
                    let summary = `**Swarm Plan** (ID: \`${plan.id}\`)\n\n**Goal:** ${plan.goal}\n\n**Tasks (parallel):**\n`;
                    summary += plan.tasks.map((t, i) => `${i + 1}. **${t.name}**: ${t.description}${t.dependencies.length > 0 ? ` [depends on: ${t.dependencies.join(', ')}]` : ' [independent]'}`).join('\n');
                    summary += '\n\nPlan ready. Use `swarm_execute` with planId to execute.';
                    return summary;
                }
                return await this.executeSwarmPlan(plan, emit);
            }
            catch (err) {
                emit?.({ type: 'swarm_error', planId: '', message: err.message });
                return `Swarm planning failed: ${err.message}`;
            }
        }
        if (name === 'swarm_execute') {
            const planId = args.planId;
            const plan = await loadSwarmPlan(planId);
            if (!plan)
                return `Swarm plan "${planId}" not found.`;
            return await this.executeSwarmPlan(plan, emit);
        }
        if (name === 'swarm_list') {
            const plans = await listSwarmPlans();
            if (plans.length === 0)
                return '(no swarm plans saved)';
            return plans.map(p => `- **${p.id.slice(0, 8)}** [${p.status}]: ${p.goal} (${p.tasks.length} tasks, max ${p.maxWorkers} workers)`).join('\n');
        }
        if (name === 'swarm_delete') {
            const ok = await deleteSwarmPlan(args.id);
            return ok ? `Swarm plan "${args.id}" deleted.` : `Swarm plan "${args.id}" not found.`;
        }
        // Timer tools
        if (name === 'set_timer') {
            if (!this.timerManager)
                return 'Timer system not available';
            const sessionId = this.currentSessionId;
            if (!sessionId)
                return 'No active session for timer';
            const result = await this.timerManager.setTimer(sessionId, {
                label: args.label,
                message: args.message,
                delaySeconds: args.delay_seconds,
                cron: args.cron,
                recurring: args.recurring,
                maxFireCount: args.max_fires,
            });
            if (result.success && result.timer) {
                const t = result.timer;
                let timeInfo = t.recurring ? `cron: ${t.cron}` : `fires in ${args.delay_seconds}s at ${new Date(t.fireAt).toLocaleTimeString()}`;
                if (t.maxFireCount)
                    timeInfo += `, auto-stops after ${t.maxFireCount} fires`;
                return `Timer set [${t.id}]: "${t.label}" (${timeInfo})`;
            }
            return `Timer failed: ${result.error}`;
        }
        if (name === 'cancel_timer') {
            if (!this.timerManager)
                return 'Timer system not available';
            const result = await this.timerManager.cancelTimer(args.timer_id, this.currentSessionId);
            return result.success ? `Timer "${args.timer_id}" cancelled.` : `Cancel failed: ${result.error}`;
        }
        if (name === 'list_timers') {
            if (!this.timerManager)
                return 'Timer system not available';
            const timers = this.timerManager.listTimers(this.currentSessionId);
            if (timers.length === 0)
                return '(no active timers)';
            return timers.map(t => {
                const timeInfo = t.recurring ? `cron: ${t.cron}` : `fires at: ${new Date(t.fireAt).toLocaleString()}`;
                return `- [${t.id}] "${t.label}" — ${timeInfo} (fired ${t.firedCount}x)`;
            }).join('\n');
        }
        if (isNativeTool(name))
            return executeTool(name, args);
        if (this.mcpManager.hasTool(name))
            return this.mcpManager.callTool(name, args);
        return `Unknown tool: ${name}`;
    }
    // ===== Grid Planning =====
    async planGrid(goal, constraints, emit) {
        const planId = crypto.randomUUID();
        emit?.({ type: 'grid_planning', planId, goal });
        const skillCatalog = buildSkillCatalog(this.allSkills);
        const skillNames = new Set(this.allSkills.map(s => s.name));
        const planningPrompt = `You are a task planner. Given a goal and available skills, create an execution plan.

Available skills:
${skillCatalog}

Rules:
- Create 2-8 focused steps to achieve the goal
- Each step can use 0-2 skills from the available list
- If a step would benefit from a skill that doesn't exist, list it in skillGaps
- Each step should be self-contained with clear instructions
- Steps execute sequentially; each step receives output from previous steps

${constraints ? `Constraints: ${constraints}\n` : ''}
Goal: ${goal}

Respond with ONLY a JSON object in this format:
{
  "steps": [
    { "name": "step name", "description": "detailed instructions for this step", "skills": ["skill-name"], "expectedOutput": "what this step should produce" }
  ],
  "skillGaps": [
    { "name": "suggested-skill-name", "reason": "why this skill would help", "step": "which step needs it" }
  ]
}`;
        let responseText;
        if (this.config.provider === 'openai') {
            responseText = await this.runCompletionOpenAI(planningPrompt, goal, []);
        }
        else {
            responseText = await this.runCompletionAnthropic(planningPrompt, goal, []);
        }
        const parsed = extractJSON(responseText);
        // Validate skill names — only keep real ones
        for (const step of parsed.steps) {
            step.skills = (step.skills || []).filter(s => skillNames.has(s));
        }
        const plan = {
            id: planId,
            goal,
            constraints,
            steps: parsed.steps,
            skillGaps: parsed.skillGaps || [],
            results: parsed.steps.map(s => ({ stepName: s.name, output: '', status: 'pending' })),
            status: 'planned',
            createdAt: Date.now(),
        };
        await savePlan(plan);
        emit?.({ type: 'grid_plan_ready', planId, goal, steps: plan.steps, skillGaps: plan.skillGaps });
        return plan;
    }
    // ===== Grid Execution =====
    async executeGridPlan(plan, emit) {
        plan.status = 'executing';
        await savePlan(plan);
        const total = plan.steps.length;
        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i];
            plan.results[i].status = 'running';
            await savePlan(plan);
            emit?.({ type: 'grid_step_start', planId: plan.id, step: step.name, index: i, total, skills: step.skills });
            // Resolve skills for this step
            const stepSkills = (step.skills || [])
                .map(sn => this.allSkills.find(s => s.name === sn))
                .filter((s) => !!s);
            // Build system prompt
            let system = (this.config.systemPrompt || BASE_SYSTEM_PROMPT) + buildSkillPrompt(stepSkills);
            const memoryText = await this.memory.getMemoryText();
            if (memoryText)
                system += '\n\n## Your Memories\n' + memoryText;
            // Build user message with context from previous steps
            let userContent = step.description;
            if (plan.goal)
                userContent = `Overall goal: ${plan.goal}\n\nCurrent step: ${step.name}\nInstructions: ${userContent}`;
            if (step.expectedOutput)
                userContent += `\n\nExpected output: ${step.expectedOutput}`;
            const completedResults = plan.results.filter(r => r.status === 'completed');
            if (completedResults.length > 0) {
                const prev = completedResults.map(r => `[${r.stepName}]: ${r.output}`).join('\n\n');
                userContent = `Previous step results:\n${prev}\n\n---\n\n${userContent}`;
            }
            // Get available tools, filtering out grid_run/grid_execute to prevent recursion
            const mcpTools = await this.mcpManager.refreshToolDefinitions();
            const allTools = [...toolDefinitions, ...mcpTools].filter(t => t.name !== 'grid_run' && t.name !== 'grid_execute');
            // Run completion with tool loop
            let output;
            try {
                if (this.config.provider === 'openai') {
                    output = await this.runCompletionOpenAI(system, userContent, allTools);
                }
                else {
                    output = await this.runCompletionAnthropic(system, userContent, allTools);
                }
                plan.results[i].output = output;
                plan.results[i].status = 'completed';
            }
            catch (err) {
                output = `Error: ${err.message}`;
                plan.results[i].output = output;
                plan.results[i].status = 'failed';
                plan.status = 'failed';
                await savePlan(plan);
                emit?.({ type: 'grid_step_end', planId: plan.id, step: step.name, index: i, output: output.slice(0, 500), status: 'failed' });
                emit?.({ type: 'grid_error', planId: plan.id, message: `Step "${step.name}" failed: ${err.message}` });
                break;
            }
            await savePlan(plan);
            emit?.({ type: 'grid_step_end', planId: plan.id, step: step.name, index: i, output: output.slice(0, 500), status: 'completed' });
        }
        if (plan.status !== 'failed') {
            plan.status = 'completed';
            await savePlan(plan);
        }
        // Format final output
        const summary = plan.results
            .filter(r => r.status === 'completed')
            .map((r, i) => `### Step ${i + 1}: ${r.stepName}\n${r.output}`)
            .join('\n\n---\n\n');
        emit?.({ type: 'grid_complete', planId: plan.id, goal: plan.goal, summary: summary.slice(0, 500) });
        return summary;
    }
    // ===== Non-streaming Completion (for Grid steps) =====
    async runCompletionAnthropic(system, userMessage, tools, depth = 0) {
        if (depth > this.maxToolIterations)
            return `[Max tool iterations (${this.maxToolIterations}) reached. Try breaking the task into smaller steps.]`;
        const messages = [{ role: 'user', content: userMessage }];
        return this.runCompletionLoopAnthropic(messages, system, tools, depth);
    }
    async runCompletionLoopAnthropic(messages, system, tools, depth) {
        if (depth > this.maxToolIterations)
            return `[Max tool iterations (${this.maxToolIterations}) reached. Try breaking the task into smaller steps.]`;
        const response = await this.anthropicClient.messages.create({
            model: this.config.model,
            max_tokens: this.config.maxTokens,
            system,
            tools: tools.length > 0 ? tools : undefined,
            messages,
        });
        let text = '';
        const toolBlocks = response.content.filter((b) => b.type === 'tool_use');
        for (const block of response.content) {
            if (block.type === 'text')
                text += block.text;
        }
        if (response.stop_reason === 'tool_use' && toolBlocks.length > 0) {
            messages.push({ role: 'assistant', content: response.content });
            const toolResults = [];
            for (const block of toolBlocks) {
                const result = await this.runTool(block.name, block.input);
                // Strip __IMG: and __FILE: prefixes to avoid sending raw base64 to model
                const imgMatch = result.match(/^__IMG:([^:]+):(.+)$/s);
                if (imgMatch) {
                    const fileName = String(block.input?.path || 'image').split(/[\\/]/).pop() || 'image';
                    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `[Image file: ${fileName}, ${imgMatch[1]}]` });
                }
                else if (result.startsWith('__FILE:')) {
                    const fileMatch = result.match(/^__FILE:([^:]+):([^:]+):(.+)$/s);
                    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: fileMatch ? `[File: ${fileMatch[2]}, ${fileMatch[1]}]` : result });
                }
                else {
                    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
                }
            }
            messages.push({ role: 'user', content: toolResults });
            const continuation = await this.runCompletionLoopAnthropic(messages, system, tools, depth + 1);
            return text + continuation;
        }
        return text;
    }
    async runCompletionOpenAI(system, userMessage, tools, depth = 0) {
        if (depth > this.maxToolIterations)
            return `[Max tool iterations (${this.maxToolIterations}) reached. Try breaking the task into smaller steps.]`;
        const messages = [
            { role: 'system', content: system },
            { role: 'user', content: userMessage },
        ];
        return this.runCompletionLoopOpenAI(messages, tools, depth);
    }
    async runCompletionLoopOpenAI(messages, tools, depth) {
        if (depth > this.maxToolIterations)
            return `[Max tool iterations (${this.maxToolIterations}) reached. Try breaking the task into smaller steps.]`;
        const { baseURL, apiKey } = this.openaiConfig;
        const endpoint = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
        const openaiTools = tools.length > 0
            ? tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema } }))
            : undefined;
        const body = { model: this.config.model, max_tokens: this.config.maxTokens, messages, stream: false };
        if (openaiTools)
            body.tools = openaiTools;
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errText = await res.text();
            return `[API Error ${res.status}: ${errText.slice(0, 200)}]`;
        }
        const json = await res.json();
        const choice = json.choices?.[0];
        if (!choice)
            return '[No response]';
        let text = choice.message?.content || '';
        // Strip <think> tags from thinking models
        text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        const toolCalls = choice.message?.tool_calls;
        if (toolCalls && toolCalls.length > 0) {
            messages.push(choice.message);
            for (const tc of toolCalls) {
                let args;
                try {
                    args = JSON.parse(tc.function.arguments);
                }
                catch {
                    args = {};
                }
                const result = await this.runTool(tc.function.name, args);
                // Strip __IMG: and __FILE: prefixes to avoid sending raw base64 to model
                const imgMatch = result.match(/^__IMG:([^:]+):(.+)$/s);
                if (imgMatch) {
                    const fileName = String(args?.path || 'image').split(/[\\/]/).pop() || 'image';
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: `[Image file: ${fileName}, ${imgMatch[1]}]` });
                }
                else if (result.startsWith('__FILE:')) {
                    const fileMatch = result.match(/^__FILE:([^:]+):([^:]+):(.+)$/s);
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: fileMatch ? `[File: ${fileMatch[2]}, ${fileMatch[1]}]` : result });
                }
                else {
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                }
            }
            const continuation = await this.runCompletionLoopOpenAI(messages, tools, depth + 1);
            return text + continuation;
        }
        return text;
    }
    // ===== Soul — Multi-Perspective Thinking =====
    async planPerspectives(question) {
        try {
            let responseText;
            if (this.config.provider === 'openai') {
                responseText = await this.runCompletionOpenAI(PERSPECTIVE_PLANNING_PROMPT, question, []);
            }
            else {
                responseText = await this.runCompletionAnthropic(PERSPECTIVE_PLANNING_PROMPT, question, []);
            }
            const parsed = extractJSON(responseText);
            if (parsed.perspectives && Array.isArray(parsed.perspectives) && parsed.perspectives.length >= 1 && parsed.perspectives.length <= 6) {
                // Validate each perspective has required fields
                const valid = parsed.perspectives.every(p => p.role && p.label && p.emoji && p.systemPrompt);
                if (valid)
                    return parsed.perspectives;
            }
        }
        catch (err) {
            console.error('Perspective planning failed, using defaults:', err.message);
        }
        // Fallback to default perspectives
        return DEFAULT_PERSPECTIVES.slice(0, 4);
    }
    async soulThink(question, unitCount, emit) {
        const soulId = crypto.randomUUID();
        // Let LLM dynamically plan perspectives for this question
        const selectedPerspectives = await this.planPerspectives(question);
        const actualCount = selectedPerspectives.length;
        const units = selectedPerspectives.map(p => ({
            role: p.role,
            label: p.label,
            emoji: p.emoji,
            output: '',
            status: 'pending',
        }));
        const session = {
            id: soulId,
            question,
            units,
            synthesis: '',
            status: 'thinking',
            createdAt: Date.now(),
        };
        emit?.({ type: 'soul_start', soulId, question, unitCount: actualCount });
        // Emit all unit_start events
        for (let i = 0; i < units.length; i++) {
            units[i].status = 'running';
            emit?.({ type: 'soul_unit_start', soulId, role: units[i].role, label: units[i].label, emoji: units[i].emoji, index: i });
        }
        // Run all units in parallel
        const unitPromises = selectedPerspectives.map(async (perspective, index) => {
            const startTime = Date.now();
            const system = perspective.systemPrompt +
                '\n\nAnalyze the following question from your unique perspective. ' +
                'Be concise (200-400 words), specific, and insightful. ' +
                'Use the same language as the question.';
            try {
                let output;
                if (this.config.provider === 'openai') {
                    output = await this.runCompletionOpenAI(system, question, []);
                }
                else {
                    output = await this.runCompletionAnthropic(system, question, []);
                }
                units[index].output = output;
                units[index].status = 'completed';
                units[index].duration = Date.now() - startTime;
                emit?.({ type: 'soul_unit_done', soulId, role: units[index].role, label: units[index].label, index, output: output.slice(0, 500), status: 'completed' });
            }
            catch (err) {
                units[index].output = `Error: ${err.message}`;
                units[index].status = 'failed';
                units[index].duration = Date.now() - startTime;
                emit?.({ type: 'soul_unit_done', soulId, role: units[index].role, label: units[index].label, index, output: `Error: ${err.message}`, status: 'failed' });
            }
        });
        await Promise.allSettled(unitPromises);
        // Check if any units completed
        const completedUnits = units.filter(u => u.status === 'completed');
        if (completedUnits.length === 0) {
            session.status = 'failed';
            await saveSoulSession(session);
            emit?.({ type: 'soul_error', soulId, message: 'All thinking units failed' });
            throw new Error('All thinking units failed');
        }
        // Synthesize
        emit?.({ type: 'soul_synthesizing', soulId });
        session.status = 'synthesizing';
        const perspectivesSummary = completedUnits.map(u => `[${u.label} ${u.emoji}]:\n${u.output}`).join('\n\n---\n\n');
        const synthesisPrompt = `Original question: ${question}\n\nThe following analysts have provided their perspectives:\n\n${perspectivesSummary}\n\nBased on all perspectives above, provide your synthesized conclusion with a clear stance.`;
        try {
            let synthesis;
            if (this.config.provider === 'openai') {
                synthesis = await this.runCompletionOpenAI(SYNTHESIS_SYSTEM_PROMPT, synthesisPrompt, []);
            }
            else {
                synthesis = await this.runCompletionAnthropic(SYNTHESIS_SYSTEM_PROMPT, synthesisPrompt, []);
            }
            session.synthesis = synthesis;
            session.status = 'completed';
            await saveSoulSession(session);
            emit?.({ type: 'soul_complete', soulId, question, synthesis });
        }
        catch (err) {
            session.status = 'failed';
            await saveSoulSession(session);
            emit?.({ type: 'soul_error', soulId, message: `Synthesis failed: ${err.message}` });
            throw err;
        }
        return session;
    }
    // ===== Swarm — Parallel Task Planning =====
    async planSwarm(goal, constraints, maxWorkers = 4, emit) {
        const planId = crypto.randomUUID();
        emit?.({ type: 'swarm_planning', planId, goal });
        const planningPrompt = `You are a task decomposition planner. Given a goal, break it into subtasks that can be executed IN PARALLEL by independent AI agents.

Rules:
- Create 2-8 subtasks
- Each subtask must be self-contained with clear instructions
- Identify which tasks can run independently (no dependencies)
- Identify which tasks depend on outputs from other tasks
- Maximize parallelism — prefer independent tasks
- Each task has access to tools: read_file, write_file, list_files, bash, web_fetch, screenshot
- Task IDs should be short strings like "t1", "t2", etc.

${constraints ? `Constraints: ${constraints}\n` : ''}
Goal: ${goal}

Respond with ONLY a JSON object:
{
  "tasks": [
    {
      "id": "t1",
      "name": "task name",
      "description": "detailed instructions for this subtask",
      "expectedOutput": "what this task should produce",
      "dependencies": []
    }
  ]
}`;
        let responseText;
        if (this.config.provider === 'openai') {
            responseText = await this.runCompletionOpenAI(planningPrompt, goal, []);
        }
        else {
            responseText = await this.runCompletionAnthropic(planningPrompt, goal, []);
        }
        const parsed = extractJSON(responseText);
        const tasks = parsed.tasks.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            expectedOutput: t.expectedOutput || '',
            dependencies: t.dependencies || [],
            output: '',
            status: 'pending',
        }));
        const plan = {
            id: planId,
            goal,
            constraints,
            tasks,
            summary: '',
            status: 'planned',
            maxWorkers,
            createdAt: Date.now(),
        };
        await saveSwarmPlan(plan);
        emit?.({ type: 'swarm_plan_ready', planId, goal, tasks });
        return plan;
    }
    // ===== Swarm — Parallel Task Execution =====
    async executeSwarmPlan(plan, emit) {
        plan.status = 'executing';
        await saveSwarmPlan(plan);
        const total = plan.tasks.length;
        const levels = resolveExecutionLevels(plan.tasks);
        const taskOutputs = new Map();
        let hasFailed = false;
        for (const level of levels) {
            // Limit concurrency to maxWorkers
            const batches = [];
            for (let i = 0; i < level.length; i += plan.maxWorkers) {
                batches.push(level.slice(i, i + plan.maxWorkers));
            }
            for (const batch of batches) {
                const batchPromises = batch.map(async (task) => {
                    const taskIndex = plan.tasks.findIndex(t => t.id === task.id);
                    // Skip if dependencies failed
                    const depsFailed = task.dependencies.some(depId => {
                        const dep = plan.tasks.find(t => t.id === depId);
                        return dep && (dep.status === 'failed' || dep.status === 'skipped');
                    });
                    if (depsFailed) {
                        task.status = 'skipped';
                        task.output = 'Skipped: dependency failed';
                        emit?.({ type: 'swarm_task_end', planId: plan.id, taskName: task.name, taskId: task.id, index: taskIndex, output: task.output, status: 'skipped' });
                        return;
                    }
                    task.status = 'running';
                    emit?.({ type: 'swarm_task_start', planId: plan.id, taskName: task.name, taskId: task.id, index: taskIndex, total });
                    // Build system prompt
                    let system = (this.config.systemPrompt || BASE_SYSTEM_PROMPT);
                    const memoryText = await this.memory.getMemoryText();
                    if (memoryText)
                        system += '\n\n## Your Memories\n' + memoryText;
                    // Build user message with dependency context
                    let userContent = `Overall goal: ${plan.goal}\n\nYour task: ${task.name}\nInstructions: ${task.description}`;
                    if (task.expectedOutput)
                        userContent += `\nExpected output: ${task.expectedOutput}`;
                    // Inject outputs from completed dependencies
                    const depOutputs = task.dependencies
                        .map(depId => {
                        const output = taskOutputs.get(depId);
                        const depTask = plan.tasks.find(t => t.id === depId);
                        return output ? `[${depTask?.name || depId}]: ${output}` : null;
                    })
                        .filter(Boolean);
                    if (depOutputs.length > 0) {
                        userContent = `Dependency outputs:\n${depOutputs.join('\n\n')}\n\n---\n\n${userContent}`;
                    }
                    // Get tools (exclude recursive tools)
                    const mcpTools = await this.mcpManager.refreshToolDefinitions();
                    const allTools = [...toolDefinitions, ...mcpTools]
                        .filter(t => !['grid_run', 'grid_execute', 'swarm_run', 'swarm_execute', 'soul_think'].includes(t.name));
                    const startTime = Date.now();
                    try {
                        let output;
                        if (this.config.provider === 'openai') {
                            output = await this.runCompletionOpenAI(system, userContent, allTools);
                        }
                        else {
                            output = await this.runCompletionAnthropic(system, userContent, allTools);
                        }
                        task.output = output;
                        task.status = 'completed';
                        task.duration = Date.now() - startTime;
                        taskOutputs.set(task.id, output);
                        emit?.({ type: 'swarm_task_end', planId: plan.id, taskName: task.name, taskId: task.id, index: taskIndex, output: output.slice(0, 500), status: 'completed' });
                    }
                    catch (err) {
                        task.output = `Error: ${err.message}`;
                        task.status = 'failed';
                        task.duration = Date.now() - startTime;
                        hasFailed = true;
                        emit?.({ type: 'swarm_task_end', planId: plan.id, taskName: task.name, taskId: task.id, index: taskIndex, output: `Error: ${err.message}`, status: 'failed' });
                    }
                });
                await Promise.allSettled(batchPromises);
                await saveSwarmPlan(plan);
            }
        }
        // Final summary
        const completedTasks = plan.tasks.filter(t => t.status === 'completed');
        const summary = completedTasks
            .map(t => `### ${t.name}\n${t.output}`)
            .join('\n\n---\n\n');
        plan.summary = summary;
        plan.status = hasFailed ? 'failed' : 'completed';
        await saveSwarmPlan(plan);
        emit?.({ type: 'swarm_complete', planId: plan.id, goal: plan.goal, summary: summary.slice(0, 500) });
        return summary;
    }
    async saveAssistantMessage(sessionId, content, extra) {
        const hasExtra = !!(extra?.thinking || (extra?.tools && extra.tools.length > 0) || (extra?.images && extra.images.length > 0) || (extra?.grids && extra.grids.length > 0) || (extra?.souls && extra.souls.length > 0) || (extra?.swarms && extra.swarms.length > 0));
        if (!content && !hasExtra)
            return;
        const msg = { role: 'assistant', content: content || '', timestamp: Date.now() };
        if (extra?.thinking)
            msg.thinking = extra.thinking;
        if (extra?.tools && extra.tools.length > 0)
            msg.tools = extra.tools;
        if (extra?.images && extra.images.length > 0)
            msg.images = extra.images;
        if (extra?.grids && extra.grids.length > 0)
            msg.grids = extra.grids;
        if (extra?.souls && extra.souls.length > 0)
            msg.souls = extra.souls;
        if (extra?.swarms && extra.swarms.length > 0)
            msg.swarms = extra.swarms;
        await this.memory.addMessage(sessionId, msg);
    }
    async listSessions() { return await this.memory.listSessions(); }
    getMemory() { return this.memory; }
}
