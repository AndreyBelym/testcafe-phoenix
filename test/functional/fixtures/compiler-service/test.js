const path       = require('path');
const { expect } = require('chai');


describe.only('Compiler service', () => {
    before(() => {
        process.env.TESTCAFE_PID = String(process.pid);
    });

    after(() => {
        delete process.env.TESTCAFE_PID;
    });

    it('Should execute a basic test', async () => {
        await runTests('testcafe-fixtures/index-test.js', 'Basic test');
    });

    it('Should handle an error', async () => {
        try {
            await runTests('testcafe-fixtures/index-test.js', 'Throw an error', { shouldFail: true })
        }
        catch (err) {
            expect(err).deep.equal([
                `The specified selector does not match any element in the DOM tree. ` +
                ` > | Selector('#not-exists') ` +
                ` [[user-agent]] ` +
                ` 5 |});` +
                ` 6 |` +
                ` 7 |test(\`Throw an error\`, async t => {` +
                ` 8 |    await t.expect(String(process.ppid)).eql(process.env.TESTCAFE_PID);` +
                ` 9 |` +
                ` > 10 |    await t.click(\'#not-exists\');` +
                ` 11 |});` +
                ` 12 |  at <anonymous> (${path.join(__dirname, 'testcafe-fixtures/index-test.js')}:10:13)`
            ]);
        }
    });
});
