export function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

export function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

export function median(values) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function mode(values) {
  if (values.length === 0) {
    return null;
  }

  const counts = new Map();
  let bestValue = values[0];
  let bestCount = 0;

  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);

    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  }

  return bestValue;
}

export function normalizeWhitespace(text) {
  return text.trim().replace(/\s+/g, ' ');
}

export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function dedupeStable(values) {
  return [...new Set(values)];
}

export function chunk(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

export function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}
