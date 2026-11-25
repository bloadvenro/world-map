import { test, expect, type Page } from '@playwright/test'

async function openMap(page: Page) {
  await page.goto('./')
  await expect(page.locator('#map')).toHaveAccessibleDescription('Масштаб 1×', {
    timeout: 20000,
  })
}
async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const AudioElement = window.Audio
    window.Audio = class extends AudioElement {
      constructor(src?: string) {
        super(src)
        this.addEventListener('playing', () => {
          document.body.dataset.playing = this.currentSrc.split('/').pop()
        })
        this.addEventListener('ended', () => {
          document.body.dataset.ended = this.currentSrc.split('/').pop()
        })
      }
    }
  })
}
test('bare map with country audio, wheel and keyboard zoom', async ({
  page,
}) => {
  await observeAudio(page)
  await openMap(page)
  await expect(
    page.locator('.brand, .actions, #hint, #zoom, #reset, #sound, #repeat'),
  ).toHaveCount(0)
  await expect(page.locator('#selection')).toBeHidden()
  // Brazil at 55°W, 10°S in the initial equirectangular view.
  await page.mouse.click(350, 433)
  await expect(page.locator('#chosen-name')).toHaveText('Бразилия')
  await expect(page.locator('body')).toHaveAttribute('data-playing', 'br.mp3')
  await expect(page.locator('body')).toHaveAttribute('data-ended', 'br.mp3')
  await page.mouse.move(360, 433)
  await page.mouse.wheel(0, -1600)
  const map = page.locator('#map')
  await expect(map).toHaveAccessibleDescription('Масштаб 4×')
  await map.press('-')
  await expect(map).toHaveAccessibleDescription('Масштаб 3,75×')
  await page.mouse.wheel(0, 1600)
  await expect(map).toHaveAccessibleDescription('Масштаб 1×')
  await map.press('Escape')
  await expect(page.locator('#selection')).toBeHidden()
})
test('offline cold start and first playback of an unheard country', async ({
  page,
  context,
}) => {
  await observeAudio(page)
  await openMap(page)
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  const cacheCount = await page.evaluate(async () => {
    const keys = await caches.keys()
    const cache = await caches.open(
      keys.find((k) => k.startsWith('flag-atlas:'))!,
    )
    return (await cache.keys()).filter((k) => k.url.endsWith('.mp3')).length
  })
  expect(cacheCount).toBe(195)
  const next = await context.newPage()
  const url = page.url()
  await page.close()
  await observeAudio(next)
  await context.setOffline(true)
  await next.goto(url)
  await expect(next.locator('#map')).toHaveAccessibleDescription('Масштаб 1×')
  const range = await next.evaluate(async () => {
    const response = await fetch('./voice/jp.mp3', {
      headers: { Range: 'bytes=10-19' },
    })
    return [response.status, (await response.arrayBuffer()).byteLength]
  })
  expect(range).toEqual([206, 10])
  await next.mouse.click(350, 433)
  await expect(next.locator('#chosen-flag')).toHaveAttribute('src', /br\.svg$/)
  await expect(next.locator('body')).toHaveAttribute('data-ended', 'br.mp3')
})

test.describe('touch', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  })
  test('swipe to Japan, pinch to both limits, cross the Pacific and select Vatican', async ({
    page,
    context,
  }) => {
    await observeAudio(page)
    await openMap(page)
    const cdp = await context.newCDPSession(page)
    type Finger = { x: number; y: number; id: number }
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      touchPoints: Finger[],
    ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
    async function swipe(from: number, to: number) {
      await touch('touchStart', [{ x: from, y: 415, id: 1 }])
      await touch('touchMove', [{ x: to, y: 415, id: 1 }])
      await touch('touchEnd', [])
    }
    await swipe(335, 55)
    await swipe(335, 55)
    await expect(page.locator('#selection')).toBeHidden()
    await expect(page.locator('body')).not.toHaveAttribute('data-playing', /.+/)
    // Camera now near 139°E. Tap central Honshu.
    await page.touchscreen.tap(192, 253)
    await expect(page.locator('#chosen-name')).toHaveText('Япония')
    await expect(page.locator('body')).toHaveAttribute('data-playing', 'jp.mp3')
    await page.locator('#dismiss').tap()
    await swipe(335, 55)
    await swipe(335, 55)
    // After crossing 180°, central US lies near the middle of the screen.
    await page.touchscreen.tap(203, 239)
    await expect(page.locator('#chosen-name')).toHaveText('США')
    await openMap(page)
    const fingers = (half: number) => [
      { x: 195 - half, y: 232, id: 1 },
      { x: 195 + half, y: 232, id: 2 },
    ]
    await touch('touchStart', fingers(27))
    await touch('touchMove', fingers(120))
    await touch('touchEnd', [])
    await expect(page.locator('#map')).toHaveAccessibleDescription('Масштаб 4×')
    await expect(page.locator('#selection')).toBeHidden()
    const mark = page.locator('.mark[title*="Ватикан"]').first()
    await mark.tap()
    if (await page.locator('#nearby').isVisible())
      await page.locator('#choices button').filter({ hasText: 'Ватикан' }).tap()
    await expect(page.locator('#chosen-name')).toHaveText('Ватикан')
    await expect(page.locator('body')).toHaveAttribute('data-playing', 'va.mp3')
    await touch('touchStart', fingers(120))
    await touch('touchMove', fingers(27))
    await touch('touchEnd', [])
    await expect(page.locator('#map')).toHaveAccessibleDescription('Масштаб 1×')
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.locator('#selection')).toBeVisible()
    await page.locator('#dismiss').tap()
    await expect(page.locator('#chosen-flag')).toBeHidden()
  })
})
