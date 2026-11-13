import {test} from 'node:test';
import assert from 'node:assert/strict';
import {progressReader} from '../convert-video.mjs';
test('progresso calcula porcentagem e estimativa com dados fragmentados',()=>{let now=0;const reports=[],reader=progressReader(p=>reports.push(p),()=>now);reader.duration('Dura');reader.duration('tion: 00:02:00.00, start: 0');now=10000;reader.progress('out_time_us=3000');reader.progress('0000\nprogress=continue\n');assert.deepEqual(reports[0],{stage:'converting',percent:25,etaSeconds:30});now=20000;reader.progress('out_time_us=120000000\nprogress=end\n');assert.equal(reports[1].percent,99);assert.equal(reports[1].stage,'finalizing');});
test('duração desconhecida não inventa porcentagem ou previsão',()=>{const reports=[],reader=progressReader(p=>reports.push(p));reader.progress('out_time_us=N/A\nprogress=continue\n');assert.equal(reports[0].percent,null);assert.equal(reports[0].etaSeconds,null);});
