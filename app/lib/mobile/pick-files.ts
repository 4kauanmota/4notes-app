/**
 * Escolher arquivos do celular (imagens para a biblioteca, o arquivo de favoritos do
 * navegador) pelo seletor de arquivos do Android — o mesmo de qualquer site.
 * Devolve [] se você cancelar.
 */
export function pickFiles(options: { accept: string; multiple?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = options.accept
    input.multiple = options.multiple === true
    input.style.display = 'none'
    let done = false
    const finish = (files: File[]) => {
      if (done) return
      done = true
      input.remove()
      document.removeEventListener('visibilitychange', onVisible)
      resolve(files)
    }
    // O seletor do Android é outra tela: ao voltar sem escolher nada, nem todo
    // Android avisa "cancel" — então, de volta ao app sem arquivo, conta como cancelado.
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTimeout(() => finish([...(input.files ?? [])]), 1200)
    }
    input.addEventListener('change', () => finish([...(input.files ?? [])]))
    input.addEventListener('cancel', () => finish([]))
    document.addEventListener('visibilitychange', onVisible)
    document.body.append(input)
    input.click()
  })
}
