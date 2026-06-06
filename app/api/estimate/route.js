import { NextResponse } from 'next/server'
import { summarizeScores, tierFor, extractJson } from '../../../lib/estimate.mjs'

// 两步 LLM 调用可能较慢，给足执行时间（Vercel Hobby 上限 60s，Pro 可调更高）。
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const BASE_URL = process.env.ESTIMATE_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'http://43.159.131.233:3001/v1'
const API_KEY = process.env.ESTIMATE_API_KEY || process.env.DEEPSEEK_API_KEY || ''
// 答题与评分都用 deepseek-v4-flash：实测唯一能在 Vercel 60s 内不超时的（答题约 18s）；
// gpt-5.x / deepseek-*-thinking 这类推理模型答一道复杂题要 90s+，必被 Vercel 掐断。
const ANSWER_MODEL = process.env.ESTIMATE_ANSWER_MODEL || process.env.ESTIMATE_MODEL || 'deepseek-v4-flash'
const JUDGE_MODEL = process.env.ESTIMATE_JUDGE_MODEL || 'deepseek-v4-flash'
// 第三步"针对性建议"模型：默认同评分模型
const ADVICE_MODEL = process.env.ESTIMATE_ADVICE_MODEL || JUDGE_MODEL

// 给足额度避免答案/评分被截断（曾导致答案为空 → 后面采分点全 0 → 误判低分）
const ANSWER_MAX_TOKENS = 8000
const JUDGE_MAX_TOKENS = 4000
const ADVICE_MAX_TOKENS = 300
const REQ_TIMEOUT_MS = 55000

// 与线下评测 (run_eval.py / rejudge.py) 保持同一套提示词，保证估分口径一致。
const ANSWER_SYSTEM =
  '你是一位资深领域专家，请认真、严谨、有条理地回答下面的问题。给出明确结论和必要的推理依据。'

const JUDGE_SYSTEM =
  '你是一名严格、公正的考试阅卷老师。你的任务是根据给定的采分点(rubric)对一份学生答案打分。' +
  '每条采分点会标注满分(max_score)，你要根据答案对该采分点的覆盖程度，给出一个 0 到 max_score 之间的整数或一位小数。' +
  '评分原则：完全且正确地命中该点给满分；部分命中给相应比例；完全没有命中或错误给 0。' +
  '重要：仅输出严格合法的 JSON，不要输出任何 <think>、解释、Markdown 围栏或额外文字。'

function judgePrompt(question, answer, rubricJson) {
  return `题目:
"""
${question}
"""

学生答案:
"""
${answer}
"""

采分点 (rubric)，每条 desc 即为该点的权威关键事实/评分标准:
${rubricJson}

请按以下 JSON 模式输出，对每条采分点给出 awarded 分数(0~max_score)和简短 reason:
{
  "items": [
    {"index": 0, "awarded": <number>, "reason": "<=40字"}
  ]
}
只输出 JSON，不要 think 块、不要 Markdown 围栏。`
}

// 第三步：拿着「分数 + 题目」单独生成一句针对性建议（分数只用于生成建议，不返回前端）
const ADVICE_SYSTEM =
  '你是科研出题顾问。这是一个考察顶尖 AI 能力的评测基准，目标是题目要能难住最强的 AI——AI 得分越低，题目越有区分度、越好。' +
  '请根据 AI 试答的得分情况，给出题专家一句简短、礼貌、可操作的中文建议。'

function advicePrompt(question, rubrics, earned, max, percent, missed) {
  const rl = rubrics.map((r, i) => `${i + 1}. (${r.score}分) ${r.desc}`).join('\n')
  const missedStr = missed.length ? `AI 未完全答到的采分点：第 ${missed.join('、')} 点` : 'AI 几乎答到了全部采分点'
  return `题目:
"""
${question}
"""

采分点:
${rl}

AI 试答得分率约 ${percent.toFixed(0)}%（满分 ${max}，得 ${earned.toFixed(1)} 分）。${missedStr}。

请给出题专家一句话建议（中文，≤40字，口吻平和专业）：
- 若得分率偏高（说明这题对强 AI 太简单），请具体指出如何加难，例如要求更深的机制推理 / 定量数据 / 文献溯源，或补充更难命中的采分点。
- 若得分率中等或偏低，简单肯定其难度即可。
不要出现任何分数、百分比或数字。直接输出建议本身，不要解释、不要加引号。`
}

