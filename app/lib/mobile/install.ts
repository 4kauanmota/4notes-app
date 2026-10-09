/**
 * Instala a API do 4notes no Android (window.fourNotes), antes de a interface abrir.
 *
 * - No app Android (Capacitor): o sistema de arquivos de verdade e o plugin nativo.
 * - Nos testes automatizados da versão mobile (navegador comum, com
 *   localStorage["4notes:test-platform"] = "android"): um disco na memória.
 * - No Electron (desktop) não faz nada: o preload já instalou a API.
 *
 * O código do Android fica num pedaço separado (import dinâmico): o desktop não o carrega.
 */
import { readLocalValue } from '~/lib/storage/device-state'

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

export function isCapacitorAndroid(): boolean {
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
  return !!capacitor?.isNativePlatform?.() && capacitor.getPlatform?.() === 'android'
}

export async function installMobilePlatform(): Promise<void> {
  if (typeof window === 'undefined' || window.fourNotes) return
  const native = isCapacitorAndroid()
  const test = !native && readLocalValue('test-platform') === 'android'
  if (!native && !test) return

  const [{ createMobileApi }, fs, nativeModule] = await Promise.all([import('./api'), import('./fs'), import('./native')])
  if (native) {
    const { App } = await import('@capacitor/app')
    const info = await nativeModule.FourNotesNativePlugin.storageInfo().catch(() => ({ root: '/storage/emulated/0', granted: false }))
    const version = await App.getInfo()
      .then((app) => app.version)
      .catch(() => '')
    window.fourNotes = await createMobileApi({ fs: fs.capacitorFs(info.root), native: nativeModule.FourNotesNativePlugin, version })
  } else {
    const root = '/storage/emulated/0'
    const today = readLocalValue('test-today')
    window.fourNotes = await createMobileApi({
      fs: fs.memoryFs(root, { persistKey: '4notes:test-fs' }),
      native: nativeModule.fakeNative(root),
      version: '0.0.0-test',
      test: true,
      fakeToday: today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : null,
    })
  }
}
