import Session from 'tls-client'
import { getValidDepopToken } from './lib/depop/auth'

async function main() {
  const token = await getValidDepopToken()
  if (!token) { console.log('No token stored'); process.exit(1) }
  console.log('Token found, testing API...')
  
  const session = new Session({ clientIdentifier: 'safari_16_0' })
  const res = await session.get('https://api.depop.com/api/v2/users/me/', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'Depop/3.7.6 (iPhone; iOS 16.6; Scale/3.00)',
    }
  })
  console.log('Status:', res.status)
  console.log(JSON.stringify(res.json, null, 2).slice(0, 500))
}

main().catch(console.error)
