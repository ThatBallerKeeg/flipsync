/**
 * Depop listing creation via Playwright browser automation.
 *
 * Uses www.depop.com/products/create/ with cookie-based auth.
 * The web sell form uses webapi.depop.com which accepts web session tokens,
 * bypassing the scope restriction on the mobile api.depop.com endpoint.
 *
 * Form structure (from live inspection):
 * - File input: [data-testid="upload-input__input"] (multiple photos)
 * - Description: textarea[name="description"]
 * - Category/Brand/Condition/Color: text inputs opened via label-linked comboboxes
 * - Price: [data-testid="priceAmount__input"]
 * - Shipping: radio[name="shipping"], [data-testid="usps__shipping__input"]
 * - Submit: first button[type="submit"] = "Post", second = "Save as a draft"
 */
import { chromium, type Browser } from 'playwright'
import { getValidDepopToken } from './auth'
import type { Listing } from '@/types'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import os from 'os'

let browser: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true })
  }
  return browser
}

const CONDITION_MAP: Record<string, string> = {
  new_with_tags: 'New with tags',
  excellent: 'Like new',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
}

/**
 * Depop limits descriptions to 5 hashtags total (counts every #word).
 * Inline uses like "Rusty Wallace #2" also count, so we strip those
 * and keep only the dedicated hashtag block (≤5 tags) at the end.
 */
