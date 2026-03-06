# PIweb Configuration Guide

## Quick Start

```bash
# 1. Clone
git clone https://github.com/user/piweb.git && cd piweb

# 2. Install
npm install

# 3. Configure (choose one)
#    Option A: Use the Web Settings panel (recommended)
#    Option B: Copy and edit config file
cp piweb.config.example.json piweb.config.json

# 4. Start
npm start
# Open http://localhost:3000, click Settings gear icon to configure
```

## Configuration Methods

### Method 1: Web Settings Panel (Recommended)

Click the gear icon in the sidebar to open the Settings panel. Select a Provider from the dropdown, enter your API Key, choose a model, and click Save. Changes take effect immediately without restarting.

### Method 2: Edit `piweb.config.json`

```json
{
  "preset": "deepseek",
  "provider": "openai",
  "baseURL": "https://api.deepseek.com/v1",
  "model": "deepseek-chat",
  "maxTokens": 8192,
  "mcp": {}
}
```

- `preset` — Which provider preset was selected in the UI (for display only)
- `provider` — `"anthropic"` or `"openai"` (all non-Anthropic providers use `"openai"`)
- `baseURL` — API endpoint URL
- `model` — Model name (leave empty for auto-detect from local servers)
- `maxTokens` — Max output tokens per response (default: 8192)
- `systemPrompt` — Custom system prompt (optional, overrides default)
- `mcp` — MCP server configurations (see below)

### Method 3: `.env` File

API keys are stored in `.env`:

```bash
API_KEY=sk-your-key-here
```

You can also set API keys via the Web Settings panel, which writes to `.env` automatically.

## Supported Providers

### Local Deployment

| Provider | Base URL | Model Examples | API Key |
|----------|----------|----------------|---------|
| Ollama | `http://localhost:11434/v1` | llama3.3, qwen2.5, deepseek-r1 | Not required |
| vLLM / SGLang | `http://localhost:8000/v1` | auto-detect | Not required |
| LM Studio | `http://localhost:1234/v1` | auto-detect | Not required |

### China Services

