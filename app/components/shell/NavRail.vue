<script setup lang="ts">
/** Barra lateral de navegação entre os módulos + tema + configurações. */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTheme } from '~/composables/useTheme'
import { modKeyLabel } from '~/lib/platform'
import { useAppStore } from '~/stores/app'
import { useTasksStore } from '~/stores/tasks'

const route = useRoute()
const app = useAppStore()
const tasks = useTasksStore()
const { theme, setTheme } = useTheme()
const mod = modKeyLabel()

const dueCount = computed(() => tasks.progress.value.total - tasks.progress.value.done)

const items = computed(() => [
  { to: '/notes', label: 'Notas', icon: 'notes', key: '1', badge: 0 },
  { to: '/tasks', label: 'Tarefas', icon: 'tasks', key: '2', badge: dueCount.value },
  { to: '/mindmap', label: 'Mapa', icon: 'graph', key: '3', badge: 0 },
  { to: '/links', label: 'Links', icon: 'link', key: '4', badge: 0 },
])

const activeIndex = computed(() => items.value.findIndex((item) => route.path.startsWith(item.to)))

function toggleTheme(event: MouseEvent) {
  const next = theme.resolved === 'dark' ? 'light' : 'dark'
  void setTheme(next, { x: event.clientX, y: event.clientY })
}
</script>

<template>
  <nav class="rail" aria-label="Módulos">
    <div class="rail-items">
      <span
        v-if="activeIndex >= 0"
        class="rail-indicator"
        :style="{ transform: `translateY(${activeIndex * 64}px)` }"
        aria-hidden="true"
      />
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="rail-item"
        :class="{ active: route.path.startsWith(item.to) }"
        :data-tip="`${item.label}  ·  ${mod}+${item.key}`"
        data-tip-pos="right"
      >
        <span class="rail-icon">
          <AppIcon :name="item.icon" :size="21" />
          <Transition name="pop">
            <span v-if="item.badge > 0" class="rail-badge">{{ item.badge > 99 ? '99+' : item.badge }}</span>
          </Transition>
        </span>
        <span class="rail-label">{{ item.label }}</span>
      </NuxtLink>
    </div>

    <div class="rail-bottom">
      <button
        class="rail-button"
        :data-tip="theme.resolved === 'dark' ? 'Tema claro' : 'Tema escuro'"
        data-tip-pos="right"
        aria-label="Alternar tema"
        @click="toggleTheme"
      >
        <Transition name="spin" mode="out-in">
          <AppIcon :key="theme.resolved" :name="theme.resolved === 'dark' ? 'sun' : 'moon'" :size="19" />
        </Transition>
      </button>
      <button class="rail-button" :data-tip="`Configurações  ·  ${mod}+,`" data-tip-pos="right" aria-label="Configurações" @click="app.openSettings()">
        <AppIcon name="settings" :size="19" />
      </button>
    </div>
  </nav>
</template>

<style scoped>
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: var(--rail-w);
  padding: 6px 0 12px;
  background: var(--chrome);
}
.rail-items {
  position: relative;
  display: flex;
  flex-direction: column;
}
.rail-indicator {
  position: absolute;
  top: 0;
  left: 6px;
  width: 52px;
  height: 58px;
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);
  transition: transform 320ms var(--ease-spring);
}
.rail-indicator::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 19px;
  width: 3px;
  height: 20px;
  border-radius: 0 3px 3px 0;
  background: var(--accent-strong);
}
.rail-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 64px;
  height: 58px;
  margin-bottom: 6px;
  color: var(--text-3);
  text-decoration: none;
  transition: color var(--t-med);
}
.rail-item:hover {
  color: var(--text);
}
.rail-item.active {
  color: var(--primary-text);
}
.rail-icon {
  position: relative;
  display: grid;
  place-items: center;
  transition: transform var(--t-med) var(--ease-spring);
}
.rail-item:active .rail-icon {
  transform: scale(0.88);
}
.rail-label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.rail-badge {
  position: absolute;
  top: -6px;
  right: -10px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--chrome);
}
.rail-bottom {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: auto;
}
.rail-button {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast), transform var(--t-fast) var(--ease-out);
}
.rail-button:hover {
  background: var(--hover);
  color: var(--text);
}
.rail-button:active {
  transform: scale(0.9);
}

.spin-enter-active,
.spin-leave-active {
  transition: transform 260ms var(--ease-out), opacity 200ms;
}
.spin-enter-from {
  transform: rotate(-90deg) scale(0.6);
  opacity: 0;
}
.spin-leave-to {
  transform: rotate(90deg) scale(0.6);
  opacity: 0;
}
</style>
