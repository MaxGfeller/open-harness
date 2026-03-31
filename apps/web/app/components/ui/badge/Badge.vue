<script setup lang="ts">
import { type HTMLAttributes, computed } from "vue";
import { type BadgeVariants, badgeVariants } from ".";
import { cn } from "~/lib/utils";

interface Props {
  variant?: BadgeVariants["variant"];
  class?: HTMLAttributes["class"];
}

const props = withDefaults(defineProps<Props>(), {
  variant: "default",
});

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;
  return delegated;
});
</script>

<template>
  <div
    v-bind="delegatedProps"
    :class="cn(badgeVariants({ variant }), props.class)"
  >
    <slot />
  </div>
</template>
