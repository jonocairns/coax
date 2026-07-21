import type { ProviderChannelView } from "./provider";

export function filterChannels(
  channels: readonly ProviderChannelView[],
  selectedCategory: string | null,
  query: string,
): readonly ProviderChannelView[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery) {
    return channels.filter((channel) =>
      channel.name.toLocaleLowerCase().includes(normalizedQuery),
    );
  }
  return channels.filter((channel) => channel.categoryId === selectedCategory);
}
