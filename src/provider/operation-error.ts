import { AuthenticationError, CallTerminatedError, ConnectionUnavailableError, HttpConnectionError,
  NotAllowedError, NotFoundError, ReconnectExhaustionError, UnexpectedConnectionError } from "surrealdb";
import { isIdentityAuthRefusal } from "./auth-error.ts";

export class OperationTimeout extends Error {
  constructor() { super("Database operation timed out"); }
}

/** A timeout bounds waiting; it cannot prove cancellation of a submitted write. */
export function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([work, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OperationTimeout()), ms);
  })]).finally(() => clearTimeout(timer));
}

/** Only return fixed text: SDK messages can contain credentials, queries and private URLs. */
export function operationError(error: unknown, connecting: boolean) {
  if ((connecting && isIdentityAuthRefusal(error)) || error instanceof AuthenticationError ||
      (error instanceof NotAllowedError && (error.isInvalidAuth || error.isTokenExpired))) {
    return { code: "invalid_credentials" as const, message: "Individual authentication was refused or expired. Verify the personal credential with your administrator." };
  }
  if (error instanceof NotAllowedError) return { code: "access_denied" as const, message: "The database refused this operation. Ask the administrator to verify your access." };
  if (connecting && error instanceof NotFoundError) return { code: "invalid_configuration" as const, message: "Tenant or authentication configuration was not found. Verify the administrator-provided connection details." };
  if (error instanceof OperationTimeout) return { code: "timeout" as const, message: "The database did not respond in time. Check network/VPN connectivity and service availability." };
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (error instanceof ConnectionUnavailableError || error instanceof UnexpectedConnectionError ||
      error instanceof CallTerminatedError || error instanceof ReconnectExhaustionError || error instanceof HttpConnectionError ||
      ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(String(code))) {
    return { code: "connection_failed" as const, message: "The database connection is unavailable or was interrupted. Check network/VPN connectivity and service availability." };
  }
  return { code: "unavailable" as const, message: "The database operation failed. Ask the administrator to check service health and configuration." };
}
