<script setup lang="ts">
/**
 * Item mencionado numa tarefa (nota, mapa, tarefa, link ou registro do Timer): o clique
 * abre o item no módulo dele; o × tira a menção. Riscado quando o item não existe mais.
 */
import { computed } from 'vue'
import { MENTION_KINDS } from '~/lib/mentions/catalog'
import type { MentionRef } from '~/lib/mentions/refs'
import { describeRef, openRef } from '~/stores/mentions'

const props = defineProps<{ mention: MentionRef; removable?: boolean }>()
const emit = defineEmits<{ remove: [] }>()

const current = computed(() => describeRef(props.mention))
const info = computed(() => MENTION_KINDS[props.mention.kind])
const title = computed(() => current.value?.title || props.mention.title || info.value.noun)
const tip = computed(() => {
  if (!current.value) return info.value.missing
  return current.value.detail ? `${info.value.open} · ${current.value.detail}` : info.value.open
})
</script>

<template>
  <span
    class="mention-chip"
    :class="[`mc-${mention.kind}`, { 'mc-missing': !current, 'mc-done': current?.done }]"
    :data-mention-kind="mention.kind"
  >
    <button type="button" class="mc-open" :data-tip="tip" data-tip-pos="top" @click.stop="openRef(mention)">
      <AppIcon :name="mention.kind === 'task' && current?.done ? 'tasks' : info.icon" :size="12" />
      <span class="mc-title">{{ title }}</span>
    </button>
    <button
      v-if="removable"
      type="button"
      class="mc-remove"
      aria-label="Tirar a menção"
      data-tip="Tirar a menção"
      @click.stop="emit('remove')"
    >
      <AppIcon name="x" :size="11" />
    </button>
  </span>
</template>

<style scoped>
.mention-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  height: 24px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary-text);
  font-size: 12px;
  font-weight: 600;
}
.mention-chip.mc-task,
.mention-chip.mc-timer {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.mention-chip.mc-missing {
  background: var(--surface-3);
  color: var(--text-3);
}
.mention-chip.mc-missing .mc-title,
.mention-chip.mc-done .mc-title {
  text-decoration: line-through;
}
.mc-open {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  height: 100%;
  padding: 0 10px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.mc-open:hover .mc-title {
  text-decoration: underline;
}
.mc-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mention-chip:has(.mc-remove) .mc-open {
  padding-right: 4px;
}
.mc-remove {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-right: 3px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
}
.mc-remove:hover {
  opacity: 1;
  background: var(--primary-soft-2);
}
</style>