async function chat(messages, { model, maxTokens, temperature }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS)
  try {
    const res = await fetch(BASE_URL.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`)
    }
    const obj = await res.json()
    return obj?.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

export async function POST(request) {
  try {
    if (!API_KEY) {
      return NextResponse.json({ error: '估分服务未配置 API Key（缺少 ESTIMATE_API_KEY）' }, { status: 500 })
    }

    const data = await request.json()
    const question = String(data.question || '').trim()
    const rubrics = (data.rubrics || [])
      .filter((r) => r && String(r.desc || '').trim())
      .map((r) => ({ desc: String(r.desc), score: Number(r.score) || 0 }))

    if (!question) {
      return NextResponse.json({ error: '题目正文为空，无法估分' }, { status: 400 })
    }
    if (rubrics.length === 0) {
      return NextResponse.json({ error: '至少需要 1 个采分点才能估分' }, { status: 400 })
    }

    // 第一步：让答题模型以领域专家身份试答（只喂题面，保持与线下评测一致）
    const answer = await chat(
      [
        { role: 'system', content: ANSWER_SYSTEM },
        { role: 'user', content: question },
      ],
      { model: ANSWER_MODEL, maxTokens: ANSWER_MAX_TOKENS, temperature: 0.2 }
    )

    if (!answer || !answer.trim()) {
      return NextResponse.json({ error: '模型未返回作答内容，请重试' }, { status: 502 })
    }

    // 第二步：按采分点逐条自评
    const rubricForPrompt = rubrics.map((r, i) => ({ index: i, desc: r.desc, max_score: r.score }))
    const judgeRaw = await chat(
      [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: judgePrompt(question, answer, JSON.stringify(rubricForPrompt, null, 2)) },
      ],
      { model: JUDGE_MODEL, maxTokens: JUDGE_MAX_TOKENS, temperature: 0 }
    )

    const parsed = extractJson(judgeRaw)
    const { perRubric, earned, max, percent } = summarizeScores(rubrics, parsed.items || [])
    const tier = tierFor(percent)

    // 第三步：拿着分数 + 题目，单独生成一句针对性建议（得分高就引导专家加难）
    let advice = ''
    try {
      const missed = perRubric.filter((r) => r.awarded < r.max).map((r) => r.index + 1)
      const adviceRaw = await chat(
        [
          { role: 'system', content: ADVICE_SYSTEM },
          { role: 'user', content: advicePrompt(question, rubrics, earned, max, percent, missed) },
        ],
        { model: ADVICE_MODEL, maxTokens: ADVICE_MAX_TOKENS, temperature: 0.4 }
      )
      advice = String(adviceRaw || '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/^[\s"'「」]+|[\s"'「」]+$/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 80)
    } catch (e) {
      console.error('Advice step failed (non-fatal):', e) // 建议失败不致命，前端按 tier 兜底
    }

    // 分数只记到服务端日志；响应只回 tier + 一句建议，前端不展示任何分数
    console.log(`[estimate] ${ANSWER_MODEL}+${JUDGE_MODEL}+${ADVICE_MODEL} → ${percent.toFixed(0)}% ${tier} | ${advice}`)

    return NextResponse.json({ tier, advice })
  } catch (error) {
    const isTimeout = error?.name === 'AbortError'
    const msg = isTimeout ? '估分超时（模型响应过慢），请稍后重试' : `估分失败：${error?.message || error}`
    console.error('Estimate error:', error)
    return NextResponse.json({ error: msg }, { status: isTimeout ? 504 : 502 })
  }
}
