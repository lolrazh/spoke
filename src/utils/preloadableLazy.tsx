import {
  createElement,
  lazy,
  type ComponentProps,
  type ComponentType,
} from "react";

export type PreloadableComponent<P> = ComponentType<P> & {
  /** Load the chunk now; resolves once the component can render synchronously. */
  preload: () => Promise<unknown>;
};

/**
 * Like React.lazy, but once the chunk has been preloaded the component renders
 * synchronously instead of suspending for a frame. React.lazy always throws
 * its promise on first render, so a Suspense fallback flashes even when the
 * module is already in memory; this keeps a preloaded panel from ever showing
 * "Loading" at all.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same bound React.lazy uses
export function preloadableLazy<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): PreloadableComponent<ComponentProps<T>> {
  let loaded: T | null = null;
  let loading: Promise<{ default: T }> | null = null;

  const load = () =>
    (loading ??= loader().then((module) => {
      loaded = module.default;
      return module;
    }));
  const Lazy = lazy(load) as unknown as ComponentType<ComponentProps<T>>;

  const Preloadable = (props: ComponentProps<T>) =>
    createElement(loaded ?? Lazy, props);
  Preloadable.preload = load;
  return Preloadable;
}
