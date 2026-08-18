export type KeyParts = {
  readonly name: string;
  /** 末尾の '/' まで。ルート直下は空文字。 */
  readonly parentPrefix: string;
  /** 末尾 '/' 込みの祖先 prefix を浅い順に並べたもの。prefixes 表に入れる値。 */
  readonly ancestorPrefixes: readonly string[];
};

// 末尾の '/' の位置ごとに切って祖先を作る。reduce で組み立てるので let を使わない。
const ancestorsOf = (parentPrefix: string): readonly string[] =>
  parentPrefix
    .split('/')
    .slice(0, -1)
    .reduce<readonly string[]>((acc, segment) => {
      const previous = acc[acc.length - 1] ?? '';

      return [...acc, `${previous}${segment}/`];
    }, []);

export const keyPartsOf = (key: string): KeyParts => {
  const lastSlash = key.lastIndexOf('/');
  const parentPrefix = lastSlash === -1 ? '' : key.slice(0, lastSlash + 1);

  return { name: key.slice(lastSlash + 1), parentPrefix, ancestorPrefixes: ancestorsOf(parentPrefix) };
};
