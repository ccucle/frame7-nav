'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../fitplan/core.js');
const Nutrition = require('../fitplan/nutrition.js');
const Backup = require('../fitplan/backup.js');

function fixture() {
  const meal = { id:'meal1', date:'2026-11-23', start:'12:00', end:'12:30', type:'meal', title:'합성 점심', repeat:'none', completed:true, detail:{food:'닭가슴살(조리)',grams:150} };
  const workout = { id:'work1', date:'2026-11-16', start:'07:00', end:'08:00', type:'strength', title:'합성 웨이트', repeat:'weekly', doneDates:['2026-11-16','2026-11-23'], completed:true, detail:{exercise:'벤치프레스',sets:3,weight:60,reps:10,notes:'테스트'} };
  const weight = { id:'weight1', date:'2026-11-23', start:'06:00', end:'06:05', type:'weight', title:'합성 체중', repeat:'none', completed:true, detail:{weight:80,bodyfat:18.5} };
  const food = Nutrition.validateFood({ id:'custom1', name:'합성 제품', nameEn:'', brand:'', category:'', basisAmount:45, basisUnit:'g', nutrients:{kcal:180,protein:20,carbs:15,fat:5,unsat:null}, source:{kind:'user'} });
  const state=Core.normalizeState({events:[meal,workout,weight],settings:{protein:150,carbs:200,fat:50},customFoods:[food],favoriteFoodIds:['custom1']});
  const map=new Map();
  const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
  const saved=Core.makeStore(storage).save(state,state.revision);
  const before=storage.getItem(Core.STORE);
  const backup=Backup.makeBackup(Core,storage,new Date('2026-11-23T04:00:00Z'));
  const parsed=JSON.parse(backup.text);
  const restored=Core.normalizeState(parsed);
  return {map,storage,saved,before,backup,parsed,restored};
}

const checks=[
  ['completed meal calorie unchanged',x=>Nutrition.calculateMeal(x.restored.events[0].detail).kcal===247.5],
  ['recurring strength occurrences independent',x=>Object.keys(x.restored.events[1].occurrences).length===2],
  ['recurring strength completed volume unchanged',x=>Core.volume(Core.occurrence(x.restored.events[1],'2026-11-23').detail).volume===1800],
  ['actual weight and body-fat preserved',x=>x.restored.events[2].detail.weight===80&&x.restored.events[2].detail.bodyfat===18.5],
  ['custom food and null unsaturated-fat preserved',x=>x.restored.customFoods.length===1&&x.restored.customFoods[0].nutrients.unsat===null],
  ['favorite food ID preserved',x=>x.restored.favoriteFoodIds[0]==='custom1'],
  ['nutrition goals preserved',x=>x.restored.settings.protein===150&&x.restored.settings.fat===50],
  ['backup app marker and schema version preserved',x=>x.parsed.app==='formday'&&x.parsed.version===3],
  ['full normalized JSON round-trips without loss',x=>JSON.stringify(x.restored)===JSON.stringify(x.saved)],
  ['original browser raw bytes not overwritten',x=>x.before===x.map.get(Core.STORE)]
];
for (const [label,check] of checks) test('G1 preflight: '+label,()=>assert.equal(check(fixture()),true));

test('G1 preflight: corrupt browser record is rejected without mutation',()=>{
  const map=new Map([[Core.STORE,'{broken']]);
  const storage={getItem:key=>map.get(key)??null,setItem(){throw Error('unexpected write')}};
  assert.throws(()=>Backup.makeBackup(Core,storage),/기록을 읽을 수 없습니다/);
  assert.equal(map.get(Core.STORE),'{broken');
});

test('G1 preflight: no saved record cannot be mistaken for a successful backup',()=>{
  const storage={getItem:()=>null,setItem(){throw Error('unexpected write')}};
  assert.throws(()=>Backup.makeBackup(Core,storage),/아직 저장된 실제 기록/);
});
