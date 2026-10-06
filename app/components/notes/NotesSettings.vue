<script setup lang="ts">
/** Configurações das Notas (Configurações › Módulos), guardadas no workspace (.4notes/notes.json). */
import { computed } from 'vue'
import type { FolderCase } from '~/lib/notes/repository'
import { useNotesStore } from '~/stores/notes'

const notes = useNotesStore()

const autoCategory = computed({
  get: () => notes.state.settings.autoCategory,
  set: (value: boolean) => notes.updateSettings({ autoCategory: value }),
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
  <SettingRow label="Categoria automática pelo título" help="Nota nova sem categoria vai para a categoria que já tem notas com o mesmo começo de título.">
    <UiSwitch v-model="autoCategory" label="Categoria automática pelo título" />
  </SettingRow>
  <SettingRow label="Exibição das pastas pelo título" help="Muda só como o nome das pastas aparece na lista; o título das notas continua igual.">
    <UiSegmented v-model="folderCase" size="sm" :options="FOLDER_CASES" aria-label="Exibição das pastas pelo título" />
  </SettingRow>
</template>
