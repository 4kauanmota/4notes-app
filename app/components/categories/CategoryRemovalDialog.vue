<script setup lang="ts">
/**
 * Excluir uma categoria (1.7.0, categorias compartilhadas). Antes de excluir uma
 * categoria em uso, você escolhe o que fazer com os registros: passar para outra
 * categoria ou deixar sem categoria. Nenhum registro é apagado.
 * Pedido pela lista de um módulo e com a categoria usada também em outros módulos, dá
 * para tirar só daquele módulo (ela continua nos outros) ou excluir do app inteiro.
 * Uma janela só, no app.vue (composables/useCategoryActions.ts › requestCategoryRemoval).
 */
import { computed, ref, watch } from 'vue'
import { finishRemoval, useCategoryUi } from '~/composables/useCategoryActions'
import { paletteVar } from '~/lib/colors'
import { trashPlace } from '~/lib/platform'
import { useCategoriesStore, type CategoryUsage } from '~/stores/categories'

const ui = useCategoryUi()
const shared = useCategoriesStore()

const request = computed(() => ui.removal)
const category = computed(() => (request.value ? (shared.findCategory(request.value.id) ?? null) : null))
const module = computed(() => request.value?.module ?? null)
const moduleLabel = computed(() => (module.value ? shared.moduleLabel(module.value) : ''))

const usage = computed<CategoryUsage[]>(() => (category.value ? shared.usage(category.value.id) : []))
/** Usada (na lista ou com registros) em outro módulo além do que pediu. */
const usedElsewhere = computed(() => !!module.value && usage.value.some((item) => item.module !== module.value && (item.member || item.records.length)))

const scope = ref<'module' | 'app'>('module')
const choice = ref<'transfer' | 'none' | null>(null)
const target = ref('')
const busy = ref(false)

watch(
  () => request.value,
  (value) => {
    if (!value) return
    scope.value = 'module'
    choice.value = null
    target.value = ''
    busy.value = false
  },
)

/** Só do módulo que pediu (ela continua nos outros). */
const onlyModule = computed(() => usedElsewhere.value && scope.value === 'module')
const affected = computed(() => usage.value.filter((item) => item.records.length && (!onlyModule.value || item.module === module.value)))
const affectedCount = computed(() => affected.value.reduce((sum, item) => sum + item.records.length, 0))
const others = computed(() => shared.state.categories.filter((item) => item.id !== category.value?.id))
const notesAffected = computed(() => affected.value.some((item) => item.module === 'notes'))

const ready = computed(() => !busy.value && (!affectedCount.value || choice.value === 'none' || (choice.value === 'transfer' && !!target.value)))

function summary(item: CategoryUsage): string {
  return `${item.label}: ${item.records.length}`
}

function close() {
  if (!busy.value) finishRemoval(false)
}

async function confirm() {
  const current = category.value
  if (!current || !ready.value) return
  busy.value = true
  const transferTo = affectedCount.value && choice.value === 'transfer' ? target.value : null
  const done = onlyModule.value && module.value ? await shared.removeFromModule(module.value, current.id, transferTo) : await shared.deleteCategory(current.id, transferTo)
  busy.value = false
  finishRemoval(done)
}
</script>

<template>
  <UiModal :open="!!request && !!category" :width="460" label="Excluir categoria" @close="close">
    <form v-if="category" class="removal" data-category-removal @submit.prevent="confirm">
      <h2>
        <CategoryAvatar :name="category.name" :color="category.color" :icon="category.icon" :image="category.image" :size="26" />
        <span>Excluir “{{ category.name }}”</span>
      </h2>

      <fieldset v-if="usedElsewhere" class="group">
        <legend class="field-label">De onde?</legend>
        <label class="option">
          <input v-model="scope" type="radio" value="module" name="removal-scope" />
          <span>
            <strong>Só de {{ moduleLabel }}</strong>
            <small>Ela continua nos outros módulos que a usam.</small>
          </span>
        </label>
        <label class="option">
          <input v-model="scope" type="radio" value="app" name="removal-scope" />
          <span>
            <strong>Do app inteiro</strong>
            <small>Sai de todos os módulos.</small>
          </span>
        </label>
      </fieldset>

      <template v-if="affectedCount">
        <p class="lead">
          {{ affectedCount === 1 ? 'Um registro usa' : `${affectedCount} registros usam` }} esta categoria
          <span class="where">({{ affected.map(summary).join(' · ') }})</span>. Nenhum registro é apagado. O que fazer com eles?
        </p>
        <fieldset class="group">
          <legend class="sr-only">Destino dos registros</legend>
          <label class="option">
            <input v-model="choice" type="radio" value="transfer" name="removal-choice" :disabled="!others.length" />
            <span>
              <strong>Passar para outra categoria</strong>
              <select
                v-model="target"
                class="select target"
                aria-label="Categoria que recebe os registros"
                :disabled="!others.length"
                @focus="choice = 'transfer'"
                @change="choice = 'transfer'"
              >
                <option value="" disabled>{{ others.length ? 'Escolha a categoria…' : 'Não há outra categoria' }}</option>
                <option v-for="item in others" :key="item.id" :value="item.id">{{ item.name }}</option>
              </select>
            </span>
          </label>
          <label class="option">
            <input v-model="choice" type="radio" value="none" name="removal-choice" />
            <span>
              <strong>Deixar sem categoria</strong>
              <small v-if="notesAffected">As notas voltam para Notas, sem categoria.</small>
            </span>
          </label>
        </fieldset>
      </template>
      <p v-else class="lead">Nenhum registro usa esta categoria{{ onlyModule ? ` em ${moduleLabel}` : '' }}.</p>

      <p v-if="notesAffected || usage.some((item) => item.module === 'notes' && item.member && (!onlyModule || module === 'notes'))" class="hint">
        <AppIcon name="folder" :size="13" />
        <span>Nas Notas, a pasta da categoria vai para {{ trashPlace() }} (se não sobrar nenhum outro arquivo nela).</span>
      </p>
      <p v-if="choice === 'transfer' && target" class="hint">
        <i class="swatch" :style="{ background: paletteVar(shared.findCategory(target)!.color) }" />
        <span>Os registros vão para “{{ shared.findCategory(target)!.name }}”.</span>
      </p>

      <div class="actions">
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="close">Cancelar</button>
        <button type="submit" class="btn btn-danger" :disabled="!ready" data-action="confirm-removal">
          {{ busy ? 'Excluindo…' : onlyModule ? `Tirar de ${moduleLabel}` : 'Excluir categoria' }}
        </button>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.removal {
  padding: 22px;
}
h2 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
h2 span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.lead {
  margin: 4px 0 10px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-2);
}
.where {
  color: var(--text-3);
}
.group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 12px;
  padding: 0;
  border: none;
}
.option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface-2);
  cursor: pointer;
}
.option:has(input:checked) {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.option input[type='radio'] {
  margin-top: 3px;
  accent-color: var(--primary);
}
.option > span {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  font-size: 13.5px;
}
.option small {
  font-size: 12px;
  color: var(--text-3);
}
.target {
  width: 100%;
  margin-top: 2px;
}
.hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-3);
}
.swatch {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
