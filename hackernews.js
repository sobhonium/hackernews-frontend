const $ = (id) => document.getElementById(id)

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, "") } catch { return "" }
}

function hashDomain(d) {
  let h = 0
  for (let i = 0; i < d.length; i++) h = d.charCodeAt(i) + ((h << 5) - h)
  return Math.abs(h)
}

const PALETTES = [
  ["#d4943a", "#e5b558"],  ["#6c5ce7", "#a29bfe"],  ["#2d9b8e", "#5ec4b6"],
  ["#c0765a", "#e8a080"],  ["#4a7db5", "#7ba9d9"],  ["#b0534a", "#d48a82"],
  ["#7c5cbf", "#b094e0"],  ["#3d8f82", "#70b8ac"],  ["#c9a84c", "#e8cc7a"],
  ["#5a636c", "#8e96a0"],
]
function gradient(n) { return PALETTES[n % PALETTES.length] }

function darkenColor(hex, factor) {
  const r = parseInt(hex.slice(1,3), 16)
  const g = parseInt(hex.slice(3,5), 16)
  const b = parseInt(hex.slice(5,7), 16)
  return `rgb(${Math.round(r*factor)},${Math.round(g*factor)},${Math.round(b*factor)})`
}

function setCardColors(el, c1, c2) {
  el.style.setProperty('--card-accent', c1)
  el.style.setProperty('--card-accent-light', c2)
  el.style.setProperty('--card-bg', darkenColor(c1, 0.08))
  el.style.setProperty('--card-border', c1 + '33')
}

function buildImageEl(url, domain, isFeatured) {
  const [c1, c2] = gradient(hashDomain(domain || "unknown"))
  if (url && typeof url === "string" && (url.startsWith("http") || url.startsWith("images/"))) {
    const img = document.createElement("img")
    img.className = isFeatured ? "featured-image" : "story-card-image"
    img.src = url; img.loading = isFeatured ? "eager" : "lazy"
    return img
  }
  const d = document.createElement("div")
  d.className = isFeatured ? "featured-image-placeholder" : "story-card-image-placeholder"
  d.style.background = `linear-gradient(135deg, ${c1}, ${c2})`
  d.textContent = (domain || "?").charAt(0).toUpperCase()
  return d
}

function escapeHtmlText(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function formatContent(text) {
  if (!text) return "<p class='inline-empty'>No content available.</p>"
  const cleaned = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|[\s(])\*([^\n*]+)\*(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/(^|[\s(])_([^\n_]+)_(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/^[ \t]*[—\-•*]+\s+/gm, "")
    .replace(/^[ \t]*\d+[.)]\s+/gm, "")
    .replace(/^[ \t]*#{1,6}\s+/gm, "")
    .trim()
  if (!cleaned) return "<p class='inline-empty'>No content available.</p>"
  const paragraphs = cleaned.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  if (paragraphs.length > 1) {
    return paragraphs.map(p => `<p class="inline-text">${escapeHtmlText(p).replace(/\n/g, "<br>")}</p>`).join("")
  }
  return `<p class="inline-text">${escapeHtmlText(cleaned).replace(/\n/g, "<br>")}</p>`
}

// ── Summary Modal ──
function openSummaryModal(story) {
  const modal = document.getElementById("summary-modal")
  if (!modal) return
  const domain = getDomain(story.url)
  const meta = `▲ ${story.score ?? 0}  ·  ${story.author ?? "?"}` + (domain ? `  ·  ${domain}` : "")
  document.getElementById("summary-modal-title").textContent = story.title || ""
  document.getElementById("summary-modal-meta").textContent = meta
  document.getElementById("summary-modal-label").textContent = story.groq_label || ""
  document.getElementById("summary-modal-content").innerHTML = formatContent(story.groq_explain)
  modal.hidden = false
  modal.setAttribute("aria-hidden", "false")
  document.body.style.overflow = "hidden"
}

function closeSummaryModal() {
  const modal = document.getElementById("summary-modal")
  if (!modal || modal.hidden) return
  modal.hidden = true
  modal.setAttribute("aria-hidden", "true")
  document.body.style.overflow = ""
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close-modal]")) closeSummaryModal()
})
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSummaryModal()
})

function makeSummaryBtn(story, iconSvg) {
  const btn = document.createElement("button")
  btn.className = "toggle-btn expand-btn"
  btn.innerHTML = iconSvg + " Summary"
  btn.addEventListener("click", () => openSummaryModal(story))
  const wrap = document.createElement("div")
  wrap.className = "toggle-wrap"
  wrap.appendChild(btn)
  return wrap
}

