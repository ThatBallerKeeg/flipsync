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
    // Depop's autotagging AI suggests categories below the Category combobox.
    // IMPORTANT: Avoid "Reworked / Upcycled" — it's wrong for clothing items
    // and may not have a Size field, causing cascading form errors.
    try {
      // Scroll to bring the Category section into view
      await page.locator('text=Category').first().scrollIntoViewIfNeeded().catch(() => null)
      await page.waitForTimeout(800)

      const listingCat = (listing.category ?? '').toLowerCase()
      const categoryKeywords = [
        ['t-shirt', 'T-shirts'], ['jersey', 'T-shirts'], ['tee', 'T-shirts'],
        ['hoodie', 'Hoodies'], ['sweatshirt', 'Sweatshirts'],
        ['pant', 'Pants'], ['short', 'Shorts'], ['jean', 'Jeans'],
        ['jacket', 'Jackets'], ['coat', 'Coats'], ['blazer', 'Blazers'],
        ['dress', 'Dresses'], ['skirt', 'Skirts'], ['shirt', 'Shirts'],
        ['top', 'Tops'], ['sneaker', 'Sneakers'], ['boot', 'Boots'],
        ['hat', 'Hats'], ['bag', 'Bags'], ['shoe', 'Shoes'],
      ]

      let categoryChosen = false

      // Strategy 1: Use the Category combobox to search for a specific clothing category
      const categoryInput = page.locator('#group-input, input[aria-controls="group-menu"]').first()
      if (await categoryInput.count() > 0) {
        // Determine search term from listing data
        let searchTerm = ''
        for (const [keyword, label] of categoryKeywords) {
          if (listingCat.includes(keyword)) {
            searchTerm = label
            break
          }
        }
        // Also try title-based inference for synced listings with generic categories
        if (!searchTerm) {
          const title = (listing.title ?? '').toLowerCase()
          for (const [keyword, label] of categoryKeywords) {
            if (title.includes(keyword)) {
              searchTerm = label
              break
            }
          }
        }

        if (searchTerm) {
          await categoryInput.click()
          await page.waitForTimeout(500)
          await categoryInput.type(searchTerm, { delay: 50 })
          await page.waitForTimeout(800)
          // Pick the first option that is NOT "Reworked" or "Upcycled"
          const picked = await page.evaluate((badPatterns) => {
            const options = Array.from(document.querySelectorAll('[role="option"]'))
            for (const o of options) {
              const text = (o as HTMLElement).innerText?.trim() ?? ''
              if (badPatterns.some((p: string) => text.toLowerCase().includes(p))) continue
              ;(o as HTMLElement).click()
              return text
            }
            return null
          }, ['reworked', 'upcycled', 'craft'])
          if (picked) {
            console.log('[Depop] Category selected via combobox search:', picked)
            categoryChosen = true
          }
          await page.keyboard.press('Escape')
          await page.waitForTimeout(300)
        }
      }

      // Strategy 2: Click a Depop AI-suggested pill (but NEVER Reworked/Upcycled)
      if (!categoryChosen) {
        const chosen = await page.evaluate(() => {
          const badWords = ['reworked', 'upcycled', 'craft', 'handmade', 'vintage']
          // Find all elements that look like category pills (contain " / ")
          const allEls = Array.from(document.querySelectorAll('*'))
          for (const el of allEls) {
            const text = (el as HTMLElement).innerText?.trim() ?? ''
            if (text.includes(' / ') && text.length < 40 && text.length > 3 && el.children.length <= 3) {
              if (badWords.some(w => text.toLowerCase().includes(w))) continue
              ;(el as HTMLElement).click()
              return text
            }
          }
          // If ALL pills are bad categories, pick the first one anyway (better than nothing)
          for (const el of allEls) {
            const text = (el as HTMLElement).innerText?.trim() ?? ''
            if (text.includes(' / ') && text.length < 40 && text.length > 3 && el.children.length <= 3) {
              ;(el as HTMLElement).click()
              return text + ' (only option)'
            }
          }
          return null
        })
        if (chosen) {
          console.log('[Depop] Category selected via AI pill:', chosen)
          categoryChosen = true
          await page.waitForTimeout(400)
        } else {
          console.warn('[Depop] No category could be selected — form may fail')
        }
      }
    } catch (e) {
      console.warn('[Depop] Category selection failed:', e)
    }

    // Dismiss any open dropdowns before next field
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // ─── 4. Select condition via combobox ─────────────────────────────────────
    // Use page.evaluate to find and click the Condition combobox by label scan
    // (avoids getByLabel matching wrong field)
    const conditionText = CONDITION_MAP[listing.condition ?? 'good'] ?? 'Good'
    try {
      const conditionResult = await page.evaluate((targetCondition) => {
        const labels = Array.from(document.querySelectorAll('label'))
        for (const label of labels) {
          const text = label.textContent?.trim() ?? ''
          if (/^condition\b/i.test(text)) {
            const forId = label.getAttribute('for')
            const input = forId ? document.getElementById(forId) as HTMLInputElement : label.querySelector('input')
            if (input) {
              input.scrollIntoView({ block: 'center' })
              input.click()
              return { found: true, inputId: input.id, labelText: text }
            }
          }
        }
        return { found: false, inputId: null, labelText: null }
      }, conditionText)

      if (conditionResult.found) {
        await page.waitForTimeout(700)
        // Select matching option from the now-open dropdown
        const picked = await page.evaluate((target) => {
          const options = Array.from(document.querySelectorAll('[role="option"]'))
          // Try matching the target condition
          for (const o of options) {
            const text = (o as HTMLElement).innerText?.trim() ?? ''
            if (text.toLowerCase().includes(target.toLowerCase())) {
              ;(o as HTMLElement).click()
              return text
            }
          }
          // Fallback: pick first option
          if (options.length > 0) {
            const text = (options[0] as HTMLElement).innerText?.trim() ?? ''
            ;(options[0] as HTMLElement).click()
            return text + ' (fallback)'
          }
          return null
        }, conditionText)
        console.log('[Depop] Condition selected:', picked)
      } else {
        console.warn('[Depop] Condition field not found on page')
      }
    } catch (e) {
      console.warn('[Depop] Condition selection failed:', e)
    }

    // Dismiss any open dropdowns before Size
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // ─── 5. Select size (required when category has sizes) ───────────────────
    // IMPORTANT: Only use label scan approach. Do NOT use getByLabel('Size') — it
    // matches the Condition field on Depop's form and corrupts the entire form state.
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
      let sizeChosen = false

      try {
        // Use page.evaluate to find the Size field by scanning labels directly in the DOM.
        // This is the ONLY reliable approach — getByLabel('Size') matches the wrong field.
        const sizeFieldInfo = await page.evaluate(() => {
          const labels = Array.from(document.querySelectorAll('label'))
          const found: { labelText: string; inputId: string | null }[] = []
          for (const label of labels) {
            const text = label.textContent?.trim() ?? ''
            // Match "Size", "Size *", "Size(required)" but NOT "Package size"
            if (/^size\b/i.test(text) && !/package/i.test(text)) {
              const forId = label.getAttribute('for')
              const input = forId ? document.getElementById(forId) : label.querySelector('input')
              found.push({ labelText: text, inputId: input?.id ?? null })
            }
          }
          return found
        })
        console.log('[Depop] Size fields found on page:', JSON.stringify(sizeFieldInfo))

        if (sizeFieldInfo.length > 0 && sizeFieldInfo[0].inputId) {
          // Click the Size input using page.evaluate to avoid Playwright selector confusion
          await page.evaluate((inputId) => {
            const input = document.getElementById(inputId)
            if (input) {
              input.scrollIntoView({ block: 'center' })
              input.click()
            }
          }, sizeFieldInfo[0].inputId)
          await page.waitForTimeout(800)

          // Verify we opened the RIGHT dropdown by checking the options
          const availableOptions = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('[role="option"]'))
              .map(o => (o as HTMLElement).innerText?.trim() ?? '')
              .slice(0, 15)
          })
          console.log('[Depop] Size options available:', availableOptions.join(', '))

          // Sanity check: if the options look like condition values, we opened the wrong dropdown
          const looksLikeConditions = availableOptions.some(o => /^(new with tags|like new|good|fair|poor)$/i.test(o))
          if (looksLikeConditions) {
            console.error('[Depop] Size dropdown opened but shows CONDITION options — aborting size selection')
            await page.keyboard.press('Escape')
            await page.waitForTimeout(300)
          } else if (availableOptions.length > 0) {
            if (sizeNorm) {
              // Try to click matching size option via evaluate
              const picked = await page.evaluate((target) => {
                const options = Array.from(document.querySelectorAll('[role="option"]'))
                // Exact match
                for (const o of options) {
                  const text = (o as HTMLElement).innerText?.trim() ?? ''
                  if (text.toUpperCase() === target.toUpperCase() || new RegExp(`\\b${target}\\b`, 'i').test(text)) {
                    ;(o as HTMLElement).click()
                    return text
                  }
                }
                return null
              }, sizeNorm)
              if (picked) {
                console.log('[Depop] Size selected:', picked)
                sizeChosen = true
              }
            }

            // If no match or no size provided, pick a size-like option
            if (!sizeChosen) {
              const picked = await page.evaluate(() => {
                const options = Array.from(document.querySelectorAll('[role="option"]'))
                const sizePattern = /^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|One Size|US \d|UK \d|\d{1,2})/i
                for (const o of options) {
                  const text = (o as HTMLElement).innerText?.trim() ?? ''
                  if (sizePattern.test(text)) {
                    ;(o as HTMLElement).click()
                    return text
                  }
                }
                // Fall back to first option if it doesn't look like a condition
                if (options.length > 0) {
                  const text = (options[0] as HTMLElement).innerText?.trim() ?? ''
                  if (!/new|like new|good|fair|poor|tags/i.test(text)) {
                    ;(options[0] as HTMLElement).click()
                    return text
                  }
                }
                return null
              })
              if (picked) {
                console.log('[Depop] Size auto-selected:', picked)
                sizeChosen = true
              }
            }
            await page.waitForTimeout(300)
          }
        } else {
          console.log('[Depop] No Size field found on page — may not be required for this category')
        }

        if (!sizeChosen && sizeFieldInfo.length > 0) {
          console.warn('[Depop] Size NOT selected — this may cause a required field error')
        }
      } catch (e) {
        console.warn('[Depop] Size selection error:', e)
      }
    }

    // Dismiss any open dropdowns before Brand
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // ─── 7. Fill brand (optional) ─────────────────────────────────────────────
    if (listing.brand) {
      try {
        // Use label scan instead of getByLabel to avoid matching wrong field
        const brandFilled = await page.evaluate((brand) => {
          const labels = Array.from(document.querySelectorAll('label'))
          for (const label of labels) {
            const text = label.textContent?.trim() ?? ''
            if (/^brand\b/i.test(text)) {
              const forId = label.getAttribute('for')
              const input = forId ? document.getElementById(forId) as HTMLInputElement : label.querySelector('input') as HTMLInputElement
              if (input) {
                input.scrollIntoView({ block: 'center' })
                input.click()
                input.value = ''
                // Use native input event to trigger React state
                input.dispatchEvent(new Event('input', { bubbles: true }))
                return true
              }
            }
          }
          return false
        }, listing.brand)

        if (brandFilled) {
          // Now type via Playwright for proper React event handling
          await page.keyboard.type(listing.brand, { delay: 30 })
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

    // Dismiss any open dropdowns before shipping
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // ─── 8. Ensure USPS shipping is selected ─────────────────────────────────
    const uspsRadio = page.locator('[data-testid="usps__shipping__input"]')
    if (await uspsRadio.count() > 0) {
      await uspsRadio.check().catch(() => null)
      await page.waitForTimeout(600)

      // ─── 8b. Select Package size (required for USPS) ─────────────────────
      // Use page.evaluate to find by label scan and click directly
      try {
        // Dismiss any open dropdowns first
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)

        const pkgResult = await page.evaluate(() => {
          const labels = Array.from(document.querySelectorAll('label'))
          for (const label of labels) {
            const text = label.textContent?.trim() ?? ''
            if (/package\s*size/i.test(text)) {
              const forId = label.getAttribute('for')
              const input = forId ? document.getElementById(forId) : label.querySelector('input')
              if (input) {
                input.scrollIntoView({ block: 'center' })
                input.click()
                return { found: true }
              }
            }
          }
          return { found: false }
        })

        if (pkgResult.found) {
          await page.waitForTimeout(800)

          // Use evaluate to find and click the option directly in the DOM
          const selectedPkg = await page.evaluate(() => {
            const options = Array.from(document.querySelectorAll('[role="option"]'))
            // Try exact "Small" first (not "Extra extra small")
            const small = options.find((o) => {
              const text = (o as HTMLElement).innerText?.trim() ?? ''
              return /^small\b/i.test(text)
            })
            if (small) { (small as HTMLElement).click(); return (small as HTMLElement).innerText?.trim() }
            // Try "Medium" as second choice
            const medium = options.find((o) => /^medium\b/i.test((o as HTMLElement).innerText?.trim() ?? ''))
            if (medium) { (medium as HTMLElement).click(); return (medium as HTMLElement).innerText?.trim() }
            // Fall back to first option
            if (options.length > 0) { (options[0] as HTMLElement).click(); return (options[0] as HTMLElement).innerText?.trim() }
            return null
          })
          if (selectedPkg) {
            console.log('[Depop] Package size:', selectedPkg)
          } else {
            console.warn('[Depop] Package size: no options found in dropdown')
          }
          await page.waitForTimeout(300)
        } else {
          console.warn('[Depop] Package size field not found')
        }
      } catch (e) {
        console.warn('[Depop] Package size selection failed:', e)
      }
    }

    // ─── 8c. Pre-submit: scan for any unfilled required comboboxes and auto-fill
    // Uses page.evaluate to directly click inputs by their DOM ID (NOT getByLabel)
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

        // Fill each one using page.evaluate to click the input directly by ID
        for (const field of unfilledFields) {
          try {
            // Dismiss any open dropdown first
            await page.keyboard.press('Escape')
            await page.waitForTimeout(200)

            // Click the input to open its dropdown
            const opened = await page.evaluate((inputId) => {
              if (!inputId) return false
              const input = document.getElementById(inputId)
              if (input) {
                input.scrollIntoView({ block: 'center' })
                input.click()
                return true
              }
              return false
            }, field.inputId)

            if (!opened) {
              console.warn(`[Depop] Could not open "${field.labelText}" (no input ID)`)
              continue
            }

            await page.waitForTimeout(800)

            // Pick the first option, but VERIFY it's not a condition/size value
            const picked = await page.evaluate((fieldLabel) => {
              const options = Array.from(document.querySelectorAll('[role="option"]'))
              if (options.length === 0) return null
              // Sanity: if this looks like condition or size options, don't pick
              const firstText = (options[0] as HTMLElement).innerText?.trim() ?? ''
              if (/^(new with tags|like new|good|fair|poor)$/i.test(firstText)) return '(skipped: condition values)'
              if (/^(XXS|XS|S|M|L|XL|XXL)$/i.test(firstText)) return '(skipped: size values)'
              ;(options[0] as HTMLElement).click()
              return firstText
            }, field.labelText)

            if (picked && !picked.startsWith('(skipped')) {
              console.log(`[Depop] Auto-filled "${field.labelText}" with: ${picked}`)
            } else {
              console.warn(`[Depop] Skipped or no options for "${field.labelText}": ${picked}`)
            }

            await page.keyboard.press('Escape')
            await page.waitForTimeout(300)
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
