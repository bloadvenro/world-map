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
  await page.mouse.wheel(0, -4000)
  const map = page.locator('#map')
  await expect(map).toHaveAccessibleDescription('Масштаб 340×')
  await map.press('-')
  await expect(map).toHaveAccessibleDescription('Масштаб 272×')
  await map.press('+')
  await expect(map).toHaveAccessibleDescription('Масштаб 340×')
  await page.mouse.wheel(0, 4000)
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
  const detail = next.waitForResponse((r) =>
    r.url().endsWith('/world-detail.json'),
  )
  await next.mouse.wheel(0, -4000)
  expect((await detail).fromServiceWorker()).toBe(true)
  await expect(next.locator('#map')).toHaveAccessibleDescription('Масштаб 340×')
  await next.reload()
  await next.getByRole('button', { name: 'Глобус', exact: true }).click()
  // Algeria at 3°E, 28°N on the initial, Africa-facing globe.
  await next.mouse.click(516, 248)
  await expect(next.locator('#chosen-name')).toHaveText('Алжир')
  await expect(next.locator('body')).toHaveAttribute('data-ended', 'dz.mp3')
  await next.mouse.click(20, 760)
  await expect(next.locator('#selection')).toBeHidden()
})

test.describe('touch', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  })
  test('rotates the globe, pinches into a country, and carries the view back to the map', async ({
    page,
    context,
  }) => {
    await observeAudio(page)
    await openMap(page)
    await page.getByRole('button', { name: 'Глобус', exact: true }).tap()
    const cdp = await context.newCDPSession(page)
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      points: { x: number; y: number; id: number }[],
    ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
    await touch('touchStart', [{ x: 195, y: 422, id: 1 }])
    await touch('touchMove', [{ x: 348, y: 422, id: 1 }])
    await touch('touchEnd', [])
    await expect(page.locator('#selection')).toBeHidden()
    const pair = (half: number) => [
      { x: 195 - half, y: 450, id: 1 },
      { x: 195 + half, y: 450, id: 2 },
    ]
    for (let i = 0; i < 2; i++) {
      await touch('touchStart', pair(6))
      await touch('touchMove', pair(120))
      await touch('touchEnd', [])
    }
    await expect(page.locator('#map')).toHaveAccessibleDescription(
      'Масштаб 340×',
    )
    await page.touchscreen.tap(195, 450)
    await expect(page.locator('#chosen-name')).toHaveText('Бразилия')
    await expect(page.locator('body')).toHaveAttribute('data-playing', 'br.mp3')
    await page.getByRole('button', { name: 'Карта', exact: true }).tap()
    await page.locator('#dismiss').tap()
    await page.touchscreen.tap(195, 422)
    await expect(page.locator('#chosen-name')).toHaveText('Бразилия')
    await page.getByRole('button', { name: 'Глобус', exact: true }).tap()
    for (let i = 0; i < 2; i++) {
      await touch('touchStart', pair(120))
      await touch('touchMove', pair(6))
      await touch('touchEnd', [])
    }
    await expect(page.locator('#map')).toHaveAccessibleDescription('Масштаб 1×')
  })
  test('renders and selects islands at regional scale and at 340×', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      type DrawImage = CanvasRenderingContext2D['drawImage']
      const drawImage = CanvasRenderingContext2D.prototype.drawImage
      CanvasRenderingContext2D.prototype.drawImage = function (
        this: CanvasRenderingContext2D,
        ...args: Parameters<DrawImage>
      ) {
        if (this.canvas.id === 'map') {
          const image = args[0]
          if (
            image instanceof HTMLImageElement &&
            document.body.dataset.lastFlags !== undefined
          )
            document.body.dataset.lastFlags += ' ' + image.src.split('/').pop()
          else if (image instanceof HTMLCanvasElement)
            document.body.dataset.previewDrawn = 'yes'
        }
        return drawImage.apply(this, args)
      } as DrawImage
    })
    await openMap(page)
    const select = page.locator('#keyboard-country')
    const map = page.locator('#map')
    const body = page.locator('body')
    await page.evaluate(() => delete document.body.dataset.previewDrawn)
    await page.mouse.move(195, 422)
    const detail = page.waitForResponse((r) =>
      r.url().endsWith('/world-detail.json'),
    )
    await page.mouse.wheel(0, -1200)
    expect((await detail).ok()).toBe(true)
    await expect(map).toHaveAccessibleDescription('Масштаб 11,02×')
    await expect(body).toHaveAttribute('data-preview-drawn', 'yes')
    const islands = [
      ['fj', 'Фиджи'],
      ['tv', 'Тувалу'],
      ['mv', 'Мальдивы'],
    ]
    for (const [code, name] of islands) {
      await page.evaluate(() => {
        document.body.dataset.lastFlags = ''
      })
      await select.selectOption(code)
      await page.locator('#dismiss').tap()
      await expect(body).toHaveAttribute(
        'data-last-flags',
        new RegExp(code + '\\.svg'),
      )
      await expect(body).not.toHaveAttribute('data-last-flags', /br\.svg/)
      if (code === 'fj') await page.touchscreen.tap(195, 422)
      else {
        const marker = page.getByRole('button', { name, exact: true })
        await expect(marker).toHaveClass(/ring/)
        await marker.tap()
      }
      await expect(page.locator('#chosen-name')).toHaveText(name)
      await page.locator('#dismiss').tap()
    }
    await page.mouse.move(195, 422)
    await page.mouse.wheel(0, -4000)
    await expect(map).toHaveAccessibleDescription('Масштаб 340×')
    await page.evaluate(() => delete document.body.dataset.previewDrawn)
    for (const [code, name] of islands) {
      await page.evaluate(() => {
        document.body.dataset.lastFlags = ''
      })
      await select.selectOption(code)
      await page.locator('#dismiss').tap()
      await map.press('ArrowRight')
      await expect(body).toHaveAttribute(
        'data-last-flags',
        new RegExp(code + '\\.svg'),
      )
      await expect(body).not.toHaveAttribute('data-preview-drawn', 'yes')
      // The island originally at the screen centre moved 60 px to the left.
      await page.touchscreen.tap(135, 422)
      await expect(page.locator('#chosen-name')).toHaveText(name)
      await page.locator('#dismiss').tap()
    }
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
      { x: 161 - half, y: 226, id: 1 },
      { x: 161 + half, y: 226, id: 2 },
    ]
    await touch('touchStart', fingers(6))
    await touch('touchMove', fingers(120))
    await touch('touchEnd', [])
    await expect(page.locator('#map')).toHaveAccessibleDescription(
      'Масштаб 20×',
    )
    await expect(page.locator('#selection')).toBeHidden()
    const mark = page.locator('.mark[title*="Ватикан"]').first()
    const box = await mark.boundingBox()
    expect(box).toBeTruthy()
    const x = box!.x + box!.width / 2
    const y = box!.y + box!.height / 2
    const aroundMarker = (half: number) => [
      { x, y: y - half, id: 1 },
      { x, y: y + half, id: 2 },
    ]
    await touch('touchStart', aroundMarker(6))
    await touch('touchMove', aroundMarker(120))
    await touch('touchEnd', [])
    await expect(page.locator('#map')).toHaveAccessibleDescription(
      'Масштаб 340×',
    )
    const zoomedBox = await mark.boundingBox()
    expect(Math.abs(zoomedBox!.x - box!.x)).toBeLessThan(3)
    expect(Math.abs(zoomedBox!.y - box!.y)).toBeLessThan(3)
    await mark.tap()
    if (await page.locator('#nearby').isVisible())
      await page.locator('#choices button').filter({ hasText: 'Ватикан' }).tap()
    await expect(page.locator('#chosen-name')).toHaveText('Ватикан')
    await expect(page.locator('body')).toHaveAttribute('data-playing', 'va.mp3')
    await touch('touchStart', fingers(120))
    await touch('touchMove', fingers(6))
    await touch('touchEnd', [])
    await touch('touchStart', fingers(120))
    await touch('touchMove', fingers(6))
    await touch('touchEnd', [])
    await expect(page.locator('#map')).toHaveAccessibleDescription('Масштаб 1×')
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.locator('#selection')).toBeVisible()
    await page.locator('#dismiss').tap()
    await expect(page.locator('#chosen-flag')).toBeHidden()
  })
})
