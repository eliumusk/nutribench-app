import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { tierFor, summarizeScores, extractJson, TOO_SIMPLE_THRESHOLD } from '../lib/estimate.mjs'

test('tierFor flags >= 80% as too simple, with correct boundaries', () => {
  assert.equal(TOO_SIMPLE_THRESHOLD, 80)
  assert.equal(tierFor(100), 'too_simple')
  assert.equal(tierFor(80), 'too_simple')
  assert.equal(tierFor(79.9), 'moderate')
  assert.equal(tierFor(60), 'moderate')
  assert.equal(tierFor(59.9), 'good')
  assert.equal(tierFor(0), 'good')
})

test('summarizeScores clamps awarded into [0, max] and totals correctly', () => {
  const rubrics = [{ desc: 'a', score: 5 }, { desc: 'b', score: 5 }]
  const { perRubric, earned, max, percent } = summarizeScores(rubrics, [
    { index: 0, awarded: 5, reason: 'ok' },
    { index: 1, awarded: 8, reason: 'over -> clamp to 5' },
  ])
  assert.equal(max, 10)
  assert.equal(earned, 10)
  assert.equal(percent, 100)
  assert.equal(perRubric[1].awarded, 5) // clamped from 8
})

test('summarizeScores treats missing / negative / NaN awarded as 0', () => {
  const rubrics = [{ desc: 'a', score: 4 }, { desc: 'b', score: 6 }]
  const { earned, percent } = summarizeScores(rubrics, [
    { index: 0, awarded: -3 },          // negative -> 0
    { index: 1, awarded: 'oops' },      // NaN -> 0
    // index for second rubric effectively missing a valid number
  ])
  assert.equal(earned, 0)
  assert.equal(percent, 0)
})

test('summarizeScores avoids divide-by-zero when no rubric scores', () => {
  const { percent, max } = summarizeScores([{ desc: 'x', score: 0 }], [{ index: 0, awarded: 0 }])
  assert.equal(max, 0)
  assert.equal(percent, 0)
})

test('extractJson parses plain, fenced, think-wrapped, and trailing-prose output', () => {
  assert.deepEqual(extractJson('{"items":[{"index":0,"awarded":2}]}').items[0].awarded, 2)
  assert.deepEqual(extractJson('```json\n{"items":[]}\n```').items, [])
  assert.deepEqual(extractJson('<think>let me think {"fake":1}</think>\n{"items":[1]}').items, [1])
  assert.equal(extractJson('好的，结果如下：\n{"items":[{"index":0,"awarded":3}]}\n谢谢').items[0].awarded, 3)
})

test('estimate API route does the two-step answer+judge against gpt-5.4', () => {
  const route = readFileSync(new URL('../app/api/estimate/route.js', import.meta.url), 'utf8')
  assert.match(route, /ANSWER_MODEL/)
  assert.match(route, /JUDGE_MODEL/)
  assert.match(route, /deepseek-v4-flash/)   // 答题与评分都用 flash（Vercel 60s 内不超时）
  assert.match(route, /advice/)              // 评分附带一句简短建议
  assert.match(route, /ANSWER_SYSTEM/)
  assert.match(route, /JUDGE_SYSTEM/)
  assert.match(route, /summarizeScores/)
  assert.match(route, /tierFor/)
  assert.match(route, /export async function POST/)
})

test('submit page wires the estimate button and panel', () => {
  const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8')
  assert.match(page, /handleEstimate/)
  assert.match(page, /\/api\/estimate/)
  assert.match(page, /EstimatePanel/)
  assert.match(page, /难度自检/)
})
