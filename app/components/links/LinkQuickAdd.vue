<script setup lang="ts">
/**
 * Campo para salvar um link rápido: cole o endereço e aperte Enter. O título e o
 * ícone do site chegam sozinhos logo depois. Com uma categoria aberta, o link vai para ela.
 */
import { computed, ref } from 'vue'
import { useLinksStore } from '~/stores/links'

const props = defineProps<{ folderId: string | null }>()
/** ↓ no campo: vai para a lista de links. */
const emit = defineEmits<{ down: [] }>()
const links = useLinksStore()
const input = ref<HTMLInputElement>()
const text = ref('')
const error = ref<string | null>(null)
const flash = ref(false)

const folder = computed(() => (props.folderId ? (links.folderById.value.get(props.folderId) ?? null) : null))

function submit() {
  if (!text.value.trim()) return
  const result = links.addLink(text.value, props.folderId)
  if (result.status === 'invalid') {
    error.value = 'Isso não parece o endereço de um site.'
    return
  }
  text.value = ''
  error.value = null
  flash.value = true
  setTimeout(() => (flash.value = false), 400)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    text.value = ''
    error.value = null
    input.value?.blur()
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    emit('down')
  }
}

defineExpose({
  focus: () => input.value?.focus(),
  /** Coloca um endereço no campo (ex.: colado fora dele) e salva. */
  add: (value: string) => {
    text.value = value
    submit()
  },
})
</script>

<template>
  <div class="quick-add-wrap">
    <form class="quick-add" :class="{ flash, invalid: !!error }" @submit.prevent="submit">
      <AppIcon name="link" :size="17" class="qa-icon" />
      <input
        ref="input"
        v-model="text"
        class="qa-input"
        placeholder="Cole um link e aperte Enter (ex.: nuxt.com/docs)"
        spellcheck="false"
        autocomplete="off"
        aria-label="Novo link"
        @input="error = null"
        @keydown="onKeydown"
      />
      <span v-if="folder" class="qa-folder" :data-tip="`O link vai para ${folder.name}`">
        <CategoryAvatar :name="folder.name" :color="folder.color" :icon="folder.icon" :image="folder.image" :size="16" />
        {{ folder.name }}
      </span>
      <button type="submit" class="btn btn-sm btn-primary qa-save" :disabled="!text.trim()">Salvar</button>
    </form>
    <Transition name="fade"><p v-if="error" class="qa-error">{{ error }}</p></Transition>
  </div>
</template>

<style scoped>
.quick-add {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 8px 0 14px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface-2);
  transition: border-color var(--t-fast), box-shadow var(--t-fast), background var(--t-fast), transform var(--t-med) var(--ease-spring);
}
.quick-add:focus-within {
  border-color: var(--primary);
  background: var(--surface);
  box-shadow: var(--focus-ring);
}
.quick-add.flash {
  transform: scale(0.99);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.quick-add.invalid {
  border-color: var(--danger);
  animation: shake 300ms var(--ease-out);
}
@keyframes shake {
  25% {
    transform: translateX(-4px);
  }
  75% {
    transform: translateX(4px);
  }
}
.qa-icon {
  color: var(--text-3);
}
.quick-add:focus-within .qa-icon {
  color: var(--primary-text);
}
.qa-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 14px;
}
.qa-input::placeholder {
  color: var(--text-3);
}
.qa-folder {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  max-width: 180px;
  height: 24px;
  padding: 0 9px 0 5px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qa-error {
  margin: 6px 0 0 14px;
  font-size: 12.5px;
  color: var(--danger);
}
</style>
