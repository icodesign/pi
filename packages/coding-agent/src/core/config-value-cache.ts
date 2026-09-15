const commandResultCache = new Map<string, string | undefined>();

export function hasConfigValueCache(key: string): boolean {
	return commandResultCache.has(key);
}

export function getConfigValueCache(key: string): string | undefined {
	return commandResultCache.get(key);
}

export function setConfigValueCache(key: string, value: string | undefined): void {
	commandResultCache.set(key, value);
}

export function clearConfigValueCache(): void {
	commandResultCache.clear();
}
