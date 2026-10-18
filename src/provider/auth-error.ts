import { AuthenticationError, InternalError, NotAllowedError, NotFoundError } from "surrealdb";

/** Only for failed identity authentication; never classify arbitrary query failures. */
export function isIdentityAuthRefusal(error: unknown): boolean {
  // Empty record SIGNIN is InternalError in 3.0.1 and NotFoundError in 3.2.0.
  // Both observed responses have this exact message and no resource details.
  const emptySignin = (error instanceof InternalError || error instanceof NotFoundError) &&
    error.message === "No record was returned" && error.details === undefined;
  return emptySignin || error instanceof AuthenticationError ||
    (error instanceof NotAllowedError && (error.isInvalidAuth || error.isTokenExpired));
}
