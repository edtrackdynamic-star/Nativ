import { expect, it } from 'vitest'
import { proposeCapacities } from './capacityPlanning'

it('distributes 100 students over six courses using integers',()=>{
  const result=proposeCapacities(100,0,Array.from({length:6},()=>({minimum:0})))
  expect(result.capacities.map(c=>c.target)).toEqual([17,17,17,17,16,16])
  expect(result.totalSeats).toBe(100)
})
it('redistributes a limited course share and never exceeds its cap with flexibility',()=>{
  const result=proposeCapacities(100,2,[{minimum:0,limit:12},...Array.from({length:5},()=>({minimum:0}))])
  expect(result.capacities.map(c=>c.target)).toEqual([12,18,18,18,17,17])
  expect(result.capacities[0].maximum).toBe(12)
  expect(result.unplaced).toBe(0)
})
it('reports insufficient caps and impossible minima',()=>{
  expect(proposeCapacities(30,10,[{minimum:0,limit:10},{minimum:0,limit:12}]).unplaced).toBe(8)
  expect(()=>proposeCapacities(10,0,[{minimum:11}])).toThrow()
  expect(()=>proposeCapacities(0,0,[{minimum:0}])).toThrow()
  expect(()=>proposeCapacities(10,0,[{minimum:0,limit:1.5}])).toThrow()
})
it('honors minimum opening size and handles more courses than students',()=>{
  expect(proposeCapacities(20,0,[{minimum:15},{minimum:0}]).capacities.map(c=>c.target)).toEqual([15,5])
  expect(proposeCapacities(1,0,[{minimum:0},{minimum:0}]).capacities.map(c=>c.target)).toEqual([1,0])
})
