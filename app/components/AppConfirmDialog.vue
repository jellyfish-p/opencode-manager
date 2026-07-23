<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  loading?: boolean
}>(), {
  confirmLabel: '确认删除',
  loading: false
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
}>()

function updateOpen(value: boolean) {
  if (!props.loading) emit('update:open', value)
}
</script>

<template>
  <UModal
    :open="open"
    :title="title"
    :dismissible="!loading"
    @update:open="updateOpen"
  >
    <template #body>
      <div class="flex items-start gap-3">
        <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-error/10">
          <UIcon name="i-lucide-triangle-alert" class="size-5 text-error" />
        </div>
        <p class="pt-2 text-sm leading-6 text-muted">{{ description }}</p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="loading"
          @click="emit('update:open', false)"
        >
          取消
        </UButton>
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
