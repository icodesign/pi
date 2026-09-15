import type { BashExecutor } from "../agent-session.ts";
import { executeBashWithOperations } from "../bash-executor.ts";
import { createLocalBashOperations } from "../tools/bash.ts";

/** Create the Node environment capability used by the full coding-agent SDK. */
export function createNodeBashExecutor(): BashExecutor {
	return async (command, cwd, options) => {
		const operations = options.operations ?? createLocalBashOperations({ shellPath: options.shellPath });
		return executeBashWithOperations(command, cwd, operations, {
			onChunk: options.onChunk,
			signal: options.signal,
		});
	};
}
