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
const foldersFirst = computed({
  get: () => notes.state.settings.foldersFirst,
  set: (value: boolean) => notes.updateSettings({ foldersFirst: value }),
})
const revealActive = computed({
  get: () => notes.state.settings.revealActive,
  set: (value: boolean) => notes.updateSettings({ revealActive: value }),
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
  <SettingRow label="Pastas sempre no topo" help="Pastas antes das notas na lista, em qualquer data. As notas seguem das mais recentes para as mais antigas.">
    <UiSwitch v-model="foldersFirst" label="Pastas sempre no topo" />
  </SettingRow>
  <SettingRow
    label="Selecionar a nota aberta na lista"
    help="Ao trocar de aba, a lista lateral abre as pastas até a nota e a destaca. Desligado, a lista fica como você deixou."
  >
    <UiSwitch v-model="revealActive" label="Selecionar a nota aberta na lista" />
  </SettingRow>
  <SettingRow label="Exibição das pastas pelo título" help="Muda só como o nome das pastas aparece na lista; o título das notas continua igual.">
    <UiSegmented v-model="folderCase" size="sm" :options="FOLDER_CASES" aria-label="Exibição das pastas pelo título" />
  </SettingRow>
</template>
