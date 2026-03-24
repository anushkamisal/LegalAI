import { useState, useRef, useEffect, useCallback } from 'react'
import './ChatPanel.css'

const SUGGESTED_QUESTIONS = [
  { id: 'summarize',  icon: '📋', label: 'Summarize this judgment' },
  { id: 'chronology', icon: '📅', label: 'List key events chronologically' },
  { id: 'parties',    icon: '👥', label: 'Who are the parties involved?' },
  { id: 'decision',   icon: '⚖️',  label: 'What was the final decision?' },
  { id: 'laws',       icon: '📜', label: 'What laws or sections are cited?' },
]

// ─── Parse a text line and inject (Page X) citation buttons ──
// Each button carries the full_text from the matching backend citation
function parseLineWithCitations(text, rawCitations, onCitationClick) {
  const re = /(\(Page\s+\d+(?:,\s*(?:Paragraph|Para\.?)\s*\d+)?\)|\[Page\s+\d+(?:,\s*(?:Paragraph|Para\.?)\s*\d+)?\])/gi
  const parts = []
  let last = 0, m, k = 0
  const regex = new RegExp(re.source, 'gi')

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={k++}>{text.slice(last, m.index)}</span>)

    const pgMatch = /(\d+)/.exec(m[0])
    const pg      = pgMatch ? parseInt(pgMatch[1], 10) : null
    const cite    = rawCitations ? rawCitations.find(c => c.page === pg) : null
    // Prefer full_text — this is the complete paragraph context from the backend
    const highlightText = cite ? (cite.full_text || cite.snippet || '') : ''

    parts.push(
      <button key={k++} className="citation-btn"
        title={'Page ' + pg + (highlightText ? '\n' + highlightText.slice(0, 100) + '...' : '')}
        onClick={() => pg && onCitationClick(pg, highlightText)}>
        {m[0]}
      </button>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<span key={k++}>{text.slice(last)}</span>)
  return parts
}

// ─── Formatted answer renderer ────────────────────────────────
function FormattedAnswer({ text, rawCitations, onCitationClick }) {
  const lines = text.split('\n')
  const elements = []
  let key = 0

  const stripped = s => s.replace(/\*\*(.+?)\*\*/g, (_, inner) => inner)

  for (const line of lines) {
    if (line.trim() === '') {
      elements.push(<div key={key++} className="answer-spacer" />)
      continue
    }

    const numMatch     = line.match(/^(\d+)[.)]\s+(.+)/)
    const bulletMatch  = line.match(/^[•\-\*]\s+(.+)/)
    const headingMatch = !numMatch && !bulletMatch && line.match(/^\*\*(.+?)\*\*:?\s*$/)

    if (headingMatch) {
      elements.push(<p key={key++} className="answer-heading">{headingMatch[1]}</p>)
    } else if (numMatch) {
      elements.push(
        <div key={key++} className="answer-list-item">
          <span className="list-num">{numMatch[1]}.</span>
          <span className="list-content">
            {parseLineWithCitations(stripped(numMatch[2]), rawCitations, onCitationClick)}
          </span>
        </div>
      )
    } else if (bulletMatch) {
      elements.push(
        <div key={key++} className="answer-list-item">
          <span className="list-bullet">—</span>
          <span className="list-content">
            {parseLineWithCitations(stripped(bulletMatch[1]), rawCitations, onCitationClick)}
          </span>
        </div>
      )
    } else {
      elements.push(
        <p key={key++} className="answer-line">
          {parseLineWithCitations(stripped(line), rawCitations, onCitationClick)}
        </p>
      )
    }
  }
  return <div className="answer-body">{elements}</div>
}

// ─── Source pills — one per unique page from backend citations ─
// Clicking scrolls to that page and highlights the full_text block
function CitationPills({ citations, onCitationClick }) {
  if (!citations || citations.length === 0) return null

  // Deduplicate by page; keep the entry with highest relevance_score
  const byPage = {}
  for (const c of citations) {
    const existing = byPage[c.page]
    if (!existing || (c.relevance_score || 0) > (existing.relevance_score || 0)) {
      byPage[c.page] = c
    }
  }
  const unique = Object.values(byPage).sort((a, b) => a.page - b.page)

  return (
    <div className="citation-pills">
      <span className="pills-label">Sources:</span>
      {unique.map((c, i) => {
        // full_text is the complete context chunk — use it for highlighting
        const highlightText = c.full_text || c.snippet || ''
        const pct = c.relevance_score ? Math.round(c.relevance_score * 100) : null

        return (
          <button key={i} className="citation-pill"
            title={'Page ' + c.page + (highlightText ? '\n' + highlightText.slice(0, 120) + '...' : '')}
            onClick={() => onCitationClick(c.page, highlightText)}>
            pg.{c.page}
            {pct && <span className="pill-score">{pct}%</span>}
          </button>
        )
      })}
    </div>
  )
}

