# task-loop e2e fixture

This small repo exists to dogfood the Pi task loop extension.

## Goal

Complete all tasks in `.agent/tasks.json` and keep `.agent/progress.md` current.

## Verify

```bash
npm test
```

## Example target usage

```js
sum([1, 2, 3]); // 6
average([2, 4, 6]); // 4
median([9, 1, 5]); // 5
mode(['b', 'a', 'b', 'a']); // 'b'
normalizeWhitespace('  hello   world\n again\tthere  '); // 'hello world again there'
slugify('Hello, World!'); // 'hello-world'
dedupeStable(['a', 'b', 'a', 'c']); // ['a', 'b', 'c']
chunk([1, 2, 3, 4, 5], 2); // [[1, 2], [3, 4], [5]]
parseCsvLine('a,"b,c",d'); // ['a', 'b,c', 'd']
```
