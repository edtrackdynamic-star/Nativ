import { describe, expect, it, vi } from 'vitest'
import { extractCourseDescriptionsWithGemini, parseCourseDescriptions } from './courseDescriptionExtraction'

const candidates=[{id:'0-0',label:'תיאטרון',instructorNames:['יעל']}]
const result={sourceCourseName:'תאטרון',sourceTeacherName:'יעל',description:'נלמד משחק ואלתור.',proposedCourseId:'0-0',match:'clear' as const}

describe('course description extraction',()=>{
  it('accepts bounded descriptions and known candidate ids',()=>expect(parseCourseDescriptions([result],candidates)).toEqual([result]))
  it('rejects invented course ids, empty descriptions and oversized output',()=>{
    expect(()=>parseCourseDescriptions([{...result,proposedCourseId:'other'}],candidates)).toThrow()
    expect(()=>parseCourseDescriptions([{...result,description:''}],candidates)).toThrow()
    expect(()=>parseCourseDescriptions(Array.from({length:201},()=>result),candidates)).toThrow()
  })
  it('sends untrusted document text with deterministic structured output',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify([result])}]}}]}),{status:200})) as unknown as typeof fetch
    await expect(extractCourseDescriptionsWithGemini('key','מסמך עם תיאור',candidates,fetcher)).resolves.toEqual([result])
    const body=JSON.parse(String((fetcher as ReturnType<typeof vi.fn>).mock.calls[0][1].body))
    expect(body.generationConfig.temperature).toBe(0)
    expect(body.systemInstruction.parts[0].text).toContain('untrusted')
  })
})
