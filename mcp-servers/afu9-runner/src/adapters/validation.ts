import { Runtime } from '../contracts/schemas';

/**
 * Shared validation utilities for executors
 */

/**
 * Validate that the requested runtime is supported by an adapter
 * @param runtime - The runtime to validate
 * @param supportedRuntime - The runtime supported by this adapter
 * @param adapterName - Name of the adapter (for error messages)
 * @throws Error if runtime is not supported
 */
export function validateRuntime(
  runtime: Runtime,
  supportedRuntime: Runtime,
  adapterName: string
): void {
  if (runtime !== supportedRuntime) {
    throw new Error(
      `Runtime ${runtime} not supported by ${adapterName}. Only '${supportedRuntime}' runtime is supported.`
    );
  }
}
