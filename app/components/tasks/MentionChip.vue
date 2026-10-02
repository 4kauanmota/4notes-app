<script setup lang="ts">
/** Nota mencionada numa tarefa: o clique abre a nota; o × tira a menção. */
import { computed } from 'vue'
import type { NoteRef } from '~/lib/tasks/mentions'
import { mentionTitle, mentionWhere, openMention } from '~/stores/mentions'

const props = defineProps<{ mention: NoteRef; removable?: boolean }>()
const emit = defineEmits<{ remove: [] }>()

const title = computed(() => mentionTitle(props.mention))
const where = computed(() => mentionWhere(props.mention))
</script>

<template>
  <span class="mention-chip">
    <button type="button" class="mc-open" :data-tip="`Abrir nota · ${where}`" data-tip-pos="top" @click.stop="openMention(mention)">
      <AppIcon :name="mention.kind === 'map' ? 'graph' : 'notes'" :size="12" />
      <span class="mc-title">{{ title }}</span>
    </button>
    <button v-if="removable" type="button" class="mc-remove" aria-label="Tirar a menção" data-tip="Tirar a menção" @click.stop="emit('remove')">
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
