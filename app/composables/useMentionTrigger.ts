/**
 * "@" num campo de texto abre a lista do que dá para mencionar (todos os módulos).
 *
 * O texto digitado depois do @ filtra a lista; ao escolher, o "@texto" vira o
 * título do item (a frase continua legível) e a menção é guardada na tarefa.
 *
 * Com `trigger: '#'` (1.7.1) é o mesmo para as categorias (CategoryMentionPicker):
 * quem usa decide o que o "#texto" vira (`replace`), ex.: nas Finanças ele sai da
 * descrição e vira a categoria do lançamento.
 */
import { nextTick, ref } from 'vue'
import type { MentionRef } from '~/lib/mentions/refs'

export interface MentionPickerControls {
  move(delta: number): void
  choose(): void
}

interface Options {
  getText(): string
  setText(value: string): void
  element(): HTMLInputElement | HTMLTextAreaElement | undefined
  onPick?(ref: MentionRef, title: string): void
  /** O caractere que abre a lista (padrão "@"). */
  trigger?: '@' | '#'
}

const TRIGGERS = {
  '@': /(?:^|\s)@([^\s@]{0,40})$/,
  '#': /(?:^|\s)#([^\s#]{0,40})$/,
}

export function useMentionTrigger(options: Options) {
  const TRIGGER = TRIGGERS[options.trigger ?? '@']
  /** Texto depois do @ (null = lista fechada). */
  const query = ref<string | null>(null)
  let start = -1

  function close(): void {
    query.value = null
    start = -1
  }

  function onInput(): void {
    const el = options.element()
    if (!el) return
    const caret = el.selectionStart ?? options.getText().length
    const match = TRIGGER.exec(options.getText().slice(0, caret))
    if (!match) return close()
    start = caret - match[1]!.length - 1
    query.value = match[1]!
  }

  /** Troca o "@texto" (ou "#texto") por `replacement` ("" tira e junta os espaços). */
  function replace(replacement: string): void {
    const el = options.element()
    const text = options.getText()
    if (start < 0) return
    const caret = Math.max(start, el?.selectionStart ?? text.length)
    let left = text.slice(0, start)
    let right = text.slice(caret)
    if (replacement) {
      if (!right.startsWith(' ') && right) right = ` ${right}`
    } else {
      // Sem nada no lugar: não sobram dois espaços (nem um no começo)
      if (left.endsWith(' ') && (right.startsWith(' ') || !right)) left = left.slice(0, -1)
      if (!left && right.startsWith(' ')) right = right.slice(1)
    }
    const next = `${left}${replacement}${right}`
    const position = left.length + replacement.length
    options.setText(next)
    close()
    void nextTick(() => el?.setSelectionRange(position, position))
  }

  function pick(ref: MentionRef, title: string): void {
    if (start < 0) return
    replace(title)
    options.onPick?.(ref, title)
  }

  /** Teclas enquanto a lista está aberta (↑/↓, Enter/Tab, Esc). Devolve true se tratou a tecla. */
  function onKeydown(event: KeyboardEvent, picker: MentionPickerControls | undefined | null): boolean {
    if (query.value === null || !picker) return false
    const handled = () => {
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    if (event.key === 'ArrowDown') {
      picker.move(1)
      return handled()
    }
    if (event.key === 'ArrowUp') {
      picker.move(-1)
      return handled()
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      picker.choose()
      return handled()
    }
    if (event.key === 'Escape') {
      close()
      return handled()
    }
    return false
  }

  return { query, onInput, onKeydown, pick, replace, close }
}
