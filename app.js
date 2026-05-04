/* ── Constants & projection ───────────────────────────── */
const SVG_W = 960, SVG_H = 520
const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
const svg = document.getElementById('map-svg')

const projection = d3.geoMercator()
  .center([90, 12])   // shifted slightly south-west to centre the content range
  .scale(360)         // zoomed out to give ~15% margin around the outermost markers
  .translate([SVG_W / 2, SVG_H / 2])

const geoPath = d3.geoPath().projection(projection)

function proj(coords) { return projection(coords) }

/* ── Geographic biome colors (ISO 3166-1 numeric codes) ── */
const COUNTRY_COLORS = {
  // Arabian Peninsula — hot desert
  682: '#c8864a', 887: '#bf7e44', 512: '#c8864a',
  784: '#c8864a', 634: '#c8864a',  48: '#c8864a', 414: '#c8864a',
  // Levant / Near East
  400: '#c07e44', 368: '#ba7a40', 760: '#bc7c42',
  376: '#b8944e', 422: '#8aaa60', 792: '#8eaa62',
  // Iran plateau — semi-arid
  364: '#b08a48',
  // Caucasus
  268: '#80a868',  31: '#98a65e',  51: '#98a25c',
  // South Asia
  356: '#7ea65c', // India — mixed tropical/dry
  586: '#ae8a50', // Pakistan — semi-arid
   50: '#5a9c5a', // Bangladesh — tropical
  144: '#54985a', // Sri Lanka — tropical
  524: '#909a72', // Nepal — high-altitude mountain
   64: '#909a72', // Bhutan — mountain
  462: '#4e9c6c', // Maldives
  // Southeast Asia — tropical/equatorial
  104: '#5a9858', 764: '#5c9a5a', 418: '#549854',
  704: '#549854', 116: '#609858', 458: '#46905a',
  360: '#3c8c4e', // Indonesia — equatorial rainforest
  608: '#429050', 702: '#469058',  96: '#3c8c4e',
  626: '#4a9858',  90: '#3c8c4e',
  // East Asia
  156: '#7ea45e', // China — vast mixed terrain
  392: '#6aa070', // Japan — temperate
  410: '#74a468', 408: '#74a468',
  496: '#acb060', // Mongolia — steppe/Gobi
  158: '#6ea06a',
  // Central Asia — steppe / semi-arid
  398: '#b6b05e', // Kazakhstan — steppe
  860: '#aeA458', // Uzbekistan
  795: '#be9850', // Turkmenistan — desert
  762: '#969e70', // Tajikistan — mountain
  417: '#969e70', // Kyrgyzstan — mountain
    4: '#a68a50', // Afghanistan — arid/mountain
  // Oceania
   36: '#bc9058', // Australia — arid interior
  598: '#3c8c4e', // Papua New Guinea — tropical
  554: '#6eaa72', // New Zealand — temperate
  242: '#4ea068', 548: '#4ea068', 882: '#4ea068',
  // Russia — boreal / taiga
  643: '#6e8c62',
  // Northeast Africa (left-edge visibility)
  818: '#c88e4e', 434: '#c88e4e', 788: '#c08848',
  706: '#b88e4e', 231: '#a08c50', 404: '#8ea25c',
}
const LAND_DEFAULT = '#a0a870' // generic fallback

/* ── State ────────────────────────────────────────────── */
let activeStory = null

/* ── Curve helper ─────────────────────────────────────── */
function curveControlPoint([x1, y1], [x2, y2], lift = 40) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  return [mx - (dy / len) * lift, my + (dx / len) * lift]
}

/* ── SVG element factory ──────────────────────────────── */
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

