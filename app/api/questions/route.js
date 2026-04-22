import { Client } from '@notionhq/client'
import { NextResponse } from 'next/server'

const notion = new Client({ auth: process.env.NOTION_API_KEY })
const databaseId = process.env.NOTION_DATABASE_ID

const NOTION_TEXT_CHUNK = 2000

function richText(content) {
  const s = String(content ?? '')
  if (!s) return [{ text: { content: '' } }]
  const chunks = []
  for (let i = 0; i < s.length; i += NOTION_TEXT_CHUNK) {
    chunks.push({ text: { content: s.slice(i, i + NOTION_TEXT_CHUNK) } })
  }
  return chunks
}

export async function GET() {
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    })

    const join = (rt) => (rt || []).map((t) => t.plain_text || '').join('')
    const questions = response.results.map((page) => {
      const p = page.properties
      return {
        id: page.id,
        created: page.created_time,
        title: p['题目标题']?.title?.[0]?.plain_text || '',
        level: p['难度等级']?.select?.name || '',
        domain: p['领域大类']?.select?.name || '',
        subdomain: join(p['领域小类']?.rich_text),
        question: join(p['题目正文']?.rich_text),
        rubrics: [1,2,3,4,5].map(i => ({
          desc: join(p[`采分点${i}-描述`]?.rich_text),
          score: p[`采分点${i}-分值`]?.number || 0,
        })).filter(r => r.desc),
        source: p['题目来源']?.select?.name || '',
        sourceDetail: join(p['来源详情']?.rich_text),
        author: join(p['出题人姓名']?.rich_text),
        institution: join(p['出题人单位']?.rich_text),
        email: p['出题人邮箱']?.email || '',
      }
    })

    return NextResponse.json({ questions, total: response.results.length })
  } catch (error) {
    console.error('Notion query error:', error)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const data = await request.json()

    const properties = {
      '题目标题': { title: [{ text: { content: String(data.title || '').slice(0, NOTION_TEXT_CHUNK) } }] },
      '难度等级': { select: { name: data.level } },
      '领域大类': { select: { name: data.domain } },
      '领域小类': { rich_text: richText(data.subdomain) },
      '题目正文': { rich_text: richText(data.question) },
      '题目来源': { select: { name: data.source } },
      '来源详情': { rich_text: richText(data.sourceDetail) },
      '出题人姓名': { rich_text: richText(data.author) },
      '出题人单位': { rich_text: richText(data.institution) },
      '出题人邮箱': { email: data.email ? String(data.email).trim() || null : null },
    }

    // Add rubric points
    data.rubrics.forEach((r, i) => {
      if (i < 5 && r.desc) {
        properties[`采分点${i + 1}-描述`] = { rich_text: richText(r.desc) }
        properties[`采分点${i + 1}-分值`] = { number: Number(r.score) || 0 }
      }
    })

    await notion.pages.create({
      parent: { database_id: databaseId },
      properties,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Notion create error:', error)
    return NextResponse.json({ error: 'Failed to submit question' }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    const data = await request.json()
    if (!data.id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const properties = {
      '题目标题': { title: [{ text: { content: String(data.title || '').slice(0, NOTION_TEXT_CHUNK) } }] },
      '难度等级': { select: { name: data.level } },
      '领域大类': { select: { name: data.domain } },
      '领域小类': { rich_text: richText(data.subdomain) },
      '题目正文': { rich_text: richText(data.question) },
      '题目来源': { select: { name: data.source } },
      '来源详情': { rich_text: richText(data.sourceDetail) },
      '出题人姓名': { rich_text: richText(data.author) },
      '出题人单位': { rich_text: richText(data.institution) },
      '出题人邮箱': { email: data.email ? String(data.email).trim() || null : null },
    }

    for (let i = 0; i < 5; i++) {
      const r = data.rubrics?.[i]
      if (r && r.desc) {
        properties[`采分点${i + 1}-描述`] = { rich_text: richText(r.desc) }
        properties[`采分点${i + 1}-分值`] = { number: Number(r.score) || 0 }
      } else {
        properties[`采分点${i + 1}-描述`] = { rich_text: [] }
        properties[`采分点${i + 1}-分值`] = { number: null }
      }
    }

    await notion.pages.update({ page_id: data.id, properties })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Notion update error:', error)
    return NextResponse.json({ error: 'Failed to update question' }, { status: 500 })
  }
}
