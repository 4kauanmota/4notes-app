// Somente para os testes automatizados (FOURNOTES_TEST=1): expõe os stores na janela
// para que os testes consigam inspecionar o estado. Não faz nada no uso normal.
import { desktop, hasDesktopApi } from '~/lib/platform'
import { useAppStore } from '~/stores/app'
import { useMindmapStore } from '~/stores/mindmap'
import { useNotesStore } from '~/stores/notes'
import { useTasksStore } from '~/stores/tasks'

export default defineNuxtPlugin(() => {
  if (!hasDesktopApi() || !desktop().bootstrap.testMode) return
  window.__fourNotesTest = {
    app: useAppStore(),
    notes: useNotesStore(),
    tasks: useTasksStore(),
    mindmap: useMindmapStore(),
  }
})
