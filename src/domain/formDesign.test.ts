import { expect,it } from 'vitest'
import { parseFormDesign,safeLink } from './formDesign'
it('rejects executable links and misleading Docs domains',()=>{for(const url of ['javascript:alert(1)','http://docs.google.com/document/d/x','https://docs.google.com.evil.example/document/d/x','https://user:password@docs.google.com/document/d/x'])expect(()=>safeLink(url,true)).toThrow()})
it('accepts Docs links and bounds the editable text and palette',()=>{expect(safeLink('https://docs.google.com/document/d/x/edit',true)).toContain('/document/d/x/');expect(()=>parseFormDesign({title:'a'.repeat(151)})).toThrow();expect(()=>parseFormDesign({theme:'red'})).toThrow();expect(parseFormDesign({title:'בחירה'}).title).toBe('בחירה')})
it('keeps old document links visible but lets new cycles hide an optional link',()=>{
  expect(parseFormDesign({documentUrl:'https://docs.google.com/document/d/x/edit'}).documentLinkVisible).toBe(true)
  expect(parseFormDesign({documentUrl:'https://docs.google.com/document/d/x/edit',documentLinkVisible:false}).documentLinkVisible).toBe(false)
  expect(()=>parseFormDesign({documentLinkVisible:'yes'})).toThrow()
})
