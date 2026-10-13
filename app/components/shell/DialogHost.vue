<script setup lang="ts">
/** Mostra os diálogos pedidos por confirmDialog / promptDialog / choiceDialog. */
import { computed, nextTick, ref, watch } from 'vue'
import { useDialogs, type DialogButton } from '~/composables/useDialog'

const { dialogs } = useDialogs()
const current = computed(() => dialogs[dialogs.length - 1] ?? null)
const value = ref('')
const touched = ref(false)
const inputEl = ref<HTMLInputElement>()
const cardEl = ref<HTMLElement>()

const error = computed(() => {
  const input = current.value?.input
  if (!input?.validate || !touched.value) return null
  return input.validate(value.value)
})

watch(current, async (dialog) => {
  if (!dialog) return
  value.value = dialog.input?.value ?? ''
  touched.value = false
  await nextTick()
  if (dialog.input) {
    inputEl.value?.focus()
    inputEl.value?.select()
  } else {
    const button = cardEl.value?.querySelector<HTMLButtonElement>(`[data-button="${dialog.defaultButton ?? ''}"]`)
    button?.focus()
  }
})

function choose(button: DialogButton | null) {
  const dialog = current.value
  if (!dialog) return
  if (button && button.id === dialog.defaultButton && dialog.input) {
    touched.value = true
    if (dialog.input.validate?.(value.value)) return
    if (!value.value.trim()) return
  }
  dialog.resolve({ button: button?.id ?? null, value: value.value })
}

function onEnter() {
  const dialog = current.value
  if (!dialog?.defaultButton) return
  choose(dialog.buttons.find((b) => b.id === dialog.defaultButton) ?? null)
}

const variantClass = (button: DialogButton) =>
  ({ primary: 'btn-primary', danger: 'btn-danger', ghost: 'btn-ghost', default: '' })[button.variant ?? 'default']
</script>

<template>
  <UiModal :open="!!current" :width="420" :label="current?.title" @close="choose(null)">
    <div v-if="current" ref="cardEl" class="dialog" @keydown.enter.prevent="onEnter">
      <div class="dialog-head">
        <span v-if="current.icon" class="dialog-icon" :class="{ danger: current.icon === 'trash' }">
          <AppIcon :name="current.icon" :size="18" />
        </span>
        <h2 class="dialog-title">{{ current.title }}</h2>
      </div>
      <p v-if="current.message" class="dialog-message selectable">{{ current.message }}</p>
      <div v-if="current.input" class="dialog-input">
        <label v-if="current.input.label" class="field-label" for="dialog-input">{{ current.input.label }}</label>
        <input
          id="dialog-input"
          ref="inputEl"
          v-model="value"
          class="input"
          :placeholder="current.input.placeholder"
          spellcheck="false"
          autocomplete="off"
          @input="touched = true"
        />
        <Transition name="fade">
          <p v-if="error" class="dialog-error">{{ error }}</p>
        </Transition>
      </div>
      <div class="dialog-actions">
        <button
          v-for="button in current.buttons"
          :key="button.id"
          class="btn"
          :class="variantClass(button)"
          :data-button="button.id"
          @click="choose(button)"
        >
          {{ button.label }}
        </button>
      </div>
    </div>
  </UiModal>
</template>

<style scoped>
.dialog {
  padding: 22px 22px 18px;
}
.dialog-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.dialog-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary-text);
}
.dialog-icon.danger {
  background: var(--danger-soft);
  color: var(--danger);
}
.dialog-title {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
  line-height: 1.3;
}
.dialog-message {
  margin-top: 10px;
  white-space: pre-line;
  color: var(--text-2);
  font-size: 13.5px;
  line-height: 1.55;
}
.dialog-input {
  margin-top: 16px;
}
.dialog-error {
  margin-top: 6px;
  color: var(--danger);
  font-size: 12.5px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 22px;
}
</style>
