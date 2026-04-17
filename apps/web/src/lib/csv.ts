/** Download any array of objects as a CSV file. */
export function downloadCsv(rows: Record<string, unknown>[], filename: string): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]!);
  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const v = row[h] ?? '';
          const s = String(v).replace(/"/g, '""');
          return s.includes(',') || s.includes('\n') || s.includes('"') ? `"${s}"` : s;
        })
        .join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