| Provider | Base URL | Models | Get API Key |
|----------|----------|--------|------------|
| Alibaba DashScope (Qwen) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-max, qwen-plus, qwen-turbo | [console.aliyun.com](https://console.aliyun.com) |
| DeepSeek | `https://api.deepseek.com/v1` | deepseek-chat, deepseek-reasoner | [platform.deepseek.com](https://platform.deepseek.com) |
| Zhipu AI (GLM) | `https://open.bigmodel.cn/api/paas/v4/` | glm-4-plus, glm-4-flash | [open.bigmodel.cn](https://open.bigmodel.cn) |
| Moonshot (Kimi) | `https://api.moonshot.ai/v1` | moonshot-v1-auto, kimi-k2 | [platform.moonshot.cn](https://platform.moonshot.cn) |
| Baidu Qianfan (ERNIE) | `https://aistudio.baidu.com/llm/lmapi/v3` | ernie-4.5, ernie-4.0 | [aistudio.baidu.com](https://aistudio.baidu.com) |
| Lingyiwanwu (Yi) | `https://api.lingyiwanwu.com/v1` | yi-large, yi-medium | [platform.lingyiwanwu.com](https://platform.lingyiwanwu.com) |
| SiliconFlow | `https://api.siliconflow.cn/v1` | deepseek-ai/DeepSeek-R1, Qwen/Qwen2.5-72B-Instruct | [siliconflow.cn](https://siliconflow.cn) |

### International Services

| Provider | Base URL | Models | Get API Key |
|----------|----------|--------|------------|
| OpenAI | `https://api.openai.com/v1` | gpt-4.1, gpt-4o, o3-mini | [platform.openai.com](https://platform.openai.com) |
| Anthropic (Claude) | Native API | claude-sonnet-4-6, claude-haiku-4-5 | [console.anthropic.com](https://console.anthropic.com) |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | gemini-2.5-flash, gemini-2.5-pro | [aistudio.google.com](https://aistudio.google.com) |
| Groq | `https://api.groq.com/openai/v1` | llama-3.3-70b-versatile, qwen-qwq-32b | [console.groq.com](https://console.groq.com) |
| Together AI | `https://api.together.xyz/v1` | Llama-4-Maverick-17B | [api.together.xyz](https://api.together.xyz) |

### FunnyPi (Recommended for Claude)

| Provider | Base URL | Models | Get API Key |
|----------|----------|--------|------------|
| FunnyPi | `https://funnypi.com/proxy/v1` | Claude Sonnet 4 / Opus / Haiku (via smart scheduling) | [funnypi.com](https://funnypi.com) |

FunnyPi provides one-click access to Claude models with built-in intelligent scheduling:

1. Select **FunnyPi** from the provider dropdown
2. Enter your FunnyPi API key (`pi-xxxx...`)
3. Choose a scheduling plan:
   - **Plan A (Performance)** — Maximize response quality
   - **Plan B (Budget)** — Minimize cost while maintaining quality
4. Click Save — no model name or base URL configuration needed

The scheduler handles model routing automatically. You interact normally; the system optimizes everything in the background.

### Custom Provider

Any OpenAI-compatible API can be used. Select "Custom" in the provider dropdown and enter the base URL manually.

## Local Model Deployment

### Ollama

```bash
# Install
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3.3

# Start server (default port 11434)
ollama serve
```

In PIweb, select "Local (Ollama)" and set model to `llama3.3`.

### vLLM

```bash
pip install vllm

# Start server
vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000
```

In PIweb, select "Local (vLLM/SGLang)". Model is auto-detected.

### SGLang

```bash
pip install sglang[all]

# Start server
python -m sglang.launch_server --model Qwen/Qwen2.5-7B-Instruct --port 8000
```

In PIweb, select "Local (vLLM/SGLang)". Model is auto-detected.

### LM Studio

1. Download from [lmstudio.ai](https://lmstudio.ai)
2. Load a model in the app
3. Start the local server (default port 1234)

In PIweb, select "Local (LM Studio)". Model is auto-detected.

## MCP Server Configuration

MCP (Model Context Protocol) servers extend PIweb with additional tools. Configure them in the MCP section of Settings, or in `piweb.config.json`:

```json
{
  "mcp": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"],
      "enabled": true
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-filesystem", "/path/to/allowed/dir"],
      "enabled": true
    }
  }
}
```

Each server entry:
- `command` — Executable to run
- `args` — Command arguments
- `enabled` — Set to `false` to disable without removing

MCP servers are hot-reloaded when you save settings.

## Skill System

Skills are loadable behavior modes stored in the `skills/` directory. Each skill is a `.md` file with a YAML frontmatter:

```markdown
---
name: code-reviewer
description: Review code for bugs and improvements
---

You are a code reviewer. Analyze the code for...
```

Toggle skills in the sidebar or via `/skillname` command in chat.

## Advanced

### Custom System Prompt

Set a custom system prompt in Settings or in `piweb.config.json`:

```json
{
  "systemPrompt": "You are a helpful coding assistant..."
}
```

This overrides the default PIweb personality. Leave empty to use the built-in prompt.

### Max Tokens

Controls the maximum output length per response. Default is 8192. Increase for longer responses, decrease for faster/cheaper responses.

## Smart Hybrid Scheduling

The scheduler intelligently optimizes model usage across different stages of a conversation, balancing quality and cost automatically.

When using FunnyPi, scheduling is configured automatically — just select a plan and start chatting.

- **Plan A (Performance)**: Maximize response quality and execution accuracy.
- **Plan B (Budget)**: Minimize cost while maintaining acceptable quality.

## FAQ

**Q: Do I need an API key for local models?**
A: No. Local providers (Ollama, vLLM, SGLang, LM Studio) don't require API keys.

**Q: Why is my model not responding?**
A: Check that: (1) the base URL is correct, (2) the model name matches what the provider expects, (3) your API key is valid.

**Q: Can I use any OpenAI-compatible API?**
A: Yes. Select "Custom" as the provider and enter the base URL. PIweb uses the standard OpenAI Chat Completions format.

**Q: How do I switch between providers?**
A: Open Settings, select a new provider from the dropdown. The base URL is filled automatically. Click Save — changes take effect immediately without restart.

**Q: Where are my conversations stored?**
A: In the `data/` directory as JSON files. Long-term memories are in `data/memory.json`.
