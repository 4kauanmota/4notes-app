/**
 * O que é só deste aparelho: abas abertas, lista lateral aberta, pastas abertas na
 * lista, último módulo, mapa aberto…
 *
 * Fica no próprio aparelho (no armazenamento local do app), separado por workspace —
 * não vai para a pasta do workspace. Assim, com a pasta sincronizada entre o
 * computador e o celular, cada um continua com as próprias abas e telas, e as
 * CONFIGURAÇÕES (stores/settings.ts) são as mesmas nos dois.
 *
 * Perder isso não perde nada importante: o app só abre "do zero" (sem abas abertas).
 */
import { desktop, hasDesktopApi } from '../platform'

const PREFIX = '4notes:'
/** Sem armazenamento local (testes): fica na memória. */
const memory = new Map<string, string>()

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

/** O workspace aberto (o mesmo caminho, escrito de outro jeito, é o mesmo workspace). */
function workspaceKey(): string {
  const path = hasDesktopApi() ? desktop().bootstrap?.dataDir?.path : null
  return path ? path.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() : '-'
}

const keyOf = (name: string) => `${PREFIX}${workspaceKey()}:${name}`

/** Estado guardado (objeto) — ou null se não houver (ou estiver corrompido). */
export function readDeviceState(name: string): Record<string, unknown> | null {
  const key = keyOf(name)
  let raw: string | null = null
  try {
    raw = storage()?.getItem(key) ?? memory.get(key) ?? null
  } catch {
    raw = memory.get(key) ?? null
  }
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function writeDeviceState(name: string, value: Record<string, unknown>): void {
  const key = keyOf(name)
  const raw = JSON.stringify(value)
  memory.set(key, raw)
  try {
    storage()?.setItem(key, raw)
  } catch (error) {
    // Armazenamento cheio ou bloqueado: continua valendo nesta sessão (na memória)
    console.warn('[4notes] Não foi possível guardar o estado do aparelho:', error)
  }
}

/** Preferência do aparelho que não depende do workspace (ex.: o tema, antes de abrir um workspace). */
export function readLocalValue(name: string): string | null {
  try {
    return storage()?.getItem(`${PREFIX}${name}`) ?? memory.get(`${PREFIX}${name}`) ?? null
  } catch {
    return memory.get(`${PREFIX}${name}`) ?? null
  }
}

export function writeLocalValue(name: string, value: string): void {
  memory.set(`${PREFIX}${name}`, value)
  try {
    storage()?.setItem(`${PREFIX}${name}`, value)
  } catch {
    // só na memória
  }
}
