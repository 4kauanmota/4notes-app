<script setup lang="ts">
/**
 * Código em tela cheia: abre um bloco de código num editor grande, com números de
 * linha e as cores da linguagem. Cada alteração vai direto para a nota (e é salva
 * junto com ela). Esc ou "Fechar" voltam para a nota.
 *
 * Bloco de texto (```text): o mesmo, mas como texto — fonte do texto, linhas que
 * quebram, sem números de linha e sem nada de código (cores, fechar parênteses…).
 *
 * Nos dois, Ctrl+D seleciona a próxima ocorrência (várias seleções editadas juntas),
 * como no editor do bloco na nota.
 *
 * "Quebrar linhas" (1.6.4, botão no cabeçalho ou Alt+Z): as linhas longas continuam
 * embaixo, na largura da janela, sem rolar para o lado. Só na tela — o conteúdo não
 * ganha quebras de verdade (lib/editor/line-wrap.ts). A escolha fica guardada no
 * workspace, uma para código (padrão: desligada) e outra para texto (padrão: ligada).
 */
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab, undo } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CodeEditRequest } from '~/lib/editor/host'
import { showToast } from '~/composables/useToasts'
import { codeFoldingSupport, indentGuides } from '~/lib/editor/code-structure'
import { minimalChange } from '~/lib/editor/diff'
import { canFormat, formatCode } from '~/lib/editor/format-code'
import { findLanguage, isTextBlockInfo, languageLabel } from '~/lib/editor/languages'
import { lineWrap } from '~/lib/editor/line-wrap'
import { plainMultipleSelections } from '~/lib/editor/multi-select'
import { codeEditorTheme, codeHighlight, textEditorTheme } from '~/lib/editor/theme'
import { useNotesStore } from '~/stores/notes'

const props = defineProps<{ request: CodeEditRequest }>()
const emit = defineEmits<{ close: [] }>()

const parent = ref<HTMLDivElement>()
const copied = ref(false)
const isText = isTextBlockInfo(props.request.info)
const label = computed(() => (isText ? 'Bloco de texto' : languageLabel(props.request.info)))
const language = new Compartment()
const wrapping = new Compartment()
let view: EditorView | null = null

// ── Quebrar linhas ──────────────────────────────────────────────────────────

const notes = useNotesStore()
const wrap = ref(isText ? notes.state.settings.wrapText : notes.state.settings.wrapCode)

function toggleWrap(): boolean {
  wrap.value = !wrap.value
  if (view) {
    // O cursor continua à vista (as linhas mudam de altura ao quebrar ou juntar)
    const head = view.state.selection.main.head
    view.dispatch({ effects: [wrapping.reconfigure(lineWrap(wrap.value, !isText)), EditorView.scrollIntoView(head, { y: 'nearest' })] })
  }
  notes.updateSettings(isText ? { wrapText: wrap.value } : { wrapCode: wrap.value })
  return true
}

/** Pelo botão: troca e devolve o foco ao texto (para continuar digitando, Esc fechar…). */
function onWrapClick(): void {
  toggleWrap()
  view?.focus()
}

function close(): boolean {
  emit('close')
  return true
}

// ── Formatar (1.7.2) ────────────────────────────────────────────────────────

/** Linguagem com formatador (format-code.ts). */
const formattable = !isText && canFormat(props.request.info)
const formatting = ref(false)

function formatNow(): boolean {
  if (!view || !formattable) return false
  if (!formatting.value) void runFormat()
  return true
}

async function runFormat(): Promise<void> {
  const current = view
  if (!current) return
  formatting.value = true
  const code = current.state.doc.toString()
  try {
    const result = await formatCode(code, props.request.info)
    // Fechou ou o código mudou enquanto formatava: não passa por cima
    if (view !== current || current.state.doc.toString() !== code) return
    if (!result.ok) showToast({ message: result.reason, icon: 'alert' })
    else if (!result.changed) showToast({ message: 'O código já está formatado.', icon: 'check' })
    else {
      current.dispatch({ changes: minimalChange(code, result.code), userEvent: 'input.format', scrollIntoView: true })
      showToast({ message: `Código formatado (${result.language})`, icon: 'check', action: { label: 'Desfazer', run: () => void (view && undo(view)) } })
    }
  } finally {
    formatting.value = false
    if (view === current) current.focus()
  }
}

const applyChanges = EditorView.updateListener.of((update) => {
  if (update.docChanged) props.request.apply(update.state.doc.toString())
})

