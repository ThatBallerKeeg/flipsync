'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle, AlertCircle, ExternalLink, Loader2, Clock } from 'lucide-react'
import { useToast } from '@/hooks/useToast'
import { ConnectedAccount } from '@/types'
import { formatRelativeTime } from '@/lib/utils'

// Reads search params and fires toast — must be inside <Suspense>
function SearchParamsHandler({ toast }: { toast: ReturnType<typeof useToast>['toast'] }) {
  const searchParams = useSearchParams()
  useEffect(() => {
    const connected = searchParams.get('connected')
    const error = searchParams.get('error')
    if (connected) {
      toast({ title: `${connected.charAt(0).toUpperCase() + connected.slice(1)} connected!`, description: 'Your account has been linked successfully.' })
    }
    if (error) {
      toast({ title: 'Connection failed', description: `Could not connect: ${error}`, variant: 'destructive' })
    }
  }, [searchParams, toast])
  return null
}

export default function SettingsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data: accounts = [] } = useQuery<ConnectedAccount[]>({
    queryKey: ['connected-accounts'],
    queryFn: () => fetch('/api/platforms/accounts').then((r) => r.json()),
  })

  const disconnectMutation = useMutation({
    mutationFn: (platform: string) =>
      fetch(`/api/platforms/${platform.toLowerCase()}/disconnect`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connected-accounts'] }),
  })

  const ebayAccount = accounts.find((a) => a.platform === 'EBAY')
  const depopAccount = accounts.find((a) => a.platform === 'DEPOP')

  return (
    <div className="max-w-2xl space-y-6">
      <Suspense fallback={null}>
        <SearchParamsHandler toast={toast} />
      </Suspense>
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-muted-foreground mt-1">Manage your platform connections and preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connected Platforms</CardTitle>
          <CardDescription>Connect your selling accounts to sync listings and orders.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* eBay */}
          <PlatformCard
            name="eBay"
            color="#E53238"
            account={ebayAccount}
            connectHref="/api/platforms/ebay/connect"
            onDisconnect={() => disconnectMutation.mutate('EBAY')}
          />
          <Separator />
          {/* Depop — uses credential form instead of OAuth */}
          <DepopCard
            account={depopAccount}
            onDisconnect={() => disconnectMutation.mutate('DEPOP')}
            onConnected={() => qc.invalidateQueries({ queryKey: ['connected-accounts'] })}
          />
        </CardContent>
      </Card>

      <AutoPublishSettings />
    </div>
  )
}

// ─── eBay card (OAuth link) ───────────────────────────────────────────────────

