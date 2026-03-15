import { getValidDepopToken } from './lib/depop/auth'
const token = await getValidDepopToken()
process.stdout.write(token || 'NO_TOKEN')
