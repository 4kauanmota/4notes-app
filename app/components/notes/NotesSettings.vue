<script setup lang="ts">
/** Configurações das Notas (Configurações › Módulos), guardadas no workspace (seção "notes" do .4notes/settings.json). */
import { computed } from 'vue'
import type { FolderCase } from '~/lib/notes/repository'
import { useNotesStore } from '~/stores/notes'

const notes = useNotesStore()

const autoCategory = computed({
  get: () => notes.state.settings.autoCategory,
  set: (value: boolean) => notes.updateSettings({ autoCategory: value }),
})
const titleFirstLine = computed({
  get: () => notes.state.settings.titleFirstLine,
  set: (value: boolean) => notes.updateSettings({ titleFirstLine: value }),
})
const folderCase = computed({
  get: () => notes.state.settings.folderCase,
  set: (value: FolderCase) => notes.updateSettings({ folderCase: value }),
})

const FOLDER_CASES: { value: FolderCase; label: string }[] = [
  { value: 'typed', label: 'Padrão' },
  { value: 'upper', label: 'CAIXA ALTA' },
]
</script>

<template>
  <SettingRow label="Título na primeira linha" help="Nota nova começa com a primeira linha em formato de título. Desligado, ela começa como texto comum.">
    <UiSwitch v-model="titleFirstLine" label="Título na primeira linha" />
  </SettingRow>
  <SettingRow label="Categoria automática pelo título" help="Nota nova sem categoria vai para a categoria que já tem notas com o mesmo começo de título.">
    <UiSwitch v-model="autoCategory" label="Categoria automática pelo título" />
  </SettingRow>
  <SettingRow label="Exibição das pastas pelo título" help="Muda só como o nome das pastas aparece na lista; o título das notas continua igual.">
    <UiSegmented v-model="folderCase" size="sm" :options="FOLDER_CASES" aria-label="Exibição das pastas pelo título" />
  </SettingRow>
</template>
