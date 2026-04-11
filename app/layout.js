import './globals.css'

export const metadata = {
  title: 'NutriBench 题目提交',
  description: '营养科学 AI Agent 评测基准 — 题目提交平台',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
