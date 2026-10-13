/**
 * Atualizações do Windows pelo GitHub Releases (electron-updater).
 *
 * - O repositório vem do package.json ("updates": { "github": "usuario/repositorio" }) —
 *   o mesmo que o `npm run release` usa para publicar. A configuração do electron-updater
 *   (app-update.yml) é gerada a partir dele, na pasta de configuração do 4notes.
 * - Procurar: lê o latest.yml do Release mais recente (só versões publicadas; rascunhos e
 *   pré-lançamentos ficam de fora). Nada é baixado sem você pedir.
 * - Instalar: baixa o instalador (com o andamento), fecha o 4notes — salvando antes, pelo
 *   fechamento normal da janela —, instala sem perguntas na mesma pasta e abre de novo.
 *   As notas e configurações ficam onde estão (o instalador nunca mexe no workspace).
 * - Só no app instalado: rodando com `npm run dev`, a verificação é desligada.
 * - Testes automatizados: FOURNOTES_FAKE_UPDATE=<versão> finge uma versão disponível.
 */
import { app } from 'electron'
import { autoUpdater, type UpdateInfo as UpdaterInfo } from 'electron-updater'
import fs from 'node:fs'
import path from 'node:path'
import { compareVersions, parseRepository, type UpdateCheck, type UpdateInstallResult } from '../shared/updates'
import { AppError } from './files'

const fakeVersion = process.env.FOURNOTES_TEST === '1' ? (process.env.FOURNOTES_FAKE_UPDATE ?? '') : ''

/** Repositório do package.json do app (o que vai dentro do instalador). */
function configuredRepository(): { owner: string; repo: string } | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as { updates?: { github?: unknown } }
    return parseRepository(pkg.updates?.github)
  } catch {
    return null
  }
}

let feedReady = false
let repositoryLabel = ''
let found: UpdaterInfo | null = null
let progressHandler: ((percent: number) => void) | null = null

function prepareFeed(): boolean {
  if (feedReady) return true
  const repository = configuredRepository()
  if (!repository) return false
  repositoryLabel = `${repository.owner}/${repository.repo}`
  // A configuração do electron-updater (normalmente gravada no instalador) é escrita aqui,
  // a partir do package.json: um `npm run dist:win` comum também gera um app que se atualiza.
  const configPath = path.join(app.getPath('userData'), 'app-update.yml')
  try {
    fs.writeFileSync(
      configPath,
      `provider: github\nowner: ${repository.owner}\nrepo: ${repository.repo}\nupdaterCacheDirName: 4notes-updater\n`,
    )
    autoUpdater.updateConfigPath = configPath
  } catch {
    // sem a configuração própria vale a do instalador (resources/app-update.yml), se houver
  }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.setFeedURL({ provider: 'github', owner: repository.owner, repo: repository.repo })
  autoUpdater.on('download-progress', (progress) => progressHandler?.(Math.max(0, Math.min(100, progress.percent))))
  feedReady = true
  return true
}

/** As notas do Release chegam em HTML: vira texto simples. */
function notesText(notes: UpdaterInfo['releaseNotes']): string {
  const raw = Array.isArray(notes) ? notes.map((item) => item.note ?? '').join('\n') : (notes ?? '')
  return raw
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\/\s*(p|h\d|li|ul|ol|div)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Mensagem que dá para entender (em vez do erro técnico do electron-updater). */
function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK|CONNECTION|TIMED_OUT)/i.test(
      message,
    )
  ) {
    return 'Sem conexão com a internet (ou o GitHub não respondeu).'
  }
  if (/latest\.yml/i.test(message))
    return `A versão publicada em ${repositoryLabel} não tem o arquivo latest.yml — publique com "npm run release".`
  if (/404|No published versions|Unable to find latest version/i.test(message)) {
    return `Nenhuma versão publicada em ${repositoryLabel} (o repositório precisa existir, ser público e ter uma versão publicada).`
  }
  return message.split('\n')[0]!.slice(0, 300) || 'Não foi possível procurar atualizações.'
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  if (fakeVersion) {
    return compareVersions(fakeVersion, app.getVersion()) > 0
      ? {
          status: 'available',
          update: { version: fakeVersion, notes: '- Melhorias de teste\n- Correções', date: new Date().toISOString() },
        }
      : { status: 'latest' }
  }
  if (!app.isPackaged) return { status: 'unsupported', reason: 'dev' }
  if (!prepareFeed()) return { status: 'unsupported', reason: 'not-configured' }
  try {
    const result = await autoUpdater.checkForUpdates()
    const info = result?.updateInfo
    if (!info || compareVersions(info.version, app.getVersion()) <= 0) {
      found = null
      return { status: 'latest' }
    }
    found = info
    return { status: 'available', update: { version: info.version, notes: notesText(info.releaseNotes), date: info.releaseDate ?? null } }
  } catch (error) {
    return { status: 'error', message: friendlyError(error) }
  }
}

/** Baixa e instala. A interface já salvou tudo antes de chamar (e salva de novo ao fechar). */
export async function installUpdate(onProgress: (percent: number) => void): Promise<UpdateInstallResult> {
  if (fakeVersion) {
    onProgress(50)
    onProgress(100)
    return 'installing'
  }
  if (!found) {
    const check = await checkForUpdate()
    if (check.status === 'error') throw new AppError('EUPDATE', check.message)
    if (check.status !== 'available') throw new AppError('EUPDATE', 'Não há uma versão nova para instalar.')
  }
  progressHandler = onProgress
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    throw new AppError('EUPDATE', `Não foi possível baixar a atualização: ${friendlyError(error)}`)
  } finally {
    progressHandler = null
  }
  onProgress(100)
  // Silencioso (mesma pasta, mesmos atalhos) e abre o 4notes de novo no fim
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 400)
  return 'installing'
}
