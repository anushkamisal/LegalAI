import { useState, useRef, useCallback } from 'react'
import './UploadScreen.css'

export default function UploadScreen({ onFileUpload }) {
  const [isDragging, setIsDragging]   = useState(false)
  const [isLoading, setIsLoading]     = useState(false)
  const [error, setError]             = useState('')
  const fileInputRef = useRef(null)

  const processFile = useCallback(async (file) => {
    if (!file) return
    if (file.type !== 'application/pdf') {
      setError('Only PDF files are accepted.')
      return
    }
    setError('')
    setIsLoading(true)
    // Small delay so the user sees the loading state
    await new Promise(r => setTimeout(r, 300))
    onFileUpload(file)
    setIsLoading(false)
  }, [onFileUpload])

  /* ── Drag events ──────────────────────────────────────────── */
  const onDragEnter = (e) => { e.preventDefault(); setIsDragging(true) }
  const onDragLeave = (e) => { e.preventDefault(); setIsDragging(false) }
  const onDragOver  = (e) => { e.preventDefault() }
  const onDrop      = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    processFile(file)
  }

  const onInputChange = (e) => processFile(e.target.files[0])
  const openPicker    = () => fileInputRef.current?.click()

  return (
    <div className="upload-root">
      {/* Background decorative elements */}
      <div className="upload-bg-grid" aria-hidden="true" />
      <div className="upload-bg-glow" aria-hidden="true" />

      <div className="upload-container">
        {/* Logo */}
        <header className="upload-header">
          <div className="upload-logo-wrap">
            <ScalesIcon />
          </div>
          <h1 className="upload-title">Legal<span className="gold">AI</span></h1>
          <p className="upload-subtitle">LEGAL DOCUMENT INTELLIGENCE</p>
        </header>

        {/* Drop zone */}
        <div
          className={`drop-zone ${isDragging ? 'dragging' : ''} ${isLoading ? 'loading' : ''}`}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={!isLoading ? openPicker : undefined}
          role="button"
          tabIndex={0}
          aria-label="Upload PDF document"
          onKeyDown={e => e.key === 'Enter' && !isLoading && openPicker()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={onInputChange}
            style={{ display: 'none' }}
          />

          <div className="drop-zone-inner">
            {isLoading ? (
              <div className="loading-state">
                <div className="spinner" />
                <p className="loading-text">Processing document…</p>
              </div>
            ) : (
              <>
                <div className="doc-icon-wrap">
                  <DocIcon />
                </div>
                <h2 className="drop-title">Drop your legal document</h2>
                <p className="drop-desc">
                  Upload a PDF judgment, contract, or case file to<br />
                  begin intelligent analysis
                </p>
                <button
                  className="select-btn"
                  onClick={e => { e.stopPropagation(); openPicker() }}
                  type="button"
                >
                  Select PDF
                </button>
              </>
            )}
          </div>

          {/* Feature pills */}
          {!isLoading && (
            <div className="feature-pills">
              <span className="pill">
                <span className="pill-dot" />AI Summaries
              </span>
              <span className="pill">
                <span className="pill-dot" />Page Citations
              </span>
              <span className="pill">
                <span className="pill-dot" />Chronology
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="upload-error" role="alert">
            <WarningIcon /> {error}
          </div>
        )}

        <p className="upload-hint">Supports PDF judgment, contract, and case files</p>
      </div>
    </div>
  )
}

/* ── Icons ──────────────────────────────────────────────────── */
function ScalesIcon() {
  return (
    <svg viewBox="0 0 56 56" fill="none" className="scales-icon" aria-hidden="true">
      <circle cx="28" cy="28" r="27" stroke="var(--gold-border)" strokeWidth="1"/>
      <path d="M28 8 L28 48" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round"/>
      <path d="M12 18 L44 18" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round"/>
      <path d="M12 18 L6 33 C6 33 6 40 12 40 C18 40 18 33 18 33 Z"
            stroke="var(--gold)" strokeWidth="1.6" fill="var(--gold-dim)"/>
      <path d="M44 18 L38 33 C38 33 38 40 44 40 C50 40 50 33 50 33 Z"
            stroke="var(--gold)" strokeWidth="1.6" fill="var(--gold-dim)"/>
      <rect x="22" y="46" width="12" height="2.5" rx="1.25" fill="var(--gold)"/>
    </svg>
  )
}

function DocIcon() {
  return (
    <svg viewBox="0 0 64 80" fill="none" className="doc-icon" aria-hidden="true">
      <rect x="4" y="2" width="44" height="56" rx="4" fill="var(--bg-tertiary)" stroke="var(--border)" strokeWidth="1.5"/>
      <rect x="6" y="2" width="34" height="56" rx="3" fill="var(--bg-card)"/>
      <path d="M34 2 L34 16 L48 16" stroke="var(--border)" strokeWidth="1.5" fill="none"/>
      <path d="M14 26 h24 M14 34 h24 M14 42 h16" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" width="15" height="15" aria-hidden="true">
      <path d="M8 1L15 14H1L8 1z" stroke="currentColor" strokeWidth="1.3" fill="none"/>
      <path d="M8 6v4M8 11.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}