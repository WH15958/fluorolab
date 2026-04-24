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
  filename: string
): { data: DataPoint[]; xLabel: string; yLabel: string } {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('%'));

  if (lines.length === 0) throw new Error('文件内容为空');

  // Detect delimiter
  const firstLine = lines[0];
  let delimiter = ',';
  if (firstLine.includes('\t')) delimiter = '\t';
  else if (firstLine.includes(';')) delimiter = ';';
  else if (firstLine.includes(',')) delimiter = ',';
  else delimiter = ' ';

  // Check if first line is header
  const firstTokens = firstLine.split(delimiter).map((t) => t.trim());
  let xLabel = 'X';
  let yLabel = 'Intensity';
  let dataLines = lines;

  const firstIsNum = firstTokens.every((t) => !isNaN(parseFloat(t)));
  if (!firstIsNum && firstTokens.length >= 2) {
    xLabel = firstTokens[0] || 'X';
    yLabel = firstTokens[1] || 'Intensity';
    dataLines = lines.slice(1);
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
    if (parts.length < 2) continue;
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
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
  type: 'steady-state' | 'transient'
): Promise<FluorescenceDataset> {
  const content = await readFileAsText(file);
  const { data, xLabel, yLabel } = parseFileContent(content, file.name);

  return {
    id: `ds-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    type,
    rawData: data,
    xLabel,
    yLabel,
  };
}

export async function readIRFFromFile(file: File): Promise<IRFDataset> {
  const content = await readFileAsText(file);
  const { data } = parseFileContent(content, file.name);
  return {
    id: `irf-${Date.now()}`,
    name: file.name,
    data,
  };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}
