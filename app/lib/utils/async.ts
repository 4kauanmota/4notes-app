/** Utilitários de tempo e concorrência (sem dependência de Vue). */

export interface Debounced<A extends unknown[]> {
  (...args: A): void
  /** Executa agora, se houver algo agendado. */
  flush(): void
  cancel(): void
  pending(): boolean
}

/** Agrupa chamadas em sequência: só executa depois de `wait` ms sem novas chamadas. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: A | null = null

  const run = () => {
    timer = null
    const args = lastArgs
    lastArgs = null
    if (args) fn(...args)
  }

  const debounced = ((...args: A) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, wait)
  }) as Debounced<A>

  debounced.flush = () => {
    if (!timer) return
    clearTimeout(timer)
    run()
  }
  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    lastArgs = null
  }
  debounced.pending = () => timer !== null
  return debounced
}

/**
 * Fila serial por chave: tarefas com a mesma chave rodam uma de cada vez, na ordem.
 * Evita, por exemplo, que dois salvamentos do mesmo arquivo se atropelem.
 */
export class SerialQueue {
  private tails = new Map<string, Promise<unknown>>()

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(task)
    const tail = result.catch(() => undefined)
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return result
  }

  get busy(): boolean {
    return this.tails.size > 0
  }

  /** Espera todas as tarefas em andamento terminarem. */
  async idle(): Promise<void> {
    while (this.tails.size) await Promise.all([...this.tails.values()])
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Identificador curto e aleatório, ex.: "t_k3j9x0a2qm". */
export function createId(prefix = ''): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  const body = Array.from(bytes, (b) => (b % 36).toString(36)).join('')
  return prefix ? `${prefix}_${body}` : body
}
