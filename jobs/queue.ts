import { Queue, Worker, QueueEvents } from 'bullmq'

const connection = {
  host: process.env.UPSTASH_REDIS_REST_URL?.replace('https://', '').replace('http://', '') ?? 'localhost',
  port: 6379,
  password: process.env.UPSTASH_REDIS_REST_TOKEN,
  tls: process.env.UPSTASH_REDIS_REST_URL?.startsWith('https') ? {} : undefined,
}

export const analyticsQueue = new Queue('syncAnalytics', { connection })
export const tokenQueue = new Queue('refreshTokens', { connection })

export { connection }
