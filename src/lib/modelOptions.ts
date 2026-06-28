export const AUTO_CHAT_MODEL = 'model-router';
export const STARTER_CHAT_MODELS = [AUTO_CHAT_MODEL, 'gpt-5.4'] as const;

export function chatModelLabel(model: string): string {
  return model === AUTO_CHAT_MODEL ? 'Auto' : model;
}

export function normalizeChatModelOptions(primary?: string, options: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...STARTER_CHAT_MODELS, primary, ...options]) {
    const model = raw?.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    out.push(model);
  }
  return out;
}

export function chatModelOverride(model?: string): string | undefined {
  const value = model?.trim();
  if (!value || value === AUTO_CHAT_MODEL) return undefined;
  return value;
}