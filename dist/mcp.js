import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
// Workplace directory — all temp/work files go here
const mcpSrcDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1');
const WORKPLACE_DIR = join(mcpSrcDir, '..', 'workplace');
// Stable browser profile directory for Playwright MCP persistent context
const BROWSER_PROFILE_DIR = resolve(mcpSrcDir, '..', 'data', 'browser-profile');
export class MCPManager {
    servers = [];
    async init(config) {
        for (const [name, serverConfig] of Object.entries(config)) {
            if (serverConfig.enabled === false)
                continue;
            // Playwright MCP: use persistent browser profile for cookie/localStorage persistence
            // Only inject --user-data-dir if user hasn't explicitly set --isolated or --user-data-dir
            if (name === 'playwright' || (serverConfig.command === 'npx' && serverConfig.args?.some(a => a.includes('@playwright/mcp')))) {
                const args = serverConfig.args || [];
                const hasIsolated = args.includes('--isolated');
                const hasUserDataDir = args.some(a => a === '--user-data-dir' || a.startsWith('--user-data-dir='));
                if (!hasIsolated && !hasUserDataDir) {
                    mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
                    serverConfig.args = [...args, '--user-data-dir', BROWSER_PROFILE_DIR];
                }
            }
            try {
                const transport = new StdioClientTransport({
                    command: serverConfig.command,
                    args: serverConfig.args || [],
                    env: { ...process.env, ...(serverConfig.env || {}) },
                });
                const client = new Client({ name: `piweb-${name}`, version: '2.0.0' });
                await client.connect(transport);
                const { tools } = await client.listTools();
                const toolMap = new Map();
                for (const tool of tools) {
                    toolMap.set(tool.name, true);
                }
                this.servers.push({ name, client, transport, tools: toolMap });
                console.log(`MCP [${name}]: connected, ${tools.length} tools`);
            }
            catch (err) {
                console.error(`MCP [${name}]: failed to connect - ${err.message}`);
            }
        }
    }
    getToolDefinitions() {
        const tools = [];
        for (const server of this.servers) {
            // We need to re-list tools synchronously from cached data
            // The tools were listed during init, but we need the full definitions
            // We'll fetch them during init and cache
        }
        return tools;
    }
    async refreshToolDefinitions() {
        const tools = [];
        for (const server of this.servers) {
            try {
                const { tools: serverTools } = await server.client.listTools();
                for (const tool of serverTools) {
                    tools.push({
                        name: tool.name,
                        description: tool.description || '',
                        input_schema: tool.inputSchema,
                    });
                    server.tools.set(tool.name, true);
                }
            }
            catch {
                // Skip failed servers
            }
        }
        return tools;
    }
    hasTool(name) {
        return this.servers.some(s => s.tools.has(name));
    }
    async callTool(name, args, signal) {
        for (const server of this.servers) {
            if (server.tools.has(name)) {
                try {
                    // Race the MCP call against the abort signal so stop button works mid-tool
                    const toolPromise = server.client.callTool({ name, arguments: args });
                    let result;
                    if (signal) {
                        result = await Promise.race([
                            toolPromise,
                            new Promise((_, reject) => {
                                if (signal.aborted)
                                    reject(new DOMException('Aborted', 'AbortError'));
                                else
                                    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
                            }),
                        ]);
                    }
                    else {
                        result = await toolPromise;
                    }
                    if (Array.isArray(result.content)) {
                        const textParts = [];
                        let imagePart = null;
                        for (const c of result.content) {
                            if (c.type === 'text') {
                                textParts.push(c.text);
                            }
                            else if (c.type === 'image' && c.data && c.mimeType) {
                                // MCP image content — compress if large
                                imagePart = { mime: c.mimeType, data: c.data };
                            }
                        }
                        // If there's an image, compress and return as __IMG protocol
                        // __IMG must be at start of string for agent.ts regex to match
                        if (imagePart) {
                            const compressed = this.compressBase64Image(imagePart.data, imagePart.mime);
                            return `__IMG:${compressed.mime}:${compressed.data}`;
                        }
                        return textParts.join('\n');
                    }
                    return String(result.content);
                }
                catch (err) {
                    if (err?.name === 'AbortError')
                        return '[Interrupted]';
                    return `MCP tool error: ${err.message}`;
                }
            }
        }
        return `MCP tool not found: ${name}`;
    }
    compressBase64Image(base64, mime) {
        const sizeKB = Math.round(base64.length * 3 / 4 / 1024);
        // If already small enough (< 300KB), return as-is
        if (sizeKB < 300)
            return { mime, data: base64 };
        try {
            const ts = Date.now();
            mkdirSync(WORKPLACE_DIR, { recursive: true });
            const tmpIn = join(WORKPLACE_DIR, `piweb_mcp_in_${ts}.bin`);
            const tmpOut = join(WORKPLACE_DIR, `piweb_mcp_out_${ts}.jpg`);
            const tmpPy = join(WORKPLACE_DIR, `piweb_mcp_compress_${ts}.py`);
            writeFileSync(tmpIn, Buffer.from(base64, 'base64'));
            writeFileSync(tmpPy, [
                'import sys',
                'from PIL import Image',
                'img = Image.open(sys.argv[1])',
                'w, h = img.size',
                'if w > 1920:',
                '    ratio = 1920 / w',
                '    img = img.resize((1920, int(h * ratio)), Image.LANCZOS)',
                'img = img.convert("RGB")',
                'img.save(sys.argv[2], "JPEG", quality=55)',
            ].join('\n'));
            execSync(`py "${tmpPy}" "${tmpIn}" "${tmpOut}"`, { timeout: 15000 });
            const compressed = readFileSync(tmpOut);
            try {
                unlinkSync(tmpIn);
            }
            catch { }
            try {
                unlinkSync(tmpOut);
            }
            catch { }
            try {
                unlinkSync(tmpPy);
            }
            catch { }
            return { mime: 'image/jpeg', data: compressed.toString('base64') };
        }
        catch {
            // Compression failed, return original
            return { mime, data: base64 };
        }
    }
    async startServer(name, serverConfig) {
        // Don't start if already connected
        if (this.servers.some(s => s.name === name))
            return true;
        // Playwright MCP: use persistent browser profile for cookie/localStorage persistence
        if (name === 'playwright' || (serverConfig.command === 'npx' && serverConfig.args?.some(a => a.includes('@playwright/mcp')))) {
            const args = serverConfig.args || [];
            const hasIsolated = args.includes('--isolated');
            const hasUserDataDir = args.some(a => a === '--user-data-dir' || a.startsWith('--user-data-dir='));
            if (!hasIsolated && !hasUserDataDir) {
                mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
                serverConfig.args = [...args, '--user-data-dir', BROWSER_PROFILE_DIR];
            }
        }
        try {
            const transport = new StdioClientTransport({
                command: serverConfig.command,
                args: serverConfig.args || [],
                env: { ...process.env, ...(serverConfig.env || {}) },
            });
            const client = new Client({ name: `piweb-${name}`, version: '2.0.0' });
            await client.connect(transport);
            const { tools } = await client.listTools();
            const toolMap = new Map();
            for (const tool of tools) {
                toolMap.set(tool.name, true);
            }
            this.servers.push({ name, client, transport, tools: toolMap });
            console.log(`MCP [${name}]: connected, ${tools.length} tools`);
            return true;
        }
        catch (err) {
            console.error(`MCP [${name}]: failed to connect - ${err.message}`);
            return false;
        }
    }
    async stopServer(name) {
        const idx = this.servers.findIndex(s => s.name === name);
        if (idx < 0)
            return;
        try {
            await this.servers[idx].client.close();
        }
        catch {
            // Ignore shutdown errors
        }
        this.servers.splice(idx, 1);
        console.log(`MCP [${name}]: stopped`);
    }
    getStatus() {
        return this.servers.map(s => ({
            name: s.name,
            connected: true,
            toolCount: s.tools.size,
        }));
    }
    isServerConnected(name) {
        return this.servers.some(s => s.name === name);
    }
    async reload(config) {
        console.log('MCP: reloading...');
        await this.shutdown();
        await this.init(config);
        return this.servers.map(s => s.name);
    }
    async shutdown() {
        for (const server of this.servers) {
            try {
                await server.client.close();
            }
            catch {
                // Ignore shutdown errors
            }
        }
        this.servers = [];
    }
}
