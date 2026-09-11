const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadUtils() {
  const context = vm.createContext({
    window: {},
    document: { querySelector() { return null; } },
  });
  vm.runInContext(fs.readFileSync('frontend/result-tracker-grid.js', 'utf8'), context);
  return context.window.ResultTrackerGridUtils;
}

test('parses Result CSV by Test ID and Result', () => {
  const utils = loadUtils();
  const rows = utils.parseResultCsv('\uFEFFTest ID,Result,Logged time\nVSTS118015,Passed,now\nVSTS117749,Failed,now\n');
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { testCaseId: '118015', result: 'Passed' },
    { testCaseId: '117749', result: 'Failed' },
  ]);
});

test('parses TestResult TXT VSTS rows and ignores group rows', () => {
  const utils = loadUtils();
  const rows = utils.parseTestResultTxt('Test\tDuration\nClass: Sample Passed Stale\nVSTS24153 Passed Stale\t5.5 min\nVSTS24846 Failed Stale\t4.7 min\n');
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { testCaseId: '24153', result: 'Passed' },
    { testCaseId: '24846', result: 'Failed' },
  ]);
});

test('Passed wins when imported sources disagree', () => {
  const utils = loadUtils();
  assert.equal(utils.mergeResult('Passed', 'Failed'), 'Passed');
  assert.equal(utils.mergeResult('Failed', 'Passed'), 'Passed');
  assert.equal(utils.mergeResult('', 'Failed'), 'Failed');
});
