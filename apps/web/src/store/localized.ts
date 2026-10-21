/**
 * A record whose values are picked in the language in use every time they are read:
 * for the label tables that components import as constants (`VERDICT[v].word`).
 */
export function localizedRecord<K extends string, V>(build: () => Record<K, V>): Record<K, V> {
  return new Proxy({} as Record<K, V>, {
    get: (_target, key) => (typeof key === 'string' ? build()[key as K] : undefined),
    has: (_target, key) => typeof key === 'string' && key in build(),
    ownKeys: () => Reflect.ownKeys(build()),
    getOwnPropertyDescriptor: (_target, key) => {
      const all = build();
      return typeof key === 'string' && key in all
        ? { value: all[key as K], enumerable: true, configurable: true, writable: false }
        : undefined;
    },
  });
}
