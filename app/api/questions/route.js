import { Client } from '@notionhq/client'
import { NextResponse } from 'next/server'

const notion = new Client({ auth: process.env.NOTION_API_KEY })
const databaseId = process.env.NOTION_DATABASE_ID

export async function GET() {
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    })

    const questions = response.results.map((page) => {
      const p = page.properties
      return {
        id: page.id,
        created: page.created_time,
        title: p['题目标题']?.title?.[0]?.plain_text || '',
        level: p['难度等级']?.select?.name || '',
        domain: p['领域大类']?.select?.name || '',
        subdomain: p['领域小类']?.rich_text?.[0]?.plain_text || '',
        question: p['题目正文']?.rich_text?.[0]?.plain_text || '',
        rubrics: [1,2,3,4,5].map(i => ({
          desc: p[`采分点${i}-描述`]?.rich_text?.[0]?.plain_text || '',
          score: p[`采分点${i}-分值`]?.number || 0,
        })).filter(r => r.desc),
        answer: p['参考答案']?.rich_text?.[0]?.plain_text || '',
        source: p['题目来源']?.select?.name || '',
        sourceDetail: p['来源详情']?.rich_text?.[0]?.plain_text || '',
        author: p['出题人姓名']?.rich_text?.[0]?.plain_text || '',
        institution: p['出题人单位']?.rich_text?.[0]?.plain_text || '',
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
      '题目标题': { title: [{ text: { content: data.title } }] },
      '难度等级': { select: { name: data.level } },
      '领域大类': { select: { name: data.domain } },
      '领域小类': { rich_text: [{ text: { content: data.subdomain } }] },
      '题目正文': { rich_text: [{ text: { content: data.question } }] },
      '参考答案': { rich_text: [{ text: { content: data.answer || '' } }] },
      '题目来源': { select: { name: data.source } },
      '来源详情': { rich_text: [{ text: { content: data.sourceDetail || '' } }] },
      '出题人姓名': { rich_text: [{ text: { content: data.author } }] },
      '出题人单位': { rich_text: [{ text: { content: data.institution } }] },
      '出题人邮箱': { email: data.email },
    }

    // Add rubric points
    data.rubrics.forEach((r, i) => {
      if (i < 5 && r.desc) {
        properties[`采分点${i + 1}-描述`] = { rich_text: [{ text: { content: r.desc } }] }
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
