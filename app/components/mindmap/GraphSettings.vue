<script setup lang="ts">
/** Ajustes do mapa (o que mostrar, estilo dos nós) e "Reorganizar o mapa". */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { GraphSettings } from '~/lib/mindmap/repository'
import { useMindmapStore } from '~/stores/mindmap'

const emit = defineEmits<{ close: []; relayout: [] }>()
const mindmap = useMindmapStore()
const root = ref<HTMLElement>()

function bind<K extends keyof GraphSettings>(key: K) {
  return computed({
    get: () => mindmap.state.settings[key],
    set: (value: GraphSettings[K]) => mindmap.updateSettings({ [key]: value } as Partial<GraphSettings>),
  })
}

const showOrphans = bind('showOrphans')
const nodeStyle = bind('nodeStyle')
const labels = bind('labels')

function onPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement
  if (root.value && !root.value.contains(target) && !target.closest('[data-settings-toggle]')) emit('close')
}
onMounted(() => document.addEventListener('pointerdown', onPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))
</script>

<template>
  <div ref="root" class="graph-settings" role="dialog" aria-label="Ajustes do mapa">
    <div class="section-label">Exibir</div>
    <label class="row">
      <span>Notas sem conexões</span>
      <UiSwitch v-model="showOrphans" label="Notas sem conexões" />
    </label>

    <div class="section-label">Aparência</div>
    <div class="row">
      <span>Nós</span>
      <UiSegmented
        v-model="nodeStyle"
        size="sm"
        :options="[
          { value: 'circle', label: 'Círculos' },
          { value: 'card', label: 'Cards' },
        ]"
      />
    </div>
    <div v-if="nodeStyle === 'circle'" class="row">
      <span>Nomes</span>
      <UiSegmented
        v-model="labels"
        size="sm"
        :options="[
          { value: 'selected', label: 'Ao selecionar' },
          { value: 'auto', label: 'Com zoom' },
          { value: 'always', label: 'Sempre' },
        ]"
      />
    </div>

    <button class="btn btn-sm relayout" @click="emit('relayout')"><AppIcon name="refresh" :size="14" /> Reorganizar o mapa</button>
    <p class="relayout-hint">Organiza os nós em volta das notas mais conectadas, evitando cruzar as linhas.</p>
  </div>
</template>

<style scoped>
.graph-settings {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 30;
  width: 290px;
  padding: 14px 16px 16px;
  border-radius: var(--r-xl);
  border: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
  animation: pop-in 200ms var(--ease-spring);
  transform-origin: top right;
}
.section-label {
  margin: 14px 0 8px;
}
.section-label:first-child {
  margin-top: 0;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 34px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
}
.relayout {
  width: 100%;
  margin-top: 16px;
}
.relayout-hint {
  margin-top: 6px;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--text-3);
}
@keyframes pop-in {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-4px);
  }
}
</style>
