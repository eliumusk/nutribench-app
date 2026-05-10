"""
NutriBench 自动评测管线。

运行示例：
  EVAL_VERSION=v3 AGENT_CONCURRENCY=3 JUDGE_CONCURRENCY=3 python eval_pipeline.py
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from typing import Any, Callable

import dotenv
from notion_client import Client as NotionClient
from openai import AsyncOpenAI


dotenv.load_dotenv(".env.local")
dotenv.load_dotenv()


# ===== 配置 =====

QUESTION_DB_ID = os.getenv("QUESTION_DB_ID") or os.getenv("NOTION_DATABASE_ID", "e755b041d920410fa6dd3aa88c421879")
RESULT_DB_ID = os.getenv("RESULT_DB_ID", "c7b1b42c0ac14b5f883725f75860860e")

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.gpugeek.com/v1")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

JUDGE_MODEL = os.getenv("JUDGE_MODEL", "Vendor2/Gemini-3.1-pro")
EVAL_VERSION = os.getenv("EVAL_VERSION", "v3")

NUM_RUNS = int(os.getenv("NUM_RUNS", "1"))
MAX_RUBRICS = int(os.getenv("MAX_RUBRICS", "5"))
AGENT_CONCURRENCY = int(os.getenv("AGENT_CONCURRENCY", "3"))
JUDGE_CONCURRENCY = int(os.getenv("JUDGE_CONCURRENCY", "3"))
NOTION_CONCURRENCY = int(os.getenv("NOTION_CONCURRENCY", "3"))

NOTION_TEXT_CHUNK = 2000
NOTION_MAX_RICH_TEXT_BLOCKS = 100


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"缺少环境变量 {name}")
    return value


NOTION_API_KEY = require_env("NOTION_API_KEY")
LLM_API_KEY = require_env("LLM_API_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")


AGENT_MODELS = [
    {
        "id": "Vendor2/Claude-4.5-Sonnet",
        "short": "Claude-4.5-Sonnet@gpugeek",
        "base_url": LLM_BASE_URL,
        "api_key": LLM_API_KEY,
    },
    {
        "id": "Vendor2/GPT-5.4",
        "short": "GPT-5.4@gpugeek",
        "base_url": LLM_BASE_URL,
        "api_key": LLM_API_KEY,
    },
]

if OPENROUTER_API_KEY:
    AGENT_MODELS.append(
        {
            "id": "anthropic/claude-sonnet-4.5",
            "short": "Claude-4.5-Sonnet@openrouter",
            "base_url": OPENROUTER_BASE_URL,
            "api_key": OPENROUTER_API_KEY,
        }
    )
else:
    print("WARN: OPENROUTER_API_KEY 未设置，跳过 OpenRouter 对比模型")


notion = NotionClient(auth=NOTION_API_KEY)
judge_client = AsyncOpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)
agent_clients: dict[str, AsyncOpenAI] = {}


# ===== Notion 读写 =====

def resolve_data_source_id(database_id: str) -> str:
    db = notion.databases.retrieve(database_id=database_id)
    sources = db.get("data_sources") or []
    if not sources:
        raise RuntimeError(f"数据库 {database_id} 没有 data_source")
    return sources[0]["id"]


def fetch_questions() -> list[dict[str, Any]]:
    questions = []
    data_source_id = resolve_data_source_id(QUESTION_DB_ID)
    start_cursor = None

    while True:
        kwargs: dict[str, Any] = {"data_source_id": data_source_id, "page_size": 100}
        if start_cursor:
            kwargs["start_cursor"] = start_cursor

        response = notion.data_sources.query(**kwargs)
        for page in response["results"]:
            question = parse_question(page)
            if question["正文"]:
                questions.append(question)

        if not response.get("has_more"):
            break
        start_cursor = response.get("next_cursor")

    print(f"读取题目: {len(questions)} 道")
    return questions


def parse_question(page: dict[str, Any]) -> dict[str, Any]:
    props = page["properties"]
    rubrics = []

    for i in range(1, MAX_RUBRICS + 1):
        desc = get_text(props, f"采分点{i}-描述")
        score = props.get(f"采分点{i}-分值", {}).get("number")
        if desc:
            rubrics.append({"描述": desc, "满分": float(score or 0)})

    return {
        "page_id": page["id"],
        "编号": props.get("题目编号", {}).get("unique_id", {}).get("number", 0),
        "标题": get_title(props, "题目标题"),
        "正文": get_text(props, "题目正文"),
        "难度": get_select(props, "难度等级"),
        "领域": get_select(props, "领域大类"),
        "小类": get_text(props, "领域小类"),
        "参考答案": get_text(props, "参考答案"),
        "采分点": rubrics,
    }


def write_result(question: dict[str, Any], agent_name: str, run: int, agent_output: str, judge: dict[str, Any]) -> None:
    scores = judge["scores"]
    max_total = sum(r["满分"] for r in question["采分点"])
    total = round(sum(scores), 4)
    rate = round(total / max_total, 4) if max_total else 0

    properties: dict[str, Any] = {
        "Name": title_prop(f"{EVAL_VERSION}|NB-{question['编号']}|{agent_name}|Run{run}"),
        "题目编号": {"number": question["编号"]},
        "题目标题": rich_text_prop(question["标题"]),
        "Agent名称": select_prop(agent_name),
        "运行轮次": select_prop(f"Run{run}"),
        "版本": rich_text_prop(EVAL_VERSION),
        "Agent原始输出": rich_text_prop(agent_output),
        "总分": {"number": total},
        "满分": {"number": max_total},
        "得分率": {"number": rate},
        "评分模型": select_prop(short_model_name(JUDGE_MODEL)),
        "评分原始输出": rich_text_prop(judge["reasoning"]),
    }
    if question["难度"]:
        properties["难度等级"] = select_prop(question["难度"])
    if question["领域"]:
        properties["领域大类"] = select_prop(question["领域"])

    for i, score in enumerate(scores[:MAX_RUBRICS], start=1):
        properties[f"采分点{i}-得分"] = {"number": score}

    retry_sync(
        lambda: notion.pages.create(parent={"database_id": RESULT_DB_ID}, properties=properties),
        label="Notion 写入",
    )


# ===== LLM 调用 =====

def agent_client(model: dict[str, str]) -> AsyncOpenAI:
    key = model["short"]
    if key not in agent_clients:
        agent_clients[key] = AsyncOpenAI(base_url=model["base_url"], api_key=model["api_key"])
    return agent_clients[key]


async def call_agent(model: dict[str, str], question_text: str) -> dict[str, Any]:
    try:
        response = await retry_async(
            lambda: agent_client(model).chat.completions.create(
                model=model["id"],
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是一个植物营养科学领域的专家级AI助手。"
                            "请根据你的知识，尽可能全面、准确、有理有据地回答以下问题。"
                            "如果涉及基因、通路、文献，请提供具体的标识符（如Gene ID、KEGG编号、PMID等）。"
                        ),
                    },
                    {"role": "user", "content": question_text},
                ],
                max_tokens=16384,
                temperature=0.3,
            ),
            label=f"Agent {model['short']}",
        )
        output = response.choices[0].message.content or ""
        if not output.strip():
            return {"ok": False, "error": "Agent 返回空内容", "output": ""}
        return {"ok": True, "output": output}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "output": ""}


async def call_judge(question: dict[str, Any], agent_output: str) -> dict[str, Any]:
    try:
        prompt = build_judge_prompt(question, agent_output)
        response = await retry_async(
            lambda: judge_client.chat.completions.create(
                model=JUDGE_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=16384,
                temperature=0.1,
            ),
            label="Judge",
        )
        raw = (response.choices[0].message.content or "").strip()
        scores, reasoning = parse_judge_scores(raw, question["采分点"])
        return {"ok": True, "scores": scores, "reasoning": reasoning, "raw": raw}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "scores": [], "reasoning": "", "raw": ""}


def build_judge_prompt(question: dict[str, Any], agent_output: str) -> str:
    rubrics = question["采分点"]
    max_total = sum(r["满分"] for r in rubrics)
    rubric_lines = "\n".join(
        f"{i}. ({r['满分']} points) {r['描述']}"
        for i, r in enumerate(rubrics, start=1)
    )
    reference = question.get("参考答案", "")
    ref_section = f"\n***\n\nThe reference answer:\n{reference}\n" if reference else ""

    return f"""You are grading a 植物营养科学 (plant nutrition science) exam answer written in Chinese.

