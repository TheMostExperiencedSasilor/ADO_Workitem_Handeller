const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadUtils() {
  const context = vm.createContext({
    window: {},
    document: { querySelector() { return null; } },
    setTimeout() {},
  });
  vm.runInContext(fs.readFileSync('frontend/test-planner-enhancements.js', 'utf8'), context);
  return context.window.TestPlannerEnhancements;
}

test('Sample classification is based only on Product Area', () => {
  const utils = loadUtils();
  assert.equal(utils.isSampleProductArea('Sample Files_HYSYS'), true);
  assert.equal(utils.isSampleProductArea(' sample files_hysys '), true);
  assert.equal(utils.isSampleProductArea('Dynamics'), false);
  assert.equal(utils.isSampleProductArea(''), false);
});

test('mixed sample and non-sample selections create two playlists', () => {
  const utils = loadUtils();
  const playlists = utils.buildPlaylistSet([
    { testCaseId: 24153, title: 'Anything', productArea: 'Sample Files_HYSYS' },
    { testCaseId: 30000, title: 'Contains Samples but is not sample area', productArea: 'Dynamics' },
  ]);

  assert.equal(playlists.length, 2);
  const normal = playlists.find((item) => item.kind === 'normal');
  const sample = playlists.find((item) => item.kind === 'sample');
  assert.equal(normal.fileName, 'Playlist_NonSample.playlist');
  assert.equal(sample.fileName, 'Playlist_Sample.playlist');
  assert.match(normal.xml, /Class" Value="ProductTestCase"/);
  assert.match(normal.xml, /VSTS30000/);
  assert.doesNotMatch(normal.xml, /VSTS24153/);
  assert.match(sample.xml, /Class" Value="ClassSampleTest"/);
  assert.match(sample.xml, /VSTS24153/);
  assert.doesNotMatch(sample.xml, /VSTS30000/);
});

test('single classification preserves one Playlist.playlist output', () => {
  const utils = loadUtils();
  const playlists = utils.buildPlaylistSet([
    { testCaseId: 'VSTS123', productArea: 'Sample Files_HYSYS' },
    { testCaseId: 'VSTS123', productArea: 'Sample Files_HYSYS' },
  ]);
  assert.equal(playlists.length, 1);
  assert.equal(playlists[0].fileName, 'Playlist.playlist');
  assert.equal(playlists[0].total, 1);
});
