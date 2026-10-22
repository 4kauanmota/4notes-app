<script setup lang="ts">
/**
 * Juntar uma categoria com outra (1.7.0): para consolidar duas categorias que
 * representam a mesma coisa ("Estudo" e "Estudos"). Em todos os módulos, os registros
 * de uma passam para a outra (sem duplicar) e a primeira deixa de existir. Nas Notas,
 * as notas vão para a pasta da outra categoria.
 * Uma janela só, no app.vue (composables/useCategoryActions.ts › requestCategoryMerge).
 */
import { computed, ref, watch } from 'vue'
import { finishMerge, useCategoryUi } from '~/composables/useCategoryActions'
import { useCategoriesStore } from '~/stores/categories'

const ui = useCategoryUi()
const shared = useCategoriesStore()

const request = computed(() => ui.merge)
const source = computed(() => (request.value ? (shared.findCategory(request.value.id) ?? null) : null))
const target = ref('')
const busy = ref(false)
const search = ref('')

watch(
  () => request.value,
  (value) => {
    if (!value) return
    target.value = ''
    search.value = ''
    busy.value = false
  },
)

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()

const options = computed(() => {
  const query = fold(search.value)
  return shared.state.categories.filter((item) => item.id !== source.value?.id && (!query || fold(item.name).includes(query)))
})

const sourceUsage = computed(() => (source.value ? shared.usage(source.value.id).filter((item) => item.records.length) : []))
const total = computed(() => sourceUsage.value.reduce((sum, item) => sum + item.records.length, 0))
const chosen = computed(() => (target.value ? (shared.findCategory(target.value) ?? null) : null))

function close() {
  if (!busy.value) finishMerge(false)
}

async function confirm() {
  if (!source.value || !chosen.value || busy.value) return
  busy.value = true
  const done = await shared.mergeCategories(source.value.id, chosen.value.id)
  busy.value = false
  finishMerge(done)
}
</script>

<template>
  <UiModal :open="!!request && !!source" :width="460" label="Juntar categorias" @close="close">
    <form v-if="source" class="merge" data-category-merge @submit.prevent="confirm">
      <h2>Juntar “{{ source.name }}” com outra categoria</h2>
      <p class="lead">
        Para quando as duas são a mesma coisa. Em todos os módulos,
        {{ total ? (total === 1 ? 'o registro' : `os ${total} registros`) : 'o que estiver' }} em “{{ source.name }}” passa para a categoria escolhida, e “{{
          source.name
        }}” deixa de existir. Nada é apagado.
      </p>

      <label class="search">
        <AppIcon name="search" :size="14" />
        <input v-model="search" placeholder="Buscar categoria…" spellcheck="false" aria-label="Buscar categoria" />
      </label>
      <div class="list" role="radiogroup" aria-label="Juntar com">
        <label v-for="item in options" :key="item.id" class="row" :class="{ on: target === item.id }" :data-merge-target="item.id">
          <input v-model="target" type="radio" :value="item.id" name="merge-target" />
          <CategoryAvatar :name="item.name" :color="item.color" :icon="item.icon" :image="item.image" :size="22" />
          <span class="name">{{ item.name }}</span>
          <span class="count">{{ shared.recordCount(item.id) }}</span>
        </label>
        <p v-if="!options.length" class="empty">Nenhuma categoria encontrada.</p>
      </div>

      <p v-if="chosen" class="result">
        Fica <strong>“{{ chosen.name }}”</strong>, com o nome, a cor e a foto dela.
      </p>

      <div class="actions">
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="close">Cancelar</button>
        <button type="submit" class="btn btn-primary" :disabled="!chosen || busy" data-action="confirm-merge">{{ busy ? 'Juntando…' : 'Juntar categorias' }}</button>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.merge {
  padding: 22px;
}
h2 {
  margin-bottom: 10px;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.lead {
  margin-bottom: 14px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-2);
}
.search {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--text-3);
}
.search:focus-within {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}
.search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 260px;
  margin-top: 8px;
  overflow-y: auto;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 0 10px;
  border-radius: var(--r-md);
  cursor: pointer;
}
html[data-touch] .row {
  min-height: 46px;
}
.row:hover {
  background: var(--hover);
}
.row.on {
  background: var(--primary-soft);
}
.row input {
  accent-color: var(--primary);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
  font-weight: 550;
}
.count {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 11.5px;
  font-weight: 650;
  line-height: 18px;
  text-align: center;
}
.empty {
  padding: 12px;
  font-size: 13px;
  color: var(--text-3);
}
.result {
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--text-2);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>
