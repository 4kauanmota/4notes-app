<script setup lang="ts">
defineProps<{ map: string }>()
const emit = defineEmits<{ create: []; contextMenu: [] }>()
</script>

<template>
  <div class="mindmap-empty" @contextmenu.prevent="emit('contextMenu')">
    <svg class="art" viewBox="0 0 220 150" aria-hidden="true">
      <line class="edge e1" x1="60" y1="48" x2="118" y2="88" />
      <line class="edge e2" x1="118" y1="88" x2="172" y2="40" />
      <line class="edge e3" x1="118" y1="88" x2="150" y2="128" />
      <line class="edge dashed" x1="60" y1="48" x2="40" y2="118" />
      <circle class="node n1" cx="60" cy="48" r="11" />
      <circle class="node n2" cx="118" cy="88" r="16" />
      <circle class="node n3" cx="172" cy="40" r="9" />
      <circle class="node n4" cx="150" cy="128" r="8" />
      <circle class="node n5" cx="40" cy="118" r="7" />
    </svg>
    <h2>O mapa “{{ map }}” está vazio</h2>
    <p>
      Cada nó é uma <strong>nota permanente</strong> (um arquivo .md). Para conectar duas notas,
      <strong>arraste de uma até a outra</strong> — a seta aparece no mapa.
    </p>
    <button class="btn btn-primary btn-lg" @click="emit('create')"><AppIcon name="plus" :size="17" /> Criar a primeira nota</button>
    <span class="hint">Dica: clique com o botão direito (ou dê dois cliques) num espaço vazio do mapa para criar uma nota ali.</span>
  </div>
</template>

<style scoped>
.mindmap-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
  background: radial-gradient(520px 320px at 50% 40%, var(--primary-soft), transparent 70%), var(--graph-bg);
}
.art {
  width: 220px;
  height: 150px;
  margin-bottom: 10px;
  overflow: visible;
  animation: float 5s ease-in-out infinite;
}
.edge {
  stroke: var(--graph-edge);
  stroke-width: 2;
  stroke-dasharray: 120;
  stroke-dashoffset: 120;
  animation: draw 900ms var(--ease-out) forwards;
}
.e2 {
  animation-delay: 200ms;
}
.e3 {
  animation-delay: 350ms;
}
.dashed {
  stroke: var(--graph-edge-active);
  stroke-dasharray: 5 4;
  stroke-dashoffset: 0;
  animation: none;
  opacity: 0.9;
}
.node {
  fill: var(--graph-node);
  transform-box: fill-box;
  transform-origin: center;
  animation: pop 500ms var(--ease-spring) both;
}
.n2 {
  fill: var(--graph-selected);
  animation-delay: 120ms;
}
.n3 {
  fill: var(--cat-teal);
  animation-delay: 240ms;
}
.n4 {
  fill: var(--cat-pink);
  animation-delay: 360ms;
}
.n5 {
  animation-delay: 480ms;
}
h2 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.01em;
}
p {
  max-width: 470px;
  margin-bottom: 10px;
  color: var(--text-2);
  line-height: 1.6;
}
.hint {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--text-3);
}
@keyframes draw {
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes pop {
  from {
    transform: scale(0);
  }
}
@keyframes float {
  50% {
    transform: translateY(-3px);
  }
}
</style>
