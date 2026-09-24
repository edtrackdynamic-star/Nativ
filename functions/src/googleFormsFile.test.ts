import { describe, expect, it } from 'vitest'
import { readGoogleFormsFile } from './googleFormsFile'

function xlsxWithSheet(xml: string): string {
  const name = Buffer.from('xl/worksheets/sheet1.xml')
  const data = Buffer.from(xml)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  const offset = local.length + name.length + data.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + name.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([local, name, data, central, name, end]).toString('base64')
}

describe('Google Forms export parsing', () => {
  it('reads a CSV with Hebrew and quoted line breaks', () => {
    const csv = Buffer.from('\uFEFFשם,נימוק\r\nדנה,"שורה אחת\nשורה שנייה"\r\n').toString('base64')
    expect(readGoogleFormsFile(csv, 'תגובות.csv')).toEqual([['שם', 'נימוק'], ['דנה', 'שורה אחת\nשורה שנייה']])
  })

  it('reads an XLSX worksheet with inline strings and gaps between cells', () => {
    const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>שם</t></is></c><c r="C1" t="inlineStr"><is><t>קורס</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>דנה</t></is></c><c r="C2" t="inlineStr"><is><t>עדיפות ראשונה</t></is></c></row></sheetData></worksheet>'
    expect(readGoogleFormsFile(xlsxWithSheet(xml), 'תגובות.xlsx')).toEqual([['שם', , 'קורס'], ['דנה', , 'עדיפות ראשונה']])
  })

  it('rejects spreadsheet formulas instead of importing evaluated values', () => {
    const xml = '<worksheet><sheetData><row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>'
    expect(() => readGoogleFormsFile(xlsxWithSheet(xml), 'תגובות.xlsx')).toThrow('נוסחאות')
  })
})
