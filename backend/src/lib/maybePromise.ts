export type MaybePromise<T> = T | Promise<T>;

export function mapMaybePromise<T, U>(
  value: MaybePromise<T>,
  map: (resolved: T) => U,
): MaybePromise<U> {
  return value instanceof Promise ? value.then(map) : map(value);
}

export function flatMapMaybePromise<T, U>(
  value: MaybePromise<T>,
  map: (resolved: T) => MaybePromise<U>,
): MaybePromise<U> {
  return value instanceof Promise ? value.then(map) : map(value);
}