/* ── Build SVG layers in Z-order (all synchronous) ────── */
function buildSVG() {
  // 1. Defs first — gradient must be defined before it is referenced
  const defs = svgEl('defs')

  // (no gradient needed — flat ocean colour avoids edge-shading artefacts)

  // Arrow markers for migration paths
  STORIES.forEach(story => {
    const marker = svgEl('marker', {
      id: `arrow-${story.id}`,
      markerWidth: '7', markerHeight: '7',
      refX: '6', refY: '3.5', orient: 'auto',
    })
    const tri = svgEl('polygon', { points: '0 0, 7 3.5, 0 7', fill: story.color })
    marker.appendChild(tri)
    defs.appendChild(marker)
  })
  svg.appendChild(defs)

  // 2. Ocean (uses gradient defined above)
  svg.appendChild(svgEl('rect', { width: SVG_W, height: SVG_H, fill: '#163d58' }))

  // 3. Land placeholder — populated async, stays below everything else
  const landGroup = svgEl('g', { class: 'land' })
  svg.appendChild(landGroup)

  // 4. Migration paths
  const pathGroup = svgEl('g', { class: 'migration-paths' })
  STORIES.forEach(story => {
    const [x1, y1] = proj(story.from)
    const [x2, y2] = proj(story.to)
    const [cx, cy] = curveControlPoint([x1, y1], [x2, y2], 40)
    const el = svgEl('path', {
      d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`,
      fill: 'none',
      stroke: story.color,
      'stroke-width': '2',
      'stroke-dasharray': '10 5',
      'stroke-linecap': 'round',
      'marker-end': `url(#arrow-${story.id})`,
      opacity: '0.8',
    })
    el.dataset.storyId = story.id
    el.classList.add('migration-path')
    pathGroup.appendChild(el)
  })
  svg.appendChild(pathGroup)

  // 5. Markers — always visible, no network needed
  const markerGroup = svgEl('g', { class: 'markers' })
  STORIES.forEach(story => {
    const coords = proj(story.markerCoords)
    if (!coords) return
    const [mx, my] = coords

    const g = svgEl('g', { transform: `translate(${mx},${my})` })
    g.style.cursor = 'pointer'
    g.dataset.storyId = story.id

    // Pulse ring (animated)
    const ring = svgEl('circle', {
      r: '14', fill: 'none',
      stroke: story.color, 'stroke-width': '1.5',
    })
    ring.classList.add('pulse-ring')
    g.appendChild(ring)

    // Solid marker circle
    const circle = svgEl('circle', {
      r: '9', fill: story.color, stroke: 'white', 'stroke-width': '2',
    })
    circle.classList.add('marker-circle')
    g.appendChild(circle)

    // Story number
    const label = svgEl('text', {
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      fill: 'white', 'font-size': '9', 'font-weight': 'bold',
      'pointer-events': 'none',
    })
    label.textContent = story.id
    g.appendChild(label)

    g.addEventListener('click', () => selectStory(story))
    markerGroup.appendChild(g)
  })
  svg.appendChild(markerGroup)

  return landGroup
}

/* ── Async: fetch & draw countries behind everything ───── */
async function loadCountries(landGroup) {
  try {
    const world = await fetch(GEO_URL).then(r => r.json())
    const countries = topojson.feature(world, world.objects.countries)
    countries.features.forEach(feature => {
      const d = geoPath(feature)
      if (!d) return
      const fill = COUNTRY_COLORS[feature.id] ?? LAND_DEFAULT
      const el = svgEl('path', {
        d,
        fill,
        stroke: '#0c2030',
        'stroke-width': '0.3',
        'stroke-opacity': '0.35',
      })
      landGroup.appendChild(el)
    })
  } catch (err) {
    console.warn('World map data unavailable — markers still work:', err)
  }
}

/* ── Interaction: select / deselect ───────────────────── */
function selectStory(story) {
  activeStory = (activeStory?.id === story.id) ? null : story
  updateMapState()
  renderPanel()
}

function updateMapState() {
  document.querySelectorAll('.migration-path').forEach(el => {
    const id = Number(el.dataset.storyId)
    if (!activeStory) {
      el.setAttribute('opacity', '0.8')
      el.setAttribute('stroke-width', '2')
    } else if (id === activeStory.id) {
      el.setAttribute('opacity', '1')
      el.setAttribute('stroke-width', '2.8')
    } else {
      el.setAttribute('opacity', '0.15')
      el.setAttribute('stroke-width', '1.5')
    }
  })

  document.querySelectorAll('.markers g').forEach(g => {
    const id = Number(g.dataset.storyId)
    const circle = g.querySelector('.marker-circle')
    const ring = g.querySelector('.pulse-ring')
    const story = STORIES.find(s => s.id === id)
    if (!circle || !ring || !story) return
    if (activeStory?.id === id) {
      circle.setAttribute('r', '12')
      circle.style.filter = `drop-shadow(0 0 10px ${story.color})`
      ring.style.opacity = '0'
    } else {
      circle.setAttribute('r', '9')
      circle.style.filter = ''
      ring.style.opacity = '1'
    }
  })

  document.getElementById('overlay').classList.toggle('active', !!activeStory)

  document.querySelectorAll('.legend-item').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.storyId) === activeStory?.id)
  })
}

/* ── Story panel ──────────────────────────────────────── */
function renderPanel() {
  const panel = document.getElementById('story-panel')
  const story = activeStory

  if (!story) {
    panel.classList.remove('open')
    setTimeout(() => { panel.innerHTML = '' }, 420)
    return
  }

  panel.style.setProperty('--story-color', story.color)
  panel.innerHTML = `
    <button class="panel-close" aria-label="Close">✕</button>
    <div class="panel-hero" style="background:${story.bgGradient}">
      <img class="panel-hero-img" src="${story.image}" alt="${story.title}"
           onerror="this.style.display='none'" />
      <div class="panel-hero-overlay">
        <span class="panel-num">#${story.id}</span>
        <h2 class="panel-title">${story.title}</h2>
        <span class="panel-period">${story.period}</span>
      </div>
    </div>
    <div class="panel-body">
      <div class="character-card">
        <div class="character-name">${story.character}</div>
        <div class="character-tagline">"${story.tagline}"</div>
      </div>
      <div class="story-text">
        ${story.story.map(p => `<p>${p}</p>`).join('')}
      </div>
    </div>
  `

  panel.querySelector('.panel-close').addEventListener('click', () => {
    activeStory = null
    updateMapState()
    renderPanel()
  })

  requestAnimationFrame(() => panel.classList.add('open'))
}

/* ── Legend ───────────────────────────────────────────── */
function buildLegend() {
  const legend = document.getElementById('legend')
  STORIES.forEach(story => {
    const btn = document.createElement('button')
    btn.className = 'legend-item'
    btn.dataset.storyId = story.id
    btn.innerHTML = `
      <span class="legend-dot" style="background:${story.color}"></span>
      <span class="legend-label">${story.title}</span>
    `
    btn.addEventListener('click', () => selectStory(story))
    legend.appendChild(btn)
  })
}

/* ── Overlay dismisses panel ──────────────────────────── */
document.getElementById('overlay').addEventListener('click', () => {
  activeStory = null
  updateMapState()
  renderPanel()
})

/* ── Boot: synchronous structure first, then async geo ── */
const landGroup = buildSVG()   // markers visible immediately
buildLegend()
loadCountries(landGroup)        // countries fill in behind markers
