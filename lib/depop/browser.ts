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
      if (imgUrl.startsWith('/uploads/')) {
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
    await page.fill('textarea[name="description"]', desc)

    // ─── 3. Fill price ────────────────────────────────────────────────────────
    const priceInput = page.locator('[data-testid="priceAmount__input"]')
    await priceInput.fill(String(listing.price))

    // ─── 3b. Select category (required) ──────────────────────────────────────
    // Depop's autotagging AI suggests categories below the Category combobox.
    // The suggestion pills are not <button> elements — use text-based clicking.
    try {
      // Scroll to bring the Category section into view
      await page.locator('text=Category').first().scrollIntoViewIfNeeded().catch(() => null)
      await page.waitForTimeout(800)

      // Try clicking an AI-suggested pill by matching the listing category
      const listingCat = (listing.category ?? '').toLowerCase()
      const categoryKeywords = [
        ['t-shirt', 'T-shirts'], ['hoodie', 'Hoodies'], ['sweatshirt', 'Sweatshirts'],
        ['pant', 'Pants'], ['short', 'Shorts'], ['jean', 'Jeans'],
        ['jacket', 'Jackets'], ['coat', 'Coats'], ['blazer', 'Blazers'],
        ['dress', 'Dresses'], ['skirt', 'Skirts'], ['shirt', 'Shirts'],
        ['top', 'Tops'], ['sneaker', 'Sneakers'], ['boot', 'Boots'],
        ['hat', 'Hats'], ['bag', 'Bags'],
      ]

      let categoryChosen = false
      for (const [keyword, label] of categoryKeywords) {
        if (listingCat.includes(keyword)) {
          // getByText matches any element containing this text (element-type agnostic)
          const pill = page.getByText(label, { exact: false }).first()
          if (await pill.count() > 0) {
            await pill.click()
            await page.waitForTimeout(400)
            console.log('[Depop] Category selected via pill:', label)
            categoryChosen = true
            break
          }
        }
      }

      if (!categoryChosen) {
        // Fall back: click the first pill INSIDE the Suggested section specifically
        const chosen = await page.evaluate(() => {
          // Find the "Suggested" label element
          const allEls = Array.from(document.querySelectorAll('*'))
          const suggested = allEls.find(
            (el) => (el as HTMLElement).innerText?.trim() === 'Suggested'
          )
          if (suggested) {
            // The pills are siblings of "Suggested" — search within parent container
            const container = suggested.parentElement
            if (container) {
              const candidates = Array.from(container.querySelectorAll('*'))
              for (const c of candidates) {
                const text = (c as HTMLElement).innerText ?? ''
                if (text.includes(' / ') && text.length < 40 && c.children.length <= 3) {
                  ;(c as HTMLElement).click()
                  return text
                }
              }
            }
          }
          return null
        })
        if (chosen) {
          console.log('[Depop] Category selected via evaluate:', chosen)
          categoryChosen = true
          await page.waitForTimeout(400)
        }
      }

      if (!categoryChosen) {
        // Last resort: open the Category combobox and search
        const categoryInput = page.locator('#group-input, input[aria-controls="group-menu"]').first()
        if (await categoryInput.count() > 0 && listingCat.length > 0) {
          await categoryInput.click()
          await page.waitForTimeout(500)
          // Type a search term derived from listing category
          const searchTerm = listingCat.includes('t-shirt') ? 'T-shirts'
            : listingCat.includes('shirt') ? 'Shirts'
            : listingCat.includes('pant') ? 'Pants'
            : listingCat.includes('jacket') ? 'Jackets'
            : listingCat.includes('dress') ? 'Dresses'
            : listingCat.split(/[>/,]/)[0].trim()
          if (searchTerm) {
            await categoryInput.type(searchTerm, { delay: 50 })
            await page.waitForTimeout(800)
            const firstOpt = page.locator('[role="option"]').first()
            if (await firstOpt.count() > 0) {
              await firstOpt.click()
              console.log('[Depop] Category selected via combobox search:', searchTerm)
              categoryChosen = true
            }
          }
        }
      }

      // Ultimate fallback: if category is still empty (e.g. synced listing with no category),
      // click the FIRST AI-suggested category pill from Depop's autotagging
      if (!categoryChosen) {
        console.log('[Depop] No category set — trying to click first AI-suggested pill')
        const suggestedPill = await page.evaluate(() => {
          // Look for any clickable element containing " / " (category format like "Men / T-shirts")
          const allEls = Array.from(document.querySelectorAll('*'))
          for (const el of allEls) {
            const text = (el as HTMLElement).innerText?.trim() ?? ''
            if (text.includes(' / ') && text.length < 40 && text.length > 3 && el.children.length <= 3) {
              ;(el as HTMLElement).click()
              return text
            }
          }
          return null
        })
        if (suggestedPill) {
          console.log('[Depop] Category selected via first AI suggestion:', suggestedPill)
          categoryChosen = true
          await page.waitForTimeout(400)
        } else {
          console.warn('[Depop] No category could be selected — form may fail')
        }
      }
    } catch (e) {
      console.warn('[Depop] Category selection failed:', e)
    }

    // ─── 4. Select condition via combobox ─────────────────────────────────────
    const conditionText = CONDITION_MAP[listing.condition ?? 'good'] ?? 'Good'
    try {
      // Scroll condition field into view
      await page.locator('text=Condition').first().scrollIntoViewIfNeeded().catch(() => null)
      await page.waitForTimeout(400)
      // Use the combobox input near the Condition label (strict: use .first() to avoid multiple matches)
      const conditionInput = page.getByLabel('Condition').first()
      if (await conditionInput.count() > 0) {
        await conditionInput.click()
        await page.waitForTimeout(700)
        // Select matching option; fall back to first option
        const option = page.locator('[role="option"]').filter({ hasText: new RegExp(conditionText, 'i') }).first()
        if (await option.count() > 0) {
          await option.click()
          console.log('[Depop] Condition selected:', conditionText)
        } else {
          await page.locator('[role="option"]').first().click().catch(() => null)
          console.log('[Depop] Condition selected: first option (fallback)')
        }
      }
    } catch (e) {
      console.warn('[Depop] Condition selection failed:', e)
    }

    // ─── 5. Select size (required when category has sizes) ───────────────────
    if (listing.size) {
      try {
        await page.locator('text=Size').first().scrollIntoViewIfNeeded().catch(() => null)
        await page.waitForTimeout(400)

        // Normalise size string: "Large" → "L", "Medium" → "M", etc.
        const sizeRaw = listing.size.trim()
        const SIZE_NORM: Record<string, string> = {
          'extra small': 'XS', 'xs': 'XS',
          'small': 'S', 's': 'S',
          'medium': 'M', 'm': 'M',
          'large': 'L', 'l': 'L',
          'extra large': 'XL', 'xl': 'XL',
          'xxl': 'XXL', '2xl': 'XXL',
          'xxxl': 'XXXL', '3xl': 'XXXL',
        }
        const sizeNorm = SIZE_NORM[sizeRaw.toLowerCase()] ?? sizeRaw

        // Depop size input is a combobox — getByLabel('Size') or aria-label
        let sizeChosen = false

        // Strategy 1: click combobox by label
        const sizeInput = page.getByLabel('Size').first()
        if (await sizeInput.count() > 0) {
          await sizeInput.click()
          await page.waitForTimeout(500)
          // Try to find a matching option (e.g. "L", "Large", "L / Large")
          const sizeOption = page.locator('[role="option"]').filter({
            hasText: new RegExp(`^${sizeNorm}$|\\b${sizeNorm}\\b`, 'i'),
          }).first()
          if (await sizeOption.count() > 0) {
            await sizeOption.click()
            console.log('[Depop] Size selected via label combobox:', sizeNorm)
            sizeChosen = true
          } else {
            // Type to filter, then pick first option
            await sizeInput.fill(sizeNorm)
            await page.waitForTimeout(500)
            const filtered = page.locator('[role="option"]').first()
            if (await filtered.count() > 0) {
              await filtered.click()
              console.log('[Depop] Size selected via typed filter:', sizeNorm)
              sizeChosen = true
            }
          }
          await page.waitForTimeout(300)
        }

        // Strategy 2: find input near "Size" text via evaluate
        if (!sizeChosen) {
          const picked = await page.evaluate((sz: string) => {
            const allInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'))
            for (const input of allInputs) {
              const label = input.closest('label') ?? document.querySelector(`label[for="${input.id}"]`)
              const nearby = input.closest('[class*="size" i], [data-testid*="size" i]')
                ?? input.parentElement?.parentElement
              const labelText = (label ?? nearby)?.textContent ?? ''
              if (/size/i.test(labelText)) {
                ;(input as HTMLInputElement).focus()
                ;(input as HTMLInputElement).click()
                return 'clicked-input'
              }
            }
            return null
          }, sizeNorm)
          if (picked) {
            await page.waitForTimeout(500)
            const opt = page.locator('[role="option"]').filter({
              hasText: new RegExp(`^${sizeNorm}$|\\b${sizeNorm}\\b`, 'i'),
            }).first()
            if (await opt.count() > 0) {
              await opt.click()
              console.log('[Depop] Size selected via evaluate fallback:', sizeNorm)
              sizeChosen = true
            }
          }
        }

        if (!sizeChosen) {
          console.warn('[Depop] Size selection failed — could not find size field for:', sizeNorm)
        }
      } catch (e) {
        console.warn('[Depop] Size selection error:', e)
      }
    }

    // ─── 5b. If no size was provided but the form shows a Size field, pick first option
    if (!listing.size) {
      try {
        const sizeInput = page.getByLabel('Size').first()
        if (await sizeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log('[Depop] Size field visible but no size set — picking first option')
          await sizeInput.click({ timeout: 3000 })
          await page.waitForTimeout(800)
          // Use evaluate to click directly (avoids visibility timeout issues)
          const selectedSize = await page.evaluate(() => {
            const options = Array.from(document.querySelectorAll('[role="option"]'))
            if (options.length > 0) { (options[0] as HTMLElement).click(); return (options[0] as HTMLElement).innerText?.trim() }
            return null
          })
          if (selectedSize) {
            console.log('[Depop] Size auto-selected:', selectedSize)
          }
          await page.waitForTimeout(300)
        }
      } catch {
        // Size is optional for some categories
      }
    }

    // ─── 7. Fill brand (optional) ─────────────────────────────────────────────
    if (listing.brand) {
      try {
        const brandInput = page.getByLabel('Brand')
        if (await brandInput.count() > 0) {
          await brandInput.click()
          await brandInput.fill(listing.brand)
          await page.waitForTimeout(800)
          // Click the first autocomplete suggestion
          const firstOpt = page.locator('[role="option"]').first()
          if (await firstOpt.count() > 0) {
            await firstOpt.click()
          } else {
            // Press Enter to accept typed brand
            await brandInput.press('Enter')
          }
        }
      } catch {
        // Brand is optional
      }
    }

    // ─── 8. Ensure USPS shipping is selected ─────────────────────────────────
    const uspsRadio = page.locator('[data-testid="usps__shipping__input"]')
    if (await uspsRadio.count() > 0) {
      await uspsRadio.check().catch(() => null)
      await page.waitForTimeout(600)

      // ─── 8b. Select Package size (required for USPS) ─────────────────────
      // Depop shows a "Package size" combobox after USPS is chosen.
      // Use page.evaluate to click options directly (avoids Playwright visibility timeout issues).
      try {
        await page.locator('text=Package size').first().scrollIntoViewIfNeeded().catch(() => null)
        await page.waitForTimeout(400)
        const pkgSizeInput = page.getByLabel('Package size').first()
        if (await pkgSizeInput.count() > 0) {
          await pkgSizeInput.click({ timeout: 5000 })
          await page.waitForTimeout(800)

          // Use evaluate to find and click the option directly in the DOM
          const selectedPkg = await page.evaluate(() => {
            const options = Array.from(document.querySelectorAll('[role="option"]'))
            // Try "Small" first
            const small = options.find((o) => /small/i.test((o as HTMLElement).innerText ?? ''))
            if (small) { (small as HTMLElement).click(); return (small as HTMLElement).innerText?.trim() }
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
        }
      } catch (e) {
        console.warn('[Depop] Package size selection failed:', e)
      }
    }

    // ─── 9. Click "Post" to publish ───────────────────────────────────────────
    // There are two submit buttons: "Post" (first) and "Save as a draft" (second)
    await page.screenshot({ path: '/tmp/depop-before-submit.png' }).catch(() => null)
    const postBtn = page.locator('button[type="submit"]').first()
    await postBtn.click()

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
        const allErrors = await page
          .locator('[role="alert"], [data-testid*="error"], p[class*="error" i], span[class*="error" i]')
          .allTextContents()
          .catch(() => [] as string[])
        const shortErrors = allErrors.map((t) => t.trim()).filter((t) => t.length > 0 && t.length < 120)
        throw new Error(
          `Listing submission failed${shortErrors.length ? ': ' + shortErrors.join(' | ') : '. Check Depop manually.'} | Page snippet: ${pageText.slice(0, 200)}`
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
