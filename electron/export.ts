/**
 * Exportar uma nota (processo principal): como .txt (só o texto) ou .pdf (com a
 * formatação). O arquivo vai para onde você escolher no "Salvar como" — fora do
 * workspace; a nota continua igual.
 *
 * O PDF é impresso por uma janela escondida, a partir do HTML montado pela
 * interface (lib/notes/export.ts). As imagens do workspace entram embutidas no
 * arquivo e nada é buscado na internet.
 */
import { BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { exportFileName, inlineWorkspaceImages as inlineImages } from '../shared/files'
import { WORKSPACE_SCHEME } from '../shared/ipc'
import { AppError, MAX_IMAGE_BYTES, resolveInside } from './files'

export { exportFileName } from '../shared/files'

/** Pasta do último arquivo exportado (o próximo "Salvar como" começa nela). */
let lastDir: string | null = null
/** Arquivos exportados nesta sessão (os únicos que "Mostrar" pode abrir no Explorador). */
const exported = new Set<string>()

const MAX_TEXT = 50 * 1024 * 1024
const MAX_HTML = 20 * 1024 * 1024

async function askTarget(win: BrowserWindow | null, title: string, name: unknown, extension: string, filter: string): Promise<string | null> {
  const file = exportFileName(name, extension)
  const options: Electron.SaveDialogOptions = {
    title,
    buttonLabel: 'Exportar',
    defaultPath: lastDir ? path.join(lastDir, file) : file,
    filters: [{ name: filter, extensions: [extension] }],
    properties: ['showOverwriteConfirmation', 'createDirectory'],
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  let target = result.filePath
  if (path.extname(target).toLowerCase() !== `.${extension}`) {
    target += `.${extension}`
    // O "Salvar como" conferiu outro nome (sem a extensão): se este já existe, pergunta aqui
    if (await fs.stat(target).then(() => true, () => false)) {
      const message: Electron.MessageBoxOptions = {
        type: 'warning',
        buttons: ['Substituir', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        title: 'Exportar nota',
        message: `“${path.basename(target)}” já existe.`,
        detail: 'Deseja substituir o arquivo?',
      }
      const answer = win ? await dialog.showMessageBox(win, message) : await dialog.showMessageBox(message)
      if (answer.response !== 0) return null
    }
  }
  lastDir = path.dirname(target)
  return target
}

/** Salva o texto num .txt (UTF-8; no Windows, com as quebras de linha do Windows). */
export async function exportText(win: BrowserWindow | null, name: unknown, text: unknown): Promise<string | null> {
  if (typeof text !== 'string' || text.length > MAX_TEXT) throw new AppError('EINVAL', 'Texto inválido.')
  const target = await askTarget(win, 'Exportar nota como TXT', name, 'txt', 'Texto')
  if (!target) return null
  await fs.writeFile(target, process.platform === 'win32' ? text.replace(/\r?\n/g, '\r\n') : text, 'utf8')
  exported.add(target)
  return target
}

/** Troca as imagens do workspace (workspace://files/…) pela imagem embutida (data:…). */
export function inlineWorkspaceImages(root: string | null, html: string): Promise<string> {
  return inlineImages(html, `${WORKSPACE_SCHEME}://files/`, async (relative) => {
    if (!root) return null
    const data = await fs.readFile(resolveInside(root, relative))
    return data.byteLength > MAX_IMAGE_BYTES ? null : data.toString('base64')
  })
}

/** Gera o PDF da nota (pelo HTML montado na interface) e salva onde você escolher. */
export async function exportPdf(win: BrowserWindow | null, root: string | null, name: unknown, html: unknown): Promise<string | null> {
  if (typeof html !== 'string' || html.length > MAX_HTML) throw new AppError('EINVAL', 'Conteúdo inválido.')
  const target = await askTarget(win, 'Exportar nota como PDF', name, 'pdf', 'PDF')
  if (!target) return null
  const page = await inlineWorkspaceImages(root, html)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4notes-pdf-'))
  const file = path.join(dir, 'nota.html')
  const printer = new BrowserWindow({
    show: false,
    width: 860,
    height: 1100,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, spellcheck: false },
  })
  printer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  printer.webContents.on('will-navigate', (event) => event.preventDefault())
  try {
    await fs.writeFile(file, page, 'utf8')
    await printer.loadFile(file)
    const pdf = await printer.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.7, bottom: 0.7, left: 0.65, right: 0.65 },
    })
    await fs.writeFile(target, pdf)
  } finally {
    printer.destroy()
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
  exported.add(target)
  return target
}

/** Mostra no Explorador um arquivo exportado nesta sessão. */
export function revealExport(target: unknown): void {
  if (typeof target === 'string' && exported.has(target)) shell.showItemInFolder(target)
}
