<script setup lang="ts">
import { NConfigProvider, NMessageProvider, darkTheme } from "naive-ui";
import AppContent from "./AppContent.vue";
</script>

<template>
  <n-config-provider :theme="darkTheme">
    <n-message-provider>
      <AppContent />
    </n-message-provider>
  </n-config-provider>
</template>
