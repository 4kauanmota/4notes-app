/** Leitura/escrita de arquivos JSON na pasta de dados (via camada desktop). */
import { desktop } from '../platform'
import { debounce, SerialQueue } from '../utils/async'

export type JsonReadResult =
  | { status: 'missing' }
  | { status: 'ok'; data: unknown; raw: string }
  | { status: 'invalid'; raw: string; error: string }

export async function readJsonFile(path: string): Promise<JsonReadResult> {
  const raw = await desktop().files.read(path)
  if (raw === null) return { status: 'missing' }
  if (!raw.trim()) return { status: 'invalid', raw, error: 'O arquivo está vazio.' }
  try {
    return { status: 'ok', data: JSON.parse(raw), raw }
  } catch (error) {
    return { status: 'invalid', raw, error: error instanceof Error ? error.message : String(error) }
  }
}

export function toJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`
}

/**
 * Gravador com "debounce" para arquivos de estado da interface
 * (abas abertas, posições do mapa…). Muitas alterações seguidas viram uma escrita só.
 */
export function createJsonWriter(path: string, delay = 400) {
  const queue = new SerialQueue()
  let latest: (() => unknown) | null = null
  let lastWritten = ''

  const write = () =>
    queue.run(path, async () => {
      if (!latest) return
      const raw = toJson(latest())
      if (raw === lastWritten) return
      await desktop().files.write(path, raw)
      lastWritten = raw
    })

  const scheduled = debounce(() => {
    void write().catch((error) => console.warn(`[4notes] Falha ao salvar ${path}:`, error))
  }, delay)

  return {
    /** Agenda a gravação; `getData` é chamado no momento de gravar. */
    save(getData: () => unknown) {
      latest = getData
      scheduled()
    },
    async flush() {
      if (scheduled.pending()) {
        scheduled.cancel()
        await write().catch(() => undefined)
      }
      await queue.idle()
    },
    /** Há uma gravação agendada ou acontecendo agora. */
    pending: () => scheduled.pending() || queue.busy,
  }
}
