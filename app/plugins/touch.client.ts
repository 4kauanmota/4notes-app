// Telas de toque e tamanhos de tela: o layout (compact / medium / expanded), o toque
// prolongado como clique direito e o botão "voltar" do Android. No desktop com mouse
// só o layout é medido (fica "expanded") — nada muda.
import { installBackButton } from '~/composables/useBackButton'
import { installLayoutSize } from '~/composables/useLayoutSize'
import { installLongPress } from '~/lib/touch/long-press'

export default defineNuxtPlugin(() => {
  installLayoutSize()
  installLongPress()
  void installBackButton()
})
