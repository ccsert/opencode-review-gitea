declare module 'hono' {
  export interface ContextVariableMap {}

  export type Next = () => Promise<void>

  export interface HonoRequest {
    header(name: string): string | undefined
    query(name: string): string | undefined
    param(): Record<string, string>
    param(name: string): string
    valid<T = unknown>(type: string): T
    text(): Promise<string>
    json<T = unknown>(): Promise<T>
    method: string
    path: string
    url: string
    raw: Request
  }

  export interface HonoResponse {
    status: number
    headers: Headers
  }

  export class Context<E = unknown, P extends string = string, I = unknown> {
    req: HonoRequest
    res: HonoResponse

    json: <T>(data: T, status?: number) => Response
    text: (text: string, status?: number) => Response
    html: (html: string, status?: number) => Response

    set: <K extends keyof ContextVariableMap>(key: K, value: ContextVariableMap[K]) => void
    get: <K extends keyof ContextVariableMap>(key: K) => ContextVariableMap[K]

    env: E
    finalized: boolean
    error?: Error
    event?: unknown
  }

  export type Handler<E = unknown, P extends string = string, I = unknown> = (
    c: Context<E, P, I>,
    next: Next
  ) => unknown | Promise<unknown>
  
  export type MiddlewareHandler<E = unknown, P extends string = string, I = unknown> = Handler<E, P, I>

  export class Hono<E = unknown> {
    use(path: string, ...handlers: MiddlewareHandler<E>[]): this
    use(...handlers: MiddlewareHandler<E>[]): this
    get<P extends string = string>(path: P, ...handlers: Handler<E, P>[]): this
    post<P extends string = string>(path: P, ...handlers: Handler<E, P>[]): this
    put<P extends string = string>(path: P, ...handlers: Handler<E, P>[]): this
    patch<P extends string = string>(path: P, ...handlers: Handler<E, P>[]): this
    delete<P extends string = string>(path: P, ...handlers: Handler<E, P>[]): this
    all<P extends string = string>(path: P, ...handlers: Handler<E, P>[]): this
    route(path: string, app: Hono<E>): this
    notFound(handler: (c: Context<E>) => Response | Promise<Response>): this
    onError(handler: (err: Error, c: Context<E>) => Response | Promise<Response>): this
    fetch: (request: Request) => Promise<Response>
  }
}

declare module 'hono/secure-headers' {
  import { MiddlewareHandler } from 'hono'
  export function secureHeaders(): MiddlewareHandler
}

declare module 'hono/cors' {
  import { MiddlewareHandler } from 'hono'
  export interface CorsOptions {
    origin?: string | string[] | ((origin: string) => string | undefined | null)
    allowMethods?: string[]
    allowHeaders?: string[]
    maxAge?: number
    credentials?: boolean
    exposeHeaders?: string[]
  }
  export function cors(options?: CorsOptions): MiddlewareHandler
}
