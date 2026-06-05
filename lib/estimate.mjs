// 估分纯逻辑：阈值分档、采分点汇总、裁判输出 JSON 容错解析。
// 不含网络调用与密钥，方便单测。被 app/api/estimate/route.js 与测试共用。

// 强模型得分率达到该值即提示「题目可能偏简单」
export const TOO_SIMPLE_THRESHOLD = 80
// 中等区分度下限
export const MODERATE_THRESHOLD = 60

// 根据得分率(0~100)给出难度档位：too_simple / moderate / good
export function tierFor(percent) {
  const p = Number(percent) || 0
  if (p >= TOO_SIMPLE_THRESHOLD) return 'too_simple'
  if (p >= MODERATE_THRESHOLD) return 'moderate'
  return 'good'
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

// 把裁判返回的逐条 awarded 归一化、夹紧到 [0, max]，并汇总出总分与得分率。
// rubrics: [{ desc, score }]  items: [{ index, awarded, reason }]
export function summarizeScores(rubrics, items) {
  const byIndex = new Map()
  for (const it of items || []) {
    const idx = Number(it?.index)
    if (Number.isInteger(idx)) byIndex.set(idx, it)
  }
  const perRubric = (rubrics || []).map((r, i) => {
    const max = Number(r?.score) || 0
    const it = byIndex.get(i)
    const awarded = clamp(it ? Number(it.awarded) : 0, 0, max)
    return {
      index: i,
      max,
      awarded,
      reason: it ? String(it.reason ?? '').slice(0, 120) : '',
    }
  })
  const earned = perRubric.reduce((s, r) => s + r.awarded, 0)
  const max = perRubric.reduce((s, r) => s + r.max, 0)
  const percent = max > 0 ? (earned / max) * 100 : 0
  return { perRubric, earned, max, percent }
}

// 从模型输出里抽出第一个/最后一个完整 JSON 对象，容忍 <think> 块与 ```json 围栏。
export function extractJson(text) {
  if (!text) throw new Error('empty text')
  const cleaned = String(text).replace(/<think>[\s\S]*?<\/think>/g, '')

  try { return JSON.parse(cleaned) } catch {}

  const fence = cleaned.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (fence) {
    try { return JSON.parse(fence[1]) } catch {}
  }

  // 扫描所有顶层平衡花括号片段，取最后一个能解析的（避免误命中 think 块里的伪 JSON）
  const candidates = []
  let depth = 0
  let start = -1
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (c === '{') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        candidates.push(cleaned.slice(start, i + 1))
        start = -1
      }
    }
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    try { return JSON.parse(candidates[i]) } catch {}
  }
  throw new Error(`no json in text: ${String(text).slice(0, 200)}`)
}
