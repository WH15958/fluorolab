import type { DataPoint, FluorescenceDataset, IRFDataset } from '../types/fluorescence';

/**
 * Parse raw text content (TXT or CSV) into DataPoint array.
 * Supports:
 *   - comma / tab / space / semicolon delimiters
 *   - comment lines starting with # or %
 *   - header lines (auto-skip if first token is non-numeric)
 */
export function parseFileContent(
  content: string,
  filename: string,
  yColumn: number = 1
): { data: DataPoint[]; xLabel: string; yLabel: string } {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('%'));

  if (lines.length === 0) throw new Error('文件内容为空');

  // Find the first data-like line (starts with a number) for delimiter detection
  // This handles instrument files with metadata headers that use different delimiters
  function findFirstNumericLine(ls: string[]): number {
    for (let i = 0; i < ls.length; i++) {
      const first = ls[i].trim().split(/\s+/)[0];
      if (first && !isNaN(parseFloat(first))) return i;
    }
    return -1;
  }
  const dataStartLine = findFirstNumericLine(lines);
  const delimLine = dataStartLine >= 0 ? lines[dataStartLine] : lines[0];

  // Detect delimiter from the data line (or fall back to first line)
  let delimiter: string;
  if (delimLine.includes('\t')) delimiter = '\t';
  else if (delimLine.includes(';')) delimiter = ';';
  else if (delimLine.includes(',')) delimiter = ',';
  else delimiter = ' ';

  // Check if first line is header
  const firstTokens = lines[0].split(delimiter).map((t) => t.trim());
  let xLabel = 'X';
  let yLabel = 'Intensity';
  let dataLines = lines;

  const firstIsNum = firstTokens.every((t) => !isNaN(parseFloat(t)));
  if (!firstIsNum && firstTokens.length >= 2) {
    xLabel = firstTokens[0] || 'X';
    yLabel = firstTokens[1] || 'Intensity';
    dataLines = lines.slice(1);
  }

  // If data uses a different delimiter than the header line, re-split header properly
  if (dataStartLine > 0 && delimiter !== ' ' && lines[0].split(delimiter).length < 2) {
    dataLines = lines;
  }

  // Infer labels from filename
  if (xLabel === 'X') {
    const lower = filename.toLowerCase();
    if (lower.includes('nm') || lower.includes('wavelength') || lower.includes('wave')) {
      xLabel = 'Wavelength (nm)';
    } else if (lower.includes('time') || lower.includes('ns') || lower.includes('ps')) {
      xLabel = 'Time (ns)';
    }
  }

  const data: DataPoint[] = [];
  for (const line of dataLines) {
    const parts = line.split(delimiter).map((t) => t.trim()).filter(Boolean);
    if (parts.length <= Math.max(1, yColumn)) continue;
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[yColumn]);
    if (!isNaN(x) && !isNaN(y)) {
      data.push({ x, y });
    }
  }

  if (data.length === 0) throw new Error('无法解析有效数据点，请检查文件格式');

  // Sort by x
  data.sort((a, b) => a.x - b.x);

  return { data, xLabel, yLabel };
}

/**
 * Read a File object and return parsed dataset
 */
export async function readDatasetFromFile(
  file: File,
  type: 'steady-state' | 'transient',
  yColumn?: number
): Promise<FluorescenceDataset> {
  const content = await readFileAsText(file);
  const { data, xLabel, yLabel } = parseFileContent(content, file.name, yColumn);

  return {
    id: `ds-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    type,
    rawData: data,
    xLabel,
    yLabel,
  };
}

export async function readIRFFromFile(file: File, yColumn?: number): Promise<IRFDataset> {
  const content = await readFileAsText(file);
  const { data } = parseFileContent(content, file.name, yColumn);
  return {
    id: `irf-${Date.now()}`,
    name: file.name,
    data,
  };
}

export interface FileColumnInfo {
  count: number;
  headers: string[];
}

/**
 * Detect number of columns and column headers from a multi-column file.
 * Looks for a "Labels" row (Edinburgh format) or uses first data line.
 */
export function detectColumns(content: string): FileColumnInfo {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('%'));

  // Check for Edinburgh-style "Labels" row with column names
  for (const line of lines) {
    if (/^labels/i.test(line) && line.includes('\t')) {
      const headers = line.split('\t').map((t) => t.trim()).filter(Boolean);
      if (headers.length >= 3) {
        return { count: headers.length, headers };
      }
    }
  }

  // Fall back to the first data line
  for (const line of lines) {
    const parts = line.split('\t').map((t) => t.trim()).filter(Boolean);
    if (parts.length >= 2 && !isNaN(parseFloat(parts[0]))) {
      return { count: parts.length, headers: parts.map((_, i) => `Column ${i + 1}`) };
    }
  }

  return { count: 2, headers: ['X', 'Y'] };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}
