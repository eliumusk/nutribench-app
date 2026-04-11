'use client'
import { useState, useEffect } from 'react'

const LEVELS = ['L1 知识检索', 'L2 机制推理', 'L3 实验方案', 'L4 通路推测']
const DOMAINS = ['糖', '脂肪', '蛋白', '微量元素', '维生素', '天然产物']
const SOURCES = ['原创', '改编自论文/教材']
const LEVEL_BADGE = { 'L1 知识检索': 'badge-l1', 'L2 机制推理': 'badge-l2', 'L3 实验方案': 'badge-l3', 'L4 通路推测': 'badge-l4' }

const emptyForm = {
  title: '', level: '', domain: '', subdomain: '', question: '',
  rubrics: [{ desc: '', score: '' }, { desc: '', score: '' }, { desc: '', score: '' }],
  answer: '', source: '原创', sourceDetail: '', author: '', institution: '', email: '',
}

const DRAFT_KEY = 'nutribench-draft-v1'
const RUBRIC_TOTAL = 10

export default function Home() {
  const [tab, setTab] = useState('submit')
  const [form, setForm] = useState({ ...emptyForm })
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [questions, setQuestions] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    fetchQuestions()
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed === 'object') setForm({ ...emptyForm, ...parsed })
      }
    } catch {}
    setDraftLoaded(true)
  }, [])

  useEffect(() => {
    if (!draftLoaded) return
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)) } catch {}
  }, [form, draftLoaded])

  const rubricTotal = form.rubrics.reduce((s, r) => s + (Number(r.score) || 0), 0)

  async function fetchQuestions() {
    setLoading(true)
    try {
      const res = await fetch('/api/questions')
      const data = await res.json()
      setQuestions(data.questions || [])
      setTotal(data.total || 0)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function showToast(msg, error) {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 3000)
  }

  function updateForm(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function updateRubric(index, key, value) {
    setForm(f => {
      const rubrics = [...f.rubrics]
      rubrics[index] = { ...rubrics[index], [key]: value }
      return { ...f, rubrics }
    })
  }

  function addRubric() {
    if (form.rubrics.length < 5) {
      setForm(f => ({ ...f, rubrics: [...f.rubrics, { desc: '', score: '' }] }))
    }
  }

  function removeRubric(index) {
    if (form.rubrics.length > 3) {
      setForm(f => ({ ...f, rubrics: f.rubrics.filter((_, i) => i !== index) }))
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title || !form.level || !form.domain || !form.question || !form.author || !form.institution || !form.email) {
      showToast('请填写所有必填字段', true)
      return
    }
    if (form.rubrics.filter(r => r.desc).length < 3) {
      showToast('至少需要 3 个采分点', true)
      return
    }
    if (rubricTotal !== RUBRIC_TOTAL) {
      showToast(`采分点总分必须为 ${RUBRIC_TOTAL} 分（当前 ${rubricTotal} 分）`, true)
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        showToast('提交成功！')
        try { localStorage.removeItem(DRAFT_KEY) } catch {}
        setForm({ ...emptyForm })
        fetchQuestions()
        setTab('list')
      } else {
        showToast('提交失败，请重试', true)
      }
    } catch (e) {
      showToast('网络错误', true)
    }
    setSubmitting(false)
  }

  return (
    <div className="container">
      <div className="header">
        <h1>🧬 NutriBench 题目提交</h1>
        <p>营养科学领域 AI Agent 评测基准 — 面向全国科研团队的开放出题平台</p>
        <div className="stats">
          <div className="stat">已收集 <strong>{total}</strong> 道题</div>
          <div className="stat">目标 <strong>≥1000</strong> 道</div>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'submit' ? 'active' : ''}`} onClick={() => setTab('submit')}>
          提交题目
        </button>
        <button className={`tab ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>
          已提交 ({total})
        </button>
      </div>

      {tab === 'submit' && (
        <form onSubmit={handleSubmit}>
          <div className="form-section">
            <h3>题目信息</h3>
            <div className="field">
              <label>题目标题 <span className="required">*</span> <span className="hint">简明概括题目内容</span></label>
              <input value={form.title} onChange={e => updateForm('title', e.target.value)} placeholder="例：番茄类胡萝卜素 MEP 通路关键酶基因检索" />
            </div>
            <div className="row">
              <div className="field">
                <label>难度等级 <span className="required">*</span></label>
                <select value={form.level} onChange={e => updateForm('level', e.target.value)}>
                  <option value="">选择难度</option>
                  {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="field">
                <label>领域大类 <span className="required">*</span></label>
                <select value={form.domain} onChange={e => updateForm('domain', e.target.value)}>
                  <option value="">选择领域</option>
                  {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label>领域小类 <span className="hint">大类下的细分方向</span></label>
              <input value={form.subdomain} onChange={e => updateForm('subdomain', e.target.value)} placeholder="例：类胡萝卜素" />
            </div>
            <div className="field">
              <label>题目正文 <span className="required">*</span></label>
              <textarea value={form.question} onChange={e => updateForm('question', e.target.value)}
                placeholder="完整的题目描述，包括所有子问题和要求。&#10;&#10;例：请列出番茄中类胡萝卜素生物合成通路 (MEP pathway) 的关键酶基因，包括：&#10;(a) 每个基因的标准名称和 NCBI Gene ID&#10;(b) 该基因在通路中催化的具体反应步骤&#10;(c) 已知的转录因子调控关系&#10;&#10;要求：所有信息必须可追溯至具体文献或数据库条目。" />
            </div>
          </div>

          <div className="form-section">
            <h3 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>采分点 Rubric <span className="hint">（至少 3 个，最多 5 个，总分须为 {RUBRIC_TOTAL} 分）</span></span>
              <span style={{
                fontFamily: 'var(--mono)',
                fontSize: 13,
                padding: '4px 10px',
                borderRadius: 6,
                background: rubricTotal === RUBRIC_TOTAL ? 'var(--accent-light)' : '#fef2f2',
                color: rubricTotal === RUBRIC_TOTAL ? 'var(--accent)' : 'var(--danger)',
                border: `1px solid ${rubricTotal === RUBRIC_TOTAL ? 'var(--accent)' : 'var(--danger)'}`,
              }}>{rubricTotal} / {RUBRIC_TOTAL}</span>
            </h3>
            {form.rubrics.map((r, i) => (
              <div className="rubric-item" key={i}>
                <input value={r.desc} onChange={e => updateRubric(i, 'desc', e.target.value)}
                  placeholder={`采分点 ${i + 1} 的描述（需可判断，如"正确列出 ≥5 个关键酶基因"）`} />
                <input type="number" value={r.score} onChange={e => updateRubric(i, 'score', e.target.value)}
                  placeholder="分值" min="0" max="10" />
                <button type="button" className="btn-remove" onClick={() => removeRubric(i)}
                  disabled={form.rubrics.length <= 3}>×</button>
              </div>
            ))}
            {form.rubrics.length < 5 && (
              <button type="button" className="btn-add" onClick={addRubric}>+ 添加采分点</button>
            )}
          </div>

          <div className="form-section">
            <h3>参考答案</h3>
            <div className="field">
              <label>参考答案 <span className="hint">L1-L2 必填，L3-L4 强烈建议</span></label>
              <textarea value={form.answer} onChange={e => updateForm('answer', e.target.value)}
                placeholder="专家级别的完整参考答案" style={{ minHeight: '160px' }} />
            </div>
          </div>

          <div className="form-section">
            <h3>来源与出题人</h3>
            <div className="row">
              <div className="field">
                <label>题目来源 <span className="required">*</span></label>
                <select value={form.source} onChange={e => updateForm('source', e.target.value)}>
                  {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label>来源详情 <span className="hint">改编时填写论文 DOI 或教材章节</span></label>
                <input value={form.sourceDetail} onChange={e => updateForm('sourceDetail', e.target.value)}
                  placeholder="例：doi:10.1038/s41586-024-xxxxx" />
              </div>
            </div>
            <div className="row-3">
              <div className="field">
                <label>出题人姓名 <span className="required">*</span></label>
                <input value={form.author} onChange={e => updateForm('author', e.target.value)} />
              </div>
              <div className="field">
                <label>出题人单位 <span className="required">*</span></label>
                <input value={form.institution} onChange={e => updateForm('institution', e.target.value)} />
              </div>
              <div className="field">
                <label>出题人邮箱 <span className="required">*</span></label>
                <input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)} />
              </div>
            </div>
          </div>

          <button type="submit" className="btn-submit" disabled={submitting}>
            {submitting ? '提交中...' : '提交题目'}
          </button>
        </form>
      )}

      {tab === 'list' && (
        <div>
          {loading && <div className="loading">加载中...</div>}
          {!loading && questions.length === 0 && (
            <div className="empty">暂无题目，去提交第一道吧！</div>
          )}
          {questions.map(q => (
            <div className="question-card" key={q.id} onClick={() => setExpanded(expanded === q.id ? null : q.id)}>
              <div className="meta">
                <span className={`badge ${LEVEL_BADGE[q.level] || ''}`}>{q.level}</span>
                <span className="badge badge-domain">{q.domain}{q.subdomain ? ` · ${q.subdomain}` : ''}</span>
                <span className="badge badge-domain">{q.source}</span>
              </div>
              <div className="title">{q.title}</div>
              {expanded === q.id ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', marginBottom: 16, lineHeight: 1.7 }}>{q.question}</div>
                  {q.rubrics.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>采分点：</div>
                      {q.rubrics.map((r, i) => (
                        <div key={i} style={{ fontSize: 13, color: '#57534e', marginBottom: 4 }}>
                          <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)', marginRight: 8 }}>[{r.score}分]</span>
                          {r.desc}
                        </div>
                      ))}
                    </div>
                  )}
                  {q.answer && (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>参考答案：</div>
                      <div style={{ fontSize: 13, color: '#57534e', whiteSpace: 'pre-wrap', background: '#fafaf9', padding: 12, borderRadius: 6, lineHeight: 1.7 }}>{q.answer}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="preview">{q.question}</div>
              )}
              <div className="footer">
                <span>{q.author} · {q.institution}</span>
                <span>{new Date(q.created).toLocaleDateString('zh-CN')}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.msg}</div>}
    </div>
  )
}
