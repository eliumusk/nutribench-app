import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8')
const route = readFileSync(new URL('../app/api/questions/route.js', import.meta.url), 'utf8')

test('frontend rubric controls allow up to 10 scoring points', () => {
  assert.match(page, /const MAX_RUBRIC_COUNT = 10\b/)
  assert.match(page, /form\.rubrics\.length < MAX_RUBRIC_COUNT/)
  assert.match(page, /最多 \{MAX_RUBRIC_COUNT\} 个/)
})

test('questions API reads and writes up to 10 rubric fields', () => {
  assert.match(route, /const MAX_RUBRICS = 10\b/)
  assert.doesNotMatch(route, /\[\s*1\s*,\s*2\s*,\s*3\s*,\s*4\s*,\s*5\s*\]/)
  assert.doesNotMatch(route, /i < 5\b/)
})
