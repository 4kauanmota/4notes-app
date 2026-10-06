<script setup lang="ts">
/**
 * Configurações do Mapa Mental (Configurações › Módulos): o que mostrar e o estilo
 * dos nós. Guardadas no workspace (.4notes/mindmap.json). "Reorganizar o mapa"
 * fica no próprio mapa (barra de cima e clique direito no vazio).
 */
import { computed } from 'vue'
import type { GraphSettings } from '~/lib/mindmap/repository'
import { useMindmapStore } from '~/stores/mindmap'

const mindmap = useMindmapStore()

function bind<K extends keyof GraphSettings>(key: K) {
  return computed({
    get: () => mindmap.state.settings[key],
    set: (value: GraphSettings[K]) => mindmap.updateSettings({ [key]: value } as Partial<GraphSettings>),
  })
}

const showOrphans = bind('showOrphans')
const nodeStyle = bind('nodeStyle')
const labels = bind('labels')

const NODE_STYLES: { value: GraphSettings['nodeStyle']; label: string }[] = [
  { value: 'circle', label: 'Círculos' },
  { value: 'card', label: 'Cards' },
]
const LABELS: { value: GraphSettings['labels']; label: string }[] = [
  { value: 'selected', label: 'Ao selecionar' },
  { value: 'auto', label: 'Com zoom' },
  { value: 'always', label: 'Sempre' },
]
</script>

<template>
  <SettingRow label="Notas sem conexões" help="Mostra no mapa também as notas que não têm nenhuma conexão.">
    <UiSwitch v-model="showOrphans" label="Notas sem conexões" />
  </SettingRow>
  <SettingRow label="Estilo dos nós" help="Círculos transforma os itens do mapa mental em bolinhas; Cards, em cards.">
    <UiSegmented v-model="nodeStyle" size="sm" :options="NODE_STYLES" aria-label="Estilo dos nós" />
  </SettingRow>
  <SettingRow v-if="nodeStyle === 'circle'" label="Nomes das notas" help="Quando o nome aparece ao lado das bolinhas.">
    <UiSegmented v-model="labels" size="sm" :options="LABELS" aria-label="Nomes das notas" />
  </SettingRow>
</template>
