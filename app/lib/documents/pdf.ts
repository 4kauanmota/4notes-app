/**
 * Leitor de PDF dos Documentos (1.7.3): o pdf.js (o mesmo motor do leitor do Firefox),
 * carregado só quando um PDF é aberto. Tudo é local: o worker, as fontes padrão, os
 * mapas de caracteres e o WebAssembly vêm do próprio app (nuxt.config.ts › nitro).
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'

type PdfJs = typeof import('pdfjs-dist')

let library: Promise<PdfJs> | null = null

export function loadPdfJs(): Promise<PdfJs> {
  library ??= (async () => {
    const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })().catch((error) => {
    library = null
    throw error
  })
  return library
}

export interface OpenedPdf {
  pdf: PDFDocumentProxy
  /** Fecha o documento (e libera o worker dele). */
  close(): Promise<void>
}

/** Abre o PDF a partir dos bytes (que passam para o worker). */
export async function openPdf(data: Uint8Array): Promise<OpenedPdf> {
  const pdfjs = await loadPdfJs()
  const base = new URL('/pdfjs/', window.location.href).href
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    useSystemFonts: true,
    // Formulários XFA e scripts do PDF ficam desligados (só leitura)
    enableXfa: false,
  })
  try {
    return { pdf: await task.promise, close: () => task.destroy() }
  } catch (error) {
    void task.destroy()
    throw error
  }
}
