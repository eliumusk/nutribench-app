# NutriBench 题目提交平台 — 部署指南

## 三步部署

### 第一步：创建 Notion Integration（获取 API Key）

1. 打开 https://www.notion.so/my-integrations
2. 点击「新建集成」
3. 名称填 `NutriBench`，选择你的 workspace
4. 创建后复制 `Internal Integration Secret`（以 `ntn_` 开头）
5. 回到 Notion，打开 NutriBench 题目提交数据库所在的页面
6. 点右上角 `⋯` → `连接` → 搜索 `NutriBench` → 确认

### 第二步：推送到 GitHub

```bash
# 解压项目
tar xzf nutribench-app.tar.gz
cd nutribench-app

# 初始化 Git
git init
git add .
git commit -m "NutriBench submission platform"

# 推送到你的 GitHub（先在 GitHub 上建一个空仓库）
git remote add origin https://github.com/YOUR_USERNAME/nutribench-app.git
git push -u origin main
```

### 第三步：在 Vercel 上部署

1. 打开 https://vercel.com/new
2. 导入刚才推送的 GitHub 仓库
3. 在部署设置中添加两个环境变量：

| 变量名 | 值 |
|--------|-----|
| `NOTION_API_KEY` | 第一步获取的 `ntn_xxx...` |
| `NOTION_DATABASE_ID` | `e755b041d920410fa6dd3aa88c421879` |

4. 点击 Deploy

部署完成后你会得到一个 `xxx.vercel.app` 链接，把这个链接发给所有出题团队就行。

## 它是怎么工作的

```
专家打开网站 → 填表单 → 点提交
                          ↓
              网站后端调 Notion API
                          ↓
              数据写入你的 Notion 数据库
                          ↓
              你在 Notion 里管理所有题目
```

## 技术栈

- Next.js 14 (React)
- Notion API (@notionhq/client)
- Vercel (部署)
