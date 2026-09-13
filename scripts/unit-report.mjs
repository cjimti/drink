/* The node:test reporter for `make unit`: one line when every case
   passes, the way every other step reports, and the failures in full
   when one does not. node sets the exit code; this only prints.

   A throw before the first case, boot failing on the data say, fails
   the file rather than a case, and all node says of that is `test
   failed`. What the file wrote to stderr is the reason, so it is kept
   and shown only then. */
const indent = (text) => String(text).split('\n')
  .filter((l) => l.trim()).map((l) => `          ${l}\n`).join('');

export default async function* report(source) {
  let passed = 0;
  const failed = [];
  let stderr = '';
  for await (const { type, data } of source) {
    if (type === 'test:stderr') stderr += data.message;
    if (!data || data.nesting !== 0) continue;
    if (type === 'test:pass' && data.details.type !== 'suite') passed++;
    if (type === 'test:fail') {
      const err = data.details.error;
      const cause = (err && err.cause) || err;
      failed.push(`  UNIT    ${data.name}\n` + indent((cause && cause.message) || cause));
    }
  }
  if (failed.length) {
    yield failed.join('') + (stderr ? indent(stderr) : '');
    yield `  UNIT    ${failed.length} of ${passed + failed.length} case(s) failed\n`;
    return;
  }
  yield `  unit    ${passed} case(s): app.js run in node against the data, decoder, shelf codes, the gate, Next bottles, the QR and the stores\n`;
}
