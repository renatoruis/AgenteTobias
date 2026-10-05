// React 19.3 in this repo ships without .d.ts. These declarations cover the
// client until the platform package adds @types/react.

declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [elemName: string]: any
  }
}

declare module "react" {
  export type SetStateAction<S> = S | ((prev: S) => S)
  export type Dispatch<A> = (value: A) => void

  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>]
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T
  export function useRef<T>(initial: T): { current: T }

  export function StrictMode(props: { children?: unknown }): JSX.Element

  export interface FormEvent<T = Element> {
    currentTarget: T
    preventDefault(): void
  }

  export interface PointerEvent<T = Element> {
    currentTarget: T
    button: number
    isPrimary: boolean
    pointerId: number
    preventDefault(): void
  }

  export interface SyntheticEvent<T = Element> {
    currentTarget: T
    preventDefault(): void
  }
}

declare module "react/jsx-runtime" {
  export function jsx(type: any, props: any, key?: any): JSX.Element
  export function jsxs(type: any, props: any, key?: any): JSX.Element
  export const Fragment: (props: { children?: unknown }) => JSX.Element
}

declare module "react-dom/client" {
  export function createRoot(container: Element): {
    render(node: unknown): void
  }
}