function sanitizeDepopDescription(desc: string): string {
  const hashtagRe = /#\w+/g
  const all = desc.match(hashtagRe) ?? []
  if (all.length <= 5) return desc

  // Remove all inline hashtag-like tokens (e.g. #2) from body text,
  // then keep only the trailing hashtag line capped at 5.
  const bodyWithout = desc.replace(hashtagRe, '').replace(/\n{3,}/g, '\n\n').trim()

  // Gather the dedicated hashtag block (lines that are mostly hashtags)
  const lines = desc.split('\n')
  const tagLines = lines.filter((l) => /^(#\w+\s*)+$/.test(l.trim()))
  const tagTokens = tagLines.join(' ').match(hashtagRe) ?? all
  const limited = tagTokens.slice(0, 5).join(' ')

  return `${bodyWithout}\n\n${limited}`
}

export async function createDepopListingBrowser(
  listing: Listing
): Promise<{ listingId: string; url: string }> {
  const token = await getValidDepopToken()
  if (!token) throw new Error('Depop not connected — please connect your account in Settings.')

  // Track temp files for cleanup (must be declared before try/finally)
  const tempFiles: string[] = []

  const b = await getBrowser()
  const ctx = await b.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })

  // Set auth cookie — Depop website reads 'access_token' from cookies
  await ctx.addCookies([
    {
      name: 'access_token',
      value: token,
      domain: '.depop.com',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'Lax',
    },
  ])

  const page = await ctx.newPage()

  try {
    // Navigate to Depop sell form
    // Use 'load' not 'networkidle' — Depop has continuous background requests
    // that prevent networkidle from ever firing, causing a 30s timeout.
    await page.goto('https://www.depop.com/products/create/', {
      waitUntil: 'load',
      timeout: 30000,
    })

    // Verify we're on the right page
    const currentUrl = page.url()
    if (currentUrl.includes('/login') || currentUrl.includes('/signup')) {
      throw new Error('Depop session expired — please reconnect your account in Settings.')
    }

    // Wait for the upload input to confirm form is rendered
    await page.waitForSelector('[data-testid="upload-input__input"]', { timeout: 15000 })

    // ─── 1. Upload photos ─────────────────────────────────────────────────────
    const photoUrls = listing.photos.slice(0, 4)
    const localPaths: string[] = []

    for (const imgUrl of photoUrls) {
      if (imgUrl.startsWith('/tmp/') || imgUrl.startsWith(os.tmpdir())) {
        // Absolute local path (pre-downloaded for relist)
        if (fs.existsSync(imgUrl)) {
          localPaths.push(imgUrl)
          console.log(`[Depop] Using pre-downloaded photo: ${imgUrl}`)
        }
      } else if (imgUrl.startsWith('/uploads/')) {
        // Legacy local path
        const localPath = path.join(process.cwd(), 'public', imgUrl)
        if (fs.existsSync(localPath)) localPaths.push(localPath)
      } else if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) {
        // Download remote URL (Supabase) to a temp file
        try {
          const ext = imgUrl.split('.').pop()?.split('?')[0] ?? 'jpg'
          const tmpPath = path.join(os.tmpdir(), `depop-photo-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)
          await new Promise<void>((resolve, reject) => {
            const file = fs.createWriteStream(tmpPath)
            const client = imgUrl.startsWith('https://') ? https : http
            client.get(imgUrl, (res) => {
              res.pipe(file)
              file.on('finish', () => { file.close(); resolve() })
            }).on('error', reject)
          })
          localPaths.push(tmpPath)
          tempFiles.push(tmpPath)
        } catch (e) {
          console.warn('[Depop] Failed to download photo:', imgUrl, e)
        }
      }
    }

    // Track all network calls during photo upload for diagnostics
    const photoNetworkLog: string[] = []
    const responseListener = (resp: { status: () => number; url: () => string }) => {
      photoNetworkLog.push(`${resp.status()} ${resp.url()}`)
    }
    page.on('response', responseListener)

    if (localPaths.length > 0) {
      // Use Playwright's native setInputFiles — it sets files via CDP at the
      // browser level and fires native change/input events that React handles.
      const fileInput = page.locator('[data-testid="upload-input__input"]').first()
      await fileInput.setInputFiles(localPaths)

      // Wait for each photo's upload POST to webapi.depop.com/api/v4/pictures/
      for (let i = 0; i < localPaths.length; i++) {
        const resp = await page.waitForResponse(
          (r) => r.url().includes('depop.com') && r.url().includes('pictures'),
          { timeout: 12000 }
        ).catch(() => null)
        if (resp) {
          console.log(`[Depop] Photo ${i + 1} upload: ${resp.status()} ${resp.url()}`)
        } else {
          console.warn(`[Depop] Photo ${i + 1} upload timed out — network log:`, photoNetworkLog.join(', '))
        }
      }
      // Wait for validate + batch + thumbnails + autotagging to finish
      await page.waitForTimeout(4000)
      console.log('[Depop] Network after photo upload:', photoNetworkLog.slice(-20).join('\n'))
      // Capture form state for debugging
      await page.screenshot({ path: '/tmp/depop-after-upload.png' }).catch(() => null)
      console.log('[Depop] Screenshot saved to /tmp/depop-after-upload.png')
    }

    page.off('response', responseListener)

    // ─── 2. Fill description ──────────────────────────────────────────────────
    const rawDesc = listing.depopDescription ?? listing.description ?? ''
    const desc = sanitizeDepopDescription(rawDesc)
    console.log(`[Depop] Filling description (${desc.length} chars): "${desc.slice(0, 80)}..."`)
    try {
      await page.fill('textarea[name="description"]', desc)
      console.log('[Depop] Description filled ✓')
    } catch (descErr) {
      console.error('[Depop] Description fill FAILED:', descErr)
      // Try fallback: any visible textarea
      try {
        const textarea = page.locator('textarea').first()
        await textarea.fill(desc)
        console.log('[Depop] Description filled via fallback textarea ✓')
      } catch {
        console.error('[Depop] Description fallback also failed')
      }
    }

    // ─── 3. Fill price ────────────────────────────────────────────────────────
    const priceStr = String(listing.price ?? 0)
    console.log(`[Depop] Filling price: ${priceStr}`)
    try {
      const priceInput = page.locator('[data-testid="priceAmount__input"]')
      await priceInput.fill(priceStr)
      console.log('[Depop] Price filled ✓')
    } catch (priceErr) {
      console.error('[Depop] Price fill FAILED:', priceErr)
      // Try fallback: input near "Price" label
      try {
        const priceFallback = page.getByLabel(/price/i).first()
        await priceFallback.fill(priceStr)
        console.log('[Depop] Price filled via fallback ✓')
      } catch {
        console.error('[Depop] Price fallback also failed')
      }
    }

    // ─── 3b. Select category (required) ──────────────────────────────────────
    // IMPORTANT: Use AI-suggested pills FIRST — the category combobox creates a
    // hierarchical dropdown with 600+ options that refuses to close and corrupts
    // all subsequent form interactions. Pills are simple single-click selections.
    try {
      // Scroll to bring the Category section into view
      await page.locator('text=Category').first().scrollIntoViewIfNeeded().catch(() => null)
      await page.waitForTimeout(800)

      let categoryChosen = false

      // Strategy 1: Click an AI-suggested pill (PREFERRED — no dropdown issues)
      // Depop's autotagging shows pills like "Men / T-shirts" after photo upload.
      const chosen = await page.evaluate(() => {
        const badWords = ['reworked', 'upcycled', 'craft', 'handmade']
        // Find all elements that look like category pills (contain " / ")
        const allEls = Array.from(document.querySelectorAll('*'))
        const pills: { text: string; el: HTMLElement }[] = []
        for (const el of allEls) {
          const text = (el as HTMLElement).innerText?.trim() ?? ''
          if (text.includes(' / ') && text.length < 40 && text.length > 3 && el.children.length <= 3) {
            pills.push({ text, el: el as HTMLElement })
          }
        }
        // Pick a good pill (not bad words) — do NOT fall back to bad pills
        for (const pill of pills) {
          if (badWords.some(w => pill.text.toLowerCase().includes(w))) continue
          pill.el.click()
          return pill.text
        }
        // All pills are bad (reworked/upcycled etc) — skip, use combobox fallback
        return null
      })
      if (chosen) {
        console.log('[Depop] Category selected via AI pill:', chosen)
        categoryChosen = true
        await page.waitForTimeout(600)
      }

      // Strategy 2 (fallback): Use the combobox search if no pills available
      if (!categoryChosen) {
        const listingCat = (listing.category ?? '').toLowerCase()
        const title = (listing.title ?? '').toLowerCase()
        const categoryKeywords = [
          ['t-shirt', 'T-shirts'], ['jersey', 'T-shirts'], ['tee', 'T-shirts'],
          ['hoodie', 'Hoodies'], ['sweatshirt', 'Sweatshirts'],
          ['pant', 'Pants'], ['short', 'Shorts'], ['jean', 'Jeans'],
          ['jacket', 'Jackets'], ['coat', 'Coats'], ['blazer', 'Blazers'],
          ['dress', 'Dresses'], ['skirt', 'Skirts'], ['shirt', 'Shirts'],
          ['top', 'Tops'], ['sneaker', 'Sneakers'], ['boot', 'Boots'],
          ['hat', 'Hats'], ['bag', 'Bags'], ['shoe', 'Shoes'],
        ]
        let searchTerm = ''
        for (const [keyword, label] of categoryKeywords) {
          if (listingCat.includes(keyword) || title.includes(keyword)) {
            searchTerm = label
            break
          }
        }
        if (searchTerm) {
          const categoryInput = page.locator('#group-input, input[aria-controls="group-menu"]').first()
          if (await categoryInput.count() > 0) {
            await categoryInput.click()
            await page.waitForTimeout(500)
            await categoryInput.type(searchTerm, { delay: 50 })
            await page.waitForTimeout(800)
            // Click the first good option via Playwright
            const options = page.locator('[role="option"]')
            const optCount = await options.count()
            for (let i = 0; i < Math.min(optCount, 10); i++) {
              const text = await options.nth(i).innerText().catch(() => '')
              if (['reworked', 'upcycled', 'craft'].some(p => text.toLowerCase().includes(p))) continue
              await options.nth(i).click()
              console.log('[Depop] Category selected via combobox search:', text.trim())
              categoryChosen = true
              break
            }
            await page.waitForTimeout(500)
          }
        }
        if (!categoryChosen) {
          console.warn('[Depop] No category could be selected — form may fail')
        }
      }
    } catch (e) {
      console.warn('[Depop] Category selection failed:', e)
    }

    // ─── Force-close the CATEGORY dropdown only ─────────────────────────────
    // The category combobox creates a 600+ option hierarchical dropdown that
    // refuses to close via Escape/body click. We hide ONLY this specific dropdown
    // using display:none. We must NOT remove or hide other listboxes because
    // Depop's React app reuses a shared listbox element across all comboboxes.
    async function forceCloseCategoryDropdown() {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      await page.locator('textarea[name="description"]').click().catch(() => null)
      await page.waitForTimeout(200)
      const hidden = await page.evaluate(() => {
        let count = 0
        // Target category-specific dropdown by ID
        const groupMenu = document.getElementById('group-menu')
        if (groupMenu) {
          groupMenu.style.display = 'none'
          groupMenu.setAttribute('data-force-hidden', 'true')
          count++
        }
        // Also hide any listbox with 20+ options (category mega-dropdown)
        document.querySelectorAll('[role="listbox"]').forEach(lb => {
          const optCount = lb.querySelectorAll('[role="option"]').length
          if (optCount > 20) {
            (lb as HTMLElement).style.display = 'none';
            (lb as HTMLElement).setAttribute('data-force-hidden', 'true')
            count++
          }
        })
        return count
      })
      if (hidden > 0) {
        console.log(`[Depop] Force-hid ${hidden} category dropdown(s)`)
      }
      await page.waitForTimeout(300)
    }
    await forceCloseCategoryDropdown()

    // ─── Helper: find combobox input ID by label regex ────────────────────────
    // Returns the input element's ID so we can use Playwright locator.click()
    // (page.evaluate clicks don't trigger React's synthetic events properly)
    async function findComboboxByLabel(labelPattern: RegExp, excludePattern?: RegExp): Promise<string | null> {
      return page.evaluate(({ pattern, exclude }) => {
        const labels = Array.from(document.querySelectorAll('label'))
        for (const label of labels) {
          const text = label.textContent?.trim() ?? ''
          // CRITICAL: use 'i' flag for case-insensitive matching
          if (new RegExp(pattern, 'i').test(text) && (!exclude || !new RegExp(exclude, 'i').test(text))) {
            const forId = label.getAttribute('for')
            const input = forId ? document.getElementById(forId) : label.querySelector('input')
            if (input?.id) return input.id
          }
        }
        // Fallback: also check aria-label on inputs directly
        const inputs = Array.from(document.querySelectorAll('input[role="combobox"], input[aria-haspopup="listbox"]'))
        for (const input of inputs) {
          const ariaLabel = input.getAttribute('aria-label') ?? ''
          if (new RegExp(pattern, 'i').test(ariaLabel) && (!exclude || !new RegExp(exclude, 'i').test(ariaLabel))) {
            if ((input as HTMLElement).id) return (input as HTMLElement).id
          }
        }
        return null
      }, { pattern: labelPattern.source, exclude: excludePattern?.source })
    }

    // Helper: detect if dropdown options are wrong (category subcategories, not the field's own options)
    const CATEGORY_SUBCATEGORIES = /^(t-shirts?|hoodies?|sweatshirts?|jumpers?|cardigans?|shirts?|polo shirts?|blouses?|crop tops?|vests?|corsets?|bodysuits?|jeans?|sweatpants?|shorts?|pants?|jackets?|coats?|blazers?|dresses?|skirts?|sneakers?|boots?|shoes?|hats?|bags?|tops?|other)$/i
    const CONDITION_VALUES = /^(new with tags|brand new|like new|good|fair|poor|used\s*-\s*(excellent|good|fair))$/i

    function looksLikeBadOptions(options: string[], currentField: string): string | null {
      if (options.length === 0) return 'empty'
      // Condition values are CORRECT when filling the Condition field
      if (!/condition/i.test(currentField) && options.some(o => CONDITION_VALUES.test(o))) return 'condition'
      // If 3+ options match category names, it's the category dropdown leaking
      const catMatches = options.filter(o => CATEGORY_SUBCATEGORIES.test(o)).length
      if (catMatches >= 3) return 'category'
      return null
    }

    // Helper: click a combobox input using Playwright's native click (triggers React events)
    // then select from the dropdown. Returns the selected option text, or null if failed.
    //
    // IMPORTANT: Does NOT remove/hide listboxes globally. Depop reuses a shared
    // listbox element across all comboboxes — removing it breaks ALL fields.
    // Instead, we: Escape → blur → click input → let React open correct dropdown.
    async function clickComboboxAndSelect(
      inputId: string,
      fieldName: string,
      selectFn: (options: string[]) => { index: number } | null
    ): Promise<string | null> {
      // Close any open dropdown via React's own mechanisms (Escape + blur)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      await page.locator('textarea[name="description"]').click().catch(() => null)
      await page.waitForTimeout(300)

      // Re-hide category dropdown in case Escape re-opened it
      await page.evaluate(() => {
        document.querySelectorAll('[data-force-hidden="true"]').forEach(el => {
          (el as HTMLElement).style.display = 'none'
        })
      })

      // Use Playwright's native click — this triggers React's synthetic events
      const escapedId = inputId.replace(/([^\w-])/g, '\\$1')
      const inputLocator = page.locator(`#${escapedId}`)
      if (await inputLocator.count() === 0) {
        console.warn(`[Depop] ${fieldName}: input #${inputId} not found in DOM`)
        return null
      }
      await inputLocator.scrollIntoViewIfNeeded().catch(() => null)
      await page.waitForTimeout(200)
      await inputLocator.click()
      await page.waitForTimeout(800)

      // Get available options (exclude force-hidden category dropdown)
      const availableOptions = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[role="option"]'))
          .filter(o => {
            const listbox = o.closest('[data-force-hidden="true"]')
            return !listbox
          })
          .map(o => (o as HTMLElement).innerText?.trim() ?? '')
      })

      // Sanity check: detect if wrong dropdown opened (context-aware)
      const badType = looksLikeBadOptions(availableOptions, fieldName)
      if (badType) {
        console.warn(`[Depop] ${fieldName}: dropdown shows ${badType} values instead of ${fieldName} options: [${availableOptions.slice(0, 5).join(', ')}]`)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
        return null
      }

      console.log(`[Depop] ${fieldName} options: [${availableOptions.slice(0, 8).join(', ')}]`)

      // Let the caller decide which option to select
      const selection = selectFn(availableOptions)
      if (selection === null || selection.index < 0 || selection.index >= availableOptions.length) {
        console.warn(`[Depop] ${fieldName}: no suitable option found`)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
        return null
      }

      // Click option via Playwright locator (excluding force-hidden category options)
      const optionLocator = page.locator('[role="option"]:not([data-force-hidden] [role="option"])').nth(selection.index)
      let picked: string | null = null
      try {
        picked = await optionLocator.innerText({ timeout: 2000 })
        await optionLocator.click({ timeout: 3000 })
        picked = picked?.trim() ?? null
      } catch {
        // Fallback: click via evaluate (option may be obscured)
        picked = await page.evaluate((idx) => {
          const options = Array.from(document.querySelectorAll('[role="option"]'))
            .filter(o => !o.closest('[data-force-hidden="true"]'))
          if (idx < options.length) {
            const text = (options[idx] as HTMLElement).innerText?.trim() ?? ''
            ;(options[idx] as HTMLElement).click()
            return text
          }
          return null
        }, selection.index)
      }

      await page.waitForTimeout(300)
      return picked
    }

    // ─── 4. Select condition via combobox ─────────────────────────────────────
    const conditionText = CONDITION_MAP[listing.condition ?? 'good'] ?? 'Good'
    try {
      const conditionInputId = await findComboboxByLabel(/^condition\b/i)
      if (conditionInputId) {
        const picked = await clickComboboxAndSelect(conditionInputId, 'Condition', (options) => {
          // Match the desired condition text
          const idx = options.findIndex(o => o.toLowerCase().includes(conditionText.toLowerCase()))
          if (idx >= 0) return { index: idx }
          // Fallback: first option
          return options.length > 0 ? { index: 0 } : null
        })
        if (picked) {
          console.log('[Depop] Condition selected:', picked)
        } else {
          console.warn('[Depop] Condition NOT selected — wrong dropdown or no options')
        }
      } else {
        console.warn('[Depop] Condition field not found on page')
      }
    } catch (e) {
      console.warn('[Depop] Condition selection failed:', e)
    }

    // ─── 5. Select size (required when category has sizes) ───────────────────
    // Uses Playwright native .click() to open dropdown (page.evaluate clicks don't trigger React)
    console.log(`[Depop] Size selection — listing.size="${listing.size ?? '(null)'}"`)
    {
      const sizeRaw = (listing.size ?? '').trim()
      const SIZE_NORM: Record<string, string> = {
        'extra small': 'XS', 'xs': 'XS',
        'small': 'S', 's': 'S',
        'medium': 'M', 'm': 'M',
        'large': 'L', 'l': 'L',
        'extra large': 'XL', 'xl': 'XL',
        'xxl': 'XXL', '2xl': 'XXL',
        'xxxl': 'XXXL', '3xl': 'XXXL',
      }
      const sizeNorm = sizeRaw ? (SIZE_NORM[sizeRaw.toLowerCase()] ?? sizeRaw) : ''

      try {
        const sizeInputId = await findComboboxByLabel(/^size\b/i, /package/i)
        console.log('[Depop] Size input ID found:', sizeInputId)

        if (sizeInputId) {
          const picked = await clickComboboxAndSelect(sizeInputId, 'Size', (options) => {
            // Try to match the normalized size
            if (sizeNorm) {
              const idx = options.findIndex(o =>
                o.toUpperCase() === sizeNorm.toUpperCase() ||
                new RegExp(`\\b${sizeNorm}\\b`, 'i').test(o)
              )
              if (idx >= 0) return { index: idx }
            }
            // Try to find any size-like option
            const sizePattern = /^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|One Size|US \d|UK \d|\d{1,2})/i
            const idx = options.findIndex(o => sizePattern.test(o))
            if (idx >= 0) return { index: idx }
            // Fall back to first option (already validated it's not condition/category)
            return { index: 0 }
          })
          if (picked) {
            console.log('[Depop] Size selected:', picked)
          } else {
            console.warn('[Depop] Size NOT selected — wrong dropdown or no options')
          }
        } else {
          console.log('[Depop] No Size field found — may not be required for this category')
        }
      } catch (e) {
        console.warn('[Depop] Size selection error:', e)
      }
    }

    // Dismiss dropdown before Brand
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // ─── 7. Fill brand (optional) ─────────────────────────────────────────────
    if (listing.brand) {
      try {
        const brandInputId = await findComboboxByLabel(/^brand\b/i)
        if (brandInputId) {
          await page.keyboard.press('Escape')
          await page.waitForTimeout(200)
          const escapedId = brandInputId.replace(/([^\w-])/g, '\\$1')
          const brandLocator = page.locator(`#${escapedId}`)
          await brandLocator.scrollIntoViewIfNeeded().catch(() => null)
          await brandLocator.click()
          await brandLocator.fill(listing.brand)
          await page.waitForTimeout(800)
          const firstOpt = page.locator('[role="option"]').first()
          if (await firstOpt.count() > 0) {
            await firstOpt.click()
            console.log('[Depop] Brand selected:', listing.brand)
          } else {
            await page.keyboard.press('Enter')
            console.log('[Depop] Brand typed (no suggestions):', listing.brand)
          }
        }
      } catch {
        // Brand is optional
      }
    }

    // Dismiss dropdown before shipping
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // ─── 8. Ensure USPS shipping is selected ─────────────────────────────────
    const uspsRadio = page.locator('[data-testid="usps__shipping__input"]')
    if (await uspsRadio.count() > 0) {
      await uspsRadio.check().catch(() => null)
      await page.waitForTimeout(600)

      // ─── 8b. Select Package size (required for USPS) ─────────────────────
      try {
        const pkgInputId = await findComboboxByLabel(/package\s*size/i)
        if (pkgInputId) {
          const picked = await clickComboboxAndSelect(pkgInputId, 'Package size', (options) => {
            // Try exact "Small" first
            const smallIdx = options.findIndex(o => /^small\b/i.test(o))
            if (smallIdx >= 0) return { index: smallIdx }
            const medIdx = options.findIndex(o => /^medium\b/i.test(o))
            if (medIdx >= 0) return { index: medIdx }
            return { index: 0 }
          })
          if (picked) console.log('[Depop] Package size:', picked)
        } else {
          console.warn('[Depop] Package size field not found')
        }
      } catch (e) {
        console.warn('[Depop] Package size selection failed:', e)
      }
    }

    // ─── 8c. Pre-submit: scan for unfilled required comboboxes and auto-fill ─
    // Uses Playwright native click (not page.evaluate click) to open each dropdown
    try {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)

      // Find all unfilled combobox inputs and their IDs
      const unfilledFields = await page.evaluate(() => {
        const results: { labelText: string; inputId: string | null }[] = []
        const inputs = Array.from(document.querySelectorAll('input[role="combobox"], input[aria-haspopup="listbox"]'))
        for (const input of inputs) {
          const val = (input as HTMLInputElement).value?.trim()
          if (!val) {
            const label = input.closest('label') ?? document.querySelector(`label[for="${input.id}"]`)
            const labelText = label?.textContent?.trim() ?? input.getAttribute('aria-label') ?? '(unknown)'
            // Skip fields we already handle or that are optional
            if (!/package|search|brand|category/i.test(labelText)) {
              results.push({ labelText, inputId: input.id || null })
            }
          }
        }
        return results
      })

      if (unfilledFields.length > 0) {
        console.warn(`[Depop] Unfilled combobox fields before submit: ${unfilledFields.map(f => f.labelText).join(', ')}`)

        for (const field of unfilledFields) {
          if (!field.inputId) {
            console.warn(`[Depop] Could not fill "${field.labelText}" — no input ID`)
            continue
          }

          try {
            const picked = await clickComboboxAndSelect(field.inputId, field.labelText, () => {
              // Just pick first option (already validated by sanity check)
              return { index: 0 }
            })
            if (picked) {
              console.log(`[Depop] Auto-filled "${field.labelText}" with: ${picked}`)
            } else {
              console.warn(`[Depop] Could not auto-fill "${field.labelText}" (wrong dropdown or no options)`)
            }
          } catch {
            console.warn(`[Depop] Failed to auto-fill "${field.labelText}"`)
          }
        }
      } else {
        console.log('[Depop] All combobox fields filled ✓')
      }
    } catch (e) {
      console.warn('[Depop] Pre-submit scan error:', e)
    }

    // ─── 9. Click "Post" to publish ───────────────────────────────────────────
    // Dismiss any lingering dropdown
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Dump form state for debugging
    const formState = await page.evaluate(() => {
      const desc = (document.querySelector('textarea[name="description"]') as HTMLTextAreaElement)?.value ?? '(not found)'
      const price = (document.querySelector('[data-testid="priceAmount__input"]') as HTMLInputElement)?.value ?? '(not found)'
      // Count uploaded photos (look for img tags within the photo upload area)
      const photoCount = document.querySelectorAll('[data-testid*="upload"] img, [class*="photo"] img, img[src*="media-photos"], img[src*="s3.amazonaws"], img[src*="pictures"]').length
      // Count filled combobox fields
      const comboboxes = Array.from(document.querySelectorAll('input[role="combobox"], input[aria-haspopup="listbox"]'))
      const filled = comboboxes.filter(i => (i as HTMLInputElement).value?.trim()).length
      const total = comboboxes.length
      return { desc: desc.slice(0, 50), price, photoCount, comboboxFilled: `${filled}/${total}` }
    }).catch(() => ({ desc: '(eval error)', price: '(eval error)', photoCount: -1, comboboxFilled: '?' }))
    console.log(`[Depop] Pre-submit form state: photos=${formState.photoCount}, price="${formState.price}", desc="${formState.desc}", comboboxes=${formState.comboboxFilled}`)

    await page.screenshot({ path: '/tmp/depop-before-submit.png' }).catch(() => null)

    // Scroll the submit button into view and click it
    const postBtn = page.locator('button[type="submit"]').first()
    await postBtn.scrollIntoViewIfNeeded().catch(() => null)
    await page.waitForTimeout(300)
    await postBtn.click({ timeout: 10000 })

    // ─── 10. Wait for redirect to the new product page ───────────────────────
    // After posting, Depop redirects to https://www.depop.com/products/{slug}/
    await page.waitForURL(
      (url) => url.pathname.includes('/products/') && !url.pathname.includes('/create'),
      { timeout: 30000 }
    ).catch(() => null)

    let finalUrl = page.url()

    // Depop sometimes shows a "Nice! It's listed" success overlay on the create
    // page instead of redirecting.  Detect that and click "View listing" to get
    // to the canonical product URL.
    if (finalUrl.includes('/create')) {
      const pageText = await page.locator('body').innerText().catch(() => '')
      const successPatterns = /nice.*listed|it's listed|successfully listed|view listing/i

      if (successPatterns.test(pageText)) {
        // Click "View listing" link to navigate to the product page
        const viewBtn = page.getByRole('link', { name: /view listing/i }).first()
        if (await viewBtn.count() > 0) {
          await viewBtn.click()
          await page.waitForURL(
            (url) => url.pathname.includes('/products/') && !url.pathname.includes('/create'),
            { timeout: 15000 }
          ).catch(() => null)
          finalUrl = page.url()
          console.log('[Depop] Success overlay detected — navigated via View listing:', finalUrl)
        } else {
          // Try to extract product URL from page links
          const productLink = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/products/"]'))
            return links.find((a) => !(a as HTMLAnchorElement).href.includes('/create'))
              ? (links.find((a) => !(a as HTMLAnchorElement).href.includes('/create')) as HTMLAnchorElement).href
              : null
          })
          if (productLink) {
            finalUrl = productLink
            console.log('[Depop] Product URL extracted from page links:', finalUrl)
          }
        }
      } else {
        // Genuine form error — capture diagnostics
        await page.screenshot({ path: '/tmp/depop-error.png' }).catch(() => null)

        // Try to identify which specific fields have errors
        const fieldErrors = await page.evaluate(() => {
          const errors: string[] = []
          // Look for error messages near form fields
          const errorEls = document.querySelectorAll('[role="alert"], [data-testid*="error"], p[class*="error" i], span[class*="error" i], [class*="Error" i]')
          errorEls.forEach(el => {
            // Find the nearest label or section heading
            const parent = el.closest('div[class*="field"], fieldset, section, [class*="Field"]')
            const label = parent?.querySelector('label, legend, h2, h3, [class*="label" i]')
            const fieldName = label?.textContent?.trim() || '(unknown field)'
            const errorText = el.textContent?.trim() || ''
            if (errorText && errorText.length < 120) {
              errors.push(`${fieldName}: ${errorText}`)
            }
          })
          return errors
        }).catch(() => [] as string[])

        const allErrors = await page
          .locator('[role="alert"], [data-testid*="error"], p[class*="error" i], span[class*="error" i]')
          .allTextContents()
          .catch(() => [] as string[])
        const shortErrors = allErrors.map((t) => t.trim()).filter((t) => t.length > 0 && t.length < 120)

        console.error(`[Depop] Field-level errors:`, fieldErrors)
        console.error(`[Depop] All errors:`, shortErrors)

        throw new Error(
          `Listing submission failed${fieldErrors.length ? ': ' + fieldErrors.join(' | ') : shortErrors.length ? ': ' + shortErrors.join(' | ') : '. Check Depop manually.'} | Page snippet: ${pageText.slice(0, 200)}`
        )
      }
    }

    // Extract slug from URL
    const match = finalUrl.match(/\/products\/([^/?#]+)/)
    const slug = match?.[1]

    if (!slug) {
      throw new Error(`Could not extract listing ID from URL: ${finalUrl}`)
    }

    return {
      listingId: slug,
      url: `https://www.depop.com/products/${slug}/`,
    }
  } finally {
    await ctx.close()
    // Clean up temp files
    for (const f of tempFiles) {
      fs.unlink(f, () => {})
    }
  }
}
