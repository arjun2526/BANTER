import { createMiddleware } from "@tanstack/react-start";

/**
 * Require a verified BANTER session before a server function accesses
 * user-owned data. Always scope database queries to context.userId.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { assertSameSiteRequest } = await import("./isolation.server");
    const { requireUserId } = await import("./verify.server");
    assertSameSiteRequest();
    const userId = await requireUserId();
    return next({ context: { userId } });
  },
);
