import { useState, useRef } from 'react'
import UploadScreen from './components/UploadScreen.jsx'
import PdfViewer from './components/PdfViewer.jsx'
import ChatPanel from './components/ChatPanel.jsx'
import './App.css'

const API_BASE = 'http://localhost:8000'

export default function App() {
  // pdfFile: local object URL for pdfjs rendering
  // fileId: returned by backend after upload
  const [pdfFile, setPdfFile]     = useState(null)
  const [fileId, setFileId]       = useState(null)
  const [fileName, setFileName]   = useState('')
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom]           = useState(1.25)

  const pdfViewerRef = useRef(null)

  /* ── Upload handler ──────────────────────────────────────── */
  const handleFileUpload = async (file) => {
    const localUrl = URL.createObjectURL(file)
    setPdfFile(localUrl)
    setFileName(file.name)

    // Upload to FastAPI backend
    try {
      const form = new FormData()
      form.append('file', file)
      const res  = await fetch(`${API_BASE}/upload-pdf/`, { method: 'POST', body: form })
      const data = await res.json()
      if (res.ok) {
        setFileId(data.file_id)
      } else {
        console.error('Backend upload error:', data.detail)
      }
    } catch (err) {
      console.error('Upload fetch error:', err)
      // App still works with local PDF + simulated responses
    }
  }

  /* ── Clear session ───────────────────────────────────────── */
  const handleClear = async () => {
    if (pdfFile) URL.revokeObjectURL(pdfFile)
    setPdfFile(null)
    setFileId(null)
    setFileName('')
    setTotalPages(0)
    setCurrentPage(1)

    try {
      await fetch(`${API_BASE}/clear/`, { method: 'DELETE' })
    } catch (_) {}
  }

  /* ── Citation scroll bridge ──────────────────────────────── */
  const handleScrollToCitation = (pageNumber, textSnippet) => {
    if (pdfViewerRef.current) {
      pdfViewerRef.current.scrollToCitation(pageNumber, textSnippet)
      setCurrentPage(pageNumber)
    }
  }

  /* ── Zoom controls ───────────────────────────────────────── */
  const handleZoomIn  = () => setZoom(z => Math.min(z + 0.15, 2.5))
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.15, 0.5))

  /* ─────────────────────────────────────────────────────────── */
  if (!pdfFile) {
    return <UploadScreen onFileUpload={handleFileUpload} />
  }

  const displayName = fileName.replace(/\.pdf$/i, '')

  return (
    <div className="app-root">

      {/* ── Top Bar ────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="topbar-brand">
          <ScalesIcon />
          <span className="brand-text">Legal<span className="brand-ai">AI</span></span>
          <span className="brand-tagline">LEGAL INTELLIGENCE</span>
        </div>

        <div className="topbar-center">
          <div className="page-controls">
            <button className="ctrl-btn" onClick={handleZoomOut} title="Zoom out">−</button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button className="ctrl-btn" onClick={handleZoomIn}  title="Zoom in">+</button>
            <div className="ctrl-divider" />
            <span className="page-indicator">
              Page <strong>{currentPage}</strong>
              {totalPages > 0 && <> / <strong>{totalPages}</strong></>}
            </span>
          </div>
        </div>

        <div className="topbar-right">
          <span className="file-badge" title={fileName}>
            <FileIcon size={13} />
            {displayName.length > 38 ? displayName.slice(0, 38) + '…' : displayName}
          </span>
          <button className="clear-btn" onClick={handleClear}>
            <CloseIcon />
            Clear
          </button>
        </div>
      </header>

      {/* ── Main Split Layout ───────────────────────────────────── */}
      <div className="main-split">
        <div className="pdf-pane">
          <PdfViewer
            ref={pdfViewerRef}
            pdfUrl={pdfFile}
            zoom={zoom}
            onPageChange={setCurrentPage}
            onTotalPages={setTotalPages}
          />
        </div>

        <div className="resizer" />

        <div className="chat-pane">
          <ChatPanel
            apiBase={API_BASE}
            fileId={fileId}
            fileName={fileName}
            onCitationClick={handleScrollToCitation}
          />
        </div>
      </div>
    </div>
  )
}

/* ── Inline SVG icons (no dependency) ──────────────────────── */
function ScalesIcon() {
  return (
    <svg className="brand-icon" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M20 4 L20 36" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round"/>
      <path d="M8 10 L32 10" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round"/>
      <path d="M8 10 L4 22 C4 22 4 27 8 27 C12 27 12 22 12 22 Z" stroke="var(--gold)" strokeWidth="1.5" fill="none"/>
      <path d="M32 10 L28 22 C28 22 28 27 32 27 C36 27 36 22 36 22 Z" stroke="var(--gold)" strokeWidth="1.5" fill="none"/>
      <rect x="14" y="34" width="12" height="2" rx="1" fill="var(--gold)"/>
    </svg>
  )
}

function FileIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" width={size} height={size} aria-hidden="true">
      <path d="M3 2h7l3 3v9H3z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true">
      <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}