You will be given the problem, a reference answer, a rubric, and the student's attempted answer. The rubric has {len(rubrics)} item(s) and totals up to {max_total} points.

Evaluate the attempted answer against the provided rubric. Pay close attention to detail and grade it strictly, but fairly. Only evaluate against the rubric. Per-item scores can be decimals. Give 0 if the item is not addressed, partial credit if partially addressed, full marks only if fully addressed per the rubric description. If the answer cites non-existent papers, gene IDs, or database entries, deduct on the traceability-related item(s).

***

The problem:
{question["正文"]}
{ref_section}
***

The rubric:
{rubric_lines}

***

The attempted answer:
{agent_output}

***

Explain your reasoning for each rubric item.

Then, on the LAST TWO LINES of your response, output EXACTLY this format and nothing else after them:
SCORES: [<num>, <num>, ...]
VERDICT: <total>"""


def parse_judge_scores(raw: str, rubrics: list[dict[str, Any]]) -> tuple[list[float], str]:
    match = re.search(r"^SCORES\s*:\s*\[([^\]]*)\]\s*$", raw, flags=re.MULTILINE)
    if not match:
        raise ValueError("Judge 输出缺少 SCORES 行")

    numbers = re.findall(r"-?\d+(?:\.\d+)?", match.group(1))
    if len(numbers) != len(rubrics):
        raise ValueError(f"Judge 返回 {len(numbers)} 个分数，期望 {len(rubrics)} 个")

    scores = []
    for number, rubric in zip(numbers, rubrics):
        score = float(number)
        scores.append(min(max(score, 0.0), float(rubric["满分"])))
    return scores, raw[: match.start()].strip()


# ===== 主流程 =====

async def process_one(
    question: dict[str, Any],
    model: dict[str, str],
    run: int,
    agent_sem: asyncio.Semaphore,
    judge_sem: asyncio.Semaphore,
    notion_sem: asyncio.Semaphore,
) -> dict[str, Any]:
    base = {"question": question["编号"], "agent": model["short"], "run": run}
    max_total = sum(r["满分"] for r in question["采分点"])

    if not question["采分点"] or max_total <= 0:
        return {**base, "ok": False, "error": "题目缺少有效采分点"}

    async with agent_sem:
        agent = await call_agent(model, question["正文"])
    if not agent["ok"]:
        return {**base, "ok": False, "error": f"Agent 调用失败: {agent['error']}"}

    async with judge_sem:
        judge = await call_judge(question, agent["output"])
    if not judge["ok"]:
        return {**base, "ok": False, "error": f"Judge 评分失败: {judge['error']}"}

    try:
        async with notion_sem:
            await asyncio.to_thread(write_result, question, model["short"], run, agent["output"], judge)
    except Exception as exc:
        return {**base, "ok": False, "error": f"Notion 写入失败: {exc}"}

    return {**base, "ok": True, "score": sum(judge["scores"]), "max_score": max_total}


async def run_evaluation() -> None:
    print("=" * 60)
    print("NutriBench 自动评测管线")
    print("=" * 60)

    questions = fetch_questions()
    if not questions:
        print("没有找到任何题目，请检查 Notion 数据库")
        return

    total = len(questions) * len(AGENT_MODELS) * NUM_RUNS
    print(f"版本: {EVAL_VERSION}")
    print(f"计划评测: {len(questions)} 题 x {len(AGENT_MODELS)} 模型 x {NUM_RUNS} 轮 = {total} 次")
    print(f"并发: agent={AGENT_CONCURRENCY}, judge={JUDGE_CONCURRENCY}, notion={NOTION_CONCURRENCY}")
    print()

    agent_sem = asyncio.Semaphore(AGENT_CONCURRENCY)
    judge_sem = asyncio.Semaphore(JUDGE_CONCURRENCY)
    notion_sem = asyncio.Semaphore(NOTION_CONCURRENCY)
    tasks = [
        process_one(q, model, run, agent_sem, judge_sem, notion_sem)
        for q in questions
        for model in AGENT_MODELS
        for run in range(1, NUM_RUNS + 1)
    ]

    ok = failed = 0
    for i, future in enumerate(asyncio.as_completed(tasks), start=1):
        result = await future
        prefix = f"[{i}/{total}] NB-{result['question']} {result['agent']} Run{result['run']}"
        if result["ok"]:
            ok += 1
            print(f"{prefix} OK {result['score']:.4g}/{result['max_score']:.4g}")
        else:
            failed += 1
            print(f"{prefix} FAIL {result['error']}")

    print("=" * 60)
    print(f"完成: 成功 {ok} 条，失败 {failed} 条")
    print(f"结果库: https://www.notion.so/{RESULT_DB_ID.replace('-', '')}")
    print("=" * 60)


# ===== 小工具 =====

async def retry_async(fn: Callable[[], Any], label: str, attempts: int = 3) -> Any:
    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            return await fn()
        except Exception as exc:
            last_error = exc
            if attempt < attempts:
                await asyncio.sleep(2 ** (attempt - 1))
    raise RuntimeError(f"{label} 重试 {attempts} 次失败: {last_error}")


def retry_sync(fn: Callable[[], Any], label: str, attempts: int = 3) -> Any:
    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:
            last_error = exc
            if attempt < attempts:
                time.sleep(2 ** (attempt - 1))
    raise RuntimeError(f"{label} 重试 {attempts} 次失败: {last_error}")


def get_text(props: dict[str, Any], key: str) -> str:
    return "".join(item.get("plain_text", "") for item in props.get(key, {}).get("rich_text", []))


def get_title(props: dict[str, Any], key: str) -> str:
    return "".join(item.get("plain_text", "") for item in props.get(key, {}).get("title", []))


def get_select(props: dict[str, Any], key: str) -> str:
    selected = props.get(key, {}).get("select")
    return selected["name"] if selected else ""


def chunks(text: Any) -> list[dict[str, Any]]:
    value = str(text or "")
    if not value:
        return [{"text": {"content": ""}}]

    pieces = [value[i : i + NOTION_TEXT_CHUNK] for i in range(0, len(value), NOTION_TEXT_CHUNK)]
    if len(pieces) > NOTION_MAX_RICH_TEXT_BLOCKS:
        pieces = pieces[:NOTION_MAX_RICH_TEXT_BLOCKS]
        pieces[-1] = pieces[-1][:1900] + "\n\n[TRUNCATED]"
    return [{"text": {"content": piece}} for piece in pieces]


def rich_text_prop(text: Any) -> dict[str, Any]:
    return {"rich_text": chunks(text)}


def title_prop(text: str) -> dict[str, Any]:
    return {"title": chunks(str(text)[:NOTION_TEXT_CHUNK])}


def select_prop(name: str) -> dict[str, Any]:
    return {"select": {"name": name}}


def short_model_name(model: str) -> str:
    return {
        "Vendor2/Claude-4.5-Sonnet": "Claude-4.5-Sonnet",
        "Vendor2/GPT-5.4": "GPT-5.4",
        "Vendor2/Gemini-3.1-pro": "Gemini-3.1-pro",
    }.get(model, model.split("/")[-1])


async def close_clients() -> None:
    await judge_client.close()
    for client in agent_clients.values():
        await client.close()


async def main() -> None:
    try:
        await run_evaluation()
    finally:
        await close_clients()


if __name__ == "__main__":
    asyncio.run(main())
