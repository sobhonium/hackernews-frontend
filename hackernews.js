const $ = (id) => document.getElementById(id)
const HN_DISCUSSION = (id) => `https://news.ycombinator.com/item?id=${id}`

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

function commentBadge(count, href) {
  const a = document.createElement("a")
  a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"
  a.className = "comment-badge"
  a.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>${count}</span>`
  return a
}

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

function formatContent(text) {
  if (!text) return "<p class='inline-empty'>No content available.</p>"
  const lines = text.split("\n").filter(Boolean)
  const hasBullets = lines.some(l => /^[—\-•]\s/.test(l.trim()))
  if (hasBullets) {
    const items = lines.map(l => {
      const clean = l.replace(/^[—\-•]\s*/, "")
      return `<li>${clean}</li>`
    }).join("")
    return `<ul class="inline-list">${items}</ul>`
  }
  return `<p class="inline-text">${text}</p>`
}

// ── Expand / Collapse ──
let expandedId = null
let expandedType = null

function collapseExpand() {
  if (!expandedId) return
  const el = document.querySelector(`[data-expand-id="${expandedId}"]`)
  if (el) {
    el.classList.remove("story-card--expanded")
    const c = el.querySelector(".story-card-inline-content")
    if (c) c.hidden = true
    const badge = el.querySelector(".story-card-expanded-badge")
    if (badge) badge.hidden = true
  }
  expandedId = null
  expandedType = null
}

function toggleExpand(cardId, type, content) {
  if (expandedId === cardId && expandedType === type) {
    collapseExpand()
    return
  }
  collapseExpand()
  const el = document.querySelector(`[data-expand-id="${cardId}"]`)
  if (!el) return
  expandedId = cardId
  expandedType = type
  el.classList.add("story-card--expanded")
  const c = el.querySelector(".story-card-inline-content")
  if (c) {
    c.innerHTML = formatContent(content)
    c.hidden = false
  }
  const badge = el.querySelector(".story-card-expanded-badge")
  if (badge) {
    badge.textContent = type
    badge.className = "story-card-expanded-badge story-card-expanded-badge--" + type.toLowerCase()
    badge.hidden = false
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" })
}

function makeExpandBtn(label, iconSvg, type, content, cardId) {
  const btn = document.createElement("button")
  btn.className = "toggle-btn expand-btn"
  btn.innerHTML = iconSvg + " " + label
  btn.addEventListener("click", () => toggleExpand(cardId, type, content))
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
    if (el) el.textContent = d.toLocaleString()
  }
  if (countEl) countEl.textContent = `top ${stories.length}`

  const discussIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`
  const explainIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`

  function buildInlineWrap() {
    const wrap = document.createElement("div")
    wrap.className = "story-card-inline-wrap"
    const badge = document.createElement("span")
    badge.className = "story-card-expanded-badge"
    badge.hidden = true
    wrap.appendChild(badge)
    const content = document.createElement("div")
    content.className = "story-card-inline-content"
    content.hidden = true
    wrap.appendChild(content)
    const closeBtn = document.createElement("button")
    closeBtn.className = "story-card-inline-close"
    closeBtn.textContent = "Collapse"
    closeBtn.addEventListener("click", collapseExpand)
    wrap.appendChild(closeBtn)
    return wrap
  }

  // ── Featured ──
  const featured = stories[0]
  if (featured) {
    const domain = getDomain(featured.url)
    const discussionUrl = HN_DISCUSSION(featured.id)
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

    const badge = commentBadge(featured.descendants ?? 0, discussionUrl)
    card.appendChild(badge)

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
    meta.innerHTML =
      `▲ ${featured.score ?? 0}  ·  ${featured.author ?? "?"}  ·  ${featured.descendants ?? 0} comments` +
      (domain ? `  ·  ${domain}` : "")
    overlayEl.appendChild(meta)

    const summaryEl = document.createElement("div")
    summaryEl.className = "summary-box featured-summary"
    summaryEl.innerHTML = featured.groq_label || "No summary."
    overlayEl.appendChild(summaryEl)

    const toggles = document.createElement("div")
    toggles.className = "toggles-row"
    toggles.appendChild(makeExpandBtn("Discussion", discussIcon, "Discussion", featured.groq_discussion, cardId))
    toggles.appendChild(makeExpandBtn("Explain", explainIcon, "Explain", featured.groq_explain, cardId))
    overlayEl.appendChild(toggles)

    overlayEl.appendChild(buildInlineWrap())
    card.appendChild(overlayEl)
    featuredSection.appendChild(card)
    featuredSection.hidden = false
  }

  // ── Grid ──
  stories.slice(1).forEach((story, i) => {
    const domain = getDomain(story.url)
    const discussionUrl = HN_DISCUSSION(story.id)
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

    const badge = commentBadge(story.descendants ?? 0, discussionUrl)
    card.appendChild(badge)

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
    meta.innerHTML =
      `▲ ${story.score ?? 0}  ·  ${story.author ?? "?"}  ·  ${story.descendants ?? 0} comments` +
      (domain ? `  ·  ${domain}` : "")
    body.appendChild(meta)

    const summaryEl = document.createElement("div")
    summaryEl.className = "summary-box card-summary"
    summaryEl.textContent = story.groq_label || ""
    body.appendChild(summaryEl)

    const toggles = document.createElement("div")
    toggles.className = "toggles-row"
    toggles.appendChild(makeExpandBtn("Discussion", discussIcon, "Discussion", story.groq_discussion, cardId))
    toggles.appendChild(makeExpandBtn("Explain", explainIcon, "Explain", story.groq_explain, cardId))
    body.appendChild(toggles)

    body.appendChild(buildInlineWrap())
    card.appendChild(body)
    grid.appendChild(card)
  })

  grid.hidden = false
})()