// ── Main ──
;(async function main() {
  const loadingEl = $("loading")
  const errorEl = $("error")
  const errorMsg = $("error-msg")
  const featuredSection = $("featured-section")
  const grid = $("magazine-grid")
  const countEl = $("story-count")

  let stories, meta
  try {
    const res = await fetch("data.json")
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    stories = json.stories || json
    meta = json._meta
  } catch (err) {
    if (loadingEl) loadingEl.hidden = true
    if (errorEl) {
      errorEl.hidden = false
      errorMsg.textContent = "Run ./update.sh first to generate data.json"
    }
    return
  }

  if (!stories?.length) {
    if (loadingEl) loadingEl.hidden = true
    if (errorEl) {
      errorEl.hidden = false
      errorMsg.textContent = "No data. Run ./update.sh first."
    }
    return
  }

  if (loadingEl) loadingEl.hidden = true

  /* ── Last Updated ── */
  if (meta?.lastUpdated) {
    const d = new Date(meta.lastUpdated)
    const el = document.getElementById("last-updated")
    if (el) el.textContent = "Last updated in: " + d.toLocaleString()
  }
  if (countEl) countEl.textContent = `top ${stories.length}`

  const summaryIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`

  // inline summary panel removed; summaries open in modal

  // ── Featured ──
  const featured = stories[0]
  if (featured) {
    const domain = getDomain(featured.url)
    const cardId = `story-${featured.id}`

    const card = document.createElement("div")
    card.className = "featured-card"
    card.dataset.expandId = cardId
    const [fc1, fc2] = gradient(hashDomain(domain || "unknown"))
    setCardColors(card, fc1, fc2)

    const imgLink = document.createElement("a")
    imgLink.href = featured.url || "#"
    imgLink.target = featured.url ? "_blank" : ""
    imgLink.rel = "noopener noreferrer"
    imgLink.className = "featured-image-link"
    imgLink.appendChild(buildImageEl(featured.og_image, domain, true))
    card.appendChild(imgLink)

    const overlayEl = document.createElement("div")
    overlayEl.className = "featured-overlay"

    const tag = document.createElement("span")
    tag.className = "featured-tag"
    tag.textContent = "Top Story"
    overlayEl.appendChild(tag)

    const titleLink = document.createElement("a")
    titleLink.href = featured.url || "#"
    titleLink.target = featured.url ? "_blank" : ""
    titleLink.rel = "noopener noreferrer"
    titleLink.className = "featured-title-link"
    const titleEl = document.createElement("h2")
    titleEl.textContent = featured.title
    titleLink.appendChild(titleEl)
    overlayEl.appendChild(titleLink)

    const meta = document.createElement("div")
    meta.className = "featured-meta"
    meta.textContent = `▲ ${featured.score ?? 0}  ·  ${featured.author ?? "?"}` + (domain ? `  ·  ${domain}` : "")
    overlayEl.appendChild(meta)

    const summaryEl = document.createElement("div")
    summaryEl.className = "summary-box featured-summary"
    summaryEl.textContent = featured.groq_label || "No summary."
    overlayEl.appendChild(summaryEl)

    const toggles = document.createElement("div")
    toggles.className = "toggles-row"
    toggles.appendChild(makeSummaryBtn(featured, summaryIcon))
    overlayEl.appendChild(toggles)
    card.appendChild(overlayEl)
    featuredSection.appendChild(card)
    featuredSection.hidden = false
  }

  // ── Grid ──
  stories.slice(1).forEach((story, i) => {
    const domain = getDomain(story.url)
    const cardId = `story-${story.id}`

    const card = document.createElement("div")
    card.className = "story-card"
    card.dataset.expandId = cardId
    card.style.animationDelay = `${i * 60}ms`
    const [c1, c2] = gradient(hashDomain(domain || "unknown"))
    setCardColors(card, c1, c2)
    const accentBar = document.createElement("div")
    accentBar.className = "story-card-accent"
    card.appendChild(accentBar)
    const accentBottom = document.createElement("div")
    accentBottom.className = "story-card-accent story-card-accent--bottom"
    card.appendChild(accentBottom)

    const imgLink = document.createElement("a")
    imgLink.href = story.url || "#"
    imgLink.target = story.url ? "_blank" : ""
    imgLink.rel = "noopener noreferrer"
    const imgWrap = document.createElement("div")
    imgWrap.className = "story-card-image-wrap"
    imgWrap.appendChild(buildImageEl(story.og_image, domain, false))
    imgLink.appendChild(imgWrap)
    card.appendChild(imgLink)

    const body = document.createElement("div")
    body.className = "story-card-body"

    const titleLink = document.createElement("a")
    titleLink.href = story.url || "#"
    titleLink.target = story.url ? "_blank" : ""
    titleLink.rel = "noopener noreferrer"
    const cardTitle = document.createElement("div")
    cardTitle.className = "story-card-title"
    cardTitle.textContent = story.title
    titleLink.appendChild(cardTitle)
    body.appendChild(titleLink)

    const meta = document.createElement("div")
    meta.className = "story-card-meta"
    meta.textContent = `▲ ${story.score ?? 0}  ·  ${story.author ?? "?"}` + (domain ? `  ·  ${domain}` : "")
    body.appendChild(meta)

    const summaryEl = document.createElement("div")
    summaryEl.className = "summary-box card-summary"
    summaryEl.textContent = story.groq_label || ""
    body.appendChild(summaryEl)

    const toggles = document.createElement("div")
    toggles.className = "toggles-row"
    toggles.appendChild(makeSummaryBtn(story, summaryIcon))
    body.appendChild(toggles)
    card.appendChild(body)
    grid.appendChild(card)
  })

  grid.hidden = false
})()