function codeExtensions(): Extension[] {
  return [
    lineNumbers(),
    // 1.7.2: setas para recolher/expandir e guias de indentação
    codeFoldingSupport(),
    indentGuides(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    plainMultipleSelections,
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    search({ top: true }),
    // Esc fecha a busca (se aberta) e, depois, a tela cheia; Alt+Z quebra as linhas
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      { key: 'Escape', run: close },
      { key: 'Alt-z', run: toggleWrap },
      { key: 'Shift-Alt-f', run: formatNow, preventDefault: true },
    ]),
    wrapping.of(lineWrap(wrap.value, true)),
    language.of([]),
    syntaxHighlighting(codeHighlight),
    codeEditorTheme,
    EditorView.contentAttributes.of({ 'aria-label': `Código ${label.value}`, spellcheck: 'false' }),
    applyChanges,
  ]
}

/** Bloco de texto: o conteúdo fica exatamente como está (nada de recursos de código). */
function textExtensions(): Extension[] {
  return [
    history(),
    drawSelection(),
    plainMultipleSelections,
    highlightSelectionMatches(),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, { key: 'Escape', run: close }, { key: 'Alt-z', run: toggleWrap }]),
    wrapping.of(lineWrap(wrap.value, false)),
    textEditorTheme,
    EditorView.contentAttributes.of({ 'aria-label': 'Bloco de texto', spellcheck: 'true' }),
    applyChanges,
  ]
}

onMounted(() => {
  view = new EditorView({
    parent: parent.value!,
    state: EditorState.create({ doc: props.request.code, extensions: isText ? textExtensions() : codeExtensions() }),
  })
  const description = isText ? null : findLanguage(props.request.info)
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
    <div
      class="code-fullscreen"
      role="dialog"
      aria-modal="true"
      :aria-label="isText ? 'Bloco de texto em tela cheia' : `Código em tela cheia: ${label}`"
      @keydown.esc.self="close"
    >
      <header class="cf-head">
        <AppIcon :name="isText ? 'text-block' : 'code'" :size="16" />
        <span class="cf-lang">{{ label }}</span>
        <span class="cf-hint">As alterações vão direto para a nota</span>
        <button
          class="btn btn-ghost btn-sm cf-wrap"
          type="button"
          data-wrap-toggle
          :aria-pressed="wrap"
          aria-label="Quebrar linhas"
          :data-tip="wrap ? 'Quebrar linhas: ligado (Alt+Z)' : 'Quebrar linhas: desligado (Alt+Z)'"
          @click="onWrapClick"
        >
          <AppIcon name="wrap" :size="15" /><span class="cf-label"> Quebrar linhas</span>
        </button>
        <button
          v-if="formattable"
          class="btn btn-ghost btn-sm"
          type="button"
          data-format-code
          :disabled="formatting"
          aria-label="Formatar código"
          data-tip="Formatar código (Shift+Alt+F)"
          @click="formatNow"
        >
          <AppIcon name="sparkle" :size="15" /><span class="cf-label"> Formatar</span>
        </button>
        <button class="btn btn-ghost btn-sm" type="button" :aria-label="copied ? 'Copiado' : 'Copiar'" @click="copy">
          <AppIcon :name="copied ? 'check' : 'copy'" :size="15" /><span class="cf-label"> {{ copied ? 'Copiado' : 'Copiar' }}</span>
        </button>
        <button class="btn btn-primary btn-sm" type="button" data-tip="Esc" aria-label="Fechar" @click="close">
          <AppIcon name="shrink" :size="15" /><span class="cf-label"> Fechar</span>
        </button>
      </header>
      <div ref="parent" class="cf-editor" />
    </div>
  </Teleport>
</template>

<style scoped>
.code-fullscreen {
  position: fixed;
  /* Abaixo da barra de título: os botões da janela (minimizar, maximizar, fechar) ficam livres.
     No Android, também abaixo da barra de status e acima da barra de gestos (--safe-*). */
  inset: calc(var(--titlebar-h) + var(--safe-top)) 0 0 0;
  padding-bottom: var(--safe-bottom);
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
/* Quebrar linhas ligado: o botão fica marcado (como os botões ativos do app) */
.cf-wrap[aria-pressed='true'],
.cf-wrap[aria-pressed='true']:hover {
  background: var(--active);
  color: var(--primary-text);
}
.cf-editor {
  flex: 1;
  min-height: 0;
}
.cf-editor :deep(.cm-editor) {
  height: 100%;
}
/* Celular: sem o aviso (não cabe) e só os ícones nos botões */
html[data-layout='compact'] .cf-hint {
  display: none;
}
html[data-layout='compact'] .cf-lang {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
html[data-layout='compact'] .cf-head .btn {
  width: 40px;
  padding: 0;
  justify-content: center;
}
html[data-layout='compact'] .cf-label {
  display: none;
}
@keyframes cf-in {
  from {
    opacity: 0;
    transform: scale(0.99);
  }
}
</style>
