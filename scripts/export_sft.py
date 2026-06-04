"""
Export PiWeb session data to SFT training format.

Supports two output formats:
1. ChatML with interleaved <think> tags (for Qwen3.5 native format)
2. OpenAI messages array (for general SFT frameworks)

Usage:
    py scripts/export_sft.py --format chatml --output training_data.jsonl
    py scripts/export_sft.py --format openai --output training_data.jsonl
    py scripts/export_sft.py --format chatml --min-tools 3 --max-result-len 2000
"""

import json
import os
import sys
import argparse
from pathlib import Path
from typing import Any


DATA_DIR = Path(__file__).parent.parent / "data"

SYSTEM_PROMPT = (
    "You are a helpful AI assistant with access to tools. "
    "Think step by step before acting. Use tools when needed to gather information or perform actions. "
    "After observing tool results, reason about the next step before calling another tool."
)

# Tool results longer than this get truncated (browser_snapshot can be 100K+)
DEFAULT_MAX_RESULT_LEN = 2000


def truncate_result(result: str, max_len: int) -> str:
    if not result or len(result) <= max_len:
        return result
    return result[:max_len] + f"\n... [truncated, {len(result)} chars total]"


def load_sessions(data_dir: Path) -> list[dict]:
    sessions = []
    for fp in sorted(data_dir.glob("*.json")):
        try:
            with open(fp, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and data.get("messages"):
                sessions.append(data)
        except Exception:
            continue
    return sessions


def has_interleaved_steps(msg: dict) -> bool:
    steps = msg.get("steps", [])
    if not steps:
        return False
    has_thinking = any(s.get("type") == "thinking" for s in steps)
    has_tool = any(s.get("type") == "tool" for s in steps)
    return has_thinking and has_tool


def rebuild_steps_from_thinking(msg: dict) -> list[dict]:
    """
    For old messages that have thinking + tools but no steps,
    attempt to reconstruct interleaved steps by splitting thinking
    at natural breakpoints and interleaving with tools.
    """
    thinking = msg.get("thinking", "") or ""
    tools = msg.get("tools", []) or []
    if not thinking or not tools:
        return []

    # Split thinking at common Chinese/English transition markers
    markers = [
        "\n\u597d\u7684\uff0c", "\n\u73b0\u5728", "\n\u8ba9\u6211",
        "\n\u5f88\u597d", "\n\u592a\u597d", "\n\u641c\u7d22\u7ed3\u679c",
        "\nI need", "\nLet me", "\nOK,", "\nNow ",
    ]

    segments: list[str] = []
    remaining = thinking
    while remaining:
        earliest_pos = len(remaining)
        earliest_marker = ""
        for m in markers:
            pos = remaining.find(m, 1)  # skip pos 0
            if 0 < pos < earliest_pos:
                earliest_pos = pos
                earliest_marker = m
        if earliest_marker and earliest_pos < len(remaining):
            segments.append(remaining[:earliest_pos].strip())
            remaining = remaining[earliest_pos:].strip()
        else:
            segments.append(remaining.strip())
            break

    # Simple heuristic: distribute tools evenly across thinking segments
    # This is approximate — real steps would be better
    steps = []
    tool_idx = 0
    tools_per_segment = max(1, len(tools) // max(len(segments), 1))

    for i, seg in enumerate(segments):
        if seg:
            steps.append({"type": "thinking", "text": seg})
        # After each thinking segment, insert appropriate number of tools
        for _ in range(tools_per_segment):
            if tool_idx < len(tools):
                t = tools[tool_idx]
                steps.append({
                    "type": "tool",
                    "name": t.get("name", "unknown"),
                    "result": t.get("result", ""),
                })
                tool_idx += 1

    # Append remaining tools
    while tool_idx < len(tools):
        t = tools[tool_idx]
        steps.append({
            "type": "tool",
            "name": t.get("name", "unknown"),
            "result": t.get("result", ""),
        })
        tool_idx += 1

    return steps


def convert_to_chatml(
    session: dict,
    max_result_len: int,
    min_tools: int,
) -> list[dict] | None:
    """
    Convert a session to ChatML training samples.
    Each user→assistant turn with tool use becomes one sample.
    Returns list of training samples or None if filtered out.
    """
    messages = session.get("messages", [])
    samples = []

    i = 0
    while i < len(messages):
        msg = messages[i]
        if msg.get("role") != "user":
            i += 1
            continue

        user_content = msg.get("content", "")
        # Find the next assistant message
        j = i + 1
        while j < len(messages) and messages[j].get("role") != "assistant":
            j += 1
        if j >= len(messages):
            break

        assistant_msg = messages[j]

        # Get steps (prefer saved steps, fall back to reconstruction)
        steps = assistant_msg.get("steps", [])
        if not steps and assistant_msg.get("tools"):
            steps = rebuild_steps_from_thinking(assistant_msg)

        tools_in_msg = [s for s in steps if s.get("type") == "tool"]
        if len(tools_in_msg) < min_tools:
            i = j + 1
            continue

        # Build ChatML conversation
        conversation: list[dict[str, str]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        # Walk through steps to build interleaved messages
        current_thinking = ""
        for step in steps:
            if step["type"] == "thinking":
                current_thinking += (step.get("text", "") or "") + "\n"
            elif step["type"] == "tool":
                tool_name = step.get("name", "unknown")
                tool_args = step.get("args", {})
                tool_result = truncate_result(
                    step.get("result", ""), max_result_len
                )

                # Assistant message with thinking + tool call
                assistant_content = ""
                if current_thinking.strip():
                    assistant_content = (
                        f"<think>\n{current_thinking.strip()}\n</think>\n"
                    )
                    current_thinking = ""

                tool_call_json = json.dumps(
                    {"name": tool_name, "arguments": tool_args},
                    ensure_ascii=False,
                )
                assistant_content += f"<tool_call>\n{tool_call_json}\n</tool_call>"

                conversation.append({
                    "role": "assistant",
                    "content": assistant_content,
                })
                conversation.append({
                    "role": "tool",
                    "name": tool_name,
                    "content": tool_result,
                })

        # Final assistant response (with any remaining thinking)
        final_content = assistant_msg.get("content", "") or ""
        if current_thinking.strip():
            final_content = (
                f"<think>\n{current_thinking.strip()}\n</think>\n{final_content}"
            )
        if final_content.strip():
            conversation.append({
                "role": "assistant",
                "content": final_content.strip(),
            })

        samples.append({
            "session_id": session.get("id", "unknown"),
            "title": session.get("title", ""),
            "turn_index": i,
            "messages": conversation,
            "metadata": {
                "num_tools": len(tools_in_msg),
                "num_steps": len(steps),
                "has_real_steps": bool(assistant_msg.get("steps")),
                "has_args": any(s.get("args") for s in steps if s.get("type") == "tool"),
                "tool_names": list(set(
                    s.get("name", "") for s in steps if s.get("type") == "tool"
                )),
            },
        })

        i = j + 1

    return samples if samples else None


def convert_to_openai(
    session: dict,
    max_result_len: int,
    min_tools: int,
) -> list[dict] | None:
    """
    Convert to OpenAI function-calling format.
    """
    messages = session.get("messages", [])
    samples = []

    i = 0
    while i < len(messages):
        msg = messages[i]
        if msg.get("role") != "user":
            i += 1
            continue

        user_content = msg.get("content", "")
        j = i + 1
        while j < len(messages) and messages[j].get("role") != "assistant":
            j += 1
        if j >= len(messages):
            break

        assistant_msg = messages[j]
        steps = assistant_msg.get("steps", [])
        if not steps and assistant_msg.get("tools"):
            steps = rebuild_steps_from_thinking(assistant_msg)

        tools_in_msg = [s for s in steps if s.get("type") == "tool"]
        if len(tools_in_msg) < min_tools:
            i = j + 1
            continue

        conversation: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        current_thinking = ""
        call_id = 0
        for step in steps:
            if step["type"] == "thinking":
                current_thinking += (step.get("text", "") or "") + "\n"
            elif step["type"] == "tool":
                tool_name = step.get("name", "unknown")
                tool_args = step.get("args", {})
                tool_result = truncate_result(
                    step.get("result", ""), max_result_len
                )

                reasoning = ""
                if current_thinking.strip():
                    reasoning = current_thinking.strip()
                    current_thinking = ""

                call_id += 1
                tc_id = f"call_{call_id}"
                assistant_entry: dict[str, Any] = {
                    "role": "assistant",
                    "content": reasoning or None,
                    "tool_calls": [{
                        "id": tc_id,
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "arguments": json.dumps(
                                tool_args, ensure_ascii=False
                            ),
                        },
                    }],
                }
                if reasoning:
                    assistant_entry["reasoning_content"] = reasoning

                conversation.append(assistant_entry)
                conversation.append({
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": tool_result,
                })

        final_content = assistant_msg.get("content", "") or ""
        if current_thinking.strip():
            final_content = current_thinking.strip() + "\n" + final_content
        if final_content.strip():
            conversation.append({
                "role": "assistant",
                "content": final_content.strip(),
            })

        samples.append({
            "session_id": session.get("id", "unknown"),
            "title": session.get("title", ""),
            "messages": conversation,
            "metadata": {
                "num_tools": len(tools_in_msg),
                "num_steps": len(steps),
                "has_real_steps": bool(assistant_msg.get("steps")),
                "has_args": any(s.get("args") for s in steps if s.get("type") == "tool"),
            },
        })

        i = j + 1

    return samples if samples else None


def main():
    parser = argparse.ArgumentParser(description="Export PiWeb sessions to SFT training data")
    parser.add_argument("--format", choices=["chatml", "openai"], default="chatml")
    parser.add_argument("--output", "-o", default="training_data.jsonl")
    parser.add_argument("--min-tools", type=int, default=1,
                        help="Minimum tool calls per turn to include")
    parser.add_argument("--max-result-len", type=int, default=DEFAULT_MAX_RESULT_LEN,
                        help="Max chars per tool result (truncate longer)")
    parser.add_argument("--data-dir", type=str, default=str(DATA_DIR))
    parser.add_argument("--include-rebuilt", action="store_true", default=True,
                        help="Include samples with reconstructed steps (no saved steps)")
    parser.add_argument("--only-real-steps", action="store_true", default=False,
                        help="Only export samples that have real saved steps")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    sessions = load_sessions(data_dir)
    print(f"Loaded {len(sessions)} sessions from {data_dir}")

    converter = convert_to_chatml if args.format == "chatml" else convert_to_openai

    total_samples = 0
    real_steps_count = 0
    rebuilt_steps_count = 0
    total_tool_calls = 0
    tool_name_stats: dict[str, int] = {}

    output_path = Path(args.output)
    with open(output_path, "w", encoding="utf-8") as f:
        for session in sessions:
            samples = converter(session, args.max_result_len, args.min_tools)
            if not samples:
                continue

            for sample in samples:
                meta = sample.get("metadata", {})

                if args.only_real_steps and not meta.get("has_real_steps"):
                    continue

                if not args.include_rebuilt and not meta.get("has_real_steps"):
                    continue

                f.write(json.dumps(sample, ensure_ascii=False) + "\n")
                total_samples += 1
                total_tool_calls += meta.get("num_tools", 0)

                if meta.get("has_real_steps"):
                    real_steps_count += 1
                else:
                    rebuilt_steps_count += 1

                for tn in meta.get("tool_names", []):
                    tool_name_stats[tn] = tool_name_stats.get(tn, 0) + 1

    print(f"\n=== Export Summary ===")
    print(f"Format: {args.format}")
    print(f"Output: {output_path}")
    print(f"Total samples: {total_samples}")
    print(f"  With real steps: {real_steps_count}")
    print(f"  With rebuilt steps: {rebuilt_steps_count}")
    print(f"Total tool calls: {total_tool_calls}")
    print(f"Max result length: {args.max_result_len}")

    if tool_name_stats:
        print(f"\nTool distribution:")
        for name, count in sorted(tool_name_stats.items(), key=lambda x: -x[1]):
            print(f"  {name}: {count}")

    has_args = sum(1 for _ in open(output_path, encoding="utf-8")
                   if '"has_args": true' in _)
    print(f"\nSamples with tool arguments: {has_args}/{total_samples}")
    if has_args < total_samples:
        print("  (Old data lacks args. New sessions after code update will have them.)")

    # File size
    size_mb = output_path.stat().st_size / 1024 / 1024
    print(f"\nFile size: {size_mb:.2f} MB")


if __name__ == "__main__":
    main()
