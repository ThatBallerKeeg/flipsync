import { getValidDepopToken } from './auth'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execFileAsync = promisify(execFile)
const DEPOP_API_BASE_V1 = 'https://api.depop.com/api/v1'
const DEPOP_API_BASE_V2 = 'https://api.depop.com/api/v2'
const FETCH_SCRIPT = path.join(process.cwd(), 'lib/depop/fetch.py')

export async function depopFetch(
  apiPath: string,
  options: { method?: string; body?: unknown; v2?: boolean } = {}
): Promise<{ status: number; json: () => unknown; text: () => string; ok: boolean }> {
  const token = await getValidDepopToken()
  if (!token) throw new Error('Depop not connected — please connect your account in Settings.')

  const method = options.method ?? 'GET'
  const base = options.v2 ? DEPOP_API_BASE_V2 : DEPOP_API_BASE_V1
  const url = `${base}${apiPath}`
  const args = [FETCH_SCRIPT, method, url, token]
  if (options.body != null) {
    const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
    args.push(bodyStr)
  }

  const { stdout } = await execFileAsync('python3', args, { maxBuffer: 20 * 1024 * 1024 })
  const newline = stdout.indexOf('\n')
  const statusCode = parseInt(stdout.slice(0, newline), 10)
  const body = stdout.slice(newline + 1)

  return {
    status: statusCode,
    ok: statusCode >= 200 && statusCode < 300,
    text: () => body,
    json: () => { try { return JSON.parse(body) } catch { return {} } },
  }
}