// ─── Query badge ──────────────────────────────────────────────
function QueryTypeBadge({ type }) {
  if (!type) return null
  const map = {
    SUMMARY:    { cls: 'badge-summary',    label: 'SUMMARY'    },
    CHRONOLOGY: { cls: 'badge-chronology', label: 'CHRONOLOGY' },
    FACT:       { cls: 'badge-fact',       label: 'FACT'       },
  }
  const info = map[type] || { cls: 'badge-fact', label: type }
  return <span className={'query-badge ' + info.cls}>{info.label}</span>
}

function TypingIndicator() {
  return <div className="typing-indicator"><span /><span /><span /></div>
}

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" width="17" height="17">
      <path d="M3 10L17 3 10 17 9 11 3 10z" stroke="currentColor"
            strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export default function ChatPanel({ apiBase, fileId, fileName, onCitationClick }) {
  const [messages, setMessages]           = useState([])
  const [input, setInput]                 = useState('')
  const [isLoading, setIsLoading]         = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(true)
  const [backendAvailable, setBackendAvailable] = useState(null)

  const messagesEndRef = useRef(null)
  const textareaRef    = useRef(null)

  useEffect(() => {
    fetch(apiBase + '/health/')
      .then(r => setBackendAvailable(r.ok))
      .catch(() => setBackendAvailable(false))
  }, [apiBase])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const sendQuery = useCallback(async (query) => {
    if (!query.trim() || isLoading) return
    setShowSuggestions(false)
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', text: query }])
    setInput('')
    setIsLoading(true)

    try {
      const res = await fetch(apiBase + '/query/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (!res.ok) throw new Error('Backend returned ' + res.status)

      const data = await res.json()

      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        text: data.answer || 'No answer returned.',
        queryType: data.query_type || 'FACT',
        // Store full citation objects from backend — including full_text
        rawCitations: Array.isArray(data.citations) ? data.citations : [],
      }])
    } catch (err) {
      console.error('Backend query failed:', err)
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        text: 'Could not reach the backend. Make sure FastAPI is running at ' + apiBase + ' and a PDF has been uploaded.',
        queryType: 'ERROR',
        rawCitations: [],
        isError: true,
      }])
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, apiBase])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(input) }
  }

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [input])

  const isBackendReady = fileId && backendAvailable !== false

  return (
    <div className="chat-root">

      {messages.length === 0 && (
        <div className="chat-welcome">
          <div className="welcome-icon">⚖️</div>
          <h2 className="welcome-title">Ask about this document</h2>
          <p className="welcome-desc">Summaries, facts, timelines — all cited by page</p>
          {!isBackendReady && (
            <div className="backend-warning">
              <span className="warning-dot" />
              {!fileId ? 'PDF not yet processed by backend'
                       : 'Backend not reachable — start FastAPI at ' + apiBase}
            </div>
          )}
        </div>
      )}

      {showSuggestions && (
        <div className="suggestions-grid">
          {SUGGESTED_QUESTIONS.map(q => (
            <button key={q.id} className="suggestion-card"
              onClick={() => sendQuery(q.label)} disabled={isLoading}>
              <span className="suggestion-icon">{q.icon}</span>
              <span className="suggestion-label">{q.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="messages-list">
        {messages.map(msg => (
          <div key={msg.id} className={'message message-' + msg.role}>
            {msg.role === 'user' ? (
              <div className="user-bubble"><p>{msg.text}</p></div>
            ) : (
              <div className={'assistant-bubble' + (msg.isError ? ' bubble-error' : '')}>
                <div className="assistant-meta">
                  <span className="assistant-label"><span className="ai-dot" />LegalAI</span>
                  {!msg.isError && <QueryTypeBadge type={msg.queryType} />}
                  {msg.isError  && <span className="error-badge">ERROR</span>}
                </div>

                <FormattedAnswer
                  text={msg.text}
                  rawCitations={msg.rawCitations}
                  onCitationClick={onCitationClick}
                />

                {/* Source pills — only rendered when backend returned citations */}
                {!msg.isError && msg.rawCitations && msg.rawCitations.length > 0 && (
                  <CitationPills
                    citations={msg.rawCitations}
                    onCitationClick={onCitationClick}
                  />
                )}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="message message-assistant">
            <div className="assistant-bubble">
              <div className="assistant-meta">
                <span className="assistant-label">
                  <span className="ai-dot thinking" />LegalAI
                </span>
                <span className="thinking-label">Analyzing document…</span>
              </div>
              <TypingIndicator />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-bar">
        <div className="chat-input-wrap">
          <textarea ref={textareaRef} className="chat-textarea"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isBackendReady ? 'Ask about this legal document...' : 'Upload a PDF to enable chat...'}
            rows={1} disabled={isLoading}
          />
          <button className="send-btn"
            onClick={() => sendQuery(input)}
            disabled={!input.trim() || isLoading}>
            <SendIcon />
          </button>
        </div>
        <p className="input-hint">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}