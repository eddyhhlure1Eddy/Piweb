"""
Automated agent trajectory collector.

Sends diverse tasks to PiWeb via WebSocket, waits for completion,
and verifies that steps were saved. All execution is REAL (not synthetic).

Usage:
    py scripts/collect_agent_data.py --host localhost --port 3000
    py scripts/collect_agent_data.py --tasks scripts/task_pool.jsonl --limit 50
    py scripts/collect_agent_data.py --category browser --concurrency 1

The script connects to PiWeb via WebSocket, creates a new session for each task,
sends the task message, and waits for the agent to finish (done/error event).
"""

import json
import sys
import time
import uuid
import argparse
import asyncio
from pathlib import Path
from typing import Any

try:
    import websockets
except ImportError:
    print("Need websockets: pip install websockets")
    sys.exit(1)


# ============================================================
# Task pool: diverse prompts that require real tool execution
# ============================================================

BUILTIN_TASKS: list[dict[str, Any]] = [
    # --- Browser search & research ---
    {"category": "browser", "prompt": "Search for the latest news about NVIDIA stock price today and summarize the key points.", "expected_tools": ["browser_navigate", "browser_snapshot"]},
    {"category": "browser", "prompt": "Find the top 5 trending repositories on GitHub right now and describe what each does.", "expected_tools": ["browser_navigate", "browser_snapshot", "browser_click"]},
    {"category": "browser", "prompt": "Look up the current weather in Tokyo and New York, compare them.", "expected_tools": ["browser_navigate", "browser_snapshot"]},
    {"category": "browser", "prompt": "Search for 'SGLang performance optimization' on Google and summarize the top 3 results.", "expected_tools": ["browser_navigate", "browser_snapshot", "browser_click"]},
    {"category": "browser", "prompt": "Go to Hacker News and find the top story, then read the comments and summarize the discussion.", "expected_tools": ["browser_navigate", "browser_snapshot", "browser_click"]},
    {"category": "browser", "prompt": "Search for recent papers about 'mixture of experts training' on arxiv and list the 5 most recent.", "expected_tools": ["browser_navigate", "browser_snapshot"]},
    {"category": "browser", "prompt": "Find the official PyTorch documentation for torch.compile and summarize its key features.", "expected_tools": ["browser_navigate", "browser_snapshot"]},
    {"category": "browser", "prompt": "Look up the latest release notes for vLLM on GitHub.", "expected_tools": ["browser_navigate", "browser_snapshot", "browser_click"]},
    {"category": "browser", "prompt": "Search for 'CUDA graph warmup overhead' and find relevant GitHub issues or discussions.", "expected_tools": ["browser_navigate", "browser_snapshot", "browser_click"]},
    {"category": "browser", "prompt": "Find the current price of Bitcoin and Ethereum, and their 24h change percentage.", "expected_tools": ["browser_navigate", "browser_snapshot"]},
    {"category": "browser", "prompt": "Go to Reddit r/LocalLLaMA and find the most discussed topic this week.", "expected_tools": ["browser_navigate", "browser_snapshot", "browser_click"]},
    {"category": "browser", "prompt": "Search for benchmarks comparing Qwen3.5 vs Llama 4 on coding tasks.", "expected_tools": ["browser_navigate", "browser_snapshot"]},
    {"category": "browser", "prompt": "Find the Wikipedia page about Raspberry Pi 5 and summarize its specifications.", "expected_tools": ["browser_navigate", "browser_snapshot"]},
    {"category": "browser", "prompt": "Search for 'FlashInfer vs FlashAttention performance comparison' and summarize findings.", "expected_tools": ["browser_navigate", "browser_snapshot", "browser_click"]},
    {"category": "browser", "prompt": "Go to the Python Package Index and find the most downloaded packages this month.", "expected_tools": ["browser_navigate", "browser_snapshot"]},

    # --- File operations ---
    {"category": "file", "prompt": "Read the file piweb.config.json and tell me what model and API endpoint it's configured to use.", "expected_tools": ["read_file"]},
    {"category": "file", "prompt": "List all TypeScript files in the src directory and count the total lines of code.", "expected_tools": ["bash"]},
    {"category": "file", "prompt": "Read package.json and tell me all the dependencies and their versions.", "expected_tools": ["read_file"]},
    {"category": "file", "prompt": "Find all TODO comments in the source code files.", "expected_tools": ["bash"]},
    {"category": "file", "prompt": "Check the git log for the last 10 commits and summarize what was changed.", "expected_tools": ["bash"]},

    # --- Bash / system ---
    {"category": "bash", "prompt": "Check the current system memory usage, disk space, and CPU info.", "expected_tools": ["bash"]},
    {"category": "bash", "prompt": "Find all node processes running on this machine and their memory usage.", "expected_tools": ["bash"]},
    {"category": "bash", "prompt": "Check what ports are currently listening on this machine.", "expected_tools": ["bash"]},
    {"category": "bash", "prompt": "Show the current network interfaces and their IP addresses.", "expected_tools": ["bash"]},
    {"category": "bash", "prompt": "Check the available disk space on all drives.", "expected_tools": ["bash"]},

    # --- Multi-tool complex tasks ---
    {"category": "complex", "prompt": "Search online for the latest LLM leaderboard rankings, then save a summary to a markdown file on the desktop.", "expected_tools": ["browser_navigate", "browser_snapshot", "write_file"]},
    {"category": "complex", "prompt": "Check if our GPU server at 192.168.31.201 is reachable via ping, then search online for any known issues with RTX PRO 6000 drivers.", "expected_tools": ["bash", "browser_navigate", "browser_snapshot"]},
    {"category": "complex", "prompt": "Read the current piweb.config.json, then search online for the model it references to find its latest benchmark scores.", "expected_tools": ["read_file", "browser_navigate", "browser_snapshot"]},
    {"category": "complex", "prompt": "Find the latest Python security advisories online, then check our local Python version to see if we're affected.", "expected_tools": ["browser_navigate", "browser_snapshot", "bash"]},
    {"category": "complex", "prompt": "Search for best practices in TypeScript error handling, then check our source code to see if we follow those practices.", "expected_tools": ["browser_navigate", "browser_snapshot", "bash"]},

    # --- Peer / multi-device ---
    {"category": "peer", "prompt": "Check which peer devices are online and report their status.", "expected_tools": ["peer_list"]},
    {"category": "peer", "prompt": "List all online peers and check if any of them have active browser sessions.", "expected_tools": ["peer_list", "peer_send"]},

    # --- Error recovery (model should handle gracefully) ---
    {"category": "error_recovery", "prompt": "Navigate to a website that might be slow or unavailable (https://httpstat.us/503) and handle the error gracefully, then try an alternative approach.", "expected_tools": ["browser_navigate"]},
    {"category": "error_recovery", "prompt": "Try to read a file that doesn't exist (nonexistent_file.txt), then recover by searching for similar files.", "expected_tools": ["read_file", "bash"]},

    # --- Deep research (long trajectory) ---
    {"category": "deep_research", "prompt": "Do a deep investigation into how CUDA memory fragmentation affects LLM inference performance. Search at least 3 different sources and compile a comprehensive report.", "expected_tools": ["browser_navigate", "browser_snapshot", "browser_click", "write_file"]},
    {"category": "deep_research", "prompt": "Research the current state of speculative decoding in LLM inference engines (SGLang, vLLM, TensorRT-LLM). Compare their approaches and performance numbers from multiple sources.", "expected_tools": ["browser_navigate", "browser_snapshot", "browser_click", "write_file"]},
    {"category": "deep_research", "prompt": "Investigate the differences between LoRA, QLoRA, and DoRA for fine-tuning large models. Find benchmark comparisons from at least 3 sources.", "expected_tools": ["browser_navigate", "browser_snapshot", "browser_click"]},
    {"category": "deep_research", "prompt": "Research how KV cache compression works in modern LLM serving systems. Find papers, blog posts, and GitHub implementations.", "expected_tools": ["browser_navigate", "browser_snapshot", "browser_click"]},
    {"category": "deep_research", "prompt": "Deep dive into EAGLE speculative decoding. Find the original paper, implementation details, known issues, and performance benchmarks across different models.", "expected_tools": ["browser_navigate", "browser_snapshot", "browser_click", "write_file"]},
]


