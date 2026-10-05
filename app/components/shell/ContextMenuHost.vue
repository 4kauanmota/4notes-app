<script setup lang="ts">
/**
 * Desenha os menus de clique direito (ver composables/useContextMenu.ts) com o
 * visual do 4notes, inclusive o menu de texto do editor (copiar/colar e as
 * sugestões do corretor, que vêm do processo principal).
 *
 * O menu não tira o foco de onde ele está (o editor continua focado, então
 * "Colar" cola no lugar certo); o teclado é tratado enquanto o menu está aberto:
 * ↑ ↓ escolhem, → / ← abrem e fecham submenus, Enter confirma e Esc fecha.
 */
import { redo, selectAll, undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { linkAtContextMenu, removeLink, selectLinkAt } from '~/lib/editor/formatting'
import { nextTick, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import type { TextMenuRequest } from '#shared/ipc'
import { openMenu, separator, showContextMenu, type MenuItemSpec } from '~/composables/useContextMenu'
import { desktop, hasDesktopApi, modKeyLabel } from '~/lib/platform'

interface Level {
  items: MenuItemSpec[]
  /** Ponto pedido (o menu é ajustado para caber na janela). */
  x: number
  y: number
  left: number
  top: number
  measured: boolean
  active: number
  /** Submenu: retângulo do menu de cima (para abrir ao lado dele) e o item que o abriu. */
  anchor: DOMRect | null
  opener: number
}

const levels = reactive<Level[]>([])
const panels: HTMLElement[] = []
let hoverTimer: ReturnType<typeof setTimeout> | null = null
const MARGIN = 6

const usable = (item: MenuItemSpec | undefined) => !!item && item.type !== 'separator' && item.enabled !== false

function makeLevel(items: MenuItemSpec[], x: number, y: number, anchor: DOMRect | null = null, opener = -1): Level {
  return { items, x, y, left: x, top: y, measured: false, active: -1, anchor, opener }
}

watch(openMenu, (request) => {
  clearHover()
  levels.splice(0)
  if (request) {
    levels.push(makeLevel(request.items, request.x, request.y))
    void place()
  }
})

function close(id: string | null = null): void {
  const request = openMenu.value
  levels.splice(0)
  clearHover()
  request?.resolve(id)
}

// ── Posição (cabe sempre dentro da janela) ──────────────────────────────────

async function place(): Promise<void> {
  await nextTick()
  const vw = window.innerWidth
  const vh = window.innerHeight
  levels.forEach((level, depth) => {
    const el = panels[depth]
    if (!el || level.measured) return
    const { width, height } = el.getBoundingClientRect()
    let left = level.x
    let top = level.y
    if (level.anchor) {
      // Submenu: ao lado do item; sem espaço à direita, abre à esquerda do menu de cima
      if (left + width > vw - MARGIN) left = Math.max(MARGIN, level.anchor.left - width + 2)
    } else if (left + width > vw - MARGIN) {
      left = Math.max(MARGIN, left - width)
    }
    if (top + height > vh - MARGIN) top = level.anchor ? vh - height - MARGIN : Math.max(MARGIN, top - height)
    level.left = Math.max(MARGIN, left)
    level.top = Math.max(MARGIN, top)
    level.measured = true
  })
}

// ── Submenus ─────────────────────────────────────────────────────────────────

function clearHover(): void {
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = null
}

function openSubmenu(depth: number, index: number, focusFirst: boolean): void {
  const level = levels[depth]
  const item = level?.items[index]
  levels.splice(depth + 1)
  if (!level || !item?.submenu || !usable(item)) return
  const row = panels[depth]?.querySelectorAll<HTMLElement>('.ctx-item')[index]
  const rect = row?.getBoundingClientRect()
  const panel = panels[depth]?.getBoundingClientRect()
  const sub = makeLevel(item.submenu, (panel?.right ?? 0) - 4, (rect?.top ?? 0) - 5, panel ?? null, index)
  if (focusFirst) sub.active = item.submenu.findIndex(usable)
  levels.push(sub)
  void place()
}

function onHover(depth: number, index: number): void {
  const level = levels[depth]
  if (!level) return
  level.active = index
  clearHover()
  const item = level.items[index]
  // Pequena espera: dá para levar o mouse em diagonal até o submenu sem ele fechar
  hoverTimer = setTimeout(() => {
    if (item?.submenu) openSubmenu(depth, index, false)
    else levels.splice(depth + 1)
  }, item?.submenu ? 120 : 200)
}

function onPanelEnter(depth: number): void {
  // Entrou no submenu: ele fica aberto (e o item que o abriu continua marcado)
  if (depth === 0) return
  clearHover()
  const parent = levels[depth - 1]
  if (parent) parent.active = levels[depth]!.opener
}

function activate(depth: number, index: number): void {
  const item = levels[depth]?.items[index]
  if (!usable(item)) return
  if (item!.submenu) return openSubmenu(depth, index, true)
  close(item!.id ?? null)
}

// ── Teclado ──────────────────────────────────────────────────────────────────

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function move(level: Level, step: number): void {
  const count = level.items.length
  for (let i = 1; i <= count; i++) {
    const index = (level.active + step * i + count * 2) % count
    if (usable(level.items[index])) {
      level.active = index
      return
    }
  }
}

function onKeydown(event: KeyboardEvent): void {
  const depth = levels.length - 1
  const level = levels[depth]
  if (!level) return
  const handled = () => {
    event.preventDefault()
    event.stopPropagation()
  }
  switch (event.key) {
    case 'ArrowDown':
      handled()
      return move(level, 1)
    case 'ArrowUp':
      handled()
      return move(level, -1)
    case 'Home':
      handled()
      level.active = -1
      return move(level, 1)
    case 'End':
      handled()
      level.active = 0
      return move(level, -1)
    case 'ArrowRight':
      handled()
      if (level.items[level.active]?.submenu) openSubmenu(depth, level.active, true)
      return
    case 'ArrowLeft':
      handled()
      if (depth > 0) levels.splice(depth)
      return
    case 'Enter':
    case ' ':
      handled()
      if (level.active >= 0) activate(depth, level.active)
      return
    case 'Escape':
      handled()
      if (depth > 0) levels.splice(depth)
      else close()
      return
    case 'Tab':
      handled()
      return close()
  }
  // Letra: vai para o próximo item que começa com ela
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    handled()
    const letter = fold(event.key)
    const count = level.items.length
    for (let i = 1; i <= count; i++) {
      const index = (level.active + i) % count
      const item = level.items[index]
      if (usable(item) && fold(item!.label ?? '').startsWith(letter)) {
        level.active = index
        return
      }
    }
    return
  }
  // Atalhos (Ctrl+…) com o menu aberto: fecha o menu e deixa o atalho seguir
  if (event.ctrlKey || event.metaKey || event.altKey) close()
}

// ── Fechar ao clicar fora, rolar, redimensionar ou trocar de janela ──────────

function isInside(target: EventTarget | null): boolean {
  return target instanceof Node && panels.some((panel) => panel?.contains(target))
}

function onPointerDown(event: PointerEvent): void {
  if (levels.length && !isInside(event.target)) close()
}
function onWheel(event: WheelEvent): void {
  if (levels.length && !isInside(event.target)) close()
}
function onWindowChange(): void {
  if (levels.length) close()
}

// ── Menu de texto (editor e campos): copiar/colar e corretor ─────────────────

const mod = modKeyLabel()

async function onTextMenu(request: TextMenuRequest): Promise<void> {
  const items: MenuItemSpec[] = []
  if (request.misspelledWord) {
    for (const word of request.suggestions) items.push({ id: `replace:${word}`, label: word })
    if (!request.suggestions.length) items.push({ label: 'Nenhuma sugestão', enabled: false })
    items.push({ id: 'learn', label: 'Adicionar ao dicionário' }, separator)
  }
  if (request.isEditable) {
    items.push(
      { id: 'undo', label: 'Desfazer', hint: `${mod}+Z`, enabled: request.canUndo },
      { id: 'redo', label: 'Refazer', hint: `${mod}+Y`, enabled: request.canRedo },
      separator,
      { id: 'cut', label: 'Recortar', hint: `${mod}+X`, enabled: request.canCut },
      { id: 'copy', label: 'Copiar', hint: `${mod}+C`, enabled: request.canCopy },
      { id: 'paste', label: 'Colar', hint: `${mod}+V`, enabled: request.canPaste },
      separator,
      { id: 'selectAll', label: 'Selecionar tudo', hint: `${mod}+A` },
    )
  } else if (request.hasSelection) {
    items.push({ id: 'copy', label: 'Copiar', hint: `${mod}+C` })
  }
  if (request.linkURL) {
    if (items.length) items.push(separator)
    items.push({ id: 'open-link', label: 'Abrir link no navegador' })
  }
  // Link no editor (o texto dele, com o endereço escondido)
  const editorLink = linkAtContextMenu()
  if (editorLink) {
    if (items.length) items.push(separator)
    items.push(
      { id: 'link-open', label: 'Abrir link no navegador', enabled: /^(https?:|mailto:)/i.test(editorLink.link.url ?? '') },
      { id: 'link-copy', label: 'Copiar endereço do link' },
      { id: 'link-edit', label: 'Editar link…' },
      { id: 'link-remove', label: 'Remover link' },
    )
  }
  if (!items.length) return

  // O editor de texto (CodeMirror) tem o próprio desfazer/refazer
  const focused = document.activeElement as HTMLElement | null
  const editor = focused?.closest('.cm-editor') ? EditorView.findFromDOM(focused.closest<HTMLElement>('.cm-editor')!) : null
  const choice = await showContextMenu(items)
  if (!choice) return
  const api = desktop()
  if (choice.startsWith('replace:')) return api.menu.runTextAction('replace', choice.slice('replace:'.length))
  if (choice === 'learn') return api.menu.runTextAction('learn', request.misspelledWord)
  if (choice === 'open-link' && request.linkURL) return void api.shell.openExternal(request.linkURL)
  if (editorLink && choice.startsWith('link-')) {
    const { view, link } = editorLink
    const url = link.url ?? ''
    if (choice === 'link-open') return void api.shell.openExternal(url)
    if (choice === 'link-copy') return void navigator.clipboard.writeText(url)
    view.focus()
    if (!selectLinkAt(view, link.openTo)) return
    if (choice === 'link-remove') removeLink(view)
    else view.dom.dispatchEvent(new CustomEvent('fournotes:edit-link'))
    return
  }
  if (editor && (choice === 'undo' || choice === 'redo' || choice === 'selectAll')) {
    const command = choice === 'undo' ? undo : choice === 'redo' ? redo : selectAll
    command(editor)
    editor.focus()
    return
  }
  if (choice === 'undo' || choice === 'redo' || choice === 'cut' || choice === 'copy' || choice === 'paste' || choice === 'selectAll') {
    return api.menu.runTextAction(choice)
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('wheel', onWheel, { capture: true, passive: true })
  window.addEventListener('resize', onWindowChange)
  window.addEventListener('blur', onWindowChange)
  if (hasDesktopApi()) desktop().menu.onTextMenu((request) => void onTextMenu(request))
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('wheel', onWheel, true)
  window.removeEventListener('resize', onWindowChange)
  window.removeEventListener('blur', onWindowChange)
  clearHover()
})

function setPanel(depth: number, el: unknown): void {
  if (el instanceof HTMLElement) panels[depth] = el
  else panels.length = Math.min(panels.length, depth)
}
</script>

<template>
  <div
    v-for="(level, depth) in levels"
    :key="depth"
    :ref="(el) => setPanel(depth, el)"
    class="ctx-menu"
    :class="{ sub: depth > 0 }"
    role="menu"
    :style="{ left: `${level.left}px`, top: `${level.top}px`, visibility: level.measured ? 'visible' : 'hidden' }"
    @mousedown.prevent
    @contextmenu.prevent
    @mouseenter="onPanelEnter(depth)"
  >
    <template v-for="(item, index) in level.items" :key="index">
      <div v-if="item.type === 'separator'" class="ctx-sep" role="separator" />
      <div
        v-else
        class="ctx-item"
        :class="{ active: level.active === index, disabled: item.enabled === false, danger: item.danger, open: !!levels[depth + 1] && level.active === index && !!item.submenu }"
        :role="item.type === 'checkbox' ? 'menuitemcheckbox' : item.type === 'radio' ? 'menuitemradio' : 'menuitem'"
        :aria-checked="item.type === 'checkbox' || item.type === 'radio' ? !!item.checked : undefined"
        :aria-disabled="item.enabled === false || undefined"
        :aria-haspopup="item.submenu ? 'menu' : undefined"
        @mouseenter="onHover(depth, index)"
        @click="activate(depth, index)"
      >
        <span class="ctx-check" aria-hidden="true">
          <AppIcon v-if="item.checked && item.type === 'checkbox'" name="check" :size="13" :stroke="2.4" />
          <span v-else-if="item.checked && item.type === 'radio'" class="ctx-dot" />
        </span>
        <span v-if="item.swatch" class="ctx-swatch" :style="{ background: item.swatch }" aria-hidden="true" />
        <span class="ctx-label">{{ item.label }}</span>
        <span v-if="item.hint" class="ctx-hint">{{ item.hint }}</span>
        <AppIcon v-if="item.submenu" name="chevron-right" :size="13" class="ctx-arrow" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 1500;
  min-width: 184px;
  max-width: 320px;
  max-height: calc(100vh - 12px);
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
  color: var(--text);
  font-size: 13px;
  user-select: none;
  animation: ctx-in 110ms var(--ease-out);
}
.ctx-menu.sub {
  animation-duration: 90ms;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px 0 6px;
  border-radius: 6px;
  cursor: default;
  white-space: nowrap;
}
.ctx-item.active,
.ctx-item.open {
  background: var(--primary-soft);
  color: var(--primary-text);
}
.ctx-item.danger {
  color: var(--danger);
}
.ctx-item.danger.active {
  background: var(--danger-soft);
  color: var(--danger);
}
.ctx-item.disabled {
  color: var(--text-3);
  background: transparent;
}
.ctx-check {
  display: grid;
  place-items: center;
  flex: none;
  width: 16px;
  color: var(--primary);
}
.ctx-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.ctx-swatch {
  flex: none;
  width: 10px;
  height: 10px;
  margin-right: -1px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}
.ctx-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ctx-hint {
  margin-left: 18px;
  color: var(--text-3);
  font-size: 12px;
}
.ctx-arrow {
  margin-right: -4px;
  color: var(--text-3);
}
.ctx-sep {
  height: 1px;
  margin: 5px 6px;
  background: var(--border);
}
@keyframes ctx-in {
  from {
    opacity: 0;
    transform: translateY(-3px) scale(0.985);
  }
}
</style>
