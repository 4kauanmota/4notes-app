<script setup lang="ts">
/**
 * Código em tela cheia: abre um bloco de código num editor grande, com números de
 * linha e as cores da linguagem. Cada alteração vai direto para a nota (e é salva
 * junto com ela). Esc ou "Fechar" voltam para a nota.
 */
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CodeEditRequest } from '~/lib/editor/host'
import { findLanguage, languageLabel } from '~/lib/editor/languages'
import { codeEditorTheme, codeHighlight } from '~/lib/editor/theme'

const props = defineProps<{ request: CodeEditRequest }>()
const emit = defineEmits<{ close: [] }>()

const parent = ref<HTMLDivElement>()
const copied = ref(false)
const label = computed(() => languageLabel(props.request.info))
const language = new Compartment()
let view: EditorView | null = null

function close(): boolean {
  emit('close')
  return true
}

onMounted(() => {
  view = new EditorView({
    parent: parent.value!,
    state: EditorState.create({
      doc: props.request.code,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        search({ top: true }),
        // Esc fecha a busca (se aberta) e, depois, a tela cheia
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, { key: 'Escape', run: close }]),
        language.of([]),
        syntaxHighlighting(codeHighlight),
        codeEditorTheme,
        EditorView.contentAttributes.of({ 'aria-label': `Código ${label.value}`, spellcheck: 'false' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) props.request.apply(update.state.doc.toString())
        }),
      ],
    }),
  })
  const description = findLanguage(props.request.info)
  if (description) void description.load().then((support) => view?.dispatch({ effects: language.reconfigure(support) }))
  view.focus()
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

function copy(): void {
  if (!view) return
  void navigator.clipboard.writeText(view.state.doc.toString()).then(() => {
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  })
}
</script>

<template>
  <Teleport to="body">
    <div class="code-fullscreen" role="dialog" aria-modal="true" :aria-label="`Código em tela cheia: ${label}`" @keydown.esc.self="close">
      <header class="cf-head">
        <AppIcon name="code" :size="16" />
        <span class="cf-lang">{{ label }}</span>
        <span class="cf-hint">As alterações vão direto para a nota</span>
        <button class="btn btn-ghost btn-sm" type="button" @click="copy">
          <AppIcon :name="copied ? 'check' : 'copy'" :size="15" /> {{ copied ? 'Copiado' : 'Copiar' }}
        </button>
        <button class="btn btn-primary btn-sm" type="button" data-tip="Esc" @click="close">
          <AppIcon name="shrink" :size="15" /> Fechar
        </button>
      </header>
      <div ref="parent" class="cf-editor" />
    </div>
  </Teleport>
</template>

<style scoped>
.code-fullscreen {
  position: fixed;
  /* Abaixo da barra de título: os botões da janela (minimizar, maximizar, fechar) ficam livres */
  inset: var(--titlebar-h) 0 0 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  animation: cf-in 160ms var(--ease-out);
}
.cf-head {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-2);
}
.cf-lang {
  font-weight: 650;
  color: var(--text);
}
.cf-hint {
  flex: 1;
  font-size: 12.5px;
  color: var(--text-3);
}
.cf-editor {
  flex: 1;
  min-height: 0;
}
.cf-editor :deep(.cm-editor) {
  height: 100%;
}
@keyframes cf-in {
  from {
    opacity: 0;
    transform: scale(0.99);
  }
}
</style>
