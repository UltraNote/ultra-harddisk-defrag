import type { AppStatus, DeepPartial, DefragJob, DefragRequest, Settings } from '@shared/types'
import React, { createContext, useContext } from 'react'

export type PageId =
  | 'dashboard'
  | 'defrag'
  | 'largefiles'
  | 'health'
  | 'schedule'
  | 'libraries'
  | 'actioncenter'
  | 'logs'
  | 'settings'

export interface ToastPayload {
  title: string
  body: string
  level: 'info' | 'warn' | 'threat' | 'success' | 'error'
}

export interface AppContextValue {
  status: AppStatus | null
  settings: Settings
  job: DefragJob | null
  busy: boolean
  refreshStatus: () => Promise<void>
  saveSettings: (patch: DeepPartial<Settings>) => Promise<void>
  navigate: (page: PageId) => void
  pushToast: (toast: ToastPayload) => void
  runJob: (request: DefragRequest) => Promise<DefragJob>
  cancelJob: () => Promise<void>
  elevate: () => Promise<void>
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppContext')
  return ctx
}

export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList, initial: T): [T, boolean, () => void] {
  const [value, setValue] = React.useState<T>(initial)
  const [loading, setLoading] = React.useState(true)
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then((res) => {
        if (alive) setValue(res)
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return [value, loading, () => setTick((t) => t + 1)]
}
