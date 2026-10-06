/**
 * Tutoriais (TutorialPanel.vue, aberto pelo "?" do menu lateral ou pelo F1): um
 * painel ao lado do menu, por cima do módulo — sem sair do que você estava fazendo.
 * Abre no tutorial do módulo atual; dá para ver os outros e o "Geral".
 */
import { reactive } from 'vue'
import type { ModuleId } from '~/lib/modules'

/** Tutorial mostrado: um módulo ou o do 4notes em geral. */
export type TutorialTopic = ModuleId | 'general'

export const tutorial = reactive({
  open: false,
  topic: 'general' as TutorialTopic,
})

/** Abre o tutorial (de `topic`, ou do módulo atual). */
export function openTutorial(topic: TutorialTopic): void {
  tutorial.topic = topic
  tutorial.open = true
}

export function closeTutorial(): void {
  tutorial.open = false
}

/** "?" e F1: abre no módulo atual; se já estiver aberto, fecha. */
export function toggleTutorial(current: TutorialTopic): void {
  if (tutorial.open) closeTutorial()
  else openTutorial(current)
}
