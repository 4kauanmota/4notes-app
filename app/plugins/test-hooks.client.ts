// Somente para os testes automatizados (FOURNOTES_TEST=1): expõe os stores na janela
// para que os testes consigam inspecionar o estado. Não faz nada no uso normal.
import { handleBack } from '~/composables/useBackButton'
import { desktop, hasDesktopApi } from '~/lib/platform'
import { useAppStore } from '~/stores/app'
import { useLinksStore } from '~/stores/links'
import { useMindmapStore } from '~/stores/mindmap'
import { useModulesStore } from '~/stores/modules'
import { useNotesStore } from '~/stores/notes'
import { useSettingsStore } from '~/stores/settings'
import { useTasksStore } from '~/stores/tasks'

export default defineNuxtPlugin(() => {
  if (!hasDesktopApi() || !desktop().bootstrap.testMode) return
  window.__fourNotesTest = {
    app: useAppStore(),
    notes: useNotesStore(),
    tasks: useTasksStore(),
    mindmap: useMindmapStore(),
    links: useLinksStore(),
    modules: useModulesStore(),
    settings: useSettingsStore(),
    /** O "voltar" do Android (devolve false se não havia nada para voltar). */
    back: handleBack,
  }
})
