/**
 * "@" num campo de texto abre a lista de notas para mencionar.
 *
 * O texto digitado depois do @ filtra a lista; ao escolher, o "@texto" vira o
 * título da nota (a frase continua legível) e a menção é guardada na tarefa.
 */
import { nextTick, ref } from 'vue'
import type { NoteRef } from '~/lib/tasks/mentions'

export interface MentionPickerControls {
  move(delta: number): void
  choose(): void
}

interface Options {
  getText(): string
  setText(value: string): void
  element(): HTMLInputElement | HTMLTextAreaElement | undefined
  onPick(ref: NoteRef, title: string): void
}

const TRIGGER = /(?:^|\s)@([^\s@]{0,40})$/

export function useMentionTrigger(options: Options) {
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

  function pick(ref: NoteRef, title: string): void {
    const el = options.element()
    const text = options.getText()
    if (start < 0) return
    const caret = Math.max(start, el?.selectionStart ?? text.length)
    const left = text.slice(0, start)
    let right = text.slice(caret)
    if (!right.startsWith(' ') && right) right = ` ${right}`
    const next = `${left}${title}${right}`
    const position = left.length + title.length
    options.setText(next)
    options.onPick(ref, title)
    close()
    void nextTick(() => el?.setSelectionRange(position, position))
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

  return { query, onInput, onKeydown, pick, close }
}
