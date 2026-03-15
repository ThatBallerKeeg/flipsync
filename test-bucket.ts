import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = readFileSync('.env.local', 'utf8')
const get = (k: string) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim() ?? ''

async function main() {
  const url = get('NEXT_PUBLIC_SUPABASE_URL')
  const key = get('SUPABASE_SERVICE_ROLE_KEY')
  console.log('URL:', url.slice(0, 40))
  console.log('Key prefix:', key.slice(0, 20))
  
  const supabase = createClient(url, key)
  
  // Try uploading a tiny test file
  const testBuffer = Buffer.from('hello world')
  const { data, error } = await supabase.storage
    .from('listing-photos')
    .upload(`test-${Date.now()}.txt`, testBuffer, { contentType: 'text/plain', upsert: false })
  
  console.log('upload data:', data)
  console.log('upload error:', JSON.stringify(error))
}
main()
