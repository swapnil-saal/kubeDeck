import type { NextFunction, Request, Response } from "express";

const UNREACHABLE =
  /unable to connect to the server|context deadline exceeded|i\/o timeout|connection refused|no route to host|network is unreachable|tls handshake timeout|dial tcp|client\.timeout exceeded/i;

export function isUnreachableMessage(message: unknown): boolean {
  return typeof message === "string" && UNREACHABLE.test(message);
}

/**
 * A cluster that cannot be reached is not a server bug. Route handlers report any kubectl failure as
 * a 500 with the raw stderr; this turns the connectivity ones into a 503 with a plain message, so the
 * UI can say "can't reach this cluster" instead of retrying for a minute and showing a stack trace.
 */
export function reportUnreachableAs503(_req: Request, res: Response, next: NextFunction): void {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    const message = (body as { message?: unknown } | null)?.message;
    if (res.statusCode === 500 && isUnreachableMessage(message)) {
      res.status(503);
      return json({ message: "Can't reach the cluster. Check your VPN or network connection.", code: "unreachable", detail: String(message).slice(0, 200) });
    }
    return json(body);
  }) as Response["json"];
  next();
}