function PlatformCard({
  name, color, account, connectHref, onDisconnect,
}: {
  name: string
  color: string
  account?: ConnectedAccount
  connectHref: string
  onDisconnect: () => void
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <span className="rounded px-2.5 py-1 text-sm font-bold text-white" style={{ backgroundColor: color }}>
          {name}
        </span>
        <div>
          {account ? (
            <>
              <div className="flex items-center gap-1.5">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">Connected</span>
                {account.shopUsername && (
                  <Badge variant="secondary" className="text-xs">@{account.shopUsername}</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Last updated {formatRelativeTime(account.updatedAt)}
              </p>
            </>
          ) : (
            <div className="flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Not connected</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        {account ? (
          <Button variant="outline" size="sm" onClick={onDisconnect}>Disconnect</Button>
        ) : (
          <Button size="sm" asChild>
            <a href={connectHref}>
              <ExternalLink className="mr-1 h-3 w-3" />Connect
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Auto-publish settings ───────────────────────────────────────────────────

function AutoPublishSettings() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then((r) => r.json()),
  })

  // Auto-publish state
  const currentPublish = settings?.autoPublishPerDay ?? '0'
  const [publishValue, setPublishValue] = useState<string | null>(null)
  const displayPublish = publishValue ?? currentPublish

  // Auto-relist state
  const currentRelistDays = settings?.autoRelistAfterDays ?? '0'
  const currentRelistPerDay = settings?.autoRelistPerDay ?? '0'
  const [relistDays, setRelistDays] = useState<string | null>(null)
  const [relistPerDay, setRelistPerDay] = useState<string | null>(null)
  const displayRelistDays = relistDays ?? currentRelistDays
  const displayRelistPerDay = relistPerDay ?? currentRelistPerDay

  const hasChanges =
    displayPublish !== currentPublish ||
    displayRelistDays !== currentRelistDays ||
    displayRelistPerDay !== currentRelistPerDay

  async function handleSave() {
    if (!hasChanges) return
    setSaving(true)
    try {
      const updates: { key: string; value: string }[] = []
      if (displayPublish !== currentPublish) updates.push({ key: 'autoPublishPerDay', value: displayPublish })
      if (displayRelistDays !== currentRelistDays) updates.push({ key: 'autoRelistAfterDays', value: displayRelistDays })
      if (displayRelistPerDay !== currentRelistPerDay) updates.push({ key: 'autoRelistPerDay', value: displayRelistPerDay })

      await Promise.all(
        updates.map((u) =>
          fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(u),
          })
        )
      )
      qc.invalidateQueries({ queryKey: ['settings'] })
      toast({ title: 'Saved', description: 'Automation settings updated.' })
      setPublishValue(null)
      setRelistDays(null)
      setRelistPerDay(null)
    } catch {
      toast({ title: 'Failed to save', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Automation
        </CardTitle>
        <CardDescription>
          Automatically publish drafts and relist stale listings on Depop.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Auto-publish */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Auto-Publish Drafts</h4>
          <div className="flex items-center gap-4">
            <Label htmlFor="auto-publish-count" className="shrink-0 text-sm text-muted-foreground">Drafts per day</Label>
            <Select value={displayPublish} onValueChange={(v) => setPublishValue(v)}>
              <SelectTrigger id="auto-publish-count" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n === 0 ? 'Off' : String(n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">Oldest drafts are published first.</p>
        </div>

        <Separator />

        {/* Auto-relist */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Auto-Relist</h4>
          <p className="text-xs text-muted-foreground">
            Automatically relist active listings after a set number of days to boost visibility.
            Relisting deletes the old listing and creates an identical new one.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <div className="flex items-center gap-3">
              <Label htmlFor="relist-after-days" className="shrink-0 text-sm text-muted-foreground">Relist after</Label>
              <Select value={displayRelistDays} onValueChange={(v) => setRelistDays(v)}>
                <SelectTrigger id="relist-after-days" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 3, 5, 7, 10, 14, 21, 30].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n === 0 ? 'Off' : `${n} days`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="relist-per-day" className="shrink-0 text-sm text-muted-foreground">Max per day</Label>
              <Select value={displayRelistPerDay} onValueChange={(v) => setRelistPerDay(v)}>
                <SelectTrigger id="relist-per-day" className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n === 0 ? 'Off' : String(n)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {hasChanges && (
          <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Save Settings
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Depop card (credential form) ────────────────────────────────────────────

function DepopCard({
  account,
  onDisconnect,
  onConnected,
}: {
  account?: ConnectedAccount
  onDisconnect: () => void
  onConnected: () => void
}) {
  const { toast } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/platforms/depop/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, token }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: 'Connection failed', description: data.error ?? 'Could not save token.', variant: 'destructive' })
      } else {
        toast({ title: 'Depop connected!', description: `Saved as @${data.username}` })
        setShowForm(false)
        setUsername('')
        setToken('')
        onConnected()
      }
    } catch {
      toast({ title: 'Connection failed', description: 'Network error.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="py-2 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded px-2.5 py-1 text-sm font-bold text-white" style={{ backgroundColor: '#FF2300' }}>
            Depop
          </span>
          <div>
            {account ? (
              <>
                <div className="flex items-center gap-1.5">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">Connected</span>
                  {account.shopUsername && (
                    <Badge variant="secondary" className="text-xs">@{account.shopUsername}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Last updated {formatRelativeTime(account.updatedAt)}
                </p>
              </>
            ) : (
              <div className="flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Not connected</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {account ? (
            <Button variant="outline" size="sm" onClick={onDisconnect}>Disconnect</Button>
          ) : (
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : 'Connect'}
            </Button>
          )}
        </div>
      </div>

      {showForm && !account && (
        <form onSubmit={handleConnect} className="ml-[4.5rem] space-y-3 rounded-lg border p-4 bg-muted/30">
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">How to get your Depop token:</p>
            <ol className="list-decimal ml-4 space-y-1">
              <li>Open <strong>depop.com</strong> in your browser and log in via magic link</li>
              <li>Press <kbd className="rounded border px-1 py-0.5 font-mono text-[11px]">F12</kbd> to open DevTools → go to <strong>Application</strong> tab</li>
              <li>In the left sidebar: <strong>Local Storage → https://www.depop.com</strong></li>
              <li>Find the key <code className="rounded bg-muted px-1 font-mono text-[11px]">persist:auth</code> and copy the <code className="rounded bg-muted px-1 font-mono text-[11px]">accessToken</code> value (without quotes)</li>
            </ol>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="depop-username" className="text-xs">Your Depop username</Label>
            <Input
              id="depop-username"
              placeholder="your_depop_username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="depop-token" className="text-xs">Access token (paste from DevTools)</Label>
            <Input
              id="depop-token"
              type="password"
              placeholder="eyJ…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={loading}
              className="h-8 text-sm font-mono"
            />
          </div>
          <Button type="submit" size="sm" disabled={loading || !username || !token} className="w-full">
            {loading && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            {loading ? 'Saving…' : 'Save Token'}
          </Button>
        </form>
      )}
    </div>
  )
}
