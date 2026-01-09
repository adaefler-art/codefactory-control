export function scrollContainerToBottom(container: { scrollTop: number; scrollHeight: number } | null | undefined) {
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}
