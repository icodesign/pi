export interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface EventBusController extends EventBus {
	clear(): void;
}

export function createEventBus(): EventBusController {
	const listeners = new Map<string, Set<{ handler: (data: unknown) => void }>>();
	return {
		emit: (channel, data) => {
			for (const listener of [...(listeners.get(channel) ?? [])]) {
				try {
					const result = listener.handler(data);
					void Promise.resolve(result).catch((error) => {
						console.error(`Event handler error (${channel}):`, error);
					});
				} catch (error) {
					console.error(`Event handler error (${channel}):`, error);
				}
			}
		},
		on: (channel, handler) => {
			const channelListeners = listeners.get(channel) ?? new Set();
			const listener = { handler };
			channelListeners.add(listener);
			listeners.set(channel, channelListeners);
			return () => {
				channelListeners.delete(listener);
				if (channelListeners.size === 0) listeners.delete(channel);
			};
		},
		clear: () => {
			listeners.clear();
		},
	};
}
