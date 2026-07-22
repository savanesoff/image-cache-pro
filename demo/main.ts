/**
 * image-cache-pro demo — rails of posters (the STB workload the lib exists
 * for) driving the real scheduler, with the full state surface on screen:
 * global RAM/VID budgets, per-rail load/render progress + memory, per-card
 * info, priority lanes, and the input-yield gate.
 *
 * Written Cobalt-first (Chrome-88-class STB browser): divs only, explicit
 * dimensions on everything that paints, transform-based scrolling, keyCode
 * input, no modern CSS. If it runs on Cobalt it runs anywhere.
 *
 * Query params:
 * - mode=stampede   naive paint-everything-at-once (comparison baseline)
 * - rails, cards    grid size (default 8×24)
 * - ram, video      budgets in MB (default 400 / 240)
 * - budget          frame budget in bytes (default lib default)
 * - hwrank          0..1 budget scalar
 * - img=<origin>    image source base; default picsum.photos
 */
import { Bucket, Controller, RenderRequest } from '../src'
import type { Size } from '../src'

// boot heartbeat: proves the bundle executed (visible before anything else)
const modeBadge = document.getElementById('mode')
if (modeBadge) modeBadge.textContent = 'booting…'

// hand-rolled query parser — URLSearchParams is not in Cobalt's Web API subset
const query: Record<string, string> = {}
location.search
  .replace(/^\?/, '')
  .split('&')
  .forEach(pair => {
    const eq = pair.indexOf('=')
    if (eq > 0) {
      query[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(
        pair.slice(eq + 1),
      )
    }
  })
const params = {
  get: (key: string): string | null => (key in query ? query[key] : null),
}
const num = (key: string, fallback: number): number => {
  const raw = Number(params.get(key))
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

const setSearch = (key: string, value: string) => {
  query[key] = value
  const parts: string[] = []

  for (const k in query) {
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
  }

  location.search = parts.join('&')
}

const MODE_STAMPEDE = params.get('mode') === 'stampede'
const RAILS = num('rails', 8)
const CARDS = num('cards', 24)
const CARD_SIZE: Size = { width: 320, height: 180 }
const IMG_BASE = params.get('img') ?? 'https://picsum.photos'

const imageUrl = (rail: number, card: number): string =>
  `${IMG_BASE}/seed/r${rail}c${card}/${CARD_SIZE.width}/${CARD_SIZE.height}`

//---------------------------------------------------------------------------
// Viewport-scaled rem root: 1rem = 16px at 1280w, 24px at 1920w (the box)
//---------------------------------------------------------------------------
const REM = (window.innerWidth / 1280) * 16
document.documentElement.style.fontSize = `${REM}px`
const rem = (px: number) => `${px / 16}rem`

// card box in "design px" (matches .card in style.css: 10rem × 5.65rem)
const CARD_W = 160
const CARD_H = 90.4
const CARD_GAP = 8
const RAIL_H = 33.6 + CARD_H + 9.6 // header + cards + rail margins/padding

//---------------------------------------------------------------------------
// Input-yield gate: warming pauses while a key is held (and briefly after)
//---------------------------------------------------------------------------
let busyUntil = 0
let keyDown = false
const canRender = () => !keyDown && performance.now() > busyUntil

//---------------------------------------------------------------------------
// Demo state exposed for the Playwright suite
//---------------------------------------------------------------------------
type DemoState = {
  controller: Controller | null
  rendered: number
  total: number
  renderOrder: string[]
  errors: string[]
}
const demo: DemoState = {
  controller: null,
  rendered: 0,
  total: RAILS * CARDS,
  renderOrder: [],
  errors: [],
}
declare global {
  interface Window {
    __demo: DemoState
  }
}
window.__demo = demo

//---------------------------------------------------------------------------
// DOM scaffolding (all sizes explicit — Cobalt never auto-sizes)
//---------------------------------------------------------------------------
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id}`)
  return el
}

const app = $('app')
app.style.width = `${window.innerWidth}px`
app.style.height = `${window.innerHeight}px`

const railsViewport = $('rails-viewport')
const railsRoot = $('rails')
const railWidth = window.innerWidth - 2 * REM

type RailUI = {
  root: HTMLElement
  cardsRow: HTMLElement
  load: HTMLElement
  render: HTMLElement
  ram: HTMLElement
  vid: HTMLElement
  bucket: Bucket | null
  requests: RenderRequest[]
}

type CellUI = { element: HTMLElement; rail: number; card: number }

const railUIs: RailUI[] = []
const cells: CellUI[][] = []

const div = (className: string, parent: HTMLElement): HTMLElement => {
  const el = document.createElement('div')
  el.className = className
  parent.appendChild(el)
  return el
}

/** Builds the DOM for one rail; rails can be added on the go (see key A) */
function buildRailUI(rail: number) {
  const railEl = div('rail', railsRoot)
  railEl.style.width = `${railWidth}px`

  const header = div('rail-header', railEl)
  const name = div('rail-name', header)
  name.textContent = `Rail ${rail}${rail === 0 ? ' ★' : ''}`
  const load = div('badge b-load', header)
  const render = div('badge b-render', header)
  const ram = div('badge b-ram', header)
  const vid = div('badge b-vid', header)

  const cardsViewport = div('cards-viewport', railEl)
  cardsViewport.style.width = `${railWidth}px`
  cardsViewport.style.height = rem(CARD_H)
  const cardsRow = div('cards', cardsViewport)
  cardsRow.style.width = `${CARDS * (CARD_W + CARD_GAP)}px`
  cardsRow.style.height = rem(CARD_H)

  const row: CellUI[] = []

  for (let card = 0; card < CARDS; card++) {
    const el = div('card', cardsRow)
    el.setAttribute('data-cell', `r${rail}c${card}`)
    el.style.backgroundSize = `${rem(CARD_W)} ${rem(CARD_H)}`
    row.push({ element: el, rail, card })
  }

  cells.push(row)
  railUIs.push({
    root: railEl,
    cardsRow,
    load,
    render,
    ram,
    vid,
    bucket: null,
    requests: [],
  })
}

for (let rail = 0; rail < RAILS; rail++) {
  buildRailUI(rail)
}

//---------------------------------------------------------------------------
// Scheduled mode: Controller → Bucket-per-rail → RenderRequest-per-card
//---------------------------------------------------------------------------

/** Creates the bucket + requests for one (already-built) rail */
function scheduleRail(rail: number) {
  const controller = demo.controller
  if (!controller) return

  const bucket = new Bucket({
    controller,
    name: `rail-${rail}`,
    priority: rail === 0 ? 1 : 0,
  })
  railUIs[rail].bucket = bucket

  for (let card = 0; card < CARDS; card++) {
    const cell = cells[rail][card]
    const request = new RenderRequest({
      bucket,
      url: imageUrl(rail, card),
      size: CARD_SIZE, // decoder bypass: dimensions are known
    })
    railUIs[rail].requests.push(request)
    request.on('rendered', event => {
      const src = request.image.element.src || event.url || ''
      cell.element.style.backgroundImage = `url("${src}")`
      cell.element.className = 'card ready'
      demo.rendered++
      demo.renderOrder.push(`r${rail}c${card}`)
      refreshFocusClasses()
    })
    request.on('error', event => {
      demo.errors.push(`r${rail}c${card}: ${event.statusText}`)
    })
    request.on('clear', () => {
      // evicted (or recycled): show it — the texture charge is gone
      if (cell.element.className.indexOf('ready') !== -1) {
        cell.element.className = 'card evicted'
        cell.element.style.backgroundImage = ''
      }
    })
  }
}

function startScheduled() {
  demo.controller = new Controller({
    ram: num('ram', 400),
    video: num('video', 240),
    units: 'MB',
    loaders: 4,
    hwRank: Math.min(1, Math.max(0, Number(params.get('hwrank')) || 1)),
    frameBudget: params.get('budget')
      ? { bytes: num('budget', 1_048_576) }
      : undefined,
    canRender,
    logLevel: 'error',
  })

  for (let rail = 0; rail < RAILS; rail++) {
    scheduleRail(rail)
  }
}

//---------------------------------------------------------------------------
// Knobs: live budget changes + on-the-go rail additions (watch eviction)
//---------------------------------------------------------------------------
function addRail() {
  if (!demo.controller || MODE_STAMPEDE) return
  const rail = railUIs.length
  buildRailUI(rail)
  scheduleRail(rail)
  demo.total = railUIs.length * CARDS
}

/** Halve/double a budget live — the engine evicts (or breathes) immediately */
function nudgeBudget(target: 'ram' | 'video' | 'frame', up: boolean) {
  const controller = demo.controller
  if (!controller) return
  const factor = up ? 2 : 0.5

  if (target === 'ram') {
    controller.setRamBudget(Math.max(1, controller.ram.size * factor))
  } else if (target === 'video') {
    controller.setVideoBudget(Math.max(1, controller.video.size * factor))
  } else {
    const budget = controller.frameQueue.frameBudget
    budget.bytes = Math.max(1024, budget.bytes * factor)
  }
}

//---------------------------------------------------------------------------
// Stampede mode: paint everything at once (what the lib prevents)
//---------------------------------------------------------------------------
function startStampede() {
  for (let rail = 0; rail < RAILS; rail++) {
    for (let card = 0; card < CARDS; card++) {
      const cell = cells[rail][card]
      const img = new Image()
      img.onload = () => {
        cell.element.style.backgroundImage = `url("${img.src}")`
        cell.element.className = 'card ready'
        demo.rendered++
        demo.renderOrder.push(`r${rail}c${card}`)
        refreshFocusClasses()
      }
      img.src = imageUrl(rail, card)
    }
  }
}

//---------------------------------------------------------------------------
// Navigation — transform-based scrolling (no scrollIntoView on Cobalt),
// keyCode-first input (RCU keys arrive as keydown with legacy keyCodes)
//---------------------------------------------------------------------------
let focusRail = 0
let focusCard = 0
let focusedCellEl: HTMLElement | null = null
const infoEl = document.createElement('div')
infoEl.className = 'card-info'
const infoLines = [0, 1, 2, 3].map(() => {
  const line = document.createElement('div')
  line.className = 'card-info-line'
  infoEl.appendChild(line)
  return line
})

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2)

function refreshFocusClasses() {
  const cell = cells[focusRail][focusCard]

  if (focusedCellEl !== cell.element && focusedCellEl) {
    focusedCellEl.className = focusedCellEl.className
      .replace(' focused', '')
      .trim()

    if (infoEl.parentElement === focusedCellEl) {
      focusedCellEl.removeChild(infoEl)
    }
  }

  focusedCellEl = cell.element

  if (focusedCellEl.className.indexOf('focused') === -1) {
    focusedCellEl.className += ' focused'
  }

  // per-card info overlay (index, priority, state, video bytes)
  const request = railUIs[focusRail].requests[focusCard] ?? null
  infoLines[0].textContent = `cell r${focusRail}c${focusCard}`
  infoLines[1].textContent = request
    ? `prio ${request.priority} · ${request.rendered ? 'rendered' : request.requested ? 'queued' : 'loading'}`
    : 'stampede mode'
  infoLines[2].textContent = request ? `vid ${mb(request.bytesVideo)}MB` : ''
  infoLines[3].textContent = request
    ? `ram ${mb(request.image.getBytesRam())}MB`
    : ''

  if (infoEl.parentElement !== focusedCellEl) {
    focusedCellEl.appendChild(infoEl)
  }
}

function applyFocus() {
  for (let rail = 0; rail < RAILS; rail++) {
    const railUI = railUIs[rail]
    const isFocused = rail === focusRail

    if (isFocused && railUI.root.className !== 'rail focused') {
      railUI.root.className = 'rail focused'
    } else if (!isFocused && railUI.root.className !== 'rail') {
      railUI.root.className = 'rail'
    }
  }

  // horizontal: keep the focused card in view (translate, never scroll)
  const railUI = railUIs[focusRail]
  const maxOffset = Math.max(
    0,
    CARDS * (CARD_W + CARD_GAP) - railWidth / (REM / 16),
  )
  const target = Math.min(focusCard * (CARD_W + CARD_GAP), maxOffset)
  railUI.cardsRow.style.transform = `translate(${rem(-target)}, 0)`

  // vertical: keep the focused rail in view
  const viewH = railsViewport.clientHeight
  const railTop = focusRail * RAIL_H * (REM / 16)
  const railBottom = railTop + RAIL_H * (REM / 16)
  const currentY = railsScrollY

  let nextY = currentY

  if (railTop + currentY < 0) {
    nextY = -railTop
  } else if (railBottom + currentY > viewH) {
    nextY = viewH - railBottom
  }

  if (nextY !== railsScrollY) {
    railsScrollY = nextY
    railsRoot.style.transform = `translate(0, ${railsScrollY}px)`
  }

  refreshFocusClasses()
}
let railsScrollY = 0

const KEY = {
  left: 37,
  up: 38,
  right: 39,
  down: 40,
  s: 83,
  p: 80,
  c: 67,
  a: 65,
  one: 49,
  two: 50,
  three: 51,
  four: 52,
  five: 53,
  six: 54,
}

function onKeyDown(event: KeyboardEvent) {
  keyDown = true
  busyUntil = performance.now() + 150
  const code = event.keyCode

  switch (code) {
    case KEY.left:
      focusCard = Math.max(0, focusCard - 1)
      break
    case KEY.right:
      focusCard = Math.min(CARDS - 1, focusCard + 1)
      break
    case KEY.up:
      focusRail = Math.max(0, focusRail - 1)
      break
    case KEY.down:
      focusRail = Math.min(RAILS - 1, focusRail + 1)
      break
    case KEY.s: {
      setSearch('mode', MODE_STAMPEDE ? 'scheduled' : 'stampede')
      return
    }

    case KEY.p: {
      const queue = demo.controller?.frameQueue
      if (queue) {
        if (queue.paused) {
          queue.resume()
        } else {
          queue.pause()
        }
      }

      return
    }
    case KEY.c:
      demo.controller?.clear()
      location.reload()
      return
    case KEY.a:
      addRail()
      return
    case KEY.one:
      nudgeBudget('ram', false)
      return
    case KEY.two:
      nudgeBudget('ram', true)
      return
    case KEY.three:
      nudgeBudget('video', false)
      return
    case KEY.four:
      nudgeBudget('video', true)
      return
    case KEY.five:
      nudgeBudget('frame', false)
      return
    case KEY.six:
      nudgeBudget('frame', true)
      return
    default:
      return
  }

  event.preventDefault()
  applyFocus()
}

document.addEventListener('keydown', onKeyDown)
document.addEventListener('keyup', () => {
  keyDown = false
  busyUntil = performance.now() + 150
})

//---------------------------------------------------------------------------
// Stats — global badges + per-rail badges, fps meter
//---------------------------------------------------------------------------
let fps = 60
let lastFrame = performance.now()
const measureFps = () => {
  const now = performance.now()
  const delta = now - lastFrame
  lastFrame = now
  fps = fps * 0.95 + (1000 / Math.max(delta, 1)) * 0.05
  requestAnimationFrame(measureFps)
}
requestAnimationFrame(measureFps)

const statRam = $('stat-ram')
const statVid = $('stat-vid')
const statImgs = $('stat-imgs')
const statReqs = $('stat-reqs')
const statQueue = $('stat-queue')
const statFps = $('stat-fps')

const pct = (used: number, size: number) =>
  size > 0 ? ((used / size) * 100).toFixed(1) : '0'

setInterval(() => {
  statFps.textContent = `fps ${fps.toFixed(0)}`
  const controller = demo.controller

  if (!controller) {
    statQueue.textContent = `${demo.rendered}/${demo.total}`
    return
  }

  const ram = controller.ram.getUsedSpace()
  const ramState = controller.ram.getState()
  const vid = controller.video.getUsedSpace()
  const vidState = controller.video.getState()
  const stats = controller.getRequestsStats()

  statRam.textContent = `RAM ${ram.units.toFixed(2)}/${ramState.size}MB ${pct(ram.units, ramState.size)}%`
  statVid.textContent = `VID ${vid.units.toFixed(2)}/${vidState.size}MB ${pct(vid.units, vidState.size)}%`
  statImgs.textContent = `I: ${controller.cache.size}`
  statReqs.textContent = `R: ${stats.total}`
  statQueue.textContent = `Q: ${controller.frameQueue.size}${controller.frameQueue.paused ? ' ⏸' : ''}`

  for (let rail = 0; rail < RAILS; rail++) {
    const ui = railUIs[rail]
    if (!ui.bucket) continue
    let renderedCount = 0

    for (const request of ui.requests) {
      renderedCount += request.rendered && !request.cleared ? 1 : 0
    }

    const ramUnits = ui.bucket.getRamUnits()
    const vidUnits = ui.bucket.getVideoUnits()
    ui.load.textContent = `load ${Math.round(ui.bucket.loadProgress * 100)}%`
    ui.render.textContent = `render ${Math.round((renderedCount / CARDS) * 100)}%`
    ui.ram.textContent = `RAM c:${ramUnits.compressed.toFixed(2)} u:${ramUnits.uncompressed.toFixed(2)} t:${ramUnits.total.toFixed(2)}`
    ui.vid.textContent = `VID r:${vidUnits.requested.toFixed(2)} u:${vidUnits.used.toFixed(2)}`
  }
}, 250)

//---------------------------------------------------------------------------
// Boot
//---------------------------------------------------------------------------
$('mode').textContent = MODE_STAMPEDE
  ? 'MODE: stampede (naive)'
  : 'MODE: scheduled (paced)'

if (MODE_STAMPEDE) {
  startStampede()
} else {
  startScheduled()
}

applyFocus()
