import {
  forwardRef,
  useImperativeHandle,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import './PdfViewer.css'

// ─── Worker setup ─────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

// ─── Build full text + character→item map ────────────────────
function buildTextMap(items) {
  let fullText  = ''
  const charMap = [] // charMap[charPos] = item index

  for (let i = 0; i < items.length; i++) {
    const str = items[i].str
    for (let c = 0; c < str.length; c++) {
      charMap[fullText.length + c] = i
    }
    fullText += str + ' '
    charMap[fullText.length - 1] = i // space char → same item
  }
  return { fullText, charMap }
}

// ─── Find item indices that cover the snippet ─────────────────
// Returns { firstIdx, lastIdx } into the items array
function findSnippetRange(items, snippet) {
  if (!snippet || !snippet.trim()) return null

  const { fullText, charMap } = buildTextMap(items)

  // Normalise both for comparison
  const normalise = s => s.replace(/[\s\n\r\t]+/g, ' ').trim().toLowerCase()
  const haystack  = normalise(fullText)
  const needle    = normalise(snippet)

  let startChar = haystack.indexOf(needle)

  // Fallback: try progressively shorter prefixes (handles truncated snippets)
  if (startChar === -1) {
    const words = needle.split(' ')
    for (let take = words.length - 1; take >= 5; take--) {
      const sub = words.slice(0, take).join(' ')
      startChar = haystack.indexOf(sub)
      if (startChar !== -1) break
    }
  }

  if (startChar === -1) return null

  const endChar   = Math.min(startChar + needle.length - 1, charMap.length - 1)
  const firstIdx  = charMap[startChar]
  const lastIdx   = charMap[endChar]

  if (firstIdx === undefined) return null
  return { firstIdx, lastIdx: lastIdx ?? firstIdx }
}

// ─── Group items into visual lines by Y position ─────────────
// Then create one overlay rect per line (looks like real text highlight)
function createHighlightOverlays(pageEl, items, viewport, firstIdx, lastIdx) {
  const overlays = []

  // Collect all items in range
  const rangeItems = []
  for (let i = firstIdx; i <= lastIdx; i++) {
    if (items[i] && items[i].transform) rangeItems.push(items[i])
  }
  if (rangeItems.length === 0) return overlays

  // Group by Y coordinate (same line = within 4px of each other)
  const lines = []
  let currentLine = []
  let lastY = null

  for (const item of rangeItems) {
    const [,,,, , f] = item.transform
    const [, viewY]  = viewport.convertToViewportPoint(0, f)

    if (lastY === null || Math.abs(viewY - lastY) > 6) {
      if (currentLine.length > 0) lines.push(currentLine)
      currentLine = [{ item, viewY }]
      lastY = viewY
    } else {
      currentLine.push({ item, viewY })
    }
  }
  if (currentLine.length > 0) lines.push(currentLine)

  // Create one overlay per line — spanning from leftmost to rightmost item
  for (const line of lines) {
    if (line.length === 0) continue

    let minX = Infinity, maxX = -Infinity, lineY = 0, lineH = 0

    for (const { item, viewY } of line) {
      const [,,,, e, f] = item.transform
      const [viewX]     = viewport.convertToViewportPoint(e, f)
      const w = (item.width  || 0)  * viewport.scale
      const h = (item.height || 11) * viewport.scale

      minX  = Math.min(minX, viewX)
      maxX  = Math.max(maxX, viewX + w)
      lineY = viewY - h
      lineH = h
    }

    if (minX === Infinity) continue

    const ov = document.createElement('div')
    ov.className           = 'pdf-text-highlight'
    ov.style.position      = 'absolute'
    ov.style.left          = (minX - 2) + 'px'
    ov.style.top           = (lineY - 2) + 'px'
    ov.style.width         = (maxX - minX + 4) + 'px'
    ov.style.height        = (lineH + 5) + 'px'
    ov.style.pointerEvents = 'none'
    ov.style.zIndex        = '10'
    pageEl.appendChild(ov)
    overlays.push(ov)
  }

  return overlays
}

// ─── Per-page renderer ───────────────────────────────────────
function PdfPage({ pdf, pageNumber, scale, onMounted }) {
  const canvasRef  = useRef(null)
  const wrapperRef = useRef(null)
  const renderTask = useRef(null)

  useEffect(() => {
    if (wrapperRef.current && onMounted) onMounted(pageNumber, wrapperRef.current)
  }, [pageNumber, onMounted])

  useEffect(() => {
    if (!pdf) return
    let cancelled = false

    async function render() {
      if (renderTask.current) {
        try { await renderTask.current.cancel() } catch (_) {}
      }
      const page     = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale })
      const canvas   = canvasRef.current
      if (!canvas || cancelled) return

      const ctx = canvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      canvas.width  = Math.floor(viewport.width  * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width  = Math.floor(viewport.width)  + 'px'
      canvas.style.height = Math.floor(viewport.height) + 'px'
      ctx.scale(dpr, dpr)

      const task = page.render({ canvasContext: ctx, viewport })
      renderTask.current = task
      try { await task.promise }
      catch (err) {
        if (err?.name !== 'RenderingCancelledException')
          console.error('Render error page', pageNumber, err)
      }
    }

    render()
    return () => { cancelled = true }
  }, [pdf, pageNumber, scale])

  return (
    <div ref={wrapperRef} className="pdf-page-wrapper" data-page={pageNumber}>
      <div className="pdf-page-number">{pageNumber}</div>
      <canvas ref={canvasRef} className="pdf-canvas" />
    </div>
  )
}

