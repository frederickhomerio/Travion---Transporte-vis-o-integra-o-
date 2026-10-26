// Leitura do .xlsx com ExcelJS. Só valores: fórmulas não são calculadas (usamos o último resultado
// gravado pelo Excel) e macros não são carregadas.

import type { Aba, Celula } from './planilha';

export async function lerPlanilha(dados: ArrayBuffer): Promise<Aba[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(dados);
  const abas: Aba[] = [];
  wb.eachSheet((ws) => {
    const linhas: Celula[][] = [];
    const maxCol = ws.columnCount;
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cels: Celula[] = [];
      for (let c = 1; c <= maxCol; c++) cels.push(converter(row.getCell(c).value));
      linhas.push(cels);
    }
    abas.push({ nome: ws.name, oculta: ws.state !== 'visible', linhas });
  });
  return abas;
}

type ValorExcel = unknown;

function converter(v: ValorExcel): Celula {
  if (v === null || v === undefined) return { v: null };
  if (typeof v !== 'object' || v instanceof Date) return { v };
  const o = v as Record<string, unknown>;
  if ('formula' in o || 'sharedFormula' in o) {
    const res = o.result;
    const f = String(o.formula ?? o.sharedFormula ?? '');
    if (res && typeof res === 'object' && 'error' in (res as object)) return { v: null, f };
    return { v: res ?? null, f };
  }
  if ('richText' in o && Array.isArray(o.richText)) {
    return { v: (o.richText as Array<{ text: string }>).map((t) => t.text).join('') };
  }
  if ('text' in o) return { v: o.text };
  if ('error' in o) return { v: null };
  return { v: null };
}
