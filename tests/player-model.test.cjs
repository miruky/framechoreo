const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/framechoreo/assets/model.js');
const cell = v => ({type:'integer',value:String(v),display:String(v)});
const fixture = () => ({format:'framechoreo.story',schema_version:1,timeline:['s','g'],steps:[
  {id:'s',name:'Input',operation:'source',columns:['key','v'],rows:[
    {position:0,cells:[cell(1),cell(10)],parents:[],cell_parents:{}},
    {position:1,cells:[cell(1),cell(20)],parents:[],cell_parents:{}}
  ],parents:[],parameters:{}},
  {id:'g',name:'Sum',operation:'group_sum',columns:['key','v'],rows:[
    {position:0,cells:[cell(1),cell(30)],parents:[{step:'s',row:0},{step:'s',row:1}],
      cell_parents:{key:[{step:'s',row:0,column:'key'}],v:[{step:'s',row:0,column:'v'},{step:'s',row:1,column:'v'}]}}
  ],parents:['s'],parameters:{by:['key'],value:'v',dropna:false,sort:false,min_count:1,groups:[{output_row:0,input_rows:[0,1]}]}}
]});
test('a group_sum has distinct grouping and summing scenes',()=>{
  assert.deepEqual(m.scenes(fixture()).map(s=>s.kind),['source','group','sum']);
});
test('origins retain exact values and order',()=>{
  const d=fixture();assert.deepEqual(m.traceCell(d,{step:'g',row:0,column:'v'}).map(x=>x.cell.value),['10','20']);
});
test('repeated inputs are not collapsed',()=>{
  const d=fixture();d.steps[1].rows[0].cell_parents.v.push({step:'s',row:0,column:'v'});
  assert.deepEqual(m.traceCell(d,{step:'g',row:0,column:'v'}).map(x=>x.row),[0,1,0]);
});
test('missing lineage yields no guessed input',()=>{
  const d=fixture();d.steps[1].rows[0].cell_parents.v=[];
  assert.deepEqual(m.traceCell(d,{step:'g',row:0,column:'v'}),[]);
});
test('limits and invalid formats fail explicitly',()=>{
  assert.throws(()=>m.indexStory({}),/Unsupported/);
  assert.throws(()=>m.traceCell(fixture(),{step:'g',row:0,column:'v'},1),/too many/);
  assert.throws(()=>m.traceCell(fixture(),{step:'g',row:5,column:'v'}),/Invalid/);
});
test('untrusted names are returned as data',()=>{
  const d=fixture();d.steps[0].name='<img onerror=alert(1)>';
  assert.equal(m.traceCell(d,{step:'s',row:0,column:'v'})[0].source,d.steps[0].name);
});
test('a result annotation does not appear before that result exists',()=>{
  const d=fixture();d.steps[1].presentation={note:'Select the total 30.',hold_ms:4000};
  const output=m.scenes(d);
  assert.equal(output[1].step.presentation.note,'');
  assert.equal(output[2].step.presentation.note,'Select the total 30.');
  assert.equal(d.steps[1].presentation.note,'Select the total 30.');
});