// ─── Main PdfViewer ──────────────────────────────────────────
const PdfViewer = forwardRef(function PdfViewer(
  { pdfUrl, zoom, onPageChange, onTotalPages },
  ref
) {
  const scale = zoom || 1.25

  const [pdf, setPdf]           = useState(null)
  const [numPages, setNumPages] = useState(0)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(true)

  const scrollContainerRef = useRef(null)
  const pageEls            = useRef({})
  const highlightCleanup   = useRef(null)

  const handlePageMounted = useCallback((pageNumber, el) => {
    pageEls.current[pageNumber] = el
  }, [])

  // ── Load PDF ───────────────────────────────────────────────
  useEffect(() => {
    if (!pdfUrl) return
    let destroyed = false
    setLoading(true); setError(''); setPdf(null); setNumPages(0)

    pdfjsLib.getDocument({ url: pdfUrl, cMapPacked: true }).promise
      .then(doc => {
        if (destroyed) return
        setPdf(doc)
        setNumPages(doc.numPages)
        if (onTotalPages) onTotalPages(doc.numPages)
        setLoading(false)
      })
      .catch(err => {
        if (destroyed) return
        console.error('PDF load error:', err)
        setError('Failed to load PDF: ' + (err.message || String(err)))
        setLoading(false)
      })

    return () => { destroyed = true }
  }, [pdfUrl])

  // ── Track current page ────────────────────────────────────
  useEffect(() => {
    if (!scrollContainerRef.current || numPages === 0) return
    const root = scrollContainerRef.current

    const observer = new IntersectionObserver(entries => {
      let best = null, bestRatio = 0
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio > bestRatio) {
          bestRatio = e.intersectionRatio; best = e.target
        }
      }
      if (best && onPageChange) {
        const pg = parseInt(best.dataset.page, 10)
        if (!isNaN(pg)) onPageChange(pg)
      }
    }, { root, threshold: [0.1, 0.5, 0.9] })

    const t = setTimeout(() => {
      root.querySelectorAll('[data-page]').forEach(p => observer.observe(p))
    }, 800)
    return () => { clearTimeout(t); observer.disconnect() }
  }, [numPages, onPageChange])

  // ── scrollToCitation — highlights the FULL snippet context ─
  const scrollToCitation = useCallback(async (pageNumber, textSnippet) => {
    const pageEl = pageEls.current[pageNumber]
    if (!pageEl) return

    // Scroll page into view first
    pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (onPageChange) onPageChange(pageNumber)

    // Remove previous highlights
    if (highlightCleanup.current) {
      highlightCleanup.current()
      highlightCleanup.current = null
    }

    if (!pdf || !textSnippet) return

    try {
      const page     = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale })
      const content  = await page.getTextContent()

      // Keep all items including spaces for accurate position mapping
      const items = content.items.filter(i => typeof i.str === 'string')

      // Use full_text if available (longer = better highlight coverage),
      // otherwise snippet. Both come from the backend citation object.
      const range = findSnippetRange(items, textSnippet)

      if (!range) {
        console.warn('Could not find snippet on page', pageNumber, textSnippet.slice(0, 60))
        return
      }

      // Create line-by-line highlight overlays covering the full range
      const overlays = createHighlightOverlays(
        pageEl, items, viewport, range.firstIdx, range.lastIdx
      )

      if (overlays.length === 0) return

      // Scroll so the highlighted region is visible (centered)
      setTimeout(() => {
        overlays[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 350)

      // Register cleanup
      highlightCleanup.current = () => {
        overlays.forEach(o => o.parentNode?.removeChild(o))
      }
      // Auto-clear after 8 seconds
      setTimeout(() => {
        if (highlightCleanup.current) {
          highlightCleanup.current()
          highlightCleanup.current = null
        }
      }, 8000)

    } catch (err) {
      console.error('Highlight error:', err)
    }
  }, [pdf, scale, onPageChange])

  useImperativeHandle(ref, () => ({ scrollToCitation }), [scrollToCitation])

  return (
    <div className="pdf-viewer-root">
      {loading && (
        <div className="pdf-loading">
          <div className="spinner" />
          <span>Loading document...</span>
        </div>
      )}
      {!loading && error && (
        <div className="pdf-error">
          <p>{error}</p>
          <p className="pdf-error-hint">Open F12 → Console for details.</p>
        </div>
      )}
      {!loading && !error && (
        <div ref={scrollContainerRef} className="pdf-scroll">
          <div className="pdf-pages">
            {Array.from({ length: numPages }, (_, i) => i + 1).map(n => (
              <PdfPage key={n} pdf={pdf} pageNumber={n}
                scale={scale} onMounted={handlePageMounted} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

export default PdfViewer