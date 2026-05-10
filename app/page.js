'use client'
import { useState, useEffect } from 'react'

const LEVELS = ['L1 知识检索', 'L2 机制推理', 'L3 实验方案', 'L4 通路推测']
const DOMAINS = ['糖', '脂肪', '蛋白', '微量元素', '维生素', '天然产物']
const SOURCES = ['原创', '改编自论文/教材']
const LEVEL_BADGE = { 'L1 知识检索': 'badge-l1', 'L2 机制推理': 'badge-l2', 'L3 实验方案': 'badge-l3', 'L4 通路推测': 'badge-l4' }
const MIN_RUBRIC_COUNT = 3
const MAX_RUBRIC_COUNT = 10
const RUBRIC_TOTAL = 10

const emptyForm = {
  title: '', level: '', domain: '', subdomain: '', question: '',
  rubrics: Array.from({ length: MIN_RUBRIC_COUNT }, () => ({ desc: '', score: '' })),
  source: '原创', sourceDetail: '', author: '', institution: '', email: '',
}

const DRAFT_KEY = 'nutribench-draft-v1'

export default function Home() {
  const [tab, setTab] = useState('submit')
  const [form, setForm] = useState({ ...emptyForm })
  const [editingId, setEditingId] = useState(null)
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
    if (editingId) return
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)) } catch {}
  }, [form, draftLoaded, editingId])

  function startEdit(q) {
    const rubrics = (q.rubrics && q.rubrics.length >= MIN_RUBRIC_COUNT)
      ? q.rubrics.map(r => ({ desc: r.desc || '', score: r.score ?? '' }))
      : [...(q.rubrics || []).map(r => ({ desc: r.desc || '', score: r.score ?? '' })),
         ...Array.from({ length: MIN_RUBRIC_COUNT - (q.rubrics?.length || 0) }, () => ({ desc: '', score: '' }))]
    setForm({
      title: q.title || '',
      level: q.level || '',
      domain: q.domain || '',
      subdomain: q.subdomain || '',
      question: q.question || '',
      rubrics,
      source: q.source || '原创',
      sourceDetail: q.sourceDetail || '',
      author: q.author || '',
      institution: q.institution || '',
      email: q.email || '',
    })
    setEditingId(q.id)
    setTab('submit')
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed === 'object') {
          setForm({ ...emptyForm, ...parsed })
          return
        }
      }
    } catch {}
    setForm({ ...emptyForm })
  }

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
    if (form.rubrics.length < MAX_RUBRIC_COUNT) {
      setForm(f => ({ ...f, rubrics: [...f.rubrics, { desc: '', score: '' }] }))
    }
  }

  function removeRubric(index) {
    if (form.rubrics.length > MIN_RUBRIC_COUNT) {
      setForm(f => ({ ...f, rubrics: f.rubrics.filter((_, i) => i !== index) }))
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title || !form.level || !form.domain || !form.question || !form.author || !form.institution) {
      showToast('请填写所有必填字段', true)
      return
    }
    const rubricCount = form.rubrics.filter(r => r.desc).length
    if (rubricCount < MIN_RUBRIC_COUNT) {
      showToast(`至少需要 ${MIN_RUBRIC_COUNT} 个采分点`, true)
      return
    }
    if (rubricCount > MAX_RUBRIC_COUNT) {
      showToast(`最多只能有 ${MAX_RUBRIC_COUNT} 个采分点`, true)
      return
    }
    if (rubricTotal !== RUBRIC_TOTAL) {
      showToast(`采分点总分必须为 ${RUBRIC_TOTAL} 分（当前 ${rubricTotal} 分）`, true)
      return
    }
    setSubmitting(true)
    try {
      const isEdit = Boolean(editingId)
      const res = await fetch('/api/questions', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { ...form, id: editingId } : form),
      })
      if (res.ok) {
        showToast(isEdit ? '更新成功！' : '提交成功！')
        if (isEdit) {
          setEditingId(null)
          try {
            const saved = localStorage.getItem(DRAFT_KEY)
            const parsed = saved ? JSON.parse(saved) : null
            setForm(parsed && typeof parsed === 'object' ? { ...emptyForm, ...parsed } : { ...emptyForm })
          } catch { setForm({ ...emptyForm }) }
        } else {
          try { localStorage.removeItem(DRAFT_KEY) } catch {}
          setForm({ ...emptyForm })
        }
        fetchQuestions()
        setTab('list')
      } else {
        showToast(isEdit ? '更新失败，请重试' : '提交失败，请重试', true)
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
          {editingId && (
            <div style={{
              padding: '10px 14px',
              marginBottom: 16,
              borderRadius: 6,
              background: '#fef3c7',
              border: '1px solid #f59e0b',
              color: '#92400e',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span>✏️ 正在编辑已提交的题目（提交后将覆盖原内容）</span>
              <button type="button" onClick={cancelEdit}
                style={{ background: 'transparent', border: '1px solid #92400e', color: '#92400e', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
                取消编辑
              </button>
            </div>
          )}
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
              <span>采分点 Rubric <span className="hint">（至少 {MIN_RUBRIC_COUNT} 个，最多 {MAX_RUBRIC_COUNT} 个，总分须为 {RUBRIC_TOTAL} 分）</span></span>
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

            <div style={{
              background: '#fffbeb',
              border: '1px solid #fcd34d',
              borderRadius: 6,
              padding: '12px 14px',
              marginBottom: 16,
              fontSize: 13,
              lineHeight: 1.7,
              color: '#78350f',
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>📌 采分点不再需要单独参考答案，请把标准答案的关键事实逐条拆进采分点里，越细越好。</div>
              <div style={{ marginBottom: 4 }}>每条采分点应当是一个<strong>可独立判断对错的具体事实/结论/数据</strong>，而不是泛泛的"答对要点"。（示例问题：在斑马鱼中，基因waslb的功能获得模型如何影响胚胎的鳍发育？请具体说明。）：</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5, background: '#fff', border: '1px solid #fde68a', borderRadius: 4, padding: '8px 10px', marginTop: 6, whiteSpace: 'pre-wrap' }}>
{`采分点写法示例
• 鳍的发育在辐射骨 (radials) 中发生改变
• 正常硬骨鱼鳍中形成近端和远端辐射骨，在这些突变体中，于正常辐射骨行之间发现了中间辐射骨
• 鳍褶 (fin fold) 不受影响
• 鳍条 (fin rays) 不受影响`}
              </div>
              <div style={{ marginTop: 8, color: '#92400e' }}>
                ✅ 好示例：写明<u>具体结构名、观察到的现象、基因/通路名称、数值范围（如有）</u>。<br/>
                ❌ 反例："正确描述鳍发育变化" / "答出关键点" / "理解基因功能" —— 这种无法客观判分，请避免。
              </div>
            </div>

            {form.rubrics.map((r, i) => (
              <div className="rubric-item" key={i}>
                <textarea value={r.desc} onChange={e => updateRubric(i, 'desc', e.target.value)}
                  placeholder={i === 0
                    ? `采分点 ${i + 1}：请写详细、可独立判断对错的具体采分点（可多行展开）。`
                    : `采分点 ${i + 1}：一个具体采分点。`}
                  style={{ minHeight: 110, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }} />
                <input type="number" value={r.score} onChange={e => updateRubric(i, 'score', e.target.value)}
                  placeholder="分值" min="0" max="10" step="0.25" />
                <button type="button" className="btn-remove" onClick={() => removeRubric(i)}
                  disabled={form.rubrics.length <= MIN_RUBRIC_COUNT}>×</button>
              </div>
            ))}
            {form.rubrics.length < MAX_RUBRIC_COUNT && (
              <button type="button" className="btn-add" onClick={addRubric}>+ 添加采分点</button>
            )}
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
                <label>出题人邮箱 <span className="hint">选填，便于后续联系</span></label>
                <input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)} />
              </div>
            </div>
          </div>

          <button type="submit" className="btn-submit" disabled={submitting}>
            {submitting ? (editingId ? '更新中...' : '提交中...') : (editingId ? '保存修改' : '提交题目')}
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
                        <div key={i} style={{ fontSize: 13, color: '#57534e', marginBottom: 8, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                          <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)', marginRight: 8 }}>[{r.score}分]</span>
                          {r.desc}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); startEdit(q) }}
                      style={{ padding: '6px 14px', fontSize: 13, border: '1px solid var(--accent)', background: 'white', color: 'var(--accent)', borderRadius: 6, cursor: 'pointer' }}>
                      ✏️ 编辑此题
                    </button>
                  </div>
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
