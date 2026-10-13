/**
 * Modais abertos, do mais antigo ao mais novo. Com um modal aberto por cima de
 * outro (ex.: a biblioteca de imagens sobre o diálogo da categoria), só o de cima
 * responde ao Esc — e ele fica por cima mesmo que tenha sido montado antes.
 */
const stack: symbol[] = []

/** Registra o modal como aberto; devolve a posição dele na pilha (1 = o primeiro). */
export function openModal(id: symbol): number {
  if (!stack.includes(id)) stack.push(id)
  return stack.indexOf(id) + 1
}

export function closeModal(id: symbol): void {
  const index = stack.indexOf(id)
  if (index >= 0) stack.splice(index, 1)
}

export const isTopModal = (id: symbol) => stack.at(-1) === id

/** Algum modal aberto (o Esc é dele, não da tela de baixo). */
export const hasOpenModal = () => stack.length > 0
