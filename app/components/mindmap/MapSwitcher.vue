<script setup lang="ts">
/** Escolha e gerenciamento dos mapas mentais (cada mapa é uma pasta em mindmap/). */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { confirmDialog, promptDialog } from '~/composables/useDialog'
import { useMindmapStore } from '~/stores/mindmap'

const mindmap = useMindmapStore()
const open = ref(false)
const root = ref<HTMLElement>()

const current = computed(() => mindmap.state.currentMap)
const maps = computed(() =>
  mindmap.state.maps.map((map) => ({ ...map, notes: map.name === current.value ? mindmap.state.notes.length : map.notes })),
)

function onPointerDown(event: PointerEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', onPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))

async function choose(name: string) {
  open.value = false
  await mindmap.switchMap(name)
}

async function create() {
  open.value = false
  const name = await promptDialog({
    title: 'Novo mapa mental',
    message: 'Cada mapa tem as próprias notas e conexões (uma pasta dentro de mindmap/).',
    label: 'Nome do mapa',
    placeholder: 'Ex.: Estudos',
    confirmLabel: 'Criar mapa',
    icon: 'layers',
    validate: (value) => mindmap.validateMapName(value),
  })
  if (name) await mindmap.createMap(name)
}

async function rename() {
  open.value = false
  const map = current.value
  const name = await promptDialog({
    title: 'Renomear mapa',
    message: 'A pasta do mapa é renomeada; as notas e conexões continuam iguais.',
    label: 'Nome do mapa',
    value: map,
    confirmLabel: 'Renomear',
    icon: 'edit',
    validate: (value) => mindmap.validateMapName(value, map),
  })
  if (name) await mindmap.renameMap(map, name)
}

async function remove() {
  open.value = false
  const map = current.value
  const count = mindmap.state.notes.length
  const ok = await confirmDialog({
    title: `Excluir o mapa “${map}”?`,
    message: `A pasta do mapa${count ? `, com ${count} ${count === 1 ? 'nota' : 'notas'},` : ''} vai para a Lixeira.`,
    confirmLabel: 'Excluir mapa',
    danger: true,
  })
  if (ok) await mindmap.deleteMap(map)
}

function reveal() {
  open.value = false
  mindmap.revealMap(current.value)
}
</script>

<template>
  <div ref="root" class="map-switcher">
    <button
      class="switcher-btn"
      :class="{ open }"
      data-map-switcher
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="`Mapa: ${current}`"
      @click="open = !open"
    >
      <AppIcon name="layers" :size="15" />
      <span class="map-name">{{ current }}</span>
      <AppIcon name="chevron-down" :size="14" class="chevron" />
    </button>

    <div v-if="open" class="menu" role="menu" aria-label="Mapas mentais">
      <div class="section-label menu-title">Mapas</div>
      <div class="map-list">
        <button
          v-for="map in maps"
          :key="map.name"
          class="map-item"
          :class="{ active: map.name === current }"
          role="menuitemradio"
          :aria-checked="map.name === current"
          @click="choose(map.name)"
        >
          <span class="check"><AppIcon v-if="map.name === current" name="check" :size="14" :stroke="2.4" /></span>
          <span class="item-name">{{ map.name }}</span>
          <span class="item-count">{{ map.notes }}</span>
        </button>
      </div>
      <div class="menu-sep" />
      <button class="menu-action" role="menuitem" @click="create"><AppIcon name="plus" :size="15" /> Novo mapa…</button>
      <button class="menu-action" role="menuitem" @click="rename"><AppIcon name="edit" :size="15" /> Renomear “{{ current }}”…</button>
      <button class="menu-action" role="menuitem" @click="reveal"><AppIcon name="folder" :size="15" /> Mostrar no Explorador</button>
      <button
        class="menu-action danger"
        role="menuitem"
        :disabled="maps.length < 2"
        :title="maps.length < 2 ? 'É preciso ter pelo menos um mapa' : undefined"
        @click="remove"
      >
        <AppIcon name="trash" :size="15" /> Excluir “{{ current }}”…
      </button>
    </div>
  </div>
</template>

<style scoped>
.map-switcher {
  position: relative;
}
.switcher-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 200px;
  height: 32px;
  padding: 0 8px 0 10px;
  border: none;
  border-radius: 9px;
  background: var(--primary-soft);
  color: var(--primary-text);
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition: background var(--t-fast);
}
.switcher-btn:hover,
.switcher-btn.open {
  background: var(--primary-soft-2);
}
.map-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chevron {
  flex: none;
  opacity: 0.8;
  transition: transform var(--t-med) var(--ease-out);
}
.switcher-btn.open .chevron {
  transform: rotate(180deg);
}
.menu {
  position: absolute;
  top: calc(100% + 10px);
  left: -6px;
  z-index: 40;
  width: 260px;
  padding: 6px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
  animation: pop-in 180ms var(--ease-spring);
  transform-origin: top left;
}
.menu-title {
  padding: 6px 10px 4px;
}
.map-list {
  max-height: 260px;
  overflow-y: auto;
}
.map-item,
.menu-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background var(--t-fast);
}
.map-item:hover,
.menu-action:hover {
  background: var(--hover);
}
.map-item.active {
  font-weight: 650;
}
.check {
  display: grid;
  place-items: center;
  width: 16px;
  flex: none;
  color: var(--primary-text);
}
.item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-count {
  color: var(--text-3);
  font-size: 12px;
}
.menu-sep {
  height: 1px;
  margin: 6px 4px;
  background: var(--border);
}
.menu-action {
  color: var(--text-2);
}
.menu-action:hover {
  color: var(--text);
}
.menu-action.danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
.menu-action:disabled {
  opacity: 0.45;
  pointer-events: none;
}
@keyframes pop-in {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(-4px);
  }
}
</style>