async def run_task(
    ws_url: str,
    task: dict,
    timeout: int = 300,
) -> dict:
    """
    Send a task to PiWeb and wait for completion.
    Returns metadata about the run.
    """
    session_id = str(uuid.uuid4())
    result = {
        "session_id": session_id,
        "task": task,
        "status": "pending",
        "tool_count": 0,
        "step_count": 0,
        "duration_s": 0,
        "error": None,
    }

    try:
        async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
            # Create session
            await ws.send(json.dumps({
                "type": "create_session",
                "title": f"[auto-collect] {task['category']}: {task['prompt'][:50]}",
            }))
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            if resp.get("type") == "session_created":
                session_id = resp["sessionId"]
                result["session_id"] = session_id

            # Switch to session
            await ws.send(json.dumps({
                "type": "switch_session",
                "sessionId": session_id,
            }))
            # Wait for switch confirmation
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                if msg.get("type") == "session_switched":
                    break

            # Send the task
            start_time = time.time()
            await ws.send(json.dumps({
                "type": "chat",
                "content": task["prompt"],
            }))

            # Wait for completion
            tool_names: list[str] = []
            step_count = 0
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                    event = json.loads(raw)
                except asyncio.TimeoutError:
                    result["status"] = "timeout"
                    result["error"] = f"Timed out after {timeout}s"
                    break

                etype = event.get("type", "")

                if etype == "tool_start":
                    tool_names.append(event.get("name", "unknown"))
                if etype == "tool_end":
                    step_count += 1
                if etype == "done":
                    result["status"] = "done"
                    result["response_len"] = len(event.get("fullText", ""))
                    break
                if etype == "error":
                    result["status"] = "error"
                    result["error"] = event.get("message", "unknown error")
                    break

            elapsed = time.time() - start_time
            result["duration_s"] = round(elapsed, 1)
            result["tool_count"] = len(tool_names)
            result["tool_names"] = tool_names
            result["step_count"] = step_count

    except Exception as e:
        result["status"] = "exception"
        result["error"] = str(e)

    return result


