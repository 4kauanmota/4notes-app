/**
 * Guarda no estado do editor se ele está com foco. Os blocos de código e as
 * imagens só "abrem" (mostram o Markdown) com o editor focado.
 */
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

const setFocus = StateEffect.define<boolean>()

const focusField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFocus)) value = effect.value
    return value
  },
})

export function isFocused(state: EditorState): boolean {
  return state.field(focusField, false) ?? false
}

/** A transação mudou o foco? */
export function focusChanged(effects: readonly StateEffect<unknown>[]): boolean {
  return effects.some((effect) => effect.is(setFocus))
}

export const focusTracking: Extension = [focusField, EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing))]
