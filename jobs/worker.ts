/**
 * Standalone BullMQ worker process.
 * Run with: npx tsx jobs/worker.ts
 * Or add to package.json scripts: "worker": "tsx jobs/worker.ts"
 *
 * This registers both workers and keeps the process alive.
 * Run alongside `pnpm dev` for local development.
 */
import 'dotenv/config'
import { syncAnalyticsWorker } from './syncAnalytics'
import { refreshTokensWorker } from './refreshTokens'

console.log('🔧 FlipSync workers starting...')

syncAnalyticsWorker.on('completed', (job) => {
  console.log(`✅ syncAnalytics job ${job.id} completed`)
})
syncAnalyticsWorker.on('failed', (job, err) => {
  console.error(`❌ syncAnalytics job ${job?.id} failed:`, err.message)
})

refreshTokensWorker.on('completed', (job) => {
  console.log(`✅ refreshTokens job ${job.id} completed`)
})
refreshTokensWorker.on('failed', (job, err) => {
  console.error(`❌ refreshTokens job ${job?.id} failed:`, err.message)
})

console.log('✓ Workers registered — listening for jobs...')
console.log('  • syncAnalytics  (enqueued every 6h via POST /api/jobs/run)')
console.log('  • refreshTokens  (enqueued every 15min via POST /api/jobs/run)')

// Keep alive
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing workers...')
  await Promise.all([syncAnalyticsWorker.close(), refreshTokensWorker.close()])
  process.exit(0)
})