async def main_async(args):
    ws_url = f"ws://{args.host}:{args.port}"

    # Load tasks
    if args.tasks:
        tasks = []
        with open(args.tasks, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    tasks.append(json.loads(line))
        print(f"Loaded {len(tasks)} tasks from {args.tasks}")
    else:
        tasks = BUILTIN_TASKS
        print(f"Using {len(tasks)} built-in tasks")

    # Filter by category
    if args.category:
        tasks = [t for t in tasks if t.get("category") == args.category]
        print(f"Filtered to {len(tasks)} tasks in category '{args.category}'")

    # Limit
    if args.limit and args.limit < len(tasks):
        tasks = tasks[:args.limit]
        print(f"Limited to {args.limit} tasks")

    if not tasks:
        print("No tasks to run!")
        return

    print(f"\nRunning {len(tasks)} tasks against {ws_url}")
    print(f"Timeout per task: {args.timeout}s")
    print(f"Delay between tasks: {args.delay}s")
    print("=" * 60)

    results = []
    success = 0
    failed = 0

    for i, task in enumerate(tasks):
        print(f"\n[{i+1}/{len(tasks)}] {task['category']}: {task['prompt'][:60]}...")
        result = await run_task(ws_url, task, timeout=args.timeout)
        results.append(result)

        status_icon = {
            "done": "+", "error": "!", "timeout": "T", "exception": "X"
        }.get(result["status"], "?")
        print(f"  [{status_icon}] {result['status']} | "
              f"tools={result['tool_count']} | "
              f"time={result['duration_s']}s")

        if result["status"] == "done" and result["tool_count"] > 0:
            success += 1
        else:
            failed += 1
            if result.get("error"):
                print(f"  Error: {result['error'][:100]}")

        # Delay between tasks to avoid overwhelming the server
        if i < len(tasks) - 1 and args.delay > 0:
            await asyncio.sleep(args.delay)

    # Summary
    print("\n" + "=" * 60)
    print(f"=== Collection Summary ===")
    print(f"Total tasks: {len(tasks)}")
    print(f"Success (done + has tools): {success}")
    print(f"Failed/no tools: {failed}")
    print(f"Success rate: {success/len(tasks)*100:.1f}%")
    print(f"Total tool calls: {sum(r['tool_count'] for r in results)}")
    print(f"Avg tools per task: {sum(r['tool_count'] for r in results)/max(len(tasks),1):.1f}")
    print(f"Avg duration: {sum(r['duration_s'] for r in results)/max(len(tasks),1):.1f}s")

    # Save results log
    log_path = Path(args.log or "collect_log.jsonl")
    with open(log_path, "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"\nResults log: {log_path}")

    # Category breakdown
    cat_stats: dict[str, dict] = {}
    for r in results:
        cat = r["task"].get("category", "unknown")
        if cat not in cat_stats:
            cat_stats[cat] = {"total": 0, "success": 0, "tools": 0}
        cat_stats[cat]["total"] += 1
        if r["status"] == "done" and r["tool_count"] > 0:
            cat_stats[cat]["success"] += 1
        cat_stats[cat]["tools"] += r["tool_count"]

    print(f"\nPer-category:")
    for cat, stats in sorted(cat_stats.items()):
        print(f"  {cat}: {stats['success']}/{stats['total']} success, "
              f"{stats['tools']} tool calls")


def main():
    parser = argparse.ArgumentParser(
        description="Automated agent trajectory collector for PiWeb"
    )
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--tasks", type=str, default=None,
                        help="JSONL file with custom tasks")
    parser.add_argument("--category", type=str, default=None,
                        help="Only run tasks from this category")
    parser.add_argument("--limit", type=int, default=None,
                        help="Max number of tasks to run")
    parser.add_argument("--timeout", type=int, default=300,
                        help="Timeout per task in seconds")
    parser.add_argument("--delay", type=float, default=3.0,
                        help="Delay between tasks in seconds")
    parser.add_argument("--log", type=str, default="collect_log.jsonl",
                        help="Output log file path")
    args = parser.parse_args()

    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
