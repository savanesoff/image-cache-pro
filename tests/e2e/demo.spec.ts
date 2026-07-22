import { expect, test, type Page } from '@playwright/test'

/**
 * E2E over the demo app (demo/), driving the real scheduler in Chromium.
 *
 * Image requests are intercepted and served a valid local PNG so the suite is
 * hermetic (no picsum dependency). The lib gets its `size` from the caller
 * (decoder bypass), so pixel content is irrelevant.
 */

// 8x8 red PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGP8z8Dwn4EIwESMolGFlCsEAE/gAhGCkuVLAAAAAElFTkSuQmCC'
const PNG = Buffer.from(PNG_BASE64, 'base64')

// window.__demo is declared globally by demo/main.ts (same TS program)

const mockImages = async (page: Page, delayMs = 0) => {
  await page.route('**/seed/**', async route => {
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }

    await route.fulfill({ contentType: 'image/png', body: PNG })
  })
}

const demoState = (page: Page) => page.evaluate(() => window.__demo)

test.describe('scheduled mode', () => {
  test('renders every card, paced across frames, without errors', async ({
    page,
  }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(String(error)))
    await mockImages(page)
    await page.goto('/?rails=4&cards=8')

    // paced: immediately after load not everything can be rendered yet
    const early = await demoState(page)
    expect(early.rendered).toBeLessThan(early.total)

    await page.waitForFunction(
      () => window.__demo.rendered === window.__demo.total,
    )

    const state = await demoState(page)
    expect(state.errors).toEqual([])
    expect(pageErrors).toEqual([])
    await expect(page.locator('.card.ready')).toHaveCount(state.total)
  })

  test('renders the focused (high priority) rail first', async ({ page }) => {
    await mockImages(page)
    await page.goto('/?rails=6&cards=6&budget=1')

    await page.waitForFunction(
      () => window.__demo.rendered === window.__demo.total,
    )

    const { renderOrder } = await demoState(page)
    const firstRailPositions = renderOrder
      .map((id, index) => ({ id, index }))
      .filter(({ id }) => id.startsWith('r0'))
      .map(({ index }) => index)

    // all rail-0 cards must render within the first quarter of the order
    const worst = Math.max(...firstRailPositions)
    expect(worst).toBeLessThan(renderOrder.length / 4)
  })

  test('warming yields while a key is held and resumes on idle', async ({
    page,
  }) => {
    await mockImages(page)
    // tiny byte budget → one warm per frame → long drain we can interrupt
    await page.goto('/?rails=6&cards=10&budget=1')

    await page.waitForFunction(() => window.__demo.rendered > 0)

    await page.keyboard.down('ArrowRight')
    // let in-flight work settle, then sample twice while the key is held
    await page.waitForTimeout(300)
    const held1 = (await demoState(page)).rendered
    await page.waitForTimeout(400)
    const held2 = (await demoState(page)).rendered
    expect(held2).toBe(held1)

    await page.keyboard.up('ArrowRight')
    await page.waitForFunction(
      () => window.__demo.rendered === window.__demo.total,
    )
  })

  test('creates a single in-viewport prewarm layer that drains', async ({
    page,
  }) => {
    await mockImages(page)
    await page.goto('/?rails=3&cards=6')

    await page.waitForFunction(() =>
      document.querySelector('[data-image-cache-pro="prewarm-layer"]'),
    )
    const layers = page.locator('[data-image-cache-pro="prewarm-layer"]')
    await expect(layers).toHaveCount(1)

    // layer is anchored in-viewport (Cobalt invariant)
    const box = await layers.evaluate(el => {
      const rect = el.getBoundingClientRect()
      return { top: rect.top, left: rect.left }
    })
    expect(box.top).toBe(0)
    expect(box.left).toBe(0)

    await page.waitForFunction(
      () => window.__demo.rendered === window.__demo.total,
    )
    // all warm divs removed after the queue drains
    await page.waitForFunction(
      () =>
        document.querySelector('[data-image-cache-pro="prewarm-layer"]')
          ?.childElementCount === 0,
    )
  })

  test('slow network: cards render as loads land, no error events', async ({
    page,
  }) => {
    await mockImages(page, 100)
    await page.goto('/?rails=2&cards=4')
    await page.waitForFunction(
      () => window.__demo.rendered === window.__demo.total,
    )
    expect((await demoState(page)).errors).toEqual([])
  })
})

test.describe('stampede mode (baseline)', () => {
  test('still renders everything (comparison path works)', async ({ page }) => {
    await mockImages(page)
    await page.goto('/?mode=stampede&rails=3&cards=6')
    await page.waitForFunction(
      () => window.__demo.rendered === window.__demo.total,
    )
  })
})
