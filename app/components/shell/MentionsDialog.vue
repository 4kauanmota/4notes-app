<script setup lang="ts">
/**
 * "Ver menções": onde um item (registro do Timer, link salvo) foi mencionado — nas
 * Notas, nas notas dos mapas e nas tarefas. Clicar num lugar leva até ele.
 * Aberto por showMentionsOf (stores/mentions.ts).
 */
import { computed, ref, watch } from 'vue'
import { MENTION_KINDS } from '~/lib/mentions/catalog'
import { mentionKind } from '~/lib/notes/mention-links'
import { findMentionPlaces, mentionsDialog, openMentionPath, type MentionPlace } from '~/stores/mentions'

const places = ref<MentionPlace[] | null>(null)
const subject = computed(() => mentionsDialog.subject)
const kind = computed(() => (subject.value ? MENTION_KINDS[mentionKind(subject.value.path)] : null))
let request = 0

watch(
  subject,
  async (current) => {
    places.value = null
    if (!current) return
    const seq = ++request
    const found = await findMentionPlaces(current).catch(() => [] as MentionPlace[])
    if (seq === request) places.value = found
  },
  { immediate: true },
)

function close() {
  mentionsDialog.subject = null
}

function go(place: MentionPlace) {
  close()
  openMentionPath(place.path)
}
</script>

<template>
  <UiModal :open="!!subject" :width="440" label="Menções" @close="close">
    <div v-if="subject && kind" class="mentions-dialog" data-mentions-dialog>
      <header class="md-head">
        <span class="md-icon"><AppIcon name="backlink" :size="18" /></span>
        <div class="md-head-text">
          <h2>Menções</h2>
          <p>
            <AppIcon :name="kind.icon" :size="13" /> <span class="md-subject">{{ subject.title || kind.noun }}</span>
          </p>
        </div>
        <button type="button" class="icon-btn" aria-label="Fechar" @click="close"><AppIcon name="x" :size="16" /></button>
      </header>

      <p v-if="!places" class="md-empty">Procurando…</p>
      <div v-else-if="!places.length" class="md-empty">
        <p>Ainda não foi mencionado em nenhuma nota ou tarefa.</p>
        <p class="md-hint">Digite @ numa nota ou numa tarefa para mencionar.</p>
      </div>
      <template v-else>
        <p class="md-count">{{ places.length === 1 ? 'Mencionado em 1 lugar' : `Mencionado em ${places.length} lugares` }}</p>
        <ul class="md-list">
          <li v-for="place in places" :key="place.path">
            <button type="button" class="md-place" :class="`md-${place.kind}`" :data-place="place.path" @click="go(place)">
              <AppIcon :name="MENTION_KINDS[place.kind].icon" :size="15" class="md-place-icon" />
              <span class="md-place-title">{{ place.title }}</span>
              <span class="md-place-where">{{ place.where }}</span>
              <AppIcon name="chevron-right" :size="14" class="md-go" />
            </button>
          </li>
        </ul>
      </template>
    </div>
  </UiModal>
</template>

<style scoped>
.mentions-dialog {
  display: flex;
  flex-direction: column;
  max-height: min(70vh, 560px);
  padding: 18px 18px 14px;
}
.md-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.md-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 11px;
  background: var(--primary-soft);
  color: var(--primary-text);
}
.md-head-text {
  flex: 1;
  min-width: 0;
}
h2 {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
.md-head-text p {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--text-2);
  font-size: 12.5px;
}
.md-subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.md-empty {
  padding: 18px 4px 10px;
  color: var(--text-2);
  font-size: 13.5px;
}
.md-hint {
  margin-top: 4px;
  color: var(--text-3);
  font-size: 12.5px;
}
.md-count {
  margin: 0 4px 6px;
  color: var(--text-3);
  font-size: 12px;
}
.md-list {
  margin: 0 -4px;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.md-place {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
  transition: background var(--t-fast);
}
.md-place:hover,
.md-place:focus-visible {
  background: var(--hover);
  outline: none;
}
.md-place-icon {
  flex: none;
  color: var(--primary-text);
}
.md-task .md-place-icon {
  color: var(--accent-text);
}
.md-place-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 550;
}
.md-place-where {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-3);
  font-size: 12px;
}
.md-go {
  flex: none;
  color: var(--text-3);
}
</style>
