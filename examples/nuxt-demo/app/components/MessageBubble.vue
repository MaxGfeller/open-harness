<script setup lang="ts">
import type { OHUIMessage } from "@openharness/core";

const props = defineProps<{
  message: OHUIMessage;
}>();

const isUser = props.message.role === "user";

function pretty(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
</script>

<template>
  <div :style="{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }">
    <div
      :style="{
        maxWidth: '80%',
        padding: '0.6rem 0.9rem',
        borderRadius: '12px',
        background: isUser ? '#333' : '#f2f2f2',
        color: isUser ? '#fff' : '#222',
        fontSize: '0.95rem',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }"
    >
      <template v-for="(part, i) in message.parts" :key="i">
        <!-- Text -->
        <span v-if="part.type === 'text'">{{ part.text }}</span>

        <!-- Reasoning -->
        <details
          v-else-if="part.type === 'reasoning'"
          :style="{ fontSize: '0.85rem', color: '#666', marginBottom: '0.4rem' }"
        >
          <summary :style="{ cursor: 'pointer' }">Reasoning</summary>
          <p :style="{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }">
            {{ (part as any).text }}
          </p>
        </details>

        <!-- File (image) -->
        <img
          v-else-if="part.type === 'file' && (part as any).mediaType?.startsWith('image/')"
          :src="(part as any).url"
          :alt="(part as any).filename ?? 'image'"
          :style="{
            maxWidth: '100%',
            maxHeight: '300px',
            borderRadius: '8px',
            margin: '0.3rem 0',
            display: 'block',
          }"
        />

        <!-- File (non-image) -->
        <div
          v-else-if="part.type === 'file'"
          :style="{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            padding: '0.25rem 0.6rem',
            margin: '0.3rem 0',
            borderRadius: '6px',
            background: isUser ? 'rgba(255,255,255,0.15)' : '#e0e0e0',
            fontSize: '0.85rem',
          }"
        >
          <span>{{ (part as any).filename ?? 'file' }}</span>
          <span :style="{ color: '#888', fontSize: '0.75rem' }">
            {{ (part as any).mediaType }}
          </span>
        </div>

        <!-- Announce tool (styled narration) -->
        <div
          v-else-if="
            (part.type.startsWith('tool-') || part.type === 'dynamic-tool') &&
            ((part as any).toolName ?? part.type.replace('tool-', '')) === 'announce'
          "
          :style="{
            fontSize: '0.85rem',
            fontStyle: 'italic',
            color: '#666',
            padding: '0.3rem 0',
          }"
        >
          {{ (part as any).input?.message ?? (part as any).output ?? '' }}
        </div>

        <!-- Tool calls -->
        <details
          v-else-if="part.type.startsWith('tool-') || part.type === 'dynamic-tool'"
          :style="{
            fontSize: '0.8rem',
            padding: '0.4rem 0.6rem',
            margin: '0.3rem 0',
            background: isUser ? 'rgba(255,255,255,0.1)' : '#e8e8e8',
            borderRadius: '6px',
            fontFamily: 'monospace',
          }"
        >
          <summary :style="{ cursor: 'pointer' }">
            <strong>{{
              part.type === 'dynamic-tool'
                ? ((part as any).toolName ?? 'tool')
                : part.type.replace('tool-', '')
            }}</strong>
            <span :style="{ color: '#888' }">
              ({{
                (part as any).state === 'output'
                  ? 'done'
                  : (part as any).state === 'output-error'
                    ? 'error'
                    : 'running...'
              }})
            </span>
          </summary>

          <div :style="{ marginTop: '0.35rem', display: 'grid', gap: '0.35rem' }">
            <div :style="{ color: '#666' }">
              toolCallId: {{ (part as any).toolCallId }}
            </div>

            <div v-if="(part as any).input !== undefined">
              <div :style="{ color: '#666', marginBottom: '4px' }">Input</div>
              <pre
                :style="{
                  margin: 0,
                  padding: '0.4rem 0.5rem',
                  borderRadius: '6px',
                  background: isUser ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.65)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }"
              >{{ pretty((part as any).input) }}</pre>
            </div>

            <div v-if="(part as any).output !== undefined">
              <div :style="{ color: '#666', marginBottom: '4px' }">Output</div>
              <pre
                :style="{
                  margin: 0,
                  padding: '0.4rem 0.5rem',
                  borderRadius: '6px',
                  background: isUser ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.65)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }"
              >{{ pretty((part as any).output) }}</pre>
            </div>

            <div v-if="(part as any).errorText" :style="{ color: '#b00' }">
              Error: {{ (part as any).errorText }}
            </div>
          </div>
        </details>
      </template>
    </div>
  </div>
</template>